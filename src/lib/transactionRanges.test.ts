import { describe, expect, it } from 'vitest';
import { presetRange } from '@/lib/transactionRanges';

/**
 * The date range this screen opens on decides what a reader believes the
 * theatre took, so a boundary that is one day out is a wrong number rather
 * than a cosmetic bug — and a silent one, because every figure still looks
 * plausible.
 *
 * All of these are venue-local (America/Los_Angeles) calendar dates, matching
 * `square-analytics` and Square's own `dateRange`, so "this week" means the
 * same week on every screen.
 *
 * Weekdays below were read from `Intl` for the venue zone rather than assumed.
 */

// Late-afternoon UTC, so the instant is unambiguously the same calendar day in
// Pacific time whatever the offset — these tests are about the date maths, not
// about the UTC-to-venue conversion, which datetime.ts owns.
const at = (iso: string) => new Date(iso);

describe('presetRange', () => {
  it('Today is a single day, both ends the same', () => {
    // The default. It is also the cheapest range by some margin — 4.0s against
    // 6.8s for 30 days, measured on production.
    const r = presetRange('today', at('2026-08-19T20:00:00Z'));
    expect(r).toEqual({ start: '2026-08-19', end: '2026-08-19' });
  });

  it('This week runs from Sunday to today, not the last seven days', () => {
    // 19 Aug 2026 is a Wednesday; the Sunday before it is the 16th. A rolling
    // 7-day window would start on the 13th and quietly fold in last week's
    // takings.
    const r = presetRange('week', at('2026-08-19T20:00:00Z'));
    expect(r).toEqual({ start: '2026-08-16', end: '2026-08-19' });
  });

  it('This week on a Sunday is that one day', () => {
    // The off-by-one that a naive "subtract getDay() days" gets right and a
    // "go back to the previous Sunday" reading gets wrong by a whole week.
    const r = presetRange('week', at('2026-08-23T20:00:00Z'));
    expect(r).toEqual({ start: '2026-08-23', end: '2026-08-23' });
  });

  it('This week reaches back across a month boundary', () => {
    // Monday 2 Mar 2026 — the week began on Sunday 1 March.
    expect(presetRange('week', at('2026-03-02T20:00:00Z')))
      .toEqual({ start: '2026-03-01', end: '2026-03-02' });
  });

  it('This week reaches back across the new year', () => {
    // Friday 2 Jan 2026 — the week began Sunday 28 Dec 2025.
    expect(presetRange('week', at('2026-01-02T20:00:00Z')))
      .toEqual({ start: '2025-12-28', end: '2026-01-02' });
  });

  it('a week spanning the spring DST change keeps its Sunday', () => {
    // US clocks go forward on 8 Mar 2026, inside this week.
    //
    // The anchor is deliberately 00:30 venue time (07:30Z under PDT), not the
    // afternoon: an hour of drift only changes the DATE when the instant is
    // near venue-local midnight. Anchored mid-afternoon this test passes under
    // the buggy millisecond implementation too, which makes it worthless —
    // checked, and it does. Here the naive version answers 7 March.
    expect(presetRange('week', at('2026-03-10T07:30:00Z')))
      .toEqual({ start: '2026-03-08', end: '2026-03-10' });
  });

  it('the rolling windows are inclusive of today', () => {
    // "30 days" spans 30 dated buckets, so the start is 29 days back — the
    // same convention _shared/square-reporting.ts uses.
    expect(presetRange('30d', at('2026-08-19T20:00:00Z')))
      .toEqual({ start: '2026-07-21', end: '2026-08-19' });
    expect(presetRange('90d', at('2026-08-19T20:00:00Z')))
      .toEqual({ start: '2026-05-22', end: '2026-08-19' });
  });

  it('a rolling window spanning the DST change does not slip a day', () => {
    // Same near-midnight anchor, same reason. The naive millisecond version
    // answers 8 February for 30 days and 10 December for 90 — each a whole day
    // of takings folded in that does not belong to the range.
    expect(presetRange('30d', at('2026-03-10T07:30:00Z')))
      .toEqual({ start: '2026-02-09', end: '2026-03-10' });
    expect(presetRange('90d', at('2026-03-10T07:30:00Z')))
      .toEqual({ start: '2025-12-11', end: '2026-03-10' });
  });

  it('Year to date starts on 1 January of the current year', () => {
    expect(presetRange('ytd', at('2026-08-19T20:00:00Z')))
      .toEqual({ start: '2026-01-01', end: '2026-08-19' });
    expect(presetRange('ytd', at('2026-01-02T20:00:00Z')))
      .toEqual({ start: '2026-01-01', end: '2026-01-02' });
  });

  it('every range ends today and never in the future', () => {
    // A log of sales that already happened has no business querying tomorrow.
    const now = at('2026-08-19T20:00:00Z');
    for (const key of ['today', 'week', '30d', '90d', 'ytd'] as const) {
      const r = presetRange(key, now);
      expect(r.end).toBe('2026-08-19');
      expect(r.start <= r.end).toBe(true);
    }
  });
});
