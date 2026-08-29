import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import {
  WEEKS_IN_VIEW,
  type CalendarView,
  anchorView,
  canStepBack,
  isShadedMonth,
  monthDividers,
  monthFloor,
  stepView,
  viewDays,
  viewLabel,
  weekStart,
  windowDays,
  windowLabel,
} from './calendarWindow';

const key = (d: Date) => format(d, 'yyyy-MM-dd');
// 2026-08-28 is a Friday; its week starts Sunday 2026-08-23.
const FRI = new Date(2026, 7, 28);
const FLOOR = monthFloor(FRI); // 2026-08-01
const WEEK_VIEW: CalendarView = { mode: 'week', start: weekStart(FRI) };
const month = (y: number, m: number): CalendarView => ({ mode: 'month', start: new Date(y, m, 1) });

describe('weekStart', () => {
  it('snaps to the preceding Sunday', () => {
    expect(key(weekStart(FRI))).toBe('2026-08-23');
  });

  it('leaves a Sunday where it is', () => {
    expect(key(weekStart(new Date(2026, 7, 23)))).toBe('2026-08-23');
  });
});

describe('windowDays', () => {
  it('returns six whole weeks starting on the anchor', () => {
    const days = windowDays(weekStart(FRI));
    expect(days).toHaveLength(WEEKS_IN_VIEW * 7);
    expect(key(days[0])).toBe('2026-08-23');
    expect(key(days[41])).toBe('2026-10-03');
  });

  it('has no gap or repeat across a DST boundary', () => {
    // US DST ends 2026-11-01, inside this window.
    const days = windowDays(weekStart(new Date(2026, 9, 25)));
    expect(new Set(days.map(key)).size).toBe(days.length);
    expect(key(days[7])).toBe('2026-11-01');
    expect(key(days[8])).toBe('2026-11-02');
  });
});

describe('viewDays', () => {
  it('rolls six weeks forward in the week view', () => {
    expect(viewDays(WEEK_VIEW)).toHaveLength(42);
    expect(key(viewDays(WEEK_VIEW)[0])).toBe('2026-08-23');
  });

  it('covers a whole month padded to week boundaries', () => {
    const days = viewDays(month(2026, 8)); // September 2026
    expect(key(days[0])).toBe('2026-08-30'); // Sunday before Sep 1
    expect(key(days[days.length - 1])).toBe('2026-10-03'); // Saturday after Sep 30
    expect(days.length % 7).toBe(0);
  });

  it('starts a month view on a week boundary even when the 1st is a Sunday', () => {
    const days = viewDays(month(2026, 10)); // November 2026, 1st is a Sunday
    expect(key(days[0])).toBe('2026-11-01');
  });
});

describe('viewLabel', () => {
  it('names the range in the week view', () => {
    expect(viewLabel(WEEK_VIEW)).toBe('Aug–Oct 2026');
  });

  it('names the month itself in a month view', () => {
    expect(viewLabel(month(2026, 8))).toBe('September 2026');
  });
});

describe('windowLabel', () => {
  it('names one month when the window does not cross a boundary', () => {
    expect(windowLabel(new Date(2026, 2, 1), 4)).toBe('March 2026');
  });

  it('abbreviates a range within one year, to keep the header off a second line', () => {
    expect(windowLabel(weekStart(FRI))).toBe('Aug–Oct 2026');
  });

  it('carries both years across a year boundary', () => {
    expect(windowLabel(weekStart(new Date(2026, 11, 20)))).toBe('Dec 2026–Jan 2027');
  });
});

describe('stepView', () => {
  it('leaves the week view forward onto the next month, not the current one', () => {
    const next = stepView(WEEK_VIEW, 1, FLOOR);
    expect(next.mode).toBe('month');
    expect(key(next.start)).toBe('2026-09-01');
  });

  it('leaves the week view backward onto the current month in full', () => {
    const back = stepView(WEEK_VIEW, -1, FLOOR);
    expect(back.mode).toBe('month');
    expect(key(back.start)).toBe('2026-08-01');
  });

  it('steps a month at a time once in month mode', () => {
    expect(key(stepView(month(2026, 8), 1, FLOOR).start)).toBe('2026-10-01');
    expect(key(stepView(month(2026, 8), -1, FLOOR).start)).toBe('2026-08-01');
  });

  it('stays in month mode rather than returning to the week view', () => {
    expect(stepView(month(2026, 8), -1, FLOOR).mode).toBe('month');
  });

  it('will not step behind the floor month', () => {
    expect(key(stepView(month(2026, 7), -1, FLOOR).start)).toBe('2026-08-01');
  });

  it('crosses a year boundary in both directions', () => {
    expect(key(stepView(month(2026, 11), 1, FLOOR).start)).toBe('2027-01-01');
    expect(key(stepView(month(2027, 0), -1, FLOOR).start)).toBe('2026-12-01');
  });
});

describe('canStepBack', () => {
  it('is available from the week view, which drops to the current month', () => {
    expect(canStepBack(WEEK_VIEW, FLOOR)).toBe(true);
  });

  it('is unavailable on the floor month', () => {
    expect(canStepBack(month(2026, 7), FLOOR)).toBe(false);
  });

  it('is available on any later month', () => {
    expect(canStepBack(month(2026, 8), FLOOR)).toBe(true);
  });
});

describe('isShadedMonth', () => {
  it('alternates between adjacent months', () => {
    expect(isShadedMonth(new Date(2026, 7, 15))).not.toBe(isShadedMonth(new Date(2026, 8, 15)));
  });

  it('gives every day of a month the same band', () => {
    expect(isShadedMonth(new Date(2026, 7, 1))).toBe(isShadedMonth(new Date(2026, 7, 31)));
  });

  it('keeps alternating across a year boundary', () => {
    expect(isShadedMonth(new Date(2026, 11, 1))).not.toBe(isShadedMonth(new Date(2027, 0, 1)));
  });
});

describe('monthDividers', () => {
  it('names the month at the top of the week view, then each new month', () => {
    const days = viewDays(WEEK_VIEW);
    expect(Object.fromEntries(monthDividers(days, WEEK_VIEW))).toEqual({
      0: 'August 2026', // the current month, at the top
      7: 'September 2026', // the row holding Sep 1 (starts Aug 30)
      35: 'October 2026', // the row holding Oct 1 (starts Sep 27)
    });
  });

  it('names a month view after its own month, not the month its first row starts in', () => {
    // September's grid opens on Aug 30, but the view is September.
    const view = month(2026, 8);
    const dividers = monthDividers(viewDays(view), view);
    expect(dividers.get(0)).toBe('September 2026');
    expect([...dividers.values()]).not.toContain('August 2026');
  });

  it('marks where a month view spills into the next month', () => {
    const view = month(2026, 8);
    expect(Object.fromEntries(monthDividers(viewDays(view), view))).toEqual({
      0: 'September 2026',
      28: 'October 2026', // the row holding Oct 1 (starts Sep 27)
    });
  });

  it('carries the year across a boundary', () => {
    const view = month(2026, 11); // December 2026
    expect([...monthDividers(viewDays(view), view).values()]).toEqual([
      'December 2026',
      'January 2027',
    ]);
  });

  it('emits one heading when a month never spills', () => {
    const view = month(2026, 1); // February 2026 starts Sunday, ends Saturday
    expect([...monthDividers(viewDays(view), view).values()]).toEqual(['February 2026']);
  });
});

describe('anchorView', () => {
  it('stays put when the view already holds an item', () => {
    expect(key(anchorView(WEEK_VIEW, ['2026-09-12'], FLOOR).start)).toBe('2026-08-23');
  });

  it('stays put when there are no items at all', () => {
    expect(key(anchorView(WEEK_VIEW, [], FLOOR).start)).toBe('2026-08-23');
  });

  it('follows the earliest item when the week view is empty', () => {
    // 2026-11-19 is a Thursday; its week starts Sunday 2026-11-15.
    const next = anchorView(WEEK_VIEW, ['2026-12-02', '2026-11-19'], FLOOR);
    expect(next.mode).toBe('week');
    expect(key(next.start)).toBe('2026-11-15');
  });

  it('follows by whole months once the reader is navigating months', () => {
    const next = anchorView(month(2026, 8), ['2026-11-19'], FLOOR);
    expect(next.mode).toBe('month');
    expect(key(next.start)).toBe('2026-11-01');
  });

  it('never follows an item behind the floor', () => {
    expect(key(anchorView(month(2026, 8), ['2026-01-05'], FLOOR).start)).toBe('2026-08-01');
  });

  it('ignores a malformed key rather than jumping somewhere absurd', () => {
    expect(key(anchorView(WEEK_VIEW, ['not-a-date'], FLOOR).start)).toBe('2026-08-23');
  });
});
