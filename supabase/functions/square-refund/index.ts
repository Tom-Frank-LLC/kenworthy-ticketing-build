// Refunds that actually reach the customer's card.
//
// The box-office refund button used to do one thing: UPDATE tickets SET
// status='refunded'. That was harmless while nothing was ever charged. The
// moment online checkout takes real money, it becomes a way to tell a patron
// "you've been refunded" while their card is never credited — the theatre's
// books say refunded, Square says paid, and the customer is out the money.
//
// This function claims the tickets (a conditional flip to refunded, so two
// overlapping refunds cannot both hold one ticket), issues the Square refund,
// and releases the claim if Square refuses. The money moves, or the record
// goes back the way it was.
//
// Four kinds of ticket arrive here, told apart by payment_method (plan.ts):
//   card/online — refunded through the Square Refunds API to the card
//   cash        — the till pays it back; a CASH tender recorded by
//                 square-cash-sale is reversed in Square for the books
//   film pass   — the deducted balance goes back on the pass, unless the pass
//                 is void or expired (refund_film_pass_redemption)
//   comp        — nothing was paid
//
// Staff or admin only, checked server-side against user_roles.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders, json, preflight } from '../_shared/http.ts';
import { requireRole } from '../_shared/callers.ts';
import { loadSquareConfig, refundPayment, squareErrorMessage } from '../_shared/square.ts';
import { actorHeaders, logStaffAction } from '../_shared/audit.ts';
import { centsOf, type ClaimedTicket, planRefund, refundKey } from './plan.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader.includes(ANON_KEY)) {
    return json({ error: 'Staff sign-in required' }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Authorise
  const user = await requireRole(req, admin, 'staff', {
    headers: corsHeaders,
    unauthorized: 'Staff sign-in required',
    forbidden: 'Staff access required',
  });
  if (user instanceof Response) return user;

  // Every write below goes through `db`, which names the verified caller to
  // the audit trigger (_shared/audit.ts, actorHeaders).
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: actorHeaders(user.id) },
  });

  // Which tickets
  const ticketIds: string[] = Array.isArray(body.ticket_ids)
    ? body.ticket_ids.filter((id: unknown) => typeof id === 'string')
    : [];
  const orderToken = typeof body.order_token === 'string' ? body.order_token : '';
  const reason = typeof body.reason === 'string' ? body.reason : 'Refunded at the box office';

  if (ticketIds.length === 0 && !orderToken) {
    return json({ error: 'Nothing to refund' }, 400);
  }

  let query = admin
    .from('tickets')
    .select('id, status, total_price, processing_fee, payment_method, square_payment_id, order_token, discount_id, discount_label');
  query = orderToken ? query.eq('order_token', orderToken) : query.in('id', ticketIds);

  const { data: tickets, error: readErr } = await query;
  if (readErr) {
    console.error('[square-refund] could not read tickets', readErr);
    return json({ error: 'Could not load those tickets' }, 500);
  }

  const refundable = (tickets || []).filter((t: any) => t.status === 'confirmed');
  if (refundable.length === 0) {
    return json({ error: 'Those tickets are not in a refundable state' }, 400);
  }

  const warnings: string[] = [];

  // A quantity discount was earned by the ORDER. Refunding part of one leaves
  // the rest of it holding a price that was only on offer for more tickets than
  // now remain. That is allowed — tickets are non-refundable, so every refund is
  // already a staff judgement (decided 21 Sep 2026; no claw-back, no block) —
  // but it should be a decision somebody knows they made, not a side effect.
  // The refund itself is untouched: each ticket returns exactly what it paid.
  for (const note of await partialDiscountNotes(admin, tickets ?? [])) warnings.push(note);

  // ---------------------------------------------------------------------
  // Claim the tickets before any money moves
  // ---------------------------------------------------------------------
  //
  // One conditional UPDATE: only rows still `confirmed` flip, and the rows it
  // returns are the only ones this request may refund. Two overlapping
  // requests (ticket A, and the whole order A+B) used to both read A as
  // confirmed and both refund it, under different idempotency keys; now one of
  // them gets A and the other gets only B (security audit 2026-10-06, L3).
  //
  // The flip comes first, so for the moments a Square call is in flight the
  // ticket reads refunded. If Square refuses, the claim is released below.
  const refundedAt = new Date().toISOString();
  const { data: claimedRows, error: claimErr } = await db
    .from('tickets')
    .update({ status: 'refunded', refunded_at: refundedAt })
    .in('id', refundable.map((t: any) => t.id))
    .eq('status', 'confirmed')
    .select('id, total_price, processing_fee, payment_method, square_payment_id');
  if (claimErr) {
    console.error('[square-refund] could not claim tickets', claimErr);
    return json({ error: 'Could not start the refund' }, 500);
  }
  const claimed = (claimedRows ?? []) as ClaimedTicket[];
  if (claimed.length === 0) {
    return json({ error: 'Those tickets were refunded a moment ago — reload before trying again.' }, 409);
  }
  if (claimed.length < refundable.length) {
    warnings.push(`${refundable.length - claimed.length} of those tickets were already being refunded elsewhere and were skipped.`);
  }

  /** Put tickets back to confirmed when their money did not move. */
  const release = async (ids: string[]) => {
    const { error } = await db
      .from('tickets')
      .update({ status: 'confirmed', refunded_at: null })
      .in('id', ids)
      .eq('status', 'refunded')
      .is('square_refund_id', null);
    if (error) console.error('[square-refund] could not release claim', error, ids);
  };

  const plan = planRefund(claimed);
  const squareRefunds: { payment_id: string; refund_id: string; amount_cents: number; tender: 'card' | 'cash' }[] = [];
  const refundedIds: string[] = [];
  let refundedCents = 0;
  const done = (rows: ClaimedTicket[]) => {
    refundedIds.push(...rows.map((r) => r.id));
    refundedCents += centsOf(rows);
  };

  const needsSquare = plan.card.size > 0 || [...plan.cash.keys()].some((k) => k);
  const square = needsSquare ? loadSquareConfig() : null;
  if (square && !square.ok) {
    await release(claimed.map((t) => t.id));
    return json({ error: square.error }, 500);
  }

  // ---------------------------------------------------------------------
  // Card: the money goes back to the card, and only then is it refunded
  // ---------------------------------------------------------------------
  for (const [paymentId, rows] of plan.card) {
    const amountCents = centsOf(rows);
    const result = await refundPayment(square!.config as any, {
      paymentId,
      amountCents,
      // Deterministic: retrying the same refund of the same tickets is the
      // same operation to Square, so a double-click cannot refund twice.
      idempotencyKey: await refundKey(paymentId, rows.map((r) => r.id)),
      reason,
    });
    const refund = result.data?.refund;
    if (!result.ok || !refund) {
      const message = squareErrorMessage(result.data, 'Square refused the refund');
      console.error('[square-refund] refund failed', paymentId, result.status);
      // Back to confirmed. A ticket marked refunded without the money going
      // back is the exact failure this function exists to stop.
      await release(rows.map((r) => r.id));
      warnings.push(`Square refund failed for payment ${paymentId}: ${message}`);
      continue;
    }
    const { error: stampErr } = await db
      .from('tickets')
      .update({ square_refund_id: refund.id ?? null })
      .in('id', rows.map((r) => r.id));
    if (stampErr) {
      console.error('[square-refund] refunded at Square but could not record the refund id', stampErr);
      warnings.push(`Payment ${paymentId} was refunded at Square (refund ${refund.id}) but the refund id could not be saved on the tickets.`);
    }
    squareRefunds.push({ payment_id: paymentId, refund_id: refund.id, amount_cents: amountCents, tender: 'card' });
    done(rows);
  }

  // ---------------------------------------------------------------------
  // Counter cash: the money comes out of the till
  // ---------------------------------------------------------------------
  for (const [paymentId, rows] of plan.cash) {
    const amountCents = centsOf(rows);
    warnings.push(
      `$${(amountCents / 100).toFixed(2)} was paid in cash — refund the customer from the till; no card was charged.`,
    );
    // square-cash-sale recorded the sale in Square as a CASH tender. Record its
    // reversal there too, so the dashboard and the till agree. No money moves
    // either way, so a refusal here does not undo the refund: it is a note.
    if (paymentId && amountCents > 0) {
      const result = await refundPayment(square!.config as any, {
        paymentId,
        amountCents,
        idempotencyKey: await refundKey(paymentId, rows.map((r) => r.id)),
        reason,
      });
      const refund = result.data?.refund;
      if (result.ok && refund) {
        await db.from('tickets').update({ square_refund_id: refund.id ?? null }).in('id', rows.map((r) => r.id));
        squareRefunds.push({ payment_id: paymentId, refund_id: refund.id, amount_cents: amountCents, tender: 'cash' });
      } else {
        console.error('[square-refund] cash refund not recorded in Square', paymentId, result.status);
        warnings.push(
          `The cash refund was not recorded in Square (${squareErrorMessage(result.data, 'refused')}). Tell a manager so the day's takings reconcile.`,
        );
      }
    }
    done(rows);
  }

  // ---------------------------------------------------------------------
  // Film pass: the balance goes back on the pass, in one locked statement
  // ---------------------------------------------------------------------
  for (const t of plan.filmPass) {
    const { data: redemptions } = await db
      .from('film_pass_redemptions')
      .select('id')
      .eq('ticket_id', t.id);
    for (const r of redemptions || []) {
      const { data: verdict, error } = await db.rpc('refund_film_pass_redemption', { p_redemption_id: r.id });
      if (error) {
        console.error('[square-refund] pass credit failed', r.id, error);
        warnings.push(`Could not credit the film pass behind ticket ${t.id}. Check the pass balance by hand.`);
      } else if (verdict?.result === 'pass_not_creditable') {
        warnings.push(
          `The film pass behind ticket ${t.id} is ${verdict.status}, so $${Number(verdict.amount).toFixed(2)} was not put back on it. A manager decides whether to make that good another way.`,
        );
      } else if (verdict?.result === 'no_pass') {
        warnings.push(`Could not find the film pass behind ticket ${t.id} to credit it back.`);
      }
    }
    done([t]);
  }

  for (const t of plan.manual) {
    warnings.push(
      `Ticket paid by ${t.payment_method} has no Square payment on file — refund the customer by hand; nothing was sent to a card.`,
    );
    done([t]);
  }
  done(plan.comp);

  const refundedTotal = round2(refundedCents / 100);

  // Who refunded what. The ticket rows are attributed by the actor header on
  // `db`; this entry carries what the rows cannot — the money and where it
  // went (security audit 2026-10-06, M11).
  await logStaffAction(user, 'tickets.refund', 'tickets', {
    reason,
    order_token: orderToken || null,
    requested: ticketIds.length || null,
    refunded_ticket_ids: refundedIds,
    refunded_total: refundedTotal,
    square_refunds: squareRefunds,
    warnings,
  });

  if (refundedIds.length === 0) {
    return json({ error: warnings[0] ?? 'Nothing could be refunded', warnings }, 400);
  }

  return json({
    success: true,
    refunded_ticket_ids: refundedIds,
    refunded_total: refundedTotal,
    square_refunds: squareRefunds,
    warnings,
  });
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One sentence per discounted order that this refund only partly covers.
 *
 * Counts what is left of the order in the database rather than trusting the
 * request, so it is right whether the caller sent ticket ids or an order token.
 */
async function partialDiscountNotes(admin: any, refunding: any[]): Promise<string[]> {
  const discounted = refunding.filter((t) => t.discount_id && t.order_token && t.status !== 'refunded');
  const tokens = [...new Set(discounted.map((t) => t.order_token as string))];
  if (tokens.length === 0) return [];

  const { data: siblings } = await admin
    .from('tickets')
    .select('id, order_token, status')
    .in('order_token', tokens)
    .in('status', ['confirmed', 'pending']);

  const refundingIds = new Set(refunding.map((t) => t.id));
  return tokens.flatMap((token) => {
    const staying = (siblings ?? []).filter((t: any) => t.order_token === token && !refundingIds.has(t.id)).length;
    if (staying === 0) return [];
    const mine = discounted.filter((t) => t.order_token === token);
    const label = mine.find((t) => t.discount_label)?.discount_label || 'a group discount';
    return [
      `${mine.length} ticket(s) refunded from an order sold with "${label}". ` +
        `${staying} ticket(s) from that order remain and keep the discounted price.`,
    ];
  });
}

