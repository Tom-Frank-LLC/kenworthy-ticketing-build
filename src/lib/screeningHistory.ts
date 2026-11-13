/**
 * What a film's past at the Kenworthy says about one showing of it.
 *
 * The screened-films archive records every date a film played here, back to
 * 1926. When the theatre brings something back after decades, that gap is the
 * story — "first time on this screen in 52 years" — so it is computed here and
 * the showing page leads with it.
 */

/** A gap this long or longer is called out as a return, not just listed. */
export const LONG_ABSENCE_YEARS = 25;

export interface ScreeningHistory {
  /** Times it played here before this showing. */
  count: number;
  /** ISO date of the first and the most recent of them. */
  first: string;
  last: string;
  /** Distinct calendar years it played in, ascending. */
  years: number[];
  /** Whole years between the most recent one and this showing. */
  yearsSince: number;
  /** yearsSince >= LONG_ABSENCE_YEARS. */
  longAbsence: boolean;
}

/**
 * Summarise the archive dates (YYYY-MM-DD) before `showingDay`, the showing's
 * date **in the theatre's time zone** — `formatShowtime(start, 'yyyy-MM-dd')`,
 * never `start_time.slice(0, 10)`. A 7 PM Pacific showing is the next day in
 * UTC, so a UTC date would count an archival showing's own screening as an
 * earlier one. Returns null when the film has no earlier screening here.
 */
export function summarizeScreenings(dates: string[], showingDay: string): ScreeningHistory | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(showingDay)) throw new Error(`showingDay must be YYYY-MM-DD: ${showingDay}`);
  const day = showingDay;
  const before = dates.map((d) => d.slice(0, 10)).filter((d) => d < day).sort();
  if (!before.length) return null;

  const first = before[0];
  const last = before[before.length - 1];
  const years = [...new Set(before.map((d) => Number(d.slice(0, 4))))];

  // Whole years, by calendar date: 1975-11-02 to 2026-11-01 is 50, not 51.
  const [ly, lm, ld] = last.split('-').map(Number);
  const [sy, sm, sd] = day.split('-').map(Number);
  let yearsSince = sy - ly;
  if (sm < lm || (sm === lm && sd < ld)) yearsSince -= 1;

  return {
    count: before.length,
    first,
    last,
    years,
    yearsSince,
    longAbsence: yearsSince >= LONG_ABSENCE_YEARS,
  };
}
