// Turning a rental request's invoice lines into a Square invoice.
//
// The HTTP calls live in the `square-invoice` function; everything that
// *decides what a renter is billed* lives here, where it can be tested without
// a Square account. Three decisions in particular are easy to get subtly wrong
// and impossible to notice from a 200 response:
//
//   1. A discount line is not a negative line item. Square rejects a negative
//      `base_price_money`, so `nonprofit_discount` (and any line a staffer
//      typed as a negative amount) becomes an order-level FIXED_AMOUNT
//      discount instead.
//   2. A fractional quantity is not a Square quantity. Square's `quantity` is
//      a string and must be a whole number unless the line also carries a
//      `quantity_unit`. "4.5 hours × $180" is therefore billed as one line of
//      $810 whose note preserves the arithmetic.
//   3. Money is rounded once, at the line, in cents — the same place
//      `RentalInvoiceLines.tsx` rounds it for the total staff see on screen.
//
// Tax and terms are not invented here; they are what the rest of the building
// already does. 6% on lines flagged taxable mirrors `TAX_RATE` in
// `src/components/admin/RentalInvoiceLines.tsx`, and net-14 is clause 3 of the
// licence agreement: "The balance of the rental fee must be paid in full no
// later than fourteen (14) days following the receipt of event invoice."

/** Mirrors TAX_RATE in src/components/admin/RentalInvoiceLines.tsx (6%). */
export const SALES_TAX_PERCENTAGE = '6';
export const SALES_TAX_NAME = 'Idaho Sales Tax';
export const SALES_TAX_UID = 'kpac-sales-tax';

/** Licence agreement, clause 3. */
export const PAYMENT_TERMS_DAYS = 14;

/**
 * The Kenworthy is in Moscow, Idaho — Pacific, not Mountain.
 * Must stay in agreement with VENUE_TIME_ZONE in ./tickets.ts and
 * src/lib/datetime.ts.
 */
export const VENUE_TIME_ZONE = 'America/Los_Angeles';

export interface RentalInvoiceLine {
  line_kind: string;
  description: string | null;
  quantity: number | string;
  unit_price: number | string;
  is_taxable: boolean;
  sort_order: number;
}

/** Fallback names, so an empty description never bills a renter for "". */
const LINE_KIND_LABELS: Record<string, string> = {
  general: 'General use rental',
  live_theater: 'Live theater rental',
  renter_fee: 'Fee charged to renter',
  film_licensing: 'Film licensing',
  poster_print: 'Poster printing',
  marquee: 'Marquee rental',
  rental_tickets: 'Rental ticket sales',
  nonprofit_discount: 'Non-profit discount',
};

export interface SquareOrderParts {
  lineItems: Record<string, unknown>[];
  discounts: Record<string, unknown>[];
  taxes: Record<string, unknown>[];
  /** Line items minus discounts, before tax. Cents. */
  netSubtotalCents: number;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function toNumber(value: number | string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/** Trim a quantity for display: 4 -> "4", 4.5 -> "4.5", 4.50 -> "4.5". */
function quantityLabel(quantity: number): string {
  return String(Number(quantity.toFixed(4)));
}

function lineName(line: RentalInvoiceLine): string {
  const described = (line.description || '').trim();
  const name = described || LINE_KIND_LABELS[line.line_kind] || 'Rental charge';
  return name.slice(0, 500);
}

/**
 * Build the Square order body's line items, discounts and taxes.
 *
 * Order matters to the reader of the invoice, so lines keep the `sort_order`
 * staff arranged them in.
 */
export function buildOrderParts(lines: RentalInvoiceLine[]): SquareOrderParts {
  const lineItems: Record<string, unknown>[] = [];
  const discounts: Record<string, unknown>[] = [];
  let anyTaxable = false;
  let chargesCents = 0;
  let discountsCents = 0;

  const ordered = [...lines].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  ordered.forEach((line, index) => {
    const quantity = toNumber(line.quantity);
    const unitPrice = toNumber(line.unit_price);
    const extendedCents = cents(quantity * unitPrice);
    const name = lineName(line);

    // A credit, however it was typed: the discount line kind, or any line whose
    // amount comes out negative.
    if (line.line_kind === 'nonprofit_discount' || extendedCents < 0) {
      const amount = Math.abs(extendedCents);
      if (amount === 0) return;
      discountsCents += amount;
      discounts.push({
        uid: `discount-${index}`,
        name,
        type: 'FIXED_AMOUNT',
        amount_money: { amount, currency: 'USD' },
        scope: 'ORDER',
      });
      return;
    }

    chargesCents += extendedCents;

    // Square wants a whole-number quantity string. Where the quantity is whole
    // the invoice reads the way an invoice should — "4 × $180.00" — and where
    // it is not, the extended amount goes on a single line with the arithmetic
    // kept in the note rather than lost.
    const wholeQuantity = Number.isInteger(quantity) && quantity >= 1;
    const item: Record<string, unknown> = {
      uid: `line-${index}`,
      name,
      quantity: wholeQuantity ? String(quantity) : '1',
      base_price_money: {
        amount: wholeQuantity ? cents(unitPrice) : extendedCents,
        currency: 'USD',
      },
    };
    if (!wholeQuantity && quantity !== 1) {
      item.note = `${quantityLabel(quantity)} × $${unitPrice.toFixed(2)}`;
    }
    if (line.is_taxable) {
      item.applied_taxes = [{ tax_uid: SALES_TAX_UID }];
      anyTaxable = true;
    }
    lineItems.push(item);
  });

  return {
    lineItems,
    discounts,
    // Only declare the tax when something is actually flagged taxable, so a
    // rental with no taxable line shows no tax row at all.
    taxes: anyTaxable
      ? [{
        uid: SALES_TAX_UID,
        name: SALES_TAX_NAME,
        percentage: SALES_TAX_PERCENTAGE,
        scope: 'LINE_ITEM',
        type: 'ADDITIVE',
      }]
      : [],
    netSubtotalCents: chargesCents - discountsCents,
  };
}

/** Today's calendar day at the venue, as `yyyy-MM-dd`. */
export function venueToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Add whole days to a `yyyy-MM-dd`, staying in calendar-day arithmetic. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** When the balance is due: net-14 from the day the invoice is generated. */
export function paymentDueDate(now: Date = new Date()): string {
  return addDays(venueToday(now), PAYMENT_TERMS_DAYS);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A booking's dates as one human phrase: "August 14, 2026",
 * "August 14–16, 2026", "August 30 – September 2, 2026".
 *
 * The browser-side twin is `formatPlainDateRange` in src/lib/datetime.ts —
 * same rules, different date library. Both parse the `yyyy-MM-dd` by hand
 * because `new Date('2026-08-14')` is UTC midnight, which prints as August 13
 * anywhere west of Greenwich.
 */
export function formatDateSpan(
  start: string | null | undefined,
  end?: string | null,
): string {
  const a = splitDate(start);
  if (!a) return '';
  const single = `${MONTHS[a.m - 1]} ${a.d}, ${a.y}`;

  const b = splitDate(end);
  if (!b || (b.y === a.y && b.m === a.m && b.d === a.d)) return single;

  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.d}–${b.d}, ${a.y}`;
  if (a.y === b.y) return `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`;
  return `${single} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
}

function splitDate(value: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/** The line under the invoice title: what the renter is being billed for. */
export function invoiceDescription(request: {
  event_title?: string | null;
  proposed_date?: string | null;
  end_date?: string | null;
  organization_name?: string | null;
}): string {
  const span = formatDateSpan(request.proposed_date, request.end_date);
  const parts = [
    'Kenworthy Performing Arts Centre — theatre rental',
    request.event_title?.trim() || null,
    span || null,
    request.organization_name?.trim() || null,
  ].filter(Boolean);
  return parts.join('\n').slice(0, 65_536);
}

/** Square keeps a customer's name in two halves; a rental request has one. */
export function splitName(fullName: string | null | undefined): {
  given_name: string;
  family_name?: string;
} {
  const name = (fullName || '').trim().replace(/\s+/g, ' ');
  if (!name) return { given_name: 'Renter' };
  const space = name.lastIndexOf(' ');
  if (space === -1) return { given_name: name.slice(0, 300) };
  return {
    given_name: name.slice(0, space).slice(0, 300),
    family_name: name.slice(space + 1).slice(0, 300),
  };
}
