// Turning a priced order into Square line items.
//
// The point of all this is one field: `catalog_object_id`. 7,868 of 7,888 recent
// line items in this account carry one, and ours carried none, so our sales were
// invisible to item-sales, category and tax reporting
// (docs/SQUARE-TRANSACTION-CONVENTIONS.md).
//
// Two rules govern the arithmetic, and they are in tension:
//
//   1. Square's convention is ONE LINE PER TIER — "Adult ×2", not two Adult
//      lines. That is what the theatre's own orders look like.
//   2. Our totals must stay authoritative. `_shared/pricing.ts` rounds tax PER
//      TICKET ROW to mirror the enforce_ticket_pricing trigger, and
//      square-refund refunds SUM(total_price). If Square's total differs by even
//      a cent, the charge stops matching our own rows and a "full" refund
//      refunds the wrong number.
//
// Those disagree exactly when a tier's price makes per-unit tax round
// differently from per-line tax: at $8.25, 825 × 6% = 49.5, so two tickets are
// 2 × 50 = 100 our way and round(1650 × 6%) = 99 Square's way. So: aggregate by
// tier normally, and split a tier into single-quantity lines only when
// aggregating would change the number. Convention where it is free, correctness
// where it is not.

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
  /** OUR per-ticket tax, already rounded the way the DB trigger rounds it. */
  unitTaxCents: number;
  count: number;
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
  /** What we expect Square to total. Verify against this before charging. */
  expectedTotalCents: number;
  /** Groups billed without a catalog link — a degraded sale, worth logging. */
  adHocGroups: number;
  /** Groups split into single lines to keep the rounding honest. */
  splitGroups: number;
}

/**
 * Would aggregating this tier onto one line change the tax we charge?
 *
 * Square taxes a line on its extended total; we tax each ticket. Equal for
 * whole-dollar prices, not equal at prices like $8.25.
 */
export function aggregationChangesTax(g: TicketGroup): boolean {
  const ours = g.unitTaxCents * g.count;
  const squares = Math.round(g.unitPriceCents * g.count * TAX_RATE);
  return ours !== squares;
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
  let expectedTotalCents = 0;
  let adHocGroups = 0;
  let splitGroups = 0;

  groups.forEach((g, gi) => {
    if (g.count <= 0) return;
    const adHoc = !g.variationId;
    if (adHoc) adHocGroups++;

    const split = aggregationChangesTax(g);
    if (split) splitGroups++;

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
      lineItems.push(line);
    };

    if (split) {
      for (let i = 0; i < g.count; i++) emit(1, `g${gi}-${i}`);
    } else {
      emit(g.count, `g${gi}`);
    }

    expectedTotalCents += (g.unitPriceCents + g.unitTaxCents) * g.count;
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
    expectedTotalCents,
    adHocGroups,
    splitGroups,
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
 * `pickup_details` and `state: PROPOSED`. PICKUP is chosen because Square
 * **stores the recipient**, which is how the buyer's name and email reach
 * Square at all — and because a ticket presented at the door is a pickup more
 * honestly than it is a digital delivery.
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
    tickets: Array<{ tier_id: string | null; price: number; tax_amount: number }>;
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
    const unitPriceCents = Math.round(Number(t.price) * 100);
    const unitTaxCents = Math.round(Number(t.tax_amount) * 100);
    const key = `${tierKey}|${unitPriceCents}`;

    const existing = byKey.get(key);
    if (existing) { existing.count++; continue; }

    byKey.set(key, {
      tierKey,
      displayName: helpers.variationName(tierKey, priced.showing.start_time, helpers.timeZone),
      variationId: variationByTier.get(tierKey) ?? null,
      unitPriceCents,
      unitTaxCents,
      count: 1,
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
    unitTaxCents: 0,
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
    unitTaxCents: 0,
    count: 1,
    taxable: false,
  };
}
