// Online ticket checkout — the one place a ticket can be sold on the web.
//
// What this replaces: both online paths created confirmed, scannable tickets
// without taking any money. The guest path inserted rows from an edge function
// with no card step at all; the signed-in path inserted them straight from the
// browser, which also meant the *browser* decided the price. There was no
// Square code on either path — nothing to switch from sandbox to live.
//
// The order of operations is the fix, and it is the whole design:
//
//     price on the server  ->  write the order as pending  ->  charge Square
//                          ->  confirm the tickets  ->  deliver them
//
// Nothing scannable exists until the money moves. A decline leaves failed rows
// and sends no email. A crash between charge and confirm leaves a pending order
// with a Square payment id on it — recoverable, and never a free ticket.
//
// Both the guest and the signed-in checkout call this. Neither inserts tickets
// any more; the RLS policy that allowed a customer to insert their own ticket
// is dropped in the accompanying migration, so this is the only route left.
//
// Card data never touches this function or this server. The browser hands the
// card to Square's own iframe and sends us a single-use token, which is all
// `source_id` below ever is. (PCI SAQ A-EP.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import {
  createPayment,
  loadSquareConfig,
  publishableConfig,
  squareErrorMessage,
  squareFetch,
} from '../_shared/square.ts';
import {
  buildTicketOrder,
  donationGroup,
  loadTicketGroups,
  orderRequestBody,
  processingFeeGroup,
} from '../_shared/square-order.ts';
import { canonicalTier, variationName } from '../_shared/square-catalog.ts';
import {
  PricingError,
  priceTicketOrder,
  readDonationCents,
  type TicketDescriptor,
} from '../_shared/pricing.ts';
import { deliverConfirmation } from '../_shared/deliver.ts';
import { settleDonation } from '../_shared/donations.ts';
import {
  EMAIL_RE,
  authenticatedUser,
  contactForUser,
  findOrCreateBuyer,
  readContact,
  type BuyerContact,
} from '../_shared/buyers.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const MAX_TICKETS_PER_SHOWING = 4;

/**
 * How long a pending order holds its seats.
 *
 * A pending row normally lives for the seconds a card charge takes. But if the
 * isolate dies between the insert and the charge, the row stays pending
 * forever — and without an expiry that abandoned row would keep a seat
 * un-sellable and count against the buyer's four-ticket limit for good. After
 * this window a pending row is treated as abandoned: it holds nothing.
 */
const PENDING_HOLD_MS = 15 * 60 * 1000;
const HELD_STATUSES = ['confirmed', 'pending'];

function isHeld(row: { status: string; purchased_at: string }): boolean {
  if (row.status === 'confirmed') return true;
  return Date.now() - new Date(row.purchased_at).getTime() < PENDING_HOLD_MS;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const square = loadSquareConfig();

  // The browser needs the publishable ids before it can render the card form.
  if (body.action === 'get_config') {
    if (!square.ok) return json({ error: square.error }, 500);
    return json(publishableConfig(square.config));
  }

  if (body.action && body.action !== 'create_purchase') {
    return json({ error: `Unknown action: ${body.action}` }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // -------------------------------------------------------------------------
  // Request shape
  // -------------------------------------------------------------------------
  const showingId = String(body.showing_id ?? '').trim();
  const descriptors: TicketDescriptor[] = Array.isArray(body.tickets) ? body.tickets : [];
  const sourceId = typeof body.source_id === 'string' ? body.source_id : '';

  // A film pass is a physical object redeemed at the door by a staff scan. It
  // is not stored value and it cannot buy a ticket on the web — that is the
  // rule, and this is where it is enforced rather than merely not offered.
  // Refused up front, before pricing or any write, so a stale browser tab still
  // holding the old checkout UI gets an answer instead of a free ticket.
  if (body.payment_method === 'film_pass' || body.pass_id) {
    return json(
      {
        error:
          'Film passes are redeemed in person at the door, not online. Bring your pass and our staff will scan it.',
      },
      400,
    );
  }

  // An optional gift added at checkout. It is money the buyer chose to give, so
  // unlike the tickets there is nothing to re-derive from the database — but it
  // is still validated here rather than trusted, and it is deliberately kept out
  // of `priceTicketOrder` so it cannot reach the tax base. See Part C of
  // docs/DONATIONS.md.
  const donation = readDonationCents(body.donation_cents);
  if (!donation.ok) return json({ error: donation.error }, 400);
  const donationCents = donation.cents;

  if (!showingId) return json({ error: 'Showing is required' }, 400);
  if (descriptors.length === 0) return json({ error: 'Select at least one ticket' }, 400);
  if (descriptors.length > MAX_TICKETS_PER_SHOWING) {
    return json({ error: `Maximum ${MAX_TICKETS_PER_SHOWING} tickets per purchase` }, 400);
  }
  // A card source is required only once we know there is money to charge. A
  // free ($0) showing has no card step at all, so it is validated after pricing
  // rather than here — see the post-pricing guard below.

  // One key per checkout attempt, generated by the browser and resent on retry.
  const idempotencyKey = normaliseKey(body.idempotency_key);

  // -------------------------------------------------------------------------
  // Who is buying
  // -------------------------------------------------------------------------
  const signedIn = await authenticatedUser(createClient, req);
  let contact: BuyerContact = readContact(body);
  let userId: string;
  // Whether this purchase silently created an account. The confirmation email
  // uses it to decide whether to offer a password-set link, so a returning
  // customer is not told an account was made for them.
  let accountCreated = false;

  if (signedIn) {
    userId = signedIn.id;
    contact = await contactForUser(admin, userId, contact);
  } else {
    // No name check. It used to be required here and on the form, and it was
    // never worth a rejected purchase — a name is a courtesy for the receipt
    // and for finding someone at the counter, not something delivery depends
    // on. Everything downstream already falls back: buyers.ts names the
    // account after the contact we do have, and the confirmation drops the
    // greeting rather than addressing nobody.
    if (!contact.email && !contact.phone) {
      return json({ error: 'Email or phone is required so we can send your tickets' }, 400);
    }
    if (contact.email && !EMAIL_RE.test(contact.email)) {
      return json({ error: 'Invalid email format' }, 400);
    }
    try {
      const buyer = await findOrCreateBuyer(admin, contact);
      userId = buyer.userId;
      accountCreated = buyer.created;
    } catch (err) {
      console.error('[ticket-checkout] buyer resolution failed', err);
      return json({ error: err instanceof Error ? err.message : 'Could not create account' }, 500);
    }
  }

  // A resubmitted attempt returns the order it already made. Matching on the
  // buyer as well as the key means a guessed key reveals nothing.
  const replay = await findExistingOrder(admin, idempotencyKey, userId);
  if (replay) return json(replay);

  // -------------------------------------------------------------------------
  // Price it — from the database, never from the request
  // -------------------------------------------------------------------------
  let order;
  try {
    order = await priceTicketOrder(admin, showingId, descriptors, 'online');
  } catch (err) {
    if (err instanceof PricingError) return json({ error: err.message }, 400);
    console.error('[ticket-checkout] pricing failed', err);
    return json({ error: 'Could not price this order' }, 500);
  }

  // What the card is actually charged: the order as priced, plus the gift,
  // added after tax and never taxed. Tax was computed per ticket row inside
  // priceTicketOrder and is untouched by this line — that is the whole of
  // "donations are tax-free" on this path.
  const chargeCents = order.amountCents + donationCents;

  // A charge must carry a Square token; a free ($0) showing must not need one.
  // (Square rejects a $0 charge outright — "below the minimum" — which is why
  // free tickets skip Square entirely, below.) A free showing with a donation
  // attached has a real amount to charge, so it needs a card like any other.
  if (chargeCents > 0 && !sourceId) {
    return json({ error: 'Missing payment source' }, 400);
  }

  // -------------------------------------------------------------------------
  // Availability and limits
  // -------------------------------------------------------------------------
  const seatIds = order.tickets.map((t) => t.seat_id).filter((id): id is string => !!id);

  if (seatIds.length > 0) {
    if (new Set(seatIds).size !== seatIds.length) {
      return json({ error: 'The same seat was selected twice' }, 400);
    }
    const { data: taken } = await admin
      .from('tickets')
      .select('seat_id, status, purchased_at')
      .eq('showing_id', showingId)
      .in('seat_id', seatIds)
      .in('status', HELD_STATUSES);
    if ((taken || []).filter(isHeld).length > 0) {
      return json({ error: 'Someone just took one of those seats. Please pick again.' }, 409);
    }
  } else if (order.showing.requires_seat_selection) {
    return json({ error: 'This showing requires seat selection' }, 400);
  } else {
    const { data: soldRows } = await admin
      .from('tickets')
      .select('id, status, purchased_at')
      .eq('showing_id', showingId)
      .in('status', HELD_STATUSES);
    const sold = (soldRows || []).filter(isHeld).length;
    if (sold + order.tickets.length > order.showing.total_seats) {
      return json({ error: 'Not enough tickets left for this showing' }, 409);
    }
  }

  const { data: ownRows } = await admin
    .from('tickets')
    .select('id, status, purchased_at')
    .eq('showing_id', showingId)
    .eq('user_id', userId)
    .in('status', HELD_STATUSES);

  const alreadyHeld = (ownRows || []).filter(isHeld).length;
  if (alreadyHeld + order.tickets.length > MAX_TICKETS_PER_SHOWING) {
    return json(
      {
        error: `Ticket limit reached. You already have ${alreadyHeld} ticket(s) for this showing.`,
      },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // Write the order as pending
  // -------------------------------------------------------------------------
  const orderToken = crypto.randomUUID();
  const ticketRows = order.tickets.map((t, i) => ({
    user_id: userId,
    showing_id: showingId,
    seat_id: t.seat_id,
    tier_id: t.tier_id,
    price: t.price,
    tax_rate: 0.06,
    tax_amount: t.tax_amount,
    total_price: t.total_price,
    // The surcharge belongs to the order, not to a seat; it rides on the first
    // row so refunds can recover it without an orders table.
    processing_fee: i === 0 ? order.processingFee : 0,
    qr_code: crypto.randomUUID(),
    order_token: orderToken,
    status: 'pending',
    payment_method: 'online',
    checkout_idempotency_key: idempotencyKey,
    // Written with the order, not just passed to the send, so a resend later
    // can honour what the buyer actually answered instead of falling back to
    // whatever number is on file. Strict boolean: the form always asks, so
    // anything the client omits is a no rather than an unknown.
    sms_consent: body.sms_consent === true,
  }));

  const { data: created, error: insertErr } = await admin
    .from('tickets')
    .insert(ticketRows)
    .select('id, qr_code, price, total_price, seat_id, tier_id');

  if (insertErr || !created || created.length === 0) {
    console.error('[ticket-checkout] pending insert failed', insertErr);

    // The availability checks above are advisory: they read, then this inserts,
    // and another order can land in between. The database is what actually
    // refuses to oversell, so the two codes below are that race being caught
    // rather than an unexpected failure — they deserve the same answer the
    // advisory check would have given, not a generic 500. Nothing has been
    // charged at this point: the card is not touched until after this insert.
    const code = (insertErr as any)?.code;

    // PT409 — the capacity trigger in
    // migrations/20260812170000_showing_capacity_enforcement.sql.
    if (code === 'PT409') {
      return json({ error: 'This showing just sold out. Your card was not charged.' }, 409);
    }

    // 23505 — UNIQUE(showing_id, seat_id): someone confirmed one of these seats
    // in the last few milliseconds. This is the case that previously reached the
    // buyer as an opaque 500.
    if (code === '23505') {
      return json({ error: 'Someone just took one of those seats. Please pick again.' }, 409);
    }

    return json({ error: 'Could not start this purchase. Please try again.' }, 500);
  }

  const ticketIds = created.map((t: any) => t.id);
  const failOrder = async (reason: string) => {
    await admin
      .from('tickets')
      .update({ status: 'failed', payment_error: reason.slice(0, 500) })
      .in('id', ticketIds);
  };

  // -------------------------------------------------------------------------
  // Take the money
  // -------------------------------------------------------------------------
  let receiptUrl: string | null = null;
  let paymentId: string | null = null;

  if (chargeCents === 0) {
    // Free showing and no gift — no money moves, so Square is skipped entirely
    // (it rejects a $0 charge). The tickets are still confirmed below, so the
    // seat is held, counts toward capacity, and scans at the door.
    // paymentId/receiptUrl stay null, exactly as they would for a comp.
  } else {
    if (!square.ok) {
      await failOrder(square.error);
      return json({ error: 'Payments are not configured. Please contact the box office.' }, 500);
    }

    // -----------------------------------------------------------------------
    // Register the sale as an Order first, so it carries catalogued line items.
    //
    // A bare payment records an amount and a note and nothing else: no item, no
    // category, no tax attribution. 99.7% of this account's line items carry a
    // catalog_object_id and ours carried none, which is why per-title and
    // per-showtime revenue was invisible and the two ledgers agreed only on the
    // grand total (docs/SQUARE-TRANSACTION-CONVENTIONS.md).
    //
    // The order is best-effort. If anything about it disagrees with our own
    // arithmetic we fall back to the bare payment rather than risk charging a
    // different number than the site quoted — attribution is worth a lot, but
    // not a cent of somebody's money.
    let squareOrderId: string | undefined;
    try {
      const groups = await loadTicketGroups(admin, showingId, order, {
        canonicalTier,
        variationName,
        timeZone: Deno.env.get('VENUE_TIME_ZONE') || undefined,
      });
      if (order.processingFee > 0) groups.push(processingFeeGroup(Math.round(order.processingFee * 100)));
      if (donationCents > 0) groups.push(donationGroup(donationCents));

      const built = buildTicketOrder(groups);
      if (built.adHocGroups > 0) {
        // Sells fine, reports badly: no item-sales or category rollup for these
        // tiers. Worth a line in the log rather than silence.
        console.warn(
          `[ticket-checkout] ${built.adHocGroups} tier(s) had no Square variation for showing ${showingId}; billed as ad-hoc lines`,
        );
      }

      if (built.expectedTotalCents !== chargeCents) {
        // Our own two calculations disagree. Do not send it.
        console.error(
          `[ticket-checkout] order build total ${built.expectedTotalCents} != charge ${chargeCents}; falling back to a bare payment`,
        );
      } else {
        const created = await squareFetch(square.config, '/orders', {
          method: 'POST',
          body: orderRequestBody({
            locationId: square.config.locationId,
            referenceId: orderToken,
            built,
            idempotencyKey: `order-${idempotencyKey}`,
            // The patron collects at the door, so the showtime is the pickup
            // time. This also puts the showtime on the order as structured
            // data, not only inside a variation name.
            fulfillment: 'PICKUP',
            pickupAt: order.showing.start_time,
            buyerEmail: contact.email,
            buyerName: contact.name,
          }),
        });
        const squareTotal = created.data?.order?.total_money?.amount;
        if (!created.ok || !created.data?.order?.id) {
          console.error('[ticket-checkout] order create failed', created.status, JSON.stringify(created.data));
        } else if (squareTotal !== chargeCents) {
          // Square totalled it differently. Charging the order would take the
          // wrong amount; charging our amount against it would leave it
          // part-paid. Neither is acceptable, so the order is abandoned — it
          // bills nobody on its own — and the payment goes through bare.
          console.error(
            `[ticket-checkout] Square totalled ${squareTotal} but we charge ${chargeCents}; abandoning order ${created.data.order.id}`,
          );
        } else {
          squareOrderId = created.data.order.id;
        }
      }
    } catch (err) {
      console.error('[ticket-checkout] order build threw, falling back to bare payment', err);
    }

    try {
      const result = await createPayment(square.config, {
        sourceId,
        amountCents: chargeCents,
        idempotencyKey,
        orderId: squareOrderId,
        referenceId: orderToken,
        note: donationCents > 0
          ? `${order.productionTitle} — ${created.length} ticket(s) + $${(donationCents / 100).toFixed(2)} donation`
          : `${order.productionTitle} — ${created.length} ticket(s)`,
        buyerEmail: contact.email,
      });

      if (!result.ok || !result.data?.payment) {
        const message = squareErrorMessage(result.data);
        console.error('[ticket-checkout] Square declined', JSON.stringify(result.data));
        await failOrder(message);
        return json({ error: message }, 400);
      }

      const payment = result.data.payment;
      if (payment.status && payment.status !== 'COMPLETED') {
        // Nothing scannable for a payment that has not actually completed.
        const message = `Payment did not complete (${payment.status}).`;
        await failOrder(message);
        return json({ error: message }, 400);
      }

      paymentId = payment.id ?? null;
      receiptUrl = payment.receipt_url ?? null;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Payment failed';
      console.error('[ticket-checkout] payment threw', err);
      await failOrder(reason);
      return json({ error: 'Payment could not be processed. Your card was not charged.' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // Paid — now the tickets become real
  // -------------------------------------------------------------------------
  const { error: confirmErr } = await admin
    .from('tickets')
    .update({
      status: 'confirmed',
      square_payment_id: paymentId,
      square_receipt_url: receiptUrl,
      payment_error: null,
    })
    .in('id', ticketIds);

  if (confirmErr) {
    // The card *was* charged. Say so plainly and leave the rows pending with
    // the payment id attached, rather than pretending the sale failed.
    console.error('[ticket-checkout] confirm failed after charge', confirmErr, { paymentId });
    return json(
      {
        error:
          'Your payment went through but we could not finish issuing the tickets. Please contact the box office — do not pay again.',
        square_payment_id: paymentId,
      },
      500,
    );
  }

  // -------------------------------------------------------------------------
  // The gift, if there was one
  // -------------------------------------------------------------------------
  // Recorded as a donations row rather than as ticket revenue: that is what
  // makes it contribution income in the QuickBooks export (donation_designation,
  // no sales tax) and what carries it to Little Green Light as a gift. It is
  // written after the charge, because a gift that was never paid for is not a
  // gift, and its failure can never fail a purchase — the card has already been
  // charged for it, so the money is ours either way and the row is recoverable
  // from the Square payment id in the log line below.
  let donationId: string | null = null;
  if (donationCents > 0) {
    const { data: donationRow, error: donationErr } = await admin
      .from('donations')
      .insert({
        amount_cents: donationCents,
        donor_name: contact.name || 'Kenworthy patron',
        donor_email: contact.email || null,
        donor_phone: contact.phone || null,
        status: 'completed',
        source: 'ticket_checkout',
        payment_channel: 'online',
        user_id: userId,
        order_token: orderToken,
        showing_id: showingId,
        square_payment_id: paymentId,
        square_receipt_url: receiptUrl,
      })
      .select('id')
      .single();

    if (donationErr || !donationRow) {
      console.error('[ticket-checkout] donation row failed after charge', donationErr, {
        paymentId,
        orderToken,
        donationCents,
      });
    } else {
      donationId = donationRow.id;
      // Receipt + tribute + LGL, on the same waitUntil footing as ticket
      // delivery. One acknowledgment for the gift, separate from the ticket
      // email: a contribution receipt is a tax document and has to stand alone.
      settleDonation(admin, donationRow.id);
    }
  }

  // -------------------------------------------------------------------------
  // Deliver — fire-and-forget, never able to fail a paid purchase
  // -------------------------------------------------------------------------
  // Called in-process, not by POSTing to send-ticket-confirmation. That HTTP
  // hop forwarded the service-role key as a bearer alongside the anon key in
  // `apikey`, and once Supabase rotated the injected keys to the
  // sb_publishable_/sb_secret_ format the gateway began refusing the pair
  // outright: 401 "Conflicting API keys". The request never reached the
  // sibling function, and since the dispatch is fire-and-forget nothing
  // surfaced -- the purchase succeeded, the card was charged, and no ticket
  // was ever sent. In-process has no gateway and no credential to forward.
  const delivery = deliverConfirmation(admin, orderToken, {
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    name: contact.name || undefined,
    accountCreated,
    // Passed as well as stored. The stored value is what a later resend reads;
    // this is the live answer for the send happening now, and it saves
    // deliverConfirmation a re-read of a row it is about to write to anyway.
    smsConsent: body.sms_consent === true,
  }).catch((e) => console.error('[ticket-checkout] confirmation dispatch failed', e));

  // waitUntil keeps the send alive past this response; a bare `void fetch` can
  // be killed when the isolate is torn down.
  // @ts-ignore — EdgeRuntime exists only in the Supabase edge runtime.
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(delivery);
  }

  syncMailchimp(contact, order, created, showingId);

  return json({
    success: true,
    order_token: orderToken,
    user_id: userId,
    tickets: created,
    ticket_count: created.length,
    payment_method: 'card',
    // What the card was charged: tickets + their tax + the untaxed gift.
    amount_cents: chargeCents,
    subtotal: order.subtotal,
    tax: order.tax,
    processing_fee: order.processingFee,
    // The ticket side of the order, unchanged by the gift.
    total: order.grandTotal,
    donation_cents: donationCents,
    donation_id: donationId,
    receipt_url: receiptUrl,
    square_payment_id: paymentId,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  // Square caps idempotency keys at 45 characters.
  return key.length >= 8 && key.length <= 45 ? key : crypto.randomUUID();
}

/** The order this key already created, if the buyer is retrying. */
async function findExistingOrder(admin: any, idempotencyKey: string, userId: string) {
  const { data } = await admin
    .from('tickets')
    .select('id, qr_code, price, total_price, seat_id, tier_id, order_token, status, square_payment_id, square_receipt_url')
    .eq('checkout_idempotency_key', idempotencyKey)
    .eq('user_id', userId);

  const rows = (data || []).filter((t: any) => t.status === 'confirmed');
  if (rows.length === 0) return null;

  return {
    success: true,
    replayed: true,
    order_token: rows[0].order_token,
    user_id: userId,
    tickets: rows,
    ticket_count: rows.length,
    receipt_url: rows[0].square_receipt_url ?? null,
    square_payment_id: rows[0].square_payment_id ?? null,
  };
}

/**
 * Marketing sync. Fire-and-forget by design: a Mailchimp outage must never
 * affect a completed purchase.
 */
function syncMailchimp(
  contact: BuyerContact,
  order: { productionTitle: string; productionCategory: string; subtotal: number },
  tickets: any[],
  showingId: string,
) {
  if (!contact.email) return;
  try {
    const [first, ...rest] = contact.name.split(/\s+/);
    void fetch(`${SUPABASE_URL}/functions/v1/mailchimp-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({
        email: contact.email,
        first_name: first ?? '',
        last_name: rest.join(' '),
        tags: ['ticket-buyer'],
        source: 'ticket-checkout',
      }),
    }).catch(() => {});

    void fetch(`${SUPABASE_URL}/functions/v1/mailchimp-ecommerce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        email: contact.email,
        first_name: first ?? '',
        last_name: rest.join(' '),
        order: {
          id: `tickets:${tickets[0].id}`,
          total: tickets.reduce((s: number, t: any) => s + Number(t.total_price || 0), 0),
          lines: tickets.map((t: any) => ({
            id: t.id,
            product_id: showingId,
            product_title: order.productionTitle,
            quantity: 1,
            price: Number(t.total_price || 0),
            category: order.productionCategory,
          })),
        },
      }),
    }).catch(() => {});
  } catch (e) {
    console.warn('[ticket-checkout] mailchimp sync threw', e);
  }
}
