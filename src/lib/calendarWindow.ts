import { addDays, format, isSameMonth, isSameYear, startOfWeek } from 'date-fns';

/**
 * Week-anchored window math for the month grid.
 *
 * The grid used to be month-anchored: it always began at the week containing
 * the 1st. Because `useFeed` fetches showings with `.gte('start_time', now)`,
 * every day before today is guaranteed empty, so that framing opened the
 * calendar on up to four dead rows before the first useful one. These helpers
 * anchor it to the current week instead and roll forward across month
 * boundaries.
 */

/** Weeks visible at once. Six matches the tallest month grid this replaced, so
 *  the surrounding page layout is unchanged. */
export const WEEKS_IN_VIEW = 6;

/** Sunday-first, matching the Sun..Sat column headers the grid renders. */
export const WEEK_STARTS_ON = 0 as const;

export function weekStart(day: Date): Date {
  return startOfWeek(day, { weekStartsOn: WEEK_STARTS_ON });
}

/**
 * The days of one window, in order.
 *
 * Built by incrementing the day field rather than adding 24h so a DST boundary
 * inside the window cannot drop or duplicate a day.
 */
export function windowDays(start: Date, weeks = WEEKS_IN_VIEW): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return days;
}

/**
 * Header text for a window. A six-week window can span three months, so this
 * names the first and last rather than every one in between.
 *
 * Ranges abbreviate the month. Spelled out, the longest of them
 * ("September–November 2026") makes the header wider than a 375px viewport and
 * wraps the arrows onto a second line; abbreviated, the widest case still fits.
 */
export function windowLabel(start: Date, weeks = WEEKS_IN_VIEW): string {
  const end = addDays(start, weeks * 7 - 1);
  if (isSameMonth(start, end)) return format(start, 'MMMM yyyy');
  if (isSameYear(start, end)) return `${format(start, 'MMM')}–${format(end, 'MMM yyyy')}`;
  return `${format(start, 'MMM yyyy')}–${format(end, 'MMM yyyy')}`;
}

/**
 * Move the window by whole pages, never earlier than `floor`.
 *
 * `floor` is the current week: there is provably nothing behind it, so paging
 * back into it would only restore the empty rows this change removes.
 */
export function shiftWindow(start: Date, pages: number, floor: Date, weeks = WEEKS_IN_VIEW): Date {
  const moved = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + pages * weeks * 7,
  );
  return moved < floor ? floor : moved;
}

/** Whether a day sits in a shaded month band. Keyed on the absolute month
 *  ordinal, not on the window, so a month keeps its shade while you page. */
export function isShadedMonth(day: Date): boolean {
  return (day.getFullYear() * 12 + day.getMonth()) % 2 === 1;
}

function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Where the window should sit for a given set of populated days.
 *
 * Keeps `current` whenever it already holds something. Only when the visible
 * window is completely empty does it follow the earliest populated day — which
 * is what makes search on /calendar usable: a query matching only a November
 * show would otherwise render an empty grid with no hint of where the match is.
 * Never moves behind `floor`.
 */
export function anchorWindow(
  current: Date,
  itemDayKeys: Iterable<string>,
  floor: Date,
  weeks = WEEKS_IN_VIEW,
): Date {
  const visible = new Set(windowDays(current, weeks).map((d) => format(d, 'yyyy-MM-dd')));
  let earliest: string | null = null;
  for (const key of itemDayKeys) {
    if (visible.has(key)) return current;
    if (earliest === null || key < earliest) earliest = key;
  }
  if (earliest === null) return current;
  const parsed = parseDayKey(earliest);
  if (!parsed) return current;
  const target = weekStart(parsed);
  return target < floor ? floor : target;
}
