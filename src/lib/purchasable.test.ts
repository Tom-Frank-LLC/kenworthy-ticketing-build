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
  doorClosesAt,
  isPast,
  isPurchasable,
  resolveDurationMinutes,
  showingEndsAt,
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
