// Tests for the server's pricing authority.
//
// This is the module that decides what a customer's card is charged, so the
// properties worth pinning down are adversarial ones: a browser asking for a
// cheap tier on an expensive seat, an inactive tier, a tier from another
// showing. Each of those is a way to buy a $20 seat for $8 if the server
// defers to the request.
//
//   deno test supabase/functions/_shared/pricing_test.ts

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  MAX_BUNDLED_DONATION_CENTS,
  PricingError,
  computeProcessingFee,
  priceTicketOrder,
  readDonationCents,
  storedOrderCents,
  ticketLineItems,
} from './pricing.ts';
import { lineItemsTotalCents } from './square.ts';

// ---------------------------------------------------------------------------
// A stub standing in for the PostgREST query builder, holding fixed rows.
// ---------------------------------------------------------------------------

type Rows = Record<string, any[]>;

function stubAdmin(rows: Rows) {
  const builder = (table: string) => {
    let result = rows[table] ?? [];
    const self: any = {
      select: () => self,
      eq: (column: string, value: unknown) => {
        result = result.filter((r) => r[column] === value);
        return self;
      },
      in: (column: string, values: unknown[]) => {
        result = result.filter((r) => values.includes(r[column]));
        return self;
      },
      maybeSingle: () => Promise.resolve({ data: result[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: result, error: null }),
    };
    return self;
  };
  return { from: (table: string) => builder(table) };
}

const SHOWING_ID = 'showing-1';

function fixture(overrides: Partial<Rows> = {}): Rows {
  return {
    showings: [{
      id: SHOWING_ID,
      ticket_price: 10,
      is_active: true,
      requires_seat_selection: false,
      total_seats: 200,
      start_time: '2026-09-01T02:00:00Z',
      movie_id: 'movie-1',
      event_id: null,
      live_performance_id: null,
    }],
    movies: [{ id: 'movie-1', title: 'Rear Window', pass_processing_fee: false }],
    showing_price_tiers: [
      { id: 'tier-adult', showing_id: SHOWING_ID, tier_name: 'Adult', price: 20, is_active: true },
      { id: 'tier-student', showing_id: SHOWING_ID, tier_name: 'Student', price: 8.25, is_active: true },
    ],
    showing_seat_tiers: [],
    seats: [],
    ...overrides,
  };
}

Deno.test('falls back to the showing price when no tier is named', async () => {
  const order = await priceTicketOrder(stubAdmin(fixture()), SHOWING_ID, [{}, {}]);
  assertEquals(order.subtotal, 20);
  assertEquals(order.tax, 1.2);
  assertEquals(order.total, 21.2);
  assertEquals(order.amountCents, 2120);
});

Deno.test('rounds tax per ticket, as the database trigger does', async () => {
  // 8.25 * 6% = 0.495 -> 0.50 each. Rounding once on the 33.00 subtotal would
  // give 1.98, and the charge would disagree with the stored ticket rows.
  const order = await priceTicketOrder(
    stubAdmin(fixture()),
    SHOWING_ID,
    Array.from({ length: 4 }, () => ({ tier_id: 'tier-student' })),
  );
  assertEquals(order.subtotal, 33);
  assertEquals(order.tax, 2);
  assertEquals(order.total, 35);
});

Deno.test('rounds a half-cent up, the way exact numeric does', async () => {
  const rows = fixture();
  rows.showings[0].ticket_price = 4.25;
  // 4.25 * 0.06 = 0.255. Computed in doubles this lands at 25.499999999999996
  // cents and rounds down to 0.25, disagreeing with the 0.26 the database
  // stores — a charge a cent under the ticket rows it is supposed to pay for.
  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]);
  assertEquals(order.tax, 0.26);
  assertEquals(order.total, 4.51);
  assertEquals(order.amountCents, 451);
});

Deno.test("a seat's own tier overrides the tier the client asked for", async () => {
  const rows = fixture({
    showing_seat_tiers: [{
      showing_id: SHOWING_ID,
      tier_id: 'tier-adult',
      // Section casing differs between venue_seats and seats in real data,
      // which is why the match is case-insensitive.
      venue_seats: { seat_row: 'A', seat_number: 1, section: 'Center' },
    }],
    seats: [{ id: 'seat-a1', seat_row: 'A', seat_number: 1, section: 'center' }],
  });

  // The browser claims the $8.25 student tier for a seat mapped to the $20 tier.
  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [
    { seat_id: 'seat-a1', tier_id: 'tier-student' },
  ]);

  assertEquals(order.tickets[0].tier_id, 'tier-adult');
  assertEquals(order.tickets[0].price, 20);
  assertEquals(order.total, 21.2);
});

Deno.test('rejects a tier that does not belong to this showing', async () => {
  await assertRejects(
    () => priceTicketOrder(stubAdmin(fixture()), SHOWING_ID, [{ tier_id: 'tier-from-elsewhere' }]),
    PricingError,
    'Invalid ticket tier',
  );
});

Deno.test('rejects a tier that has been taken off sale', async () => {
  const rows = fixture();
  rows.showing_price_tiers[1].is_active = false;
  await assertRejects(
    () => priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{ tier_id: 'tier-student' }]),
    PricingError,
    'no longer on sale',
  );
});

Deno.test('rejects an inactive showing and an unknown one', async () => {
  const inactive = fixture();
  inactive.showings[0].is_active = false;
  await assertRejects(
    () => priceTicketOrder(stubAdmin(inactive), SHOWING_ID, [{}]),
    PricingError,
    'no longer on sale',
  );
  await assertRejects(
    () => priceTicketOrder(stubAdmin(fixture()), 'no-such-showing', [{}]),
    PricingError,
    'Showing not found',
  );
});

Deno.test('charges no processing fee on a standard sale', async () => {
  // Theatre policy: the patron pays ticket price + tax, and the Kenworthy
  // absorbs Square's cut. Every production has pass_processing_fee false.
  const order = await priceTicketOrder(stubAdmin(fixture()), SHOWING_ID, [{}, {}]);
  assertEquals(order.processingFee, 0);
  assertEquals(order.grandTotal, order.total);
  assertEquals(order.amountCents, 2120);
});

Deno.test('adds the buyer-paid fee only for a rental that opted in', async () => {
  const withFee = fixture();
  withFee.movies[0].pass_processing_fee = true;

  const charged = await priceTicketOrder(stubAdmin(withFee), SHOWING_ID, [{}]);
  const expected = computeProcessingFee(10.6, 'online');
  assertEquals(charged.processingFee, expected.fee);
  assertEquals(charged.grandTotal, expected.total);

  // A film-pass redemption never touches Square, so it carries no surcharge.
  const redeemed = await priceTicketOrder(stubAdmin(withFee), SHOWING_ID, [{}], 'none');
  assertEquals(redeemed.processingFee, 0);
  assertEquals(redeemed.grandTotal, 10.6);
});

Deno.test('refuses an empty order', async () => {
  await assertRejects(
    () => priceTicketOrder(stubAdmin(fixture()), SHOWING_ID, []),
    PricingError,
    'No tickets requested',
  );
});

// ---------------------------------------------------------------------------
// Bundled donations
// ---------------------------------------------------------------------------
//
// The property that matters is negative: a donation must never reach the tax
// base. priceTicketOrder does not take one, and readDonationCents hands back a
// number the caller adds to the charge *after* pricing — so the test below
// pins the validation, and the tax-free part is structural rather than a
// number to assert.

Deno.test('readDonationCents accepts nothing, zero, and the preset amounts', () => {
  assertEquals(readDonationCents(undefined), { ok: true, cents: 0 });
  assertEquals(readDonationCents(null), { ok: true, cents: 0 });
  assertEquals(readDonationCents(''), { ok: true, cents: 0 });
  assertEquals(readDonationCents(0), { ok: true, cents: 0 });
  assertEquals(readDonationCents(100), { ok: true, cents: 100 });
  assertEquals(readDonationCents(500), { ok: true, cents: 500 });
  assertEquals(readDonationCents(1000), { ok: true, cents: 1000 });
});

Deno.test('readDonationCents refuses what the donations table would refuse', () => {
  // Below the table's own CHECK (amount_cents >= 100): charging this would
  // take the money and then fail to record what it was for.
  const tooSmall = readDonationCents(40);
  assertEquals(tooSmall.ok, false);

  const negative = readDonationCents(-500);
  assertEquals(negative.ok, false);

  // Fractional cents are not money.
  assertEquals(readDonationCents(12.5).ok, false);
  assertEquals(readDonationCents('five dollars').ok, false);

  // A tampered request cannot turn a $9 ticket into a five-figure charge.
  assertEquals(readDonationCents(MAX_BUNDLED_DONATION_CENTS).ok, true);
  assertEquals(readDonationCents(MAX_BUNDLED_DONATION_CENTS + 1).ok, false);
});

// ---------------------------------------------------------------------------
// Square attribution lines
// ---------------------------------------------------------------------------
//
// One property matters above all the rest: the lines must sum to exactly the
// amount charged. Square refuses a payment larger than its order, and leaves the
// order part-paid if it is smaller, so a drift here is not a cosmetic reporting
// bug. `createAttributionOrder` refuses to send a mismatched set — these tests
// are what keep that refusal from being reached in normal use.

Deno.test('line items sum to the charged amount, including the odd-cent case', async () => {
  // 3 × $8.25. Tax rounds to 50c per row here, which is not what Square's own
  // arithmetic produces: measured in sandbox it rounds half-to-even and
  // apportions from the order total, making the same three tickets 2623. That
  // is why the tax is a line we compute rather than a percentage Square
  // applies. See docs/SQUARE-PAYMENTS.md.
  const order = await priceTicketOrder(
    stubAdmin(fixture()),
    SHOWING_ID,
    Array.from({ length: 3 }, () => ({ tier_id: 'tier-student' })),
  );
  const lines = ticketLineItems(order);
  assertEquals(lineItemsTotalCents(lines), order.amountCents);
  assertEquals(lineItemsTotalCents(lines), 2625);

  // Split, not rolled together: 2475 of film and 150 of tax.
  assertEquals(lines.find((l) => l.name === 'Rear Window')?.amountCents, 825);
  assertEquals(lines.find((l) => l.name === 'Sales tax')?.amountCents, 150);
});

Deno.test('tickets group by price point, with the film as the item', async () => {
  const order = await priceTicketOrder(stubAdmin(fixture()), SHOWING_ID, [
    { tier_id: 'tier-adult' },
    { tier_id: 'tier-student' },
    { tier_id: 'tier-student' },
  ]);
  const lines = ticketLineItems(order);
  const films = lines.filter((l) => l.name === 'Rear Window');

  // Two film lines, not three: Item Sales wants a quantity, not a row per seat.
  // The film is the item so revenue aggregates by film, and the tier rides
  // underneath it as a variation.
  assertEquals(films.length, 2);
  assertEquals(films.map((l) => l.variationName).sort(), ['Adult', 'Student']);
  assertEquals(films.find((l) => l.variationName === 'Student')?.quantity, 2);

  // Pre-tax, so a film's gross in Square means what the register's line has
  // always meant for the same catalog item.
  assertEquals(films.find((l) => l.variationName === 'Adult')?.amountCents, 2000);
  assertEquals(films.find((l) => l.variationName === 'Student')?.amountCents, 825);
  assertEquals(lineItemsTotalCents(lines), order.amountCents);
});

Deno.test('a gift sits outside both the film takings and the tax line', async () => {
  const order = await priceTicketOrder(stubAdmin(fixture()), SHOWING_ID, [{}]);
  const lines = ticketLineItems(order, 2500);

  const donation = lines.find((l) => l.name === 'Donation');
  assertEquals(donation?.amountCents, 2500);
  assertEquals(donation?.quantity, 1);

  // A $10 ticket: $10.00 of film, 60c of tax, and a $25 gift that is part of
  // neither. Splitting the tax out is what makes that visible in Square — with
  // a combined $10.60 ticket line, "what was taxed" was only ever implied.
  assertEquals(lines.find((l) => l.name === 'Rear Window')?.amountCents, 1000);
  assertEquals(lines.find((l) => l.name === 'Sales tax')?.amountCents, 60);

  // The tax is 6% of the ticket alone; the gift never enters the base.
  assertEquals(lineItemsTotalCents(lines), order.amountCents + 2500);
});

Deno.test('a free showing carries no tax line at all', async () => {
  const rows = fixture({
    showings: [{
      id: SHOWING_ID,
      ticket_price: 0,
      is_active: true,
      requires_seat_selection: false,
      total_seats: 200,
      start_time: '2026-09-01T02:00:00Z',
      movie_id: 'movie-1',
      event_id: null,
      live_performance_id: null,
    }],
    showing_price_tiers: [],
  });
  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]);
  const lines = ticketLineItems(order);

  // No money moves, so there is no order to attribute — but the builder must
  // not emit a $0 tax line on the way to finding that out.
  assertEquals(lines.find((l) => l.name === 'Sales tax'), undefined);
  assertEquals(lineItemsTotalCents(lines), 0);
});

Deno.test('the buyer-paid surcharge is a line, not part of the ticket price', async () => {
  const rows = fixture({
    movies: [{ id: 'movie-1', title: 'Rear Window', pass_processing_fee: true }],
  });
  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}], 'in_person');
  const lines = ticketLineItems(order);

  assertEquals(
    lines.find((l) => l.name === 'Card processing fee')?.amountCents,
    Math.round(order.processingFee * 100),
  );
  assertEquals(lineItemsTotalCents(lines), order.amountCents);
});

// ---------------------------------------------------------------------------
// Priced vs stored
// ---------------------------------------------------------------------------
//
// `enforce_ticket_pricing` re-derives price, tax and total in Postgres numeric
// after we derived them in JavaScript. The two are meant to agree exactly,
// because `charged == SUM(tickets.total_price)` is what the refund path
// re-reads. These pin the comparison itself.

Deno.test('stored cents reads back what the trigger left on the rows', () => {
  // Two $8.25 tickets: 875 each after per-row tax, plus a surcharge riding on
  // the first row the way the schema puts it.
  assertEquals(
    storedOrderCents([
      { total_price: 8.75, processing_fee: 0.55 },
      { total_price: 8.75, processing_fee: 0 },
    ]),
    1805,
  );

  // PostgREST hands numerics back as strings often enough to matter.
  assertEquals(storedOrderCents([{ total_price: '10.60', processing_fee: '0' }]), 1060);

  // A missing surcharge column is zero, not NaN — the select does not always
  // ask for it.
  assertEquals(storedOrderCents([{ total_price: 12.72 }]), 1272);
  assertEquals(storedOrderCents([]), 0);
});

Deno.test('priced and stored agree on the case that once did not', async () => {
  // $4.25 is the price that broke this before: `4.25 * 0.06 * 100` is
  // 25.499999999999996 in doubles and rounds down to 25c, while Postgres numeric
  // stores 26c. The server now works in integer cents and lands on 26 — so the
  // charge equals what the trigger will store, which is exactly what the check
  // in ticket-checkout asserts on every real order.
  const rows = fixture({
    showings: [{
      id: SHOWING_ID,
      ticket_price: 4.25,
      is_active: true,
      requires_seat_selection: false,
      total_seats: 200,
      start_time: '2026-09-01T02:00:00Z',
      movie_id: 'movie-1',
      event_id: null,
      live_performance_id: null,
    }],
    showing_price_tiers: [],
  });
  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]);
  assertEquals(order.tax, 0.26);
  assertEquals(order.amountCents, 451);

  // What the trigger would leave behind for that same ticket.
  assertEquals(storedOrderCents([{ total_price: 4.51, processing_fee: 0 }]), order.amountCents);
});

Deno.test('only the film line is offered to the catalog lookup', async () => {
  const rows = fixture({
    movies: [{ id: 'movie-1', title: 'Rear Window', pass_processing_fee: true }],
  });
  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}], 'in_person');
  const lines = ticketLineItems(order, 2500);

  // The film has a decade of history in Square's item library and should join
  // it. A fee and a gift have no counterpart there, and letting them search
  // would risk binding the theatre's revenue to whatever happened to be named
  // "Donation" on the register.
  assertEquals(lines.find((l) => l.name === 'Rear Window')?.lookupCatalog, true);
  assertEquals(lines.find((l) => l.name === 'Card processing fee')?.lookupCatalog, undefined);
  assertEquals(lines.find((l) => l.name === 'Donation')?.lookupCatalog, undefined);
  assertEquals(lines.find((l) => l.name === 'Sales tax')?.lookupCatalog, undefined);
});
