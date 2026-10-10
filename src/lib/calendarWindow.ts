import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isSameYear,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';

/**
 * View math for the month grid.
 *
 * The grid opens **week-anchored** on the current week: what a reader opening
 * a calendar wants first is what is coming, and a month-anchored grid opened
 * on up to four rows of days already gone before the first useful one. Those
 * rows can hold history now (the /calendar page loads ended showings month by
 * month, see `useCalendarHistory`), but history is something to page back to,
 * not something to open on.
 *
 * The moment the reader pages, it switches to **month-anchored** and navigates
 * a month at a time from the 1st, which is the familiar calendar metaphor and
 * what this grid did before. Opening position and navigation are answering two
 * different questions, so they are allowed two different framings.
 */

/** Weeks visible in the opening week view. Six matches the tallest month grid,
 *  so switching between the two modes does not resize the page. */
export const WEEKS_IN_VIEW = 6;

/** Sunday-first, matching the Sun..Sat column headers the grid renders. */
export const WEEK_STARTS_ON = 0 as const;

export type CalendarView =
  /** `start` is a week start; the grid runs six weeks forward from it. */
  | { mode: 'week'; start: Date }
  /** `start` is a month start; the grid runs whole weeks across that month. */
  | { mode: 'month'; start: Date };

export function weekStart(day: Date): Date {
  return startOfWeek(day, { weekStartsOn: WEEK_STARTS_ON });
}

/**
 * The day the calendar treats as "today": today, or the day of a showing that
 * started earlier and is still playing — a Saturday 11 PM film is still on at
 * 12:30 AM Sunday, and it sits in Saturday's cell, which a grid opened on
 * Sunday's week (or month) would not show.
 *
 * Pass only the days of showings that have **not ended**. An ended showing's
 * day is history, and handing it in here would open the grid on the oldest
 * week the reader has loaded instead of this one.
 */
export function calendarStart(itemDayKeys: Iterable<string>, now: Date = new Date()): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let earliest: Date | null = null;
  for (const key of itemDayKeys) {
    const d = parseDayKey(key);
    if (d && (earliest === null || d < earliest)) earliest = d;
  }
  return earliest && earliest < today ? earliest : today;
}

/**
 * The earliest month the reader may page back to.
 *
 * The month of `calendarStart`, or of the earliest showing on record when the
 * caller knows one (`history`): the grid pages back as far as there is
 * something to see, and no further.
 */
export function monthFloor(today: Date, history?: Date | null): Date {
  const floor = startOfMonth(today);
  if (!history) return floor;
  const earliest = startOfMonth(history);
  return earliest < floor ? earliest : floor;
}

/**
 * The first of every month a set of days touches, in order. The grid pads a
 * month out to whole weeks and the opening week view can span three months,
 * so "the month on screen" is usually more than one.
 */
export function monthsCovered(days: Date[]): Date[] {
  const out: Date[] = [];
  for (const d of days) {
    const m = startOfMonth(d);
    if (out.length === 0 || out[out.length - 1].getTime() !== m.getTime()) out.push(m);
  }
  return out;
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

/** The days a view renders: six rolling weeks, or the whole of one month
 *  padded out to week boundaries. */
export function viewDays(view: CalendarView): Date[] {
  if (view.mode === 'week') return windowDays(view.start);
  const gridStart = weekStart(startOfMonth(view.start));
  const gridEnd = endOfWeek(endOfMonth(view.start), { weekStartsOn: WEEK_STARTS_ON });
  const days: Date[] = [];
  for (
    let d = gridStart;
    d <= gridEnd;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    days.push(d);
  }
  return days;
}

/**
 * Header text for a rolling window. A six-week window can span three months, so
 * this names the first and last rather than every one in between.
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

/** Header text for a view. The rolling window names its range; a month names
 *  itself, as it did before. */
export function viewLabel(view: CalendarView): string {
  return view.mode === 'week' ? windowLabel(view.start) : format(view.start, 'MMMM yyyy');
}

/** The month a view is "about" — what its first in-grid divider announces.
 *  For a month view that is the month itself, not the month its first row
 *  happens to start in. */
export function principalMonth(view: CalendarView): Date {
  return startOfMonth(view.start);
}

/**
 * Where an arrow goes.
 *
 * Forward from the opening week view lands on the *next* month rather than the
 * current one: forward should always move forward in time, never back onto a
 * screen the reader has already partly seen. Back from it lands on the current
 * month in full, which is the floor.
 */
export function stepView(view: CalendarView, direction: 1 | -1, floor: Date): CalendarView {
  const anchor = startOfMonth(view.start);
  if (view.mode === 'week') {
    const target = direction === 1 ? addMonths(anchor, 1) : anchor;
    return { mode: 'month', start: target < floor ? floor : target };
  }
  const target = direction === 1 ? addMonths(view.start, 1) : subMonths(view.start, 1);
  return { mode: 'month', start: target < floor ? floor : target };
}

/** Whether the back arrow does anything. In the week view it always does — it
 *  drops to the current month in full. In a month view it stops at the floor. */
export function canStepBack(view: CalendarView, floor: Date): boolean {
  if (view.mode === 'week') return true;
  return startOfMonth(view.start) > startOfMonth(floor);
}

/** Whether a day sits in a shaded month band. Keyed on the absolute month
 *  ordinal, not on the view, so a month keeps its shade while you page. */
export function isShadedMonth(day: Date): boolean {
  return (day.getFullYear() * 12 + day.getMonth()) % 2 === 1;
}

/**
 * Where to draw an in-grid month heading, as `day index -> label`.
 *
 * The first row always gets one, so the month at the top of the calendar is
 * named. After that a heading appears on the row that contains the 1st of a
 * month the grid has not announced yet — which is why a month view of September
 * reads "September" at the top and "October" where it spills, rather than
 * "August" at the top because the first row happens to start on Aug 30.
 */
export function monthDividers(days: Date[], view: CalendarView): Map<number, string> {
  const out = new Map<number, string>();
  if (days.length === 0) return out;
  const principal = principalMonth(view);
  let last = principal.getFullYear() * 12 + principal.getMonth();
  out.set(0, format(principal, 'MMMM yyyy'));
  for (let row = 7; row < days.length; row += 7) {
    for (let i = row; i < Math.min(row + 7, days.length); i++) {
      const d = days[i];
      const ord = d.getFullYear() * 12 + d.getMonth();
      if (d.getDate() === 1 && ord !== last) {
        out.set(row, format(d, 'MMMM yyyy'));
        last = ord;
        break;
      }
    }
  }
  return out;
}

function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Where the view should sit for a given set of populated days.
 *
 * Keeps the current view whenever it already holds something. Only when the
 * visible grid is completely empty does it follow a populated day — which is
 * what makes search on /calendar usable: a query matching only a November show
 * would otherwise render an empty grid with no hint of where the match is.
 *
 * It follows the **soonest day from `start` on**, and only when nothing is
 * coming does it fall back to the most recent day before it. With history
 * loaded the earliest populated day can be years back, and a search for a film
 * playing next week should land on next week, not on its 2022 run.
 *
 * Never moves behind the floor. Never changes mode either, with one exception:
 * the week view only ever covers the coming weeks, so a match that is
 * entirely in the past moves it to that match's month.
 *
 * The week view is only ever the opening view (paging switches to months), so
 * it is also moved back to `start`'s week when a showing still playing from an
 * earlier day would otherwise sit just off its top edge.
 */
export function anchorView(
  view: CalendarView,
  itemDayKeys: Iterable<string>,
  floor: Date,
  start: Date = new Date(),
): CalendarView {
  const weekFloor = weekStart(start);
  if (view.mode === 'week' && view.start > weekFloor) view = { mode: 'week', start: weekFloor };
  const visible = new Set(viewDays(view).map((d) => format(d, 'yyyy-MM-dd')));
  const startKey = format(start, 'yyyy-MM-dd');
  let soonest: string | null = null;
  let latestBefore: string | null = null;
  for (const key of itemDayKeys) {
    if (visible.has(key)) return view;
    if (key >= startKey) {
      if (soonest === null || key < soonest) soonest = key;
    } else if (latestBefore === null || key > latestBefore) {
      latestBefore = key;
    }
  }
  const chosen = soonest ?? latestBefore;
  if (chosen === null) return view;
  const parsed = parseDayKey(chosen);
  if (!parsed) return view;
  if (view.mode === 'month' || parsed < weekFloor) {
    const target = startOfMonth(parsed);
    if (view.mode === 'week' && target < floor) return view;
    return { mode: 'month', start: target < floor ? floor : target };
  }
  return { mode: 'week', start: weekStart(parsed) };
}
