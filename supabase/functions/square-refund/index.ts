// Refunds that actually reach the customer's card.
//
// The box-office refund button used to do one thing: UPDATE tickets SET
// status='refunded'. That was harmless while nothing was ever charged. The
// moment online checkout takes real money, it becomes a way to tell a patron
// "you've been refunded" while their card is never credited — the theatre's
// books say refunded, Square says paid, and the customer is out the money.
//
// This function issues the Square refund first and only marks the ticket
// refunded if Square accepted it. Same discipline as checkout, in reverse:
// the money moves, then the record changes.
//
// Three kinds of ticket arrive here:
//   card      — has square_payment_id: refunded through the Square Refunds API
//   film pass — the deducted balance is returned to the pass it came from
//   cash/comp — nothing to refund electronically; marked refunded and reported
//               back as such, so staff know to open the till
//
// Staff or admin only, checked server-side against user_roles.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import { loadSquareConfig, refundPayment, squareErrorMessage } from '../_shared/square.ts';

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
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Staff sign-in required' }, 401);

  const { data: isStaff } = await admin.rpc('has_role', { _user_id: user.id, _role: 'staff' });
  if (!isStaff) return json({ error: 'Staff access required' }, 403);

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
    .select('id, status, total_price, processing_fee, payment_method, square_payment_id');
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
  const squareRefunds: { payment_id: string; refund_id: string; amount_cents: number }[] = [];
  const refundedIds: string[] = [];
  let refundedTotal = 0;

  // ---------------------------------------------------------------------
  // Card refunds, grouped by the payment that paid for them
  // ---------------------------------------------------------------------
  const byPayment = new Map<string, any[]>();
  const noPayment: any[] = [];

  for (const t of refundable) {
    if (t.square_payment_id) {
      const list = byPayment.get(t.square_payment_id) ?? [];
      list.push(t);
      byPayment.set(t.square_payment_id, list);
    } else {
      noPayment.push(t);
    }
  }

  if (byPayment.size > 0) {
    const square = loadSquareConfig();
    if (!square.ok) return json({ error: square.error }, 500);

    for (const [paymentId, rows] of byPayment) {
      // The buyer paid ticket total plus any grossed-up surcharge; refund both.
      const amount = round2(
        rows.reduce(
          (sum, t) => sum + Number(t.total_price || 0) + Number(t.processing_fee || 0),
          0,
        ),
      );
      const amountCents = Math.round(amount * 100);
      if (amountCents <= 0) {
        noPayment.push(...rows);
        continue;
      }

      // Deterministic key: retrying the same refund of the same tickets is the
      // same operation to Square, so a double-click cannot refund twice.
      const idempotencyKey = await refundKey(paymentId, rows.map((r) => r.id));

      const result = await refundPayment(square.config, {
        paymentId,
        amountCents,
        idempotencyKey,
        reason,
      });

      const refund = result.data?.refund;
      if (!result.ok || !refund) {
        const message = squareErrorMessage(result.data, 'Square refused the refund');
        console.error('[square-refund] refund failed', paymentId, JSON.stringify(result.data));
        // Leave these tickets confirmed. A ticket marked refunded without the
        // money going back is the exact failure this function exists to stop.
        warnings.push(`Square refund failed for payment ${paymentId}: ${message}`);
        continue;
      }

      const { error: updateErr } = await admin
        .from('tickets')
        .update({
          status: 'refunded',
          square_refund_id: refund.id ?? null,
          refunded_at: new Date().toISOString(),
        })
        .in('id', rows.map((r) => r.id));

      if (updateErr) {
        console.error('[square-refund] refunded at Square but DB update failed', updateErr);
        warnings.push(
          `Payment ${paymentId} was refunded at Square but the tickets could not be marked refunded. Do not retry — correct it in the admin.`,
        );
        continue;
      }

      squareRefunds.push({ payment_id: paymentId, refund_id: refund.id, amount_cents: amountCents });
      refundedIds.push(...rows.map((r) => r.id));
      refundedTotal = round2(refundedTotal + amount);
    }
  }

  // ---------------------------------------------------------------------
  // Non-card tickets
  // ---------------------------------------------------------------------
  for (const t of noPayment) {
    if (t.payment_method === 'film_pass') {
      // Put the balance back where it came from, then drop the redemption so
      // the pass's history matches its balance.
      const { data: redemptions } = await admin
        .from('film_pass_redemptions')
        .select('id, pass_id, amount_deducted')
        .eq('ticket_id', t.id);

      for (const r of redemptions || []) {
        const { data: pass } = await admin
          .from('user_film_passes')
          .select('id, remaining_balance')
          .eq('id', r.pass_id)
          .maybeSingle();
        if (!pass) {
          warnings.push(`Could not find the film pass behind ticket ${t.id} to credit it back.`);
          continue;
        }
        await admin
          .from('user_film_passes')
          .update({
            remaining_balance: round2(Number(pass.remaining_balance) + Number(r.amount_deducted)),
          })
          .eq('id', pass.id);
        await admin.from('film_pass_redemptions').delete().eq('id', r.id);
      }
    } else if (t.payment_method !== 'comp') {
      warnings.push(
        `Ticket paid by ${t.payment_method} — refund the customer from the till; no card was charged.`,
      );
    }

    const { error: updateErr } = await admin
      .from('tickets')
      .update({ status: 'refunded', refunded_at: new Date().toISOString() })
      .eq('id', t.id);

    if (updateErr) {
      warnings.push(`Could not mark ticket ${t.id} refunded.`);
      continue;
    }
    refundedIds.push(t.id);
    refundedTotal = round2(
      refundedTotal + Number(t.total_price || 0) + Number(t.processing_fee || 0),
    );
  }

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

/** Stable 40-char key for "refund exactly these tickets of this payment". */
async function refundKey(paymentId: string, ticketIds: string[]): Promise<string> {
  const material = `${paymentId}:${[...ticketIds].sort().join(',')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 40);
}
