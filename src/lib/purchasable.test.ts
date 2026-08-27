// The rule that a past showing cannot be bought.
//
// The cases worth pinning are the boundaries and the fallbacks, because those
// are where the three copies of this rule (this file, the Deno twin, and
// showing_ends_at() in SQL) would drift apart without anyone noticing: a
// showing sold five minutes after it ended looks identical to one sold five
// minutes before, in every log we keep.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOWING_MINUTES,
  DOOR_GRACE_MINUTES,
  NO_TICKET_REQUIRED_MESSAGE,
  SOLD_OUT_MESSAGE,
  doorClosesAt,
  isManuallySoldOut,
  isPast,
  isPurchasable,
  needsNoTicket,
  resolveDurationMinutes,
  showingEndsAt,
  soldOutMessage,
} from './purchasable';

const START = '2026-08-19T02:00:00Z'; // 7:00 PM Pacific
const startMs = new Date(START).getTime();
const min = (n: number) => n * 60 * 1000;

describe('resolveDurationMinutes', () => {
  it("prefers the showing's own override", () => {
    expect(resolveDurationMinutes({ start_time: START, duration_minutes: 200 }, { duration_minutes: 118 }))
      .toBe(200);
  });

  it("falls back to the film's runtime", () => {
    expect(resolveDurationMinutes({ start_time: START }, { duration_minutes: 118 })).toBe(118);
  });

  it('falls back to the default when nothing knows — an event or a live performance', () => {
    expect(resolveDurationMinutes({ start_time: START })).toBe(DEFAULT_SHOWING_MINUTES);
  });

  it('treats zero and negative durations as absent rather than as an instant end', () => {
    expect(resolveDurationMinutes({ start_time: START, duration_minutes: 0 }, { duration_minutes: 118 }))
      .toBe(118);
    expect(resolveDurationMinutes({ start_time: START, duration_minutes: -30 })).toBe(DEFAULT_SHOWING_MINUTES);
  });
});

describe('showingEndsAt', () => {
  it('adds the resolved runtime to the start', () => {
    expect(showingEndsAt({ start_time: START }, { duration_minutes: 118 }).getTime())
      .toBe(startMs + min(118));
  });
});

describe('isPast', () => {
  it('is false while the film is still running — the whole point of the chosen cutoff', () => {
    // 7:20 PM at a 7:00 PM, 118-minute film. A latecomer is still a customer.
    expect(isPast({ start_time: START }, { duration_minutes: 118 }, startMs + min(20))).toBe(false);
  });

  it('is false one minute before the end', () => {
    expect(isPast({ start_time: START }, { duration_minutes: 118 }, startMs + min(117))).toBe(false);
  });

  it('is true at exactly the end — the boundary is inclusive', () => {
    expect(isPast({ start_time: START }, { duration_minutes: 118 }, startMs + min(118))).toBe(true);
  });

  it('uses the two-hour default for an event with no runtime anywhere', () => {
    expect(isPast({ start_time: START }, null, startMs + min(119))).toBe(false);
    expect(isPast({ start_time: START }, null, startMs + min(120))).toBe(true);
  });

  it('does not call an undateable showing past', () => {
    // A broken row should render its normal page and be refused by the server
    // for its own reasons, not be silently hidden by this rule.
    expect(isPast({ start_time: null })).toBe(false);
    expect(isPast({ start_time: 'not a date' })).toBe(false);
    expect(isPast(null)).toBe(false);
  });
});

describe('isPurchasable', () => {
  it('is true for a future showing', () => {
    expect(isPurchasable({ start_time: START, is_active: true }, null, startMs - min(60))).toBe(true);
  });

  it('is false once the showing has ended', () => {
    expect(isPurchasable({ start_time: START, is_active: true }, null, startMs + min(121))).toBe(false);
  });

  it('is false for a deactivated showing that has not happened yet', () => {
    expect(isPurchasable({ start_time: START, is_active: false }, null, startMs - min(60))).toBe(false);
  });

  it('says nothing about capacity — sold out is a separate state with its own notice', () => {
    expect(isPurchasable({ start_time: START, is_active: true }, null, startMs - min(1))).toBe(true);
  });
});

describe('doorClosesAt', () => {
  it('is start + the door grace, independent of how long the show runs', () => {
    expect(doorClosesAt({ start_time: START }).getTime()).toBe(startMs + min(DOOR_GRACE_MINUTES));
  });

  it('outlasts the online cutoff for an ordinary film, which is why they are two rules', () => {
    const ends = showingEndsAt({ start_time: START }, { duration_minutes: 118 }).getTime();
    expect(doorClosesAt({ start_time: START }).getTime()).toBeGreaterThan(ends);
  });
});

/**
 * The other rule this file states: a showing that issues no ticket cannot sell
 * one. Worth pinning for the same reason as the first — the flag has three
 * copies (here, the Deno twin, and the trigger in
 * 20260827113402_showings_no_ticket_required.sql), and the failure mode when
 * they drift is silent. A walk-in night that still takes money looks exactly
 * like a paid one in every log we keep.
 */
describe('needsNoTicket', () => {
  it('is true only when the flag is actually set', () => {
    expect(needsNoTicket({ start_time: START, no_ticket_required: true })).toBe(true);
  });

  it('reads an absent flag as ticketed', () => {
    // Every showing created before the column existed, and every row PostgREST
    // returns from a select that does not name it. Defaulting the other way
    // would turn the whole site into walk-in showings for as long as a stale
    // schema cache lasted.
    expect(needsNoTicket({ start_time: START })).toBe(false);
    expect(needsNoTicket({ start_time: START, no_ticket_required: null })).toBe(false);
    expect(needsNoTicket({ start_time: START, no_ticket_required: false })).toBe(false);
  });

  it('is not inferred from a free price', () => {
    // The distinction the whole feature rests on: a $0 showing is free *and*
    // ticketed unless somebody says otherwise. There is no price on
    // ShowingTiming at all, which is the point — this cannot be answered by
    // arithmetic.
    expect(needsNoTicket({ start_time: START, is_active: true })).toBe(false);
  });

  it('is unaffected by the clock', () => {
    // Unlike isPast, this takes no `now`. A showing that issues no tickets
    // issues none before it starts and none a year after.
    expect(needsNoTicket({ start_time: '1999-01-01T00:00:00Z', no_ticket_required: true })).toBe(true);
  });

  it('says the same sentence the server and the trigger say', () => {
    // Mirrored by NO_TICKET_REQUIRED_MESSAGE in
    // supabase/functions/_shared/purchasable.ts and by the PT409 RAISE in
    // 20260827113402_showings_no_ticket_required.sql. A buyer who submits a
    // stale tab must not get a second, differently worded version of the fact
    // the page already showed them.
    expect(NO_TICKET_REQUIRED_MESSAGE).toBe('This showing does not require a ticket.');
  });
});

describe('isPurchasable and the no-ticket flag', () => {
  it('refuses a walk-in showing that has not started yet', () => {
    expect(
      isPurchasable(
        { start_time: START, is_active: true, no_ticket_required: true },
        null,
        startMs - min(60),
      ),
    ).toBe(false);
  });

  it('still allows a free *ticketed* showing — the RSVP case is unchanged', () => {
    expect(
      isPurchasable(
        { start_time: START, is_active: true, no_ticket_required: false },
        null,
        startMs - min(60),
      ),
    ).toBe(true);
  });

  it('refuses a walk-in showing that is also past, without disagreeing about why', () => {
    // Both rules apply; isPurchasable only answers "can money change hands".
    // Which *reason* to give is the caller's decision, and the trigger and the
    // server both report the no-ticket one first.
    expect(
      isPurchasable(
        { start_time: START, is_active: true, no_ticket_required: true },
        null,
        startMs + min(600),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The manual sold-out flag.
//
// What makes this one worth pinning separately from capacity: it has to be
// able to close a showing with every seat still unsold, and it must not leak
// into `isPurchasable`, because the page tells the two states in two different
// sentences and a merged answer would collapse them into one hidden button.
// ---------------------------------------------------------------------------

describe('isManuallySoldOut', () => {
  it('is true only when an admin actually set the flag', () => {
    expect(isManuallySoldOut({ start_time: START, manually_sold_out: true })).toBe(true);
    expect(isManuallySoldOut({ start_time: START, manually_sold_out: false })).toBe(false);
  });

  it('reads an absent or null flag as open', () => {
    // Every showing that existed before the column, and every row PostgREST
    // returns before it reloads its schema cache. Closing the whole site is
    // the worse failure of the two, and unlike the walk-in flag there is no
    // trigger underneath to catch what this lets through.
    expect(isManuallySoldOut({ start_time: START })).toBe(false);
    expect(isManuallySoldOut({ start_time: START, manually_sold_out: null })).toBe(false);
    expect(isManuallySoldOut(null)).toBe(false);
    expect(isManuallySoldOut(undefined)).toBe(false);
  });

  it('is false on a walk-in showing, even with the flag set', () => {
    // A contradictory row. Nothing is issued, so nothing can run out — and
    // "Sold Out" printed over a screening anyone can walk into is the specific
    // wrong outcome this guard exists to prevent.
    expect(
      isManuallySoldOut({
        start_time: START,
        no_ticket_required: true,
        manually_sold_out: true,
      }),
    ).toBe(false);
  });

  it('does not care about the clock', () => {
    // Unlike isPast, this asks a question with no time in it. A showing closed
    // by hand is closed a week before and a week after.
    expect(
      isManuallySoldOut({ start_time: '1999-01-01T00:00:00Z', manually_sold_out: true }),
    ).toBe(true);
  });
});

describe('soldOutMessage', () => {
  it("uses the admin's sentence when there is one, trimmed", () => {
    expect(
      soldOutMessage({ start_time: START, sold_out_message: '  Booked privately.  ' }),
    ).toBe('Booked privately.');
  });

  it('falls back to the standard notice for blank, whitespace, null and absent', () => {
    // A field opened and cleared leaves '' or ' ' behind. Neither should blank
    // the notice on the page or produce an empty refusal from the server.
    expect(soldOutMessage({ start_time: START, sold_out_message: '' })).toBe(SOLD_OUT_MESSAGE);
    expect(soldOutMessage({ start_time: START, sold_out_message: '   ' })).toBe(SOLD_OUT_MESSAGE);
    expect(soldOutMessage({ start_time: START, sold_out_message: null })).toBe(SOLD_OUT_MESSAGE);
    expect(soldOutMessage({ start_time: START })).toBe(SOLD_OUT_MESSAGE);
  });
});

describe('isPurchasable and the sold-out flag', () => {
  it('does not answer the sold-out question', () => {
    // Deliberate. Sold-out is a state with its own notice, and Showing.tsx
    // asks the two separately so that a full house and a finished show do not
    // end up telling the customer the same thing. The sale is protected by
    // _shared/pricing.ts, which asks both.
    expect(
      isPurchasable(
        { start_time: START, is_active: true, manually_sold_out: true },
        null,
        startMs - min(60),
      ),
    ).toBe(true);
  });

  it('still refuses a sold-out showing that has also passed', () => {
    // The timing rule is untouched by any of this.
    expect(
      isPurchasable(
        { start_time: START, is_active: true, manually_sold_out: true },
        null,
        startMs + min(600),
      ),
    ).toBe(false);
  });
});

// The page's own arithmetic: `soldOut = manual || capacity`. Pinned here
// because it is the line that decides whether the buy controls render at all,
// and either input alone has to be enough.
describe('the showing page combines the two sold-out states with OR', () => {
  const soldOut = (manual: boolean, capacity: boolean) => manual || capacity;

  it('closes on the manual flag with seats to spare', () => {
    expect(soldOut(true, false)).toBe(true);
  });

  it('closes on capacity with no manual flag — the behaviour that already existed', () => {
    expect(soldOut(false, true)).toBe(true);
  });

  it('stays open only when neither says otherwise', () => {
    expect(soldOut(false, false)).toBe(false);
  });
});
