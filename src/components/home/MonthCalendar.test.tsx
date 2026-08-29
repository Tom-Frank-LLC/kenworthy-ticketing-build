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

const cellFor = (d: Date) =>
  screen.getByRole('button', { name: new RegExp(`^${dayName(d)}`) });

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

  it('keyboard activation toggles the panel', () => {
    renderCalendar([item()]);
    const cell = cellFor(TARGET);
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(cell).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(cell).toHaveAttribute('aria-expanded', 'false');
  });
});
