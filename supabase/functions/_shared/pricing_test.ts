// Tests for the server's pricing authority.
//
// This is the module that decides what a customer's card is charged, so the
// properties worth pinning down are adversarial ones: a browser asking for a
// cheap tier on an expensive seat, an inactive tier, a tier from another
// showing. Each of those is a way to buy a $20 seat for $8 if the server
// defers to the request.
//
//   deno test supabase/functions/_shared/pricing_test.ts

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  MAX_BUNDLED_DONATION_CENTS,
  PricingError,
  bundledDonationEmailError,
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
      // Relative, not absolute. This was '2026-09-01T02:00:00Z', and on
      // 2026-09-01 it quietly became a date in the past — at which point the
      // "you cannot buy a ticket to something that already happened" rule
      // (#102, merged 19 Aug) rejected every order before the test reached
      // what it was actually checking. Sixteen tests went red at once —
      // covering tax rounding, tier validation, processing fees and sold-out
      // handling — and stayed that way, on the money path.
      //
      // A test that fails for a reason unrelated to its subject is not testing
      // its subject. These were not "16 known failures"; they were 16 things
      // nobody was checking any more.
      //
      // The aged fixtures below already did this correctly with Date.now().
      // This one was the outlier, and absolute dates in fixtures are a time
      // bomb with the fuse set to whenever the rule that reads them changes.
      start_time: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
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

// ---------------------------------------------------------------------------
// A showing an admin closed to online sales by hand.
//
// This is the whole enforcement of that flag, which makes these tests load
// bearing in a way the two rules above are not: there is no trigger on
// `tickets` behind this one, deliberately, so the box office can keep selling
// on a night the website is closed. If this gate goes, nothing refuses.
//
// The case it exists for: the house filled through a block booking taken over
// the phone, an admin flips the toggle, and a tab opened before that still
// holds a rendered buy button with seats showing available.
// ---------------------------------------------------------------------------

/** The fixture's showing, closed by hand. Seats are deliberately left plentiful. */
function soldOutFixture(overrides: Record<string, unknown> = {}): Rows {
  const rows = fixture();
  rows.showings[0].manually_sold_out = true;
  Object.assign(rows.showings[0], overrides);
  return rows;
}

Deno.test('refuses to price a showing an admin marked sold out', async () => {
  await assertRejects(
    () => priceTicketOrder(stubAdmin(soldOutFixture()), SHOWING_ID, [{}]),
    PricingError,
    'This showing is sold out.',
  );
});

Deno.test('refuses on the flag alone, with the whole house still unsold', async () => {
  // The point of the feature. total_seats is 200 and the fixture sells none of
  // them, so every capacity check in the system says this showing is wide
  // open. The flag has to be able to overrule that on its own, or it only
  // works on showings that were nearly full anyway.
  const rows = soldOutFixture({ total_seats: 500 });
  await assertRejects(
    () => priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]),
    PricingError,
    'This showing is sold out.',
  );
});

Deno.test("refuses with the admin's own sentence when one is set", async () => {
  // The refusal and the notice on the page have to be the same words. A buyer
  // told "sold out" by a page that said "booked privately by the Historical
  // Society" has two facts to reconcile and one of them is vaguer.
  const rows = soldOutFixture({
    sold_out_message: 'Sold out — this screening was booked privately.',
  });
  await assertRejects(
    () => priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]),
    PricingError,
    'Sold out — this screening was booked privately.',
  );
});

Deno.test('falls back to the standard sentence when the message is only whitespace', async () => {
  // A field that was opened and cleared. Refusing with an empty string would
  // surface a blank error toast.
  const rows = soldOutFixture({ sold_out_message: '   ' });
  await assertRejects(
    () => priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]),
    PricingError,
    'This showing is sold out.',
  );
});

Deno.test('reports a past showing as past even when it is also sold out', async () => {
  // The reverse of the walk-in ordering, and deliberately so. "Sold out" on a
  // screening that ended last week invites a patron to ring the box office
  // about a seat; "has passed" is the older and plainer fact.
  const rows = soldOutFixture();
  rows.showings[0].start_time = new Date(Date.now() - 180 * 60_000).toISOString();

  await assertRejects(
    () => priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]),
    PricingError,
    'This showing has passed.',
  );
});

Deno.test('a walk-in showing is refused as such, not as sold out', async () => {
  // A contradictory row — nothing is issued, yet something is flagged sold
  // out. isManuallySoldOut answers false for a walk-in, so the reason given is
  // the real one rather than an inherited flag nobody meant to set.
  const rows = walkInFixture({ manually_sold_out: true });
  await assertRejects(
    () => priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]),
    PricingError,
    'This showing does not require a ticket.',
  );
});

Deno.test('still prices a showing that has been reopened', async () => {
  // Reopening clears the flag and nothing else. A leftover sold_out_message
  // must not keep refusing the sale — the text outlives the closure by design.
  const rows = fixture();
  rows.showings[0].manually_sold_out = false;
  rows.showings[0].sold_out_message = 'Sold out — booked privately.';

  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]);
  assertEquals(order.subtotal, 10);
});

Deno.test('treats a showing row with no sold-out column as open', async () => {
  // A PostgREST schema cache that has not reloaded after the migration.
  // Absent must read as open: the opposite default would close every showing
  // on the site, and unlike the walk-in flag there is no trigger underneath to
  // catch what this lets through — so the failure has to be the visible one.
  const rows = fixture();
  delete rows.showings[0].manually_sold_out;

  const order = await priceTicketOrder(stubAdmin(rows), SHOWING_ID, [{}]);
  assertEquals(order.subtotal, 10);
});

// ---------------------------------------------------------------------------
// The gift's own contact rule
// ---------------------------------------------------------------------------
//
// The narrowness is the whole point, so it is what these pin down: a ticket
// order is untouched, and only the presence of a gift changes the answer. A
// phone-only buyer who adds a dollar was charged, banked and then permanently
// un-syncable — LGL has nothing to key a constituent on — which is the failure
// this rule exists to make impossible.

Deno.test('no gift: a phone-only buyer is unaffected', () => {
  assertEquals(bundledDonationEmailError(null, 0), null);
  assertEquals(bundledDonationEmailError('', 0), null);
  assertEquals(bundledDonationEmailError(undefined, 0), null);
});

Deno.test('gift with no email is refused', () => {
  const err = bundledDonationEmailError(null, 100);
  assert(err, 'a $1 gift with no email must be refused');
  assertStringIncludes(err, 'email');
});

Deno.test('gift with no email: blank and whitespace count as no email', () => {
  assert(bundledDonationEmailError('', 500));
  assert(bundledDonationEmailError('   ', 500));
  assert(bundledDonationEmailError(undefined, 500));
});

Deno.test('gift with an email is allowed', () => {
  assertEquals(bundledDonationEmailError('donor@example.com', 100), null);
  assertEquals(bundledDonationEmailError('donor@example.com', MAX_BUNDLED_DONATION_CENTS), null);
});

Deno.test('a negative or zero gift never triggers the rule', () => {
  assertEquals(bundledDonationEmailError(null, -1), null);
  assertEquals(bundledDonationEmailError(null, 0), null);
});
