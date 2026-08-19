// Put a counter cash sale into Square.
//
// The in-person path never reached Square at all: StaffPOS inserted ticket rows
// with square_payment_id null and stopped. So every cash ticket was invisible to
// Square — not just uncatalogued, absent. The till and the dashboard could only
// be reconciled by hand.
//
// This registers the sale after the fact: an Order with catalogued line items
// and a CASH tender, matching how Square's own Point of Sale records the same
// transaction (1,148 of the account's recent tenders are CASH).
//
// The amount is read back from the ticket rows, never taken from the caller.
// StaffPOS runs in a browser, and a browser deciding what was collected is the
// exact mistake ticket-checkout was built to remove; this endpoint keeps that
// property for the counter. The rows are already written and already scannable,
// so this is a recording step: a failure here loses the Square record, never the
// sale, and never the money.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { json, preflight } from '../_shared/http.ts';
import {
  createPayment,
  loadSquareConfig,
  squareErrorMessage,
  squareFetch,
} from '../_shared/square.ts';
import {
  buildTicketOrder,
  donationGroup,
  orderRequestBody,
  type TicketGroup,
} from '../_shared/square-order.ts';
import { canonicalTier, variationName } from '../_shared/square-catalog.ts';

declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization' }, 401);
  const { data: userRes } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  const user = userRes?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // Whoever can sell at the counter can record the sale.
  const roles = await Promise.all(
    (['staff', 'admin', 'superadmin'] as const).map((r) =>
      admin.rpc('has_role', { _user_id: user.id, _role: r }).then((x: any) => !!x.data)
    ),
  );
  if (!roles.some(Boolean)) return json({ error: 'Staff only' }, 403);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const orderToken = String(body.order_token ?? '').trim();
  if (!orderToken) return json({ error: 'order_token is required' }, 400);
  const donationCents = Number.isInteger(body.donation_cents) && body.donation_cents > 0
    ? Number(body.donation_cents)
    : 0;

  const square = loadSquareConfig();
  if (!square.ok) return json({ error: square.error }, 500);

  // ---- what was actually sold, from our own rows --------------------------
  const { data: tickets, error: ticketErr } = await admin
    .from('tickets')
    .select('id, showing_id, tier_id, price, tax_amount, total_price, processing_fee, payment_method, status, square_payment_id')
    .eq('order_token', orderToken);

  if (ticketErr) return json({ error: 'Could not read the sale' }, 500);
  if (!tickets || tickets.length === 0) return json({ error: 'No tickets for that order' }, 404);

  const cash = tickets.filter((t: any) => t.payment_method === 'cash' && t.status !== 'failed');
  if (cash.length === 0) return json({ error: 'That order has no cash tickets' }, 400);

  // Already recorded: a double-click, or a retry after a slow response. Say so
  // rather than posting the takings to Square twice.
  const already = cash.find((t: any) => t.square_payment_id);
  if (already) {
    return json({ ok: true, already_recorded: true, square_payment_id: already.square_payment_id });
  }

  const showingId = cash[0].showing_id;
  if (cash.some((t: any) => t.showing_id !== showingId)) {
    return json({ error: 'That order spans multiple showings' }, 400);
  }

  const { data: showing } = await admin
    .from('showings')
    .select('id, start_time, movie_id, event_id, live_performance_id')
    .eq('id', showingId)
    .maybeSingle();
  if (!showing) return json({ error: 'Showing not found' }, 404);

  const [{ data: tierRows }, { data: mapRows }] = await Promise.all([
    admin.from('showing_price_tiers').select('id, tier_name').eq('showing_id', showingId),
    admin.from('showing_square_variations')
      .select('tier_name, square_variation_id').eq('showing_id', showingId),
  ]);
  const tierNameById = new Map<string, string>((tierRows ?? []).map((t: any) => [t.id, t.tier_name]));
  const variationByTier = new Map<string, string>(
    (mapRows ?? []).map((m: any) => [m.tier_name, m.square_variation_id]),
  );

  const tz = Deno.env.get('VENUE_TIME_ZONE') || undefined;
  const byKey = new Map<string, TicketGroup>();
  let expectedCents = 0;
  let feeCents = 0;

  for (const t of cash) {
    const tierKey = canonicalTier(t.tier_id ? tierNameById.get(t.tier_id) ?? null : null);
    const unitPriceCents = Math.round(Number(t.price) * 100);
    const unitTaxCents = Math.round(Number(t.tax_amount) * 100);
    feeCents += Math.round(Number(t.processing_fee ?? 0) * 100);
    expectedCents += Math.round(Number(t.total_price) * 100);

    const key = `${tierKey}|${unitPriceCents}`;
    const existing = byKey.get(key);
    if (existing) { existing.count++; continue; }
    byKey.set(key, {
      tierKey,
      displayName: variationName(tierKey, showing.start_time, tz),
      variationId: variationByTier.get(tierKey) ?? null,
      unitPriceCents,
      unitTaxCents,
      count: 1,
    });
  }

  const groups = [...byKey.values()];
  if (donationCents > 0) groups.push(donationGroup(donationCents));
  const chargeCents = expectedCents + feeCents + donationCents;

  const built = buildTicketOrder(groups);
  if (built.expectedTotalCents + feeCents !== chargeCents) {
    console.error(
      `[square-cash-sale] built ${built.expectedTotalCents} + fee ${feeCents} != ${chargeCents} for ${orderToken}`,
    );
    return json({ error: 'The sale does not add up; not recording it in Square.' }, 500);
  }
  if (built.adHocGroups > 0) {
    console.warn(`[square-cash-sale] ${built.adHocGroups} tier(s) unmapped for showing ${showingId}; ad-hoc lines`);
  }

  // ---- Square -------------------------------------------------------------
  const created = await squareFetch(square.config, '/orders', {
    method: 'POST',
    body: orderRequestBody({
      locationId: square.config.locationId,
      referenceId: orderToken,
      built,
      idempotencyKey: `cash-order-${orderToken}`,
      // A ticket bought at the counter is handed over at the counter.
      fulfillment: 'IN_STORE',
    }),
  });
  const squareTotal = created.data?.order?.total_money?.amount;
  if (!created.ok || !created.data?.order?.id) {
    console.error('[square-cash-sale] order create failed', created.status, JSON.stringify(created.data));
    return json({ error: squareErrorMessage(created.data, 'Could not record the sale in Square') }, 502);
  }
  if (squareTotal !== chargeCents) {
    console.error(`[square-cash-sale] Square totalled ${squareTotal} vs ${chargeCents}; abandoning order`);
    return json({ error: 'Square totalled the sale differently; not recording it.' }, 502);
  }

  const payment = await createPayment(square.config, {
    sourceId: 'CASH',
    amountCents: chargeCents,
    idempotencyKey: `cash-pay-${orderToken}`,
    orderId: created.data.order.id,
    referenceId: orderToken,
    cashBuyerSuppliedCents: chargeCents,
  });
  if (!payment.ok || !payment.data?.payment?.id) {
    console.error('[square-cash-sale] cash tender failed', payment.status, JSON.stringify(payment.data));
    return json({ error: squareErrorMessage(payment.data, 'Could not record the cash tender') }, 502);
  }

  const paymentId = payment.data.payment.id;

  // Stamp the rows so a refund can find the tender, and so a retry sees this as
  // already recorded rather than posting the takings again.
  const { error: stampErr } = await admin
    .from('tickets')
    .update({ square_payment_id: paymentId })
    .in('id', cash.map((t: any) => t.id));
  if (stampErr) {
    console.error('[square-cash-sale] recorded in Square but could not stamp tickets', stampErr);
  }

  return json({
    ok: true,
    square_order_id: created.data.order.id,
    square_payment_id: paymentId,
    amount_cents: chargeCents,
    ad_hoc_lines: built.adHocGroups,
    tickets_stamped: stampErr ? 0 : cash.length,
  });
});
