import { describe, expect, it } from 'vitest';
import {
  VENUE_TIME_ZONE,
  formatShowtime,
  instantToVenueLocalInput,
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
