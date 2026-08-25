import { describe, expect, it } from 'vitest';
import {
  VENUE_TIME_ZONE,
  formatPlainDate,
  formatPlainDateRange,
  formatRuntime,
  formatShowtime,
  instantToVenueLocalInput,
  runtimeLabel,
  venueDayKey,
  venueLocalToInstant,
} from './datetime';

/**
 * These tests protect one invariant: the time a customer reads on the website
 * is the time printed on their ticket email, regardless of where either the
 * customer or the admin who entered the showing happens to be.
 *
 * The fixture instant is the same one the edge function's test uses
 * (supabase/functions/_shared/tickets_test.ts) — 2026-08-15T02:30:00Z is 7:30
 * PM on Aug 14 in Moscow, Idaho. Keeping both suites on the same instant is
 * what makes "the web agrees with the email" a checked claim rather than a
 * hope.
 */
describe('venue timezone', () => {
  it('is Pacific — northern Idaho is not Mountain', () => {
    // A regression here is worth a full second of anyone's attention: setting
    // this to America/Boise or America/Denver silently shifts every showtime
    // in the app by exactly one hour, year-round.
    expect(VENUE_TIME_ZONE).toBe('America/Los_Angeles');
  });
});

describe('formatShowtime', () => {
  it('renders in the venue zone, not the viewer\'s', () => {
    expect(formatShowtime('2026-08-15T02:30:00Z', 'EEE, MMM d, yyyy h:mm a')).toBe(
      'Fri, Aug 14, 2026 7:30 PM',
    );
  });

  it('renders a Mountain-baked instant an hour early, which is the bug we fixed', () => {
    // What the Boise import stored for an advertised 7:00 PM show.
    expect(formatShowtime('2026-08-24T01:00:00Z', 'h:mm a')).toBe('6:00 PM');
    // What it should have stored.
    expect(formatShowtime('2026-08-24T02:00:00Z', 'h:mm a')).toBe('7:00 PM');
  });

  it('returns empty string for an unusable timestamp', () => {
    expect(formatShowtime('not-a-date', 'h:mm a')).toBe('');
    expect(formatShowtime('', 'h:mm a')).toBe('');
    expect(formatShowtime(null, 'h:mm a')).toBe('');
  });
});

describe('venueDayKey', () => {
  it('groups a late show under the venue day, not the next UTC day', () => {
    // 9:30 PM Aug 14 Pacific. Grouping on UTC would file this under Aug 15
    // and the calendar would show the show on the wrong date.
    expect(venueDayKey('2026-08-15T04:30:00Z')).toBe('2026-08-14');
  });
});

describe('admin round-trip', () => {
  it('interprets a datetime-local value as venue wall clock', () => {
    // The admin types 7:30 PM meaning 7:30 PM at the theatre. It must store as
    // 02:30Z whether they are sitting in Moscow, Denver, or Berlin.
    expect(venueLocalToInstant('2026-08-14T19:30').toISOString()).toBe(
      '2026-08-15T02:30:00.000Z',
    );
  });

  it('round-trips edit read-back without drift', () => {
    const naive = '2026-08-14T19:30';
    expect(instantToVenueLocalInput(venueLocalToInstant(naive))).toBe(naive);
  });

  it('handles a winter date, when the Pacific offset changes', () => {
    // Standard time: UTC-8 rather than UTC-7. A hardcoded offset would fail
    // here, which is the reason this goes through a real tz database.
    expect(venueLocalToInstant('2026-12-20T13:00').toISOString()).toBe(
      '2026-12-20T21:00:00.000Z',
    );
  });
});

describe('formatPlainDate', () => {
  it('renders a DATE column as the day it says, west of Greenwich', () => {
    // `new Date('2026-08-14')` is UTC midnight, which is 5 PM on the 13th
    // here. A rental booked for the 14th must never print as the 13th on the
    // contract the renter signs.
    expect(formatPlainDate('2026-08-14')).toBe('August 14, 2026');
  });
});

describe('formatPlainDateRange', () => {
  it('says a single day once', () => {
    expect(formatPlainDateRange('2026-08-14')).toBe('Aug 14, 2026');
    expect(formatPlainDateRange('2026-08-14', null)).toBe('Aug 14, 2026');
    // An end equal to the start is the same one-day booking, not a range.
    expect(formatPlainDateRange('2026-08-14', '2026-08-14')).toBe('Aug 14, 2026');
  });

  it('shares the month and year across a span', () => {
    expect(formatPlainDateRange('2026-08-14', '2026-08-16')).toBe('Aug 14–16, 2026');
    expect(formatPlainDateRange('2026-08-30', '2026-09-02')).toBe('Aug 30 – Sep 2, 2026');
    expect(formatPlainDateRange('2026-12-30', '2027-01-02')).toBe('Dec 30, 2026 – Jan 2, 2027');
  });

  it('spells the month out when asked', () => {
    expect(formatPlainDateRange('2026-08-14', '2026-08-16', { month: 'long' }))
      .toBe('August 14–16, 2026');
  });

  it('agrees with the invoice, which writes the same phrase in the edge function', () => {
    // supabase/functions/_shared/rental_invoice.ts formatDateSpan — kept in
    // step by rental_invoice_test.ts, which asserts these exact strings.
    expect(formatPlainDateRange('2026-08-14', '2026-08-16', { month: 'long' }))
      .toBe('August 14–16, 2026');
    expect(formatPlainDateRange('2026-08-30', '2026-09-02', { month: 'long' }))
      .toBe('August 30 – September 2, 2026');
    expect(formatPlainDateRange('2026-12-30', '2027-01-02', { month: 'long' }))
      .toBe('December 30, 2026 – January 2, 2027');
  });

  it('has nothing to say without a start date', () => {
    expect(formatPlainDateRange(null, '2026-08-16')).toBe('');
    expect(formatPlainDateRange('', null)).toBe('');
  });
});

/**
 * Run times are stored as a total minute count and read as hours + minutes.
 * The pair of formatters has to stay in step: the badge shows one and
 * announces the other, so a film that reads "1h 30m" must not be spoken as
 * anything but "1 hour 30 minutes".
 */
describe('formatRuntime', () => {
  it('splits a feature-length runtime into hours and minutes', () => {
    expect(formatRuntime(90)).toBe('1h 30m');
    expect(formatRuntime(100)).toBe('1h 40m');
    expect(formatRuntime(128)).toBe('2h 8m');
  });

  it('drops the minutes on an exact hour — "2h", never "2h 0m"', () => {
    expect(formatRuntime(60)).toBe('1h');
    expect(formatRuntime(120)).toBe('2h');
  });

  it('keeps a short under an hour in the same compact style', () => {
    expect(formatRuntime(45)).toBe('45m');
    expect(formatRuntime(1)).toBe('1m');
  });

  it('formats nothing when there is no runtime, so the badge can hide', () => {
    // Events and live performances carry no runtime anywhere in the schema,
    // and the caller renders on the returned string rather than guarding.
    expect(formatRuntime(null)).toBe('');
    expect(formatRuntime(undefined)).toBe('');
    expect(formatRuntime(0)).toBe('');
    expect(formatRuntime(-30)).toBe('');
    expect(formatRuntime(Number.NaN)).toBe('');
  });
});

describe('runtimeLabel', () => {
  it('spells out what the compact form abbreviates', () => {
    expect(runtimeLabel(90)).toBe('1 hour 30 minutes');
    expect(runtimeLabel(100)).toBe('1 hour 40 minutes');
    expect(runtimeLabel(120)).toBe('2 hours');
    expect(runtimeLabel(45)).toBe('45 minutes');
  });

  it('says one hour and one minute in the singular', () => {
    expect(runtimeLabel(60)).toBe('1 hour');
    expect(runtimeLabel(61)).toBe('1 hour 1 minute');
    expect(runtimeLabel(1)).toBe('1 minute');
  });

  it('is empty exactly when formatRuntime is', () => {
    for (const v of [null, undefined, 0, -30, Number.NaN]) {
      expect(runtimeLabel(v)).toBe('');
      expect(formatRuntime(v)).toBe('');
    }
  });
});
