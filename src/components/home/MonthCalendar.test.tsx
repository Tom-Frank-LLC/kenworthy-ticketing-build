import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { addDays, format, startOfDay } from 'date-fns';
import { MonthCalendar } from './MonthCalendar';
import { venueLocalToInstant } from '@/lib/datetime';
import type { FeedItem } from './TrailerFeed';

/**
 * The mobile day panel used to render after the whole grid, so a tap on the
 * first week put its answer five weeks further down the page. What is worth
 * protecting is therefore *position*, not just presence: the panel has to sit
 * between the tapped day's week and the week below it. Presence alone passed
 * before this change too.
 *
 * Dates are relative to the run date because the grid opens on the current
 * week and pages forward only — a fixed date would fall out of the window.
 * Day 10 and day 17 are the same weekday in consecutive weeks, which is what
 * makes the ordering assertions readable.
 */
const TARGET = addDays(startOfDay(new Date()), 10);
const NEXT_WEEK = addDays(TARGET, 7);
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
const dayName = (d: Date) => format(d, 'EEEE, MMMM d');

/** 7 PM on the venue's clock, so the item's venue day is the day we named. */
const at7pm = (d: Date) => venueLocalToInstant(`${dayKey(d)}T19:00`).toISOString();

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'movie-prod-1-showing-a',
    productionId: 'prod-1',
    title: 'The Gold Rush',
    posterUrl: null,
    trailerUrl: null,
    startTime: at7pm(TARGET),
    showingId: 'showing-a',
    type: 'movie',
    ...overrides,
  };
}

const renderCalendar = (items: FeedItem[]) =>
  render(
    <MemoryRouter>
      <MonthCalendar items={items} />
    </MemoryRouter>,
  );

/**
 * The day's disclosure trigger.
 *
 * This is the day-number button, not the cell box. The two used to be the same
 * element — the cell was `role="button" tabIndex={0}` — but a control with
 * focusable controls inside it is axe's `nested-interactive`, and it put every
 * cell in the tab order ahead of the showings. The name and aria-expanded live
 * on the button now; the box is `cellBoxFor` below.
 */
const cellFor = (d: Date) =>
  screen.getByRole('button', { name: new RegExp(`^${dayName(d)}`) });

/** The cell box around that trigger — what the grid sizes and fills. */
const cellBoxFor = (d: Date) => {
  const box = cellFor(d).closest('[data-day-cell]');
  expect(box).not.toBeNull();
  return box as HTMLElement;
};

const panelFor = (cell: HTMLElement) => {
  const id = cell.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  const panel = document.getElementById(id as string);
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
};

/** True when `a` comes before `b` in document order. */
const precedes = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('MonthCalendar mobile day accordion', () => {
  it('opens collapsed, so the month is scannable before anything is pushed down', () => {
    renderCalendar([item()]);
    // A day is still *selected* — the desktop column has to describe one — but
    // nothing is expanded until a tap.
    expect(cellFor(TARGET)).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[aria-controls]')).toBeNull();
  });

  it('expands the tapped day between its own week and the week below', () => {
    renderCalendar([item()]);
    const cell = cellFor(TARGET);
    fireEvent.click(cell);

    expect(cell).toHaveAttribute('aria-expanded', 'true');
    const panel = panelFor(cell);
    expect(panel).toHaveTextContent('The Gold Rush');

    // The regression this file exists for: the panel must not land after the
    // whole grid.
    expect(precedes(cell, panel)).toBe(true);
    expect(precedes(panel, cellFor(NEXT_WEEK))).toBe(true);
  });

  it('collapses when the open day is tapped again', () => {
    renderCalendar([item()]);
    const cell = cellFor(TARGET);
    fireEvent.click(cell);
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-expanded', 'false');
  });

  it('collapses from the close button and hands focus back to the day', () => {
    renderCalendar([item()]);
    const cell = cellFor(TARGET);
    fireEvent.click(cell);

    fireEvent.click(screen.getByRole('button', { name: `Close ${format(TARGET, 'MMMM d')}` }));
    expect(cell).toHaveAttribute('aria-expanded', 'false');
    expect(cell).toHaveFocus();
  });

  it('moves the open panel to the week of a day tapped in another week', () => {
    renderCalendar([item(), item({ id: 'b', showingId: 'showing-b', title: 'City Lights', startTime: at7pm(NEXT_WEEK) })]);
    fireEvent.click(cellFor(TARGET));
    fireEvent.click(cellFor(NEXT_WEEK));

    const first = cellFor(TARGET);
    const second = cellFor(NEXT_WEEK);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');

    const panel = panelFor(second);
    expect(panel).toHaveTextContent('City Lights');
    expect(precedes(second, panel)).toBe(true);
    expect(precedes(first, panel)).toBe(true);
  });

  it('says so inline when the tapped day has nothing on', () => {
    renderCalendar([item()]);
    const empty = addDays(TARGET, 1);
    const cell = cellFor(empty);
    fireEvent.click(cell);
    expect(panelFor(cell)).toHaveTextContent('Nothing on the marquee this day.');
  });

  /**
   * The trigger is a native `<button>` now, so Enter and Space are the
   * browser's job rather than ours — the hand-rolled onKeyDown that used to
   * sit on the cell div is gone with it.
   *
   * jsdom does not synthesise the click a real keydown produces on a button,
   * so firing `keyDown` here would test nothing. Asserting on `click` is
   * asserting on exactly what a keyboard produces in a browser; what keeps
   * that honest is the element being a real button, which the query above
   * enforces by role.
   */
  it('activation toggles the panel', () => {
    renderCalendar([item()]);
    const cell = cellFor(TARGET);
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-expanded', 'false');
  });
});

/**
 * A day cell used to draw two titles and then a "+N more" line, inside a box
 * with a fixed height. That line spent the cell's scarcest row saying there was
 * something it would not show — and on the busiest day in production (four
 * showings) it hid half the day.
 *
 * The cells are grid children, so grid stretches every cell in a week to the
 * tallest one. Giving the box a *minimum* instead of a fixed height therefore
 * grows the whole week row to its busiest day and keeps the row uniform, which
 * is what lets every showing be drawn.
 *
 * jsdom computes no layout, so what is pinned here is the part that is real
 * without it: that every showing renders, that the "+N more" line is gone, and
 * that the height is a floor rather than a cap. The stretching itself is grid's
 * own behaviour and was measured in a browser against production data.
 */
describe('a day cell draws every showing on that day', () => {
  const fourOnOneDay: FeedItem[] = [
    item({ id: 'a', showingId: 's1', title: 'The Gold Rush' }),
    item({ id: 'b', showingId: 's2', title: 'Punch-Drunk Love' }),
    item({ id: 'c', showingId: 's3', title: 'Tony n’ Tina’s Wedding' }),
    item({ id: 'd', showingId: 's4', title: 'The Odyssey' }),
  ];

  it('renders all four titles, not two and a "+2 more"', () => {
    renderCalendar(fourOnOneDay);
    const cell = cellBoxFor(TARGET);

    for (const title of ['The Gold Rush', 'Punch-Drunk Love', 'Tony n’ Tina’s Wedding', 'The Odyssey']) {
      // getAllBy: the selected-day panel prints the same titles beside the grid.
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }

    // The cell itself, not the page — the panel would satisfy a page-wide
    // check. `[data-day-cell] > * button` would also catch the day-number
    // disclosure trigger, so the showings are counted by their own marker.
    const drawn = cell.querySelectorAll('button.group\\/ev');
    expect(drawn).toHaveLength(4);
    expect(cell.textContent).not.toMatch(/\+\d+ more/);
  });

  it('sizes the cell with a floor, not a fixed height', () => {
    renderCalendar(fourOnOneDay);
    const cls = cellBoxFor(TARGET).className;

    // A fixed height is what forced the truncation; a minimum is what lets the
    // row grow. `h-[...]` coming back here means the cap is back.
    expect(cls).toContain('min-h-[6.25rem]');
    expect(cls).toContain('md:min-h-[9.375rem]');
    expect(cls).not.toMatch(/(^|\s)h-\[6\.25rem\]/);
    expect(cls).not.toMatch(/(^|\s)md:h-\[9\.375rem\]/);
  });
});
