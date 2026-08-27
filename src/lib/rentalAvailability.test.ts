import { describe, it, expect } from 'vitest';
import {
  parseClockMinutes,
  buildDayView,
  dayStatus,
  blockLabel,
  formatHourLabel,
  DAY_VIEW_START_HOUR,
  DAY_VIEW_END_HOUR,
  type OccupiedBlock,
} from './rentalAvailability';

const DAY = '2026-09-10';

function block(partial: Partial<OccupiedBlock> = {}): OccupiedBlock {
  return {
    dayKey: DAY,
    startMinutes: null,
    endMinutes: null,
    isPublic: false,
    title: null,
    kind: 'rental',
    ...partial,
  };
}

const rowAt = (view: ReturnType<typeof buildDayView>, hour: number) =>
  view.rows.find(r => r.hour === hour)!;

describe('parseClockMinutes', () => {
  it('reads what <input type="time"> writes', () => {
    // This is the only format the app itself has ever stored.
    expect(parseClockMinutes('17:00')).toBe(17 * 60);
    expect(parseClockMinutes('09:30')).toBe(9 * 60 + 30);
    expect(parseClockMinutes('00:00')).toBe(0);
    expect(parseClockMinutes('23:59')).toBe(23 * 60 + 59);
  });

  it('reads the 12-hour spellings a human would type into the column', () => {
    expect(parseClockMinutes('7:00 PM')).toBe(19 * 60);
    expect(parseClockMinutes('7 pm')).toBe(19 * 60);
    expect(parseClockMinutes('12:00 AM')).toBe(0);
    expect(parseClockMinutes('12:00 PM')).toBe(12 * 60);
    expect(parseClockMinutes('12:30am')).toBe(30);
  });

  it('tolerates seconds and surrounding whitespace', () => {
    expect(parseClockMinutes(' 08:15:00 ')).toBe(8 * 60 + 15);
  });

  it('refuses anything it cannot read rather than guessing', () => {
    // The whole point: a value that does not parse must reach the page as
    // "unknown", never as a plausible-looking hour.
    for (const bad of ['evening', 'late', '', '   ', '25:00', '10:75', '13:00 PM', 'noon', '7-9pm', 'TBD']) {
      expect(parseClockMinutes(bad), `${bad} should not parse`).toBeNull();
    }
    expect(parseClockMinutes(null)).toBeNull();
    expect(parseClockMinutes(undefined)).toBeNull();
  });
});

describe('formatHourLabel', () => {
  it('renders the venue clock, not a 24-hour one', () => {
    expect(formatHourLabel(8)).toBe('8:00 AM');
    expect(formatHourLabel(12)).toBe('12:00 PM');
    expect(formatHourLabel(13)).toBe('1:00 PM');
    expect(formatHourLabel(22)).toBe('10:00 PM');
    expect(formatHourLabel(0)).toBe('12:00 AM');
  });
});

describe('blockLabel — what a stranger is allowed to read', () => {
  it('names a public booking', () => {
    expect(blockLabel(block({ isPublic: true, title: 'Moscow Community Choir' }))).toBe(
      'Moscow Community Choir',
    );
  });

  it('never names a private one', () => {
    expect(blockLabel(block({ isPublic: false, title: 'Marriage proposal' }))).toBe('Private event');
  });

  it('falls back rather than showing an empty label on a public booking with no title', () => {
    expect(blockLabel(block({ isPublic: true, title: null, kind: 'showing' }))).toBe('Programmed event');
  });
});

describe('buildDayView', () => {
  it('covers 8 AM through the 10 PM hour', () => {
    const view = buildDayView({ dayKey: DAY, blocks: [] });
    expect(view.rows).toHaveLength(DAY_VIEW_END_HOUR - DAY_VIEW_START_HOUR);
    expect(view.rows[0].hour).toBe(8);
    expect(view.rows[view.rows.length - 1].hour).toBe(22);
  });

  it('reads a day with nothing on it as wide open', () => {
    const view = buildDayView({ dayKey: DAY, blocks: [] });
    expect(view.status).toBe('available');
    expect(view.rows.every(r => r.status === 'available')).toBe(true);
    expect(view.untimed).toHaveLength(0);
  });

  it('marks only the hours a booking actually overlaps', () => {
    const view = buildDayView({
      dayKey: DAY,
      blocks: [block({ startMinutes: 17 * 60, endMinutes: 22 * 60 })],
    });

    expect(rowAt(view, 16).status).toBe('available');
    for (const hour of [17, 18, 19, 20, 21]) {
      expect(rowAt(view, hour).status, `${hour}:00`).toBe('unavailable');
    }
    // The booking ends exactly at 22:00, so the 10 PM hour is free.
    expect(rowAt(view, 22).status).toBe('available');
  });

  it('is "limited availability", never "unavailable", for a day that has a booking', () => {
    // A 7 PM screening leaves the whole morning rentable. Only a black-out
    // closes a day outright.
    const view = buildDayView({
      dayKey: DAY,
      blocks: [block({ startMinutes: 19 * 60, endMinutes: 21 * 60 })],
    });
    expect(view.status).toBe('limited');
    expect(rowAt(view, 9).status).toBe('available');
  });

  it('gives a showing the hour span its runtime implies', () => {
    const start = 19 * 60;
    const view = buildDayView({
      dayKey: DAY,
      blocks: [
        block({ kind: 'showing', isPublic: true, title: 'Casablanca', startMinutes: start, endMinutes: start + 102 }),
      ],
    });

    expect(rowAt(view, 19).status).toBe('unavailable');
    expect(rowAt(view, 20).status).toBe('unavailable'); // runs to 20:42
    expect(rowAt(view, 21).status).toBe('available');
    expect(rowAt(view, 19).detail).toBe('Casablanca');
  });

  it('shows a public booking by name and a private one only as "Private event"', () => {
    const view = buildDayView({
      dayKey: DAY,
      blocks: [
        block({ isPublic: true, title: 'Moscow Community Choir', startMinutes: 9 * 60, endMinutes: 11 * 60 }),
        block({ isPublic: false, title: null, startMinutes: 18 * 60, endMinutes: 20 * 60 }),
      ],
    });

    expect(rowAt(view, 9).detail).toBe('Moscow Community Choir');
    expect(rowAt(view, 18).detail).toBe('Private event');

    const rendered = JSON.stringify(view);
    expect(rendered).not.toContain('Marriage');
    expect(rendered).toContain('Private event');
  });

  it('says "check with us" for a booking whose hours we cannot read', () => {
    // An unparseable or absent time must not be flattened into either answer:
    // "available" oversells a taken slot, "unavailable" turns away a free one.
    const view = buildDayView({ dayKey: DAY, blocks: [block({ startMinutes: null, endMinutes: null })] });

    expect(view.status).toBe('limited');
    expect(view.untimed).toHaveLength(1);
    expect(view.rows.every(r => r.status === 'unknown')).toBe(true);
    expect(rowAt(view, 12).detail).toBe('Private event');
  });

  it('lets a known booking still claim its hours on a day that also has an untimed one', () => {
    const view = buildDayView({
      dayKey: DAY,
      blocks: [
        block({ startMinutes: null }),
        block({ kind: 'showing', isPublic: true, title: 'Casablanca', startMinutes: 19 * 60, endMinutes: 21 * 60 }),
      ],
    });

    expect(rowAt(view, 19).status).toBe('unavailable');
    expect(rowAt(view, 19).detail).toBe('Casablanca');
    expect(rowAt(view, 9).status).toBe('unknown');
  });

  it('does not let one unreadable end time close the rest of the day', () => {
    // Start known, end not: the block gets a one-hour floor rather than
    // running to midnight.
    const view = buildDayView({
      dayKey: DAY,
      blocks: [block({ startMinutes: 13 * 60, endMinutes: null })],
    });

    expect(rowAt(view, 13).status).toBe('unavailable');
    expect(rowAt(view, 14).status).toBe('available');
    expect(rowAt(view, 20).status).toBe('available');
  });

  it('treats an end at or before the start as a typo, not as an all-day hold', () => {
    const view = buildDayView({
      dayKey: DAY,
      blocks: [block({ startMinutes: 15 * 60, endMinutes: 9 * 60 })],
    });

    expect(rowAt(view, 15).status).toBe('unavailable');
    expect(rowAt(view, 16).status).toBe('available');
    expect(rowAt(view, 9).status).toBe('available');
  });

  it('closes a black-out day entirely, with the reason on every row', () => {
    const view = buildDayView({ dayKey: DAY, blocks: [], blackoutLabel: 'Christmas Day' });

    expect(view.status).toBe('unavailable');
    expect(view.blackoutLabel).toBe('Christmas Day');
    expect(view.rows.every(r => r.status === 'unavailable')).toBe(true);
    expect(view.rows.every(r => r.detail === 'Christmas Day')).toBe(true);
  });

  it('ignores blocks belonging to other days', () => {
    const view = buildDayView({
      dayKey: DAY,
      blocks: [block({ dayKey: '2026-09-11', startMinutes: 9 * 60, endMinutes: 23 * 60 })],
    });
    expect(view.status).toBe('available');
    expect(view.rows.every(r => r.status === 'available')).toBe(true);
  });
});

describe('dayStatus', () => {
  it('grades a day for the calendar cell', () => {
    const blocks = [block({ startMinutes: 19 * 60, endMinutes: 21 * 60 })];
    expect(dayStatus(DAY, blocks)).toBe('limited');
    expect(dayStatus('2026-09-11', blocks)).toBe('available');
    expect(dayStatus(DAY, blocks, 'Thanksgiving')).toBe('unavailable');
  });

  it('calls an untimed hold "limited", the same as any other booking', () => {
    expect(dayStatus(DAY, [block({ startMinutes: null })])).toBe('limited');
  });
});
