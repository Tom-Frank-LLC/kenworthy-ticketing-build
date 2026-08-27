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
} from './pricing.ts';

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
    movies: [{ id: 'movie-1', title: 'Rear Window', pass_processing_fee: false, duration_minutes: 112 }],
    showing_price_tiers: [
      { id: 'tier-adult', showing_id: SHOWING_ID, tier_name: 'Adult', price: 20, is_active: true },
      { id: 'tier-student', showing_id: SHOWING_ID, tier_name: 'Student', price: 8.25, is_active: true },
    ],
    showing_seat_tiers: [],
    seats: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A showing that has already happened cannot be priced, and so cannot be sold.
//
// This is the server side of the rule — the layer a stale browser tab, a
// cached page or a hand-rolled POST all land on. The fixture's showing is
// dated in the future, so these build their own past ones rather than relying
// on the clock staying kind to the rest of this file.
// ---------------------------------------------------------------------------

/** A showing that started `minutesAgo` ago, with the given runtime. */
function agedFixture(minutesAgo: number, durationMinutes: number | null = null): Rows {
  const rows = fixture();
  rows.showings[0].start_time = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  rows.showings[0].duration_minutes = durationMinutes;
  return rows;
}

Deno.test('refuses to price a showing that has already ended', async () => {
  // 112-minute film, started three hours ago.
  await assertRejects(
    () => priceTicketOrder(stubAdmin(agedFixture(180)), SHOWING_ID, [{}]),
    PricingError,
    'This showing has passed.',
  );
});

Deno.test('still prices a showing that is under way — the cutoff is the end, not the start', async () => {
  // 7:20 into a 112-minute film. This is the case the "at start_time" cutoff
  // would have refused, and the reason it was not chosen.
  const order = await priceTicketOrder(stubAdmin(agedFixture(20)), SHOWING_ID, [{}]);
  assertEquals(order.subtotal, 10);
});

Deno.test("uses the showing's own duration over the film's when one is set", async () => {
  // A 112-minute film in a 300-minute slot — a double bill, say. Two and a
  // half hours in, the film's runtime says over and the showing says not.
  const order = await priceTicketOrder(stubAdmin(agedFixture(150, 300)), SHOWING_ID, [{}]);
  assertEquals(order.subtotal, 10);

  await assertRejects(
    () => priceTicketOrder(stubAdmin(agedFixture(150, 60)), SHOWING_ID, [{}]),
    PricingError,
    'This showing has passed.',
  );
});

Deno.test('falls back to two hours for an event, which carries no runtime at all', async () => {
  const eventRows = agedFixture(150);
  eventRows.showings[0].movie_id = null;
  eventRows.showings[0].event_id = 'event-1';
  eventRows.events = [{ id: 'event-1', title: 'Centenary Gala', pass_processing_fee: false }];

  await assertRejects(
    () => priceTicketOrder(stubAdmin(eventRows), SHOWING_ID, [{}]),
    PricingError,
    'This showing has passed.',
  );

  const stillOn = agedFixture(90);
  stillOn.showings[0].movie_id = null;
  stillOn.showings[0].event_id = 'event-1';
  stillOn.events = [{ id: 'event-1', title: 'Centenary Gala', pass_processing_fee: false }];
  const order = await priceTicketOrder(stubAdmin(stillOn), SHOWING_ID, [{}]);
  assertEquals(order.subtotal, 10);
});

Deno.test('falls back to two hours for a movie whose runtime is missing', async () => {
  const rows = agedFixture(150);
  rows.movies = [{ id: 'movie-1', title: 'Rear Window', pass_processing_fee: false }];
  await assertRejects(
    () => priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]),
    PricingError,
    'This showing has passed.',
  );
});

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
// A showing that issues no ticket cannot be sold one.
//
// The server side of the walk-in rule. The case it exists for is an admin
// flipping a free screening to "no ticket needed" while somebody has its old
// purchase panel open — that tab still holds a rendered Reserve button, and
// pressing it lands here.
//
// The fixture is priced at $10 on purpose in the first test: the database's
// CHECK would refuse that combination, so it can only arrive from a caller
// that is already lying. Refusing it on the flag rather than on the price is
// what makes the flag, not the arithmetic, the thing being enforced.
// ---------------------------------------------------------------------------

/** The fixture's showing, free and issuing no ticket. */
function walkInFixture(overrides: Record<string, unknown> = {}): Rows {
  const rows = fixture();
  rows.showings[0].ticket_price = 0;
  rows.showings[0].no_ticket_required = true;
  rows.showing_price_tiers = [];
  Object.assign(rows.showings[0], overrides);
  return rows;
}

Deno.test('refuses to price a showing that requires no ticket', async () => {
  await assertRejects(
    () => priceTicketOrder(stubAdmin(walkInFixture()), SHOWING_ID, [{}]),
    PricingError,
    'This showing does not require a ticket.',
  );
});

Deno.test('refuses a walk-in showing on the flag alone, whatever the price says', async () => {
  // A row the CHECK constraint would not allow, arriving anyway. The refusal
  // must not depend on the price agreeing with the flag.
  await assertRejects(
    () => priceTicketOrder(stubAdmin(walkInFixture({ ticket_price: 10 })), SHOWING_ID, [{}]),
    PricingError,
    'This showing does not require a ticket.',
  );
});

Deno.test('reports a walk-in showing as such even when it is also past', async () => {
  // Both rules apply. The reason given has to be the real one: "This showing
  // has passed" would send staff looking for a date problem on a screening
  // whose actual answer is that it never had tickets. The trigger orders its
  // two checks the same way.
  const rows = walkInFixture();
  rows.showings[0].start_time = new Date(Date.now() - 180 * 60_000).toISOString();

  await assertRejects(
    () => priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]),
    PricingError,
    'This showing does not require a ticket.',
  );
});

Deno.test('still prices a free showing that DOES issue a ticket — the RSVP case', async () => {
  // The distinction the feature rests on. Both are $0; only one is refused.
  const rows = fixture();
  rows.showings[0].ticket_price = 0;
  rows.showings[0].no_ticket_required = false;
  rows.showing_price_tiers = [];

  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]);
  assertEquals(order.subtotal, 0);
});

Deno.test('treats a showing row with no such column as ticketed', async () => {
  // A select that lost the column, or a PostgREST schema cache that has not
  // reloaded after the migration. Absent must read as "ordinary ticketed
  // showing": the opposite default would refuse every sale on the site, and
  // the trigger still backstops the sale this lets through.
  const rows = fixture();
  delete rows.showings[0].no_ticket_required;

  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]);
  assertEquals(order.subtotal, 10);
});
