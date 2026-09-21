// Turning a priced order into Square line items.
//
// The point of all this is one field: `catalog_object_id`. 7,868 of 7,888 recent
// line items in this account carry one, and ours carried none, so our sales were
// invisible to item-sales, category and tax reporting
// (docs/SQUARE-TRANSACTION-CONVENTIONS.md).
//
// ## The arithmetic is Square's
//
// Square totals an order ONE way, whatever shape its lines take: it sums the
// taxed lines, takes 6% of that sum once, and rounds half-to-even. Measured —
// docs/FINDINGS-square-order-arithmetic.md, 49 sandbox orders.
//
// This file used to believe otherwise. `_shared/pricing.ts` rounded tax per
// ticket, and a tier whose per-unit tax rounded differently from its line's
// ($8.25: 2 × 50 = 100 vs round(1650 × 6%) = 99) was split into single-quantity
// lines on the premise that Square would then round each line separately. It
// does not. Two separate $8.25 lines total 1749, exactly as one 2× line does,
// so the split bought nothing and the order was abandoned either way. The
// original probe could not see this because it tested only $8.25 × 1, where
// 49.5 rounds to 50 under both half-up and half-even.
//
// So: always ONE LINE PER TIER — "Adult ×2", which is Square's own convention
// and what the theatre's other orders look like — and `expectedTotalCents` is
// computed with Square's formula (`_shared/order_math.ts`), which makes the
// caller's pre-flight check a model of what Square will return rather than a
// restatement of our own sum. `pricing.ts` prices with the same function, so
// the two agree by construction; the check exists for the day they do not.

import { taxOnCents } from './order_math.ts';

export const TAX_RATE = 0.06;
export const SALES_TAX_UID = 'kenworthy-sales-tax';
export const SALES_TAX_NAME = 'Sales tax';
export const SALES_TAX_PERCENTAGE = '6';

/** One tier's worth of a sale: what it is called, what it costs, how many. */
export interface TicketGroup {
  /** Canonical tier name, '' for a single-price showing. */
  tierKey: string;
  /** Variation name if catalogued, otherwise the ad-hoc line's label. */
  displayName: string;
  /** The Square ITEM_VARIATION to bill against, or null to go ad hoc. */
  variationId: string | null;
  unitPriceCents: number;
  count: number;
  /**
   * What the order's discount takes off THIS line in total, in cents — the sum
   * of its tickets' shares. `unitPriceCents` stays the list price: Square is
   * sent the full price and the discount separately, so its receipt and its
   * reports show both, the way its own POS would.
   */
  discountCents?: number;
  /** The rule's label. Becomes the discount's name on Square's receipt. */
  discountName?: string;
  /**
   * False for lines that must never be taxed — a bundled donation, a card
   * processing surcharge. `pricing.ts` deliberately keeps a gift out of the tax
   * base, and an order that taxed it would charge more than the site quoted.
   */
  taxable?: boolean;
}

export interface BuiltOrder {
  lineItems: Record<string, unknown>[];
  taxes: Record<string, unknown>[];
  /** One per discounted line. Empty when the order has no discount. */
  discounts: Record<string, unknown>[];
  /** What we expect Square to total. Verify against this before charging. */
  expectedTotalCents: number;
  /** Groups billed without a catalog link — a degraded sale, worth logging. */
  adHocGroups: number;
}

/**
 * Build the line items for an order.
 *
 * EVERY line carries our tax explicitly, catalogued or not.
 *
 * This was measured, not assumed, and the measurement reversed the design.
 * Square does NOT apply a catalog item's `tax_ids` to an Orders API line item:
 * a line referencing a `is_taxable` item priced $8.25 came back with
 * `total_tax_money: 0`. Trusting the catalog would have undercharged sales tax
 * on every catalogued ticket — silently, since the order looks perfectly well
 * formed. And sending our own tax on a catalogued line does NOT double it:
 * the same line with an ADDITIVE 6% came back $8.75 with one applied tax.
 * (square-order-probe, sandbox, API 2024-01-18.)
 *
 * `expectedTotalCents` remains the caller's check against the order Square
 * actually returns. It is what would have caught this had the probe not: an
 * 825 total against an expected 875 refuses to charge.
 */
export function buildTicketOrder(groups: TicketGroup[]): BuiltOrder {
  const lineItems: Record<string, unknown>[] = [];
  const discounts: Record<string, unknown>[] = [];
  let grossCents = 0;
  let discountCents = 0;
  let taxableDiscountCents = 0;
  let taxableCents = 0;
  let adHocGroups = 0;

  groups.forEach((g, gi) => {
    if (g.count <= 0) return;
    const adHoc = !g.variationId;
    if (adHoc) adHocGroups++;

    const emit = (qty: number, uid: string) => {
      const line: Record<string, unknown> = {
        uid,
        quantity: String(qty),
        base_price_money: { amount: g.unitPriceCents, currency: 'USD' },
      };
      // The catalog link drives item-sales and category reporting; the price and
      // the tax are ours either way.
      if (g.variationId) {
        line.catalog_object_id = g.variationId;
      } else {
        line.name = g.displayName.slice(0, 512);
      }
      if (g.taxable !== false) line.applied_taxes = [{ tax_uid: SALES_TAX_UID }];

      // The discount, as a FIXED amount scoped to THIS line.
      //
      // Both halves of that are measured (FINDINGS, batch 4). Scoped to the
      // ORDER, Square spreads a discount over every line — it took 25% off a
      // bundled donation. And sent as a percentage, the rounding of it is
      // Square's to do; sent as the amount we already computed, there is nothing
      // left for Square to round except the tax, which order_math.ts matches.
      const off = Math.min(g.discountCents ?? 0, g.unitPriceCents * g.count);
      if (off > 0) {
        const discountUid = `${uid}-discount`;
        line.applied_discounts = [{ discount_uid: discountUid }];
        discounts.push({
          uid: discountUid,
          name: (g.discountName || 'Discount').slice(0, 255),
          amount_money: { amount: off, currency: 'USD' },
          scope: 'LINE_ITEM',
        });
        discountCents += off;
        if (g.taxable !== false) taxableDiscountCents += off;
      }
      lineItems.push(line);
    };

    emit(g.count, `g${gi}`);

    grossCents += g.unitPriceCents * g.count;
    if (g.taxable !== false) taxableCents += g.unitPriceCents * g.count;
  });

  return {
    lineItems,
    // Always declared when there is anything to tax, because Square applies no
    // tax of its own to these lines.
    taxes: groups.some((x) => x.count > 0 && x.taxable !== false)
      ? [{
        uid: SALES_TAX_UID,
        name: SALES_TAX_NAME,
        percentage: SALES_TAX_PERCENTAGE,
        scope: 'LINE_ITEM',
        type: 'ADDITIVE',
      }]
      : [],
    discounts,
    // Square's own sum: every line, less the discounts, plus one tax on what is
    // left of everything taxable.
    expectedTotalCents: grossCents - discountCents + taxOnCents(taxableCents - taxableDiscountCents),
    adHocGroups,
  };
}

/**
 * The order body, ready to POST.
 *
 * `reference_id` is our own order id and is the reconciliation key — Square's
 * ledger and ours agree on nothing else. `source.name` is the established name
 * for this build's sales.
 *
 * ## Why PICKUP and not DIGITAL
 *
 * This used to send `type: 'DIGITAL'` with `delivery_details`, and Square
 * rejected **every** order with `MISSING_REQUIRED_PARAMETER — Fulfillments of
 * type DIGITAL must have digital_details supplied`. Checkout then fell back to
 * a bare payment, so from 19 Aug to 28 Aug 2026 every online sale registered as
 * an unnamed "Custom Amount" — the exact failure #103 existed to end.
 *
 * The obvious fix is not the fix. Measured against the Square sandbox
 * (`BRIEF-square-order-falls-back-to-bare-payment.md`), supplying
 * `digital_details` fails identically — empty, with a recipient, with
 * `state: PROPOSED`, and under `Square-Version: 2025-01-23`. DIGITAL simply
 * does not work for this account, whatever the error text invites you to try.
 *
 * Two shapes were measured working: no `fulfillments` at all, and PICKUP with
 * `pickup_details` and `state: PROPOSED`.
 *
 * **Every caller uses the no-fulfillment shape**, which is what `square-invoice`
 * has always sent. PICKUP was tried first because Square stores the recipient
 * there, but an end-to-end sandbox run showed the cost: a *paid* PICKUP order
 * stays `state: OPEN` with an unfulfilled pickup, even after the fulfillment is
 * updated to COMPLETED. Every online sale would leave a phantom pickup on the
 * theatre's Orders screen forever. A no-fulfillment order goes straight to
 * COMPLETED once paid.
 *
 * The recipient was the only thing PICKUP bought, and it was nearly redundant:
 * `createPayment` already sends `buyer_email_address`, so the buyer's email
 * reaches Square on the payment regardless. PICKUP remains supported here — it
 * is one argument away — if the buyer's *name* on the order is ever worth an
 * open order per sale.
 *
 * `state` must be `PROPOSED` or `HELD` at creation. `COMPLETED` — which this
 * sent for every type, including `IN_STORE` — is rejected outright, so that was
 * a second, independent reason these orders could never have been created.
 */
export function orderRequestBody(params: {
  locationId: string;
  referenceId: string;
  built: BuiltOrder;
  idempotencyKey: string;
  /**
   * `'PICKUP'` needs `pickupAt`. `'NONE'` omits the fulfillment entirely, which
   * is right for a donation — nothing is collected — and is the shape
   * `square-invoice` has always used.
   */
  fulfillment?: 'PICKUP' | 'NONE';
  /** When the patron collects: the showtime for a ticket. ISO 8601. */
  pickupAt?: string | null;
  buyerEmail?: string | null;
  buyerName?: string | null;
}) {
  // Square rejects PICKUP without a pickup_at, and an order that is rejected
  // costs us the whole sale's attribution. A caller that cannot supply one
  // degrades to the no-fulfillment shape, which is proven to work, rather than
  // taking the order down with it.
  const wantsPickup = (params.fulfillment ?? 'PICKUP') === 'PICKUP' && !!params.pickupAt;

  return {
    idempotency_key: params.idempotencyKey,
    order: {
      location_id: params.locationId,
      reference_id: params.referenceId.slice(0, 40),
      source: { name: 'Kenworthy Website' },
      line_items: params.built.lineItems,
      ...(params.built.taxes.length ? { taxes: params.built.taxes } : {}),
      ...(params.built.discounts.length ? { discounts: params.built.discounts } : {}),
      ...(wantsPickup
        ? {
          fulfillments: [{
            type: 'PICKUP',
            state: 'PROPOSED',
            pickup_details: {
              pickup_at: params.pickupAt,
              recipient: {
                display_name: (params.buyerName || 'Kenworthy patron').slice(0, 255),
                ...(params.buyerEmail ? { email_address: params.buyerEmail } : {}),
              },
            },
          }],
        }
        : {}),
    },
  };
}

// --- turning a priced ticket order into groups ------------------------------

/**
 * Group a priced order into one entry per (tier, price), with the Square
 * variation to bill each against.
 *
 * Grouping is by tier AND price rather than tier alone: the two should never
 * disagree, and if they ever do, billing a $5 ticket at the $8 tier's price is
 * the kind of error that reconciles perfectly and is wrong.
 *
 * A tier with no stored variation still sells — it just sells as a named ad-hoc
 * line, which forfeits item-sales and category attribution. That is a degraded
 * sale, not a failed one, and the caller logs it.
 */
export async function loadTicketGroups(
  admin: any,
  showingId: string,
  priced: {
    tickets: Array<{
      tier_id: string | null;
      price: number;
      list_price?: number | null;
      discount_amount?: number | null;
      discount_label?: string | null;
    }>;
    showing: { start_time: string };
    productionTitle: string;
  },
  helpers: {
    canonicalTier: (raw: string | null | undefined) => string;
    variationName: (tier: string | null | undefined, startTime: string | Date, tz?: string) => string;
    timeZone?: string;
  },
): Promise<TicketGroup[]> {
  const [{ data: tierRows }, { data: mapRows }] = await Promise.all([
    admin.from('showing_price_tiers').select('id, tier_name').eq('showing_id', showingId),
    admin.from('showing_square_variations')
      .select('tier_name, square_variation_id').eq('showing_id', showingId),
  ]);

  const tierNameById = new Map<string, string>(
    (tierRows ?? []).map((t: any) => [t.id, t.tier_name]),
  );
  const variationByTier = new Map<string, string>(
    (mapRows ?? []).map((m: any) => [m.tier_name, m.square_variation_id]),
  );

  const byKey = new Map<string, TicketGroup>();
  for (const t of priced.tickets) {
    const rawTier = t.tier_id ? tierNameById.get(t.tier_id) ?? null : null;
    const tierKey = helpers.canonicalTier(rawTier);
    // Grouped on the LIST price. Two tickets of one tier can carry discount
    // shares a cent apart, and they still belong on one "Adult x2" line.
    // `list_price` is absent on rows written before discounts existed, where it
    // is simply the price.
    const unitPriceCents = Math.round(Number(t.list_price ?? t.price) * 100);
    const offCents = Math.round(Number(t.discount_amount ?? 0) * 100);
    const key = `${tierKey}|${unitPriceCents}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      existing.discountCents = (existing.discountCents ?? 0) + offCents;
      existing.discountName ??= t.discount_label ?? undefined;
      continue;
    }

    byKey.set(key, {
      tierKey,
      displayName: helpers.variationName(tierKey, priced.showing.start_time, helpers.timeZone),
      variationId: variationByTier.get(tierKey) ?? null,
      unitPriceCents,
      count: 1,
      discountCents: offCents,
      discountName: t.discount_label ?? undefined,
    });
  }

  return [...byKey.values()];
}

/** A bundled gift. Never taxed, never a ticket line. */
export function donationGroup(cents: number): TicketGroup {
  return {
    tierKey: '__donation',
    displayName: 'Donation',
    variationId: null,
    unitPriceCents: cents,
    count: 1,
    taxable: false,
  };
}

/** The buyer-paid card surcharge, when a production has opted into it. */
export function processingFeeGroup(cents: number): TicketGroup {
  return {
    tierKey: '__processing_fee',
    displayName: 'Card processing fee',
    variationId: null,
    unitPriceCents: cents,
    count: 1,
    taxable: false,
  };
}
