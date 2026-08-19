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
 * Ad-hoc lines carry our own tax explicitly, because there is no catalog item to
 * carry it. Catalog-linked lines do NOT: the tax lives on the item and Square
 * applies it, and sending our own on top would tax the ticket twice. Whether
 * Square really does apply it is not assumed — `expectedTotalCents` exists so the
 * caller can compare against the order Square actually returns and refuse to
 * charge on a mismatch.
 */
export function buildTicketOrder(groups: TicketGroup[]): BuiltOrder {
  const lineItems: Record<string, unknown>[] = [];
  let expectedTotalCents = 0;
  let adHocGroups = 0;
  let splitGroups = 0;
  let anyAdHoc = false;

  groups.forEach((g, gi) => {
    if (g.count <= 0) return;
    const adHoc = !g.variationId;
    if (adHoc) { adHocGroups++; anyAdHoc = true; }

    const split = aggregationChangesTax(g);
    if (split) splitGroups++;

    const emit = (qty: number, uid: string) => {
      const line: Record<string, unknown> = {
        uid,
        quantity: String(qty),
        base_price_money: { amount: g.unitPriceCents, currency: 'USD' },
      };
      if (g.variationId) {
        line.catalog_object_id = g.variationId;
        // Deliberately no applied_taxes: a catalogued item carries its own
        // tax_ids and Square applies them.
      } else {
        line.name = g.displayName.slice(0, 512);
        line.applied_taxes = [{ tax_uid: SALES_TAX_UID }];
      }
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
    // Declared only when an ad-hoc line needs it; a fully catalogued order lets
    // the catalog's own taxes do the work.
    taxes: anyAdHoc
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
 * for this build's sales, and DIGITAL fulfillment is what Square Online's 891
 * web orders use.
 */
export function orderRequestBody(params: {
  locationId: string;
  referenceId: string;
  built: BuiltOrder;
  idempotencyKey: string;
  fulfillment?: 'DIGITAL' | 'PICKUP' | 'IN_STORE';
  buyerEmail?: string | null;
  buyerName?: string | null;
}) {
  const fulfillmentType = params.fulfillment ?? 'DIGITAL';
  return {
    idempotency_key: params.idempotencyKey,
    order: {
      location_id: params.locationId,
      reference_id: params.referenceId.slice(0, 40),
      source: { name: 'Kenworthy Website' },
      line_items: params.built.lineItems,
      ...(params.built.taxes.length ? { taxes: params.built.taxes } : {}),
      fulfillments: [{
        type: fulfillmentType,
        state: 'COMPLETED',
        ...(fulfillmentType === 'DIGITAL'
          ? {
            delivery_details: {
              recipient: {
                display_name: (params.buyerName || 'Kenworthy patron').slice(0, 255),
                ...(params.buyerEmail ? { email_address: params.buyerEmail } : {}),
              },
            },
          }
          : {}),
      }],
    },
  };
}
