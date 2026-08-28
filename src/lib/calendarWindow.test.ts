import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import {
  WEEKS_IN_VIEW,
  anchorWindow,
  isShadedMonth,
  shiftWindow,
  weekStart,
  windowDays,
  windowLabel,
} from './calendarWindow';

const key = (d: Date) => format(d, 'yyyy-MM-dd');
// 2026-08-28 is a Friday; its week starts Sunday 2026-08-23.
const FRI = new Date(2026, 7, 28);

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

describe('windowLabel', () => {
  it('names one month when the window does not cross a boundary', () => {
    // 2026-03-01 is a Sunday; six weeks runs to 2026-04-11, so use a shorter
    // window to exercise the single-month branch.
    expect(windowLabel(new Date(2026, 2, 1), 4)).toBe('March 2026');
  });

  it('abbreviates a range within one year, to keep the header off a second line', () => {
    expect(windowLabel(weekStart(FRI))).toBe('Aug–Oct 2026');
  });

  it('carries both years across a year boundary', () => {
    expect(windowLabel(weekStart(new Date(2026, 11, 20)))).toBe('Dec 2026–Jan 2027');
  });
});

describe('shiftWindow', () => {
  const floor = weekStart(FRI);

  it('pages forward by a whole window', () => {
    expect(key(shiftWindow(floor, 1, floor))).toBe('2026-10-04');
  });

  it('pages back to where it started', () => {
    const next = shiftWindow(floor, 1, floor);
    expect(key(shiftWindow(next, -1, floor))).toBe(key(floor));
  });

  it('will not page behind the floor', () => {
    expect(key(shiftWindow(floor, -1, floor))).toBe(key(floor));
    expect(key(shiftWindow(floor, -5, floor))).toBe(key(floor));
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

describe('anchorWindow', () => {
  const floor = weekStart(FRI); // 2026-08-23

  it('stays put when the window already holds an item', () => {
    expect(key(anchorWindow(floor, ['2026-09-12'], floor))).toBe('2026-08-23');
  });

  it('stays put when there are no items at all', () => {
    expect(key(anchorWindow(floor, [], floor))).toBe('2026-08-23');
  });

  it('follows the earliest item when the window is empty', () => {
    // 2026-11-19 is a Thursday; its week starts Sunday 2026-11-15.
    expect(key(anchorWindow(floor, ['2026-12-02', '2026-11-19'], floor))).toBe('2026-11-15');
  });

  it('never follows an item behind the floor', () => {
    expect(key(anchorWindow(floor, ['2026-01-05'], floor))).toBe('2026-08-23');
  });

  it('ignores a malformed key rather than jumping somewhere absurd', () => {
    expect(key(anchorWindow(floor, ['not-a-date'], floor))).toBe('2026-08-23');
  });
});
