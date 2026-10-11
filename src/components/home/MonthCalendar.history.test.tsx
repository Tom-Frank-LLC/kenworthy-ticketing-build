import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { addDays, format, startOfDay, startOfMonth, subMonths } from 'date-fns';
import { MonthCalendar } from './MonthCalendar';
import { venueLocalToInstant } from '@/lib/datetime';
import { viewLabel, weekStart } from '@/lib/calendarWindow';
import type { FeedItem } from './TrailerFeed';

/**
 * Past showings on the /calendar grid.
 *
 * Three things are worth protecting: the grid still opens on this week when it
 * is handed history (it used to open on the earliest day it was given), the
 * back arrow reaches that history, and an ended showing is never a way into
 * the drawer — it is drawn as text, not as a button.
 */

const TODAY = startOfDay(new Date());
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
const at7pm = (d: Date) => venueLocalToInstant(`${dayKey(d)}T19:00`).toISOString();

// Two months back, mid-month, so it is never in the opening week view.
const PAST_DAY = addDays(startOfMonth(subMonths(TODAY, 2)), 14);
const NEXT_DAY = addDays(TODAY, 3);

const upcoming: FeedItem = {
  id: 'movie-p1-s1',
  productionId: 'p1',
  title: 'Sunset Boulevard',
  posterUrl: null,
  trailerUrl: null,
  startTime: at7pm(NEXT_DAY),
  showingId: 's1',
  type: 'movie',
};

const played: FeedItem = {
  id: 'movie-p2-s2',
  productionId: 'p2',
  title: 'The General',
  posterUrl: null,
  trailerUrl: null,
  startTime: at7pm(PAST_DAY),
  showingId: 's2',
  type: 'movie',
  ended: true,
};

const header = () =>
  screen.getAllByText((_, el) => el?.classList.contains('min-w-[16ch]') ?? false)[0];

function renderCalendar(items: FeedItem[], props: Partial<Parameters<typeof MonthCalendar>[0]> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <MemoryRouter>
      <MonthCalendar items={items} onSelect={onSelect} historyFrom={new Date(2021, 5, 17)} {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onSelect };
}

/** Back from the week view lands on this month; each press after is a month. */
function pageBackTo(target: Date) {
  for (let guard = 0; header().textContent !== format(target, 'MMMM yyyy') && guard < 24; guard++) {
    fireEvent.click(screen.getAllByRole('button', { name: /^Go to / })[0]);
  }
}

describe('MonthCalendar with history', () => {
  it('opens on this week, not on the oldest day it was handed', () => {
    renderCalendar([played, upcoming]);
    expect(header().textContent).toBe(viewLabel({ mode: 'week', start: weekStart(TODAY) }));
  });

  it('pages back into the month the history is in', () => {
    renderCalendar([played, upcoming]);
    pageBackTo(PAST_DAY);
    expect(header().textContent).toBe(format(PAST_DAY, 'MMMM yyyy'));
    const cell = document.querySelector(`[data-day-cell="${dayKey(PAST_DAY)}"]`) as HTMLElement;
    expect(within(cell).getByText('The General')).toBeTruthy();
  });

  it('stops at the current month when the caller loads no history', () => {
    renderCalendar([upcoming], { historyFrom: undefined });
    fireEvent.click(screen.getAllByRole('button', { name: /^Go to / })[0]);
    expect(header().textContent).toBe(format(TODAY, 'MMMM yyyy'));
    expect((screen.getAllByRole('button', { name: /^Go to / })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('draws an ended showing as text: no button, and a click opens nothing', () => {
    const { onSelect } = renderCalendar([played, upcoming]);
    pageBackTo(PAST_DAY);
    const cell = document.querySelector(`[data-day-cell="${dayKey(PAST_DAY)}"]`) as HTMLElement;
    expect(within(cell).queryByRole('button', { name: /The General/ })).toBeNull();
    fireEvent.click(within(cell).getByText('The General'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks a past day by shape and in its name, not by colour', () => {
    renderCalendar([played, upcoming]);
    pageBackTo(PAST_DAY);
    const cell = document.querySelector(`[data-day-cell="${dayKey(PAST_DAY)}"]`) as HTMLElement;
    expect(cell.className).toContain('border-dashed');
    expect(
      screen.getByRole('button', { name: `${format(PAST_DAY, 'EEEE, MMMM d')}, 1 showing, past` }),
    ).toBeTruthy();
  });

  it('says "Ended" in the day panel and offers no button there either', () => {
    const { onSelect } = renderCalendar([played, upcoming]);
    pageBackTo(PAST_DAY);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${format(PAST_DAY, 'EEEE, MMMM d')}`) }));
    expect(screen.getAllByText('Ended').length).toBeGreaterThan(0);
    for (const title of screen.getAllByText('The General')) {
      expect(title.closest('button')).toBeNull();
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still opens an upcoming showing', () => {
    const { onSelect } = renderCalendar([played, upcoming]);
    fireEvent.click(screen.getAllByRole('button', { name: /Sunset Boulevard/ })[0]);
    expect(onSelect).toHaveBeenCalledWith(upcoming);
  });

  it('stays on a month the reader paged to when history for another month arrives', () => {
    // A month with nothing in it, between the history and today.
    const empty = subMonths(startOfMonth(TODAY), 1);
    const { rerender } = renderCalendar([played, upcoming]);
    pageBackTo(empty);
    expect(header().textContent).toBe(format(empty, 'MMMM yyyy'));

    const older: FeedItem = { ...played, id: 'movie-p3-s3', showingId: 's3', startTime: at7pm(addDays(PAST_DAY, -20)) };
    rerender(
      <MemoryRouter>
        <MonthCalendar items={[older, played, upcoming]} historyFrom={new Date(2021, 5, 17)} />
      </MemoryRouter>,
    );
    expect(header().textContent).toBe(format(empty, 'MMMM yyyy'));
  });

  it('reports the months it shows, so the caller can load them', () => {
    const onMonthsInView = vi.fn();
    renderCalendar([upcoming], { onMonthsInView });
    const months = onMonthsInView.mock.calls[onMonthsInView.mock.calls.length - 1]?.[0] as Date[];
    expect(months.map((m) => format(m, 'yyyy-MM'))).toContain(format(TODAY, 'yyyy-MM'));
  });
});
