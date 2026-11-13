import { describe, expect, it } from 'vitest';
import { LONG_ABSENCE_YEARS, summarizeScreenings } from './screeningHistory';

describe('summarizeScreenings', () => {
  it('returns null for a film with no earlier screening here', () => {
    expect(summarizeScreenings([], '2026-11-30')).toBeNull();
    // Only later or same-day dates: still nothing *before* this showing.
    expect(summarizeScreenings(['2026-11-30', '2027-01-05'], '2026-11-30')).toBeNull();
  });

  it('reports the most recent screening as "last", not the first', () => {
    // The restored component said "Last played here on" the *earliest* date.
    const h = summarizeScreenings(['1958-11-02', '1975-03-14', '1962-06-01'], '2026-12-01');
    expect(h).toMatchObject({ count: 3, first: '1958-11-02', last: '1975-03-14', years: [1958, 1962, 1975] });
  });

  it('counts whole years by calendar date', () => {
    expect(summarizeScreenings(['1975-11-02'], '2026-11-01')!.yearsSince).toBe(50);
    expect(summarizeScreenings(['1975-11-02'], '2026-11-02')!.yearsSince).toBe(51);
  });

  it('calls out a long absence and not a recent run', () => {
    expect(summarizeScreenings(['1926-01-04'], '2026-01-10')!.longAbsence).toBe(true);
    expect(summarizeScreenings([`${2026 - LONG_ABSENCE_YEARS}-01-01`], '2026-06-01')!.longAbsence).toBe(true);
    expect(summarizeScreenings(['2019-05-01'], '2026-06-01')!.longAbsence).toBe(false);
  });

  it('refuses a timestamp, which would be the UTC date', () => {
    // 7 PM Pacific on 1 May is 02:00 UTC on 2 May: sliced, the archival
    // showing's own 1 May screening would read as an earlier visit.
    expect(() => summarizeScreenings(['2026-05-01'], '2026-05-02T02:00:00Z')).toThrow();
  });
});
