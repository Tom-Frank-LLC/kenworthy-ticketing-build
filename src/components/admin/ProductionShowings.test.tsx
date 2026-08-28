import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProductionShowings } from './ProductionShowings';
import { AddLiveEventDialog } from './AddLiveEventDialog';

/**
 * The Live Events listing showed a title, some badges and one aggregate ticket
 * count. The nights it played were not on the screen at all, and the only way
 * to add one was through the Movies tab. These cover the two pieces that fixed
 * that: the showings block both listings now share, and the single door in
 * front of the two create forms.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const showing = (over: Record<string, unknown> = {}) => ({
  id: 'showing-1',
  start_time: '2026-09-12T01:30:00.000Z',
  ticket_price: '12.5',
  total_seats: 265,
  venues: { name: 'Main Auditorium' },
  manually_sold_out: false,
  no_ticket_required: false,
  ...over,
});

function renderShowings(showings: any[], handlers: Record<string, any> = {}) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <ProductionShowings
          showings={showings}
          productionTitle="Palouse Jazz Quartet"
          getSold={() => 30}
          getScanned={() => 0}
          onOpenAttendees={handlers.onOpenAttendees ?? vi.fn()}
          onToggleSoldOut={handlers.onToggleSoldOut ?? vi.fn()}
          onDeleteShowing={handlers.onDeleteShowing ?? vi.fn()}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('ProductionShowings', () => {
  it('puts the date, price, venue and ticket count on the row', () => {
    renderShowings([showing()]);

    expect(screen.getByText(/Sep 11, 2026/)).toBeInTheDocument();
    expect(screen.getByText('• $12.50')).toBeInTheDocument();
    expect(screen.getByText('Main Auditorium')).toBeInTheDocument();
    expect(screen.getByText('30 / 265')).toBeInTheDocument();
  });

  it('links edit at the showing, and asks to delete by its id', () => {
    const onDeleteShowing = vi.fn();
    renderShowings([showing()], { onDeleteShowing });

    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/showings/showing-1');

    // The trash button is the last unlabelled one on the row.
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onDeleteShowing).toHaveBeenCalledWith('showing-1');
  });

  it('names the production in the attendee sheet it opens', () => {
    const onOpenAttendees = vi.fn();
    renderShowings([showing()], { onOpenAttendees });

    fireEvent.click(screen.getByRole('button', { name: /View 30 attendees/ }));
    const [title, ids, capacity] = onOpenAttendees.mock.calls[0];
    expect(title).toMatch(/^Palouse Jazz Quartet — /);
    expect(ids).toEqual(['showing-1']);
    expect(capacity).toBe(265);
  });

  it('says sold out on the row, not only in the toggle', () => {
    renderShowings([showing({ manually_sold_out: true })]);
    expect(screen.getByText('Sold Out')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen online sales' })).toBeInTheDocument();
  });

  it('offers no sell-out toggle on a walk-in night, which issues nothing', () => {
    renderShowings([showing({ no_ticket_required: true })]);
    expect(screen.queryByRole('button', { name: /sold out|Reopen/i })).toBeNull();
  });

  it('renders nothing at all for a title with no showings', () => {
    const { container } = renderShowings([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AddLiveEventDialog', () => {
  function renderDialog() {
    return render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AddLiveEventDialog />} />
          <Route path="/admin/concerts/new" element={<div>performance form</div>} />
          <Route path="/admin/events/new" element={<div>event form</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('replaces the two buttons with one, and explains the choice behind it', async () => {
    renderDialog();
    expect(screen.queryByText('Add Performance')).toBeNull();
    expect(screen.queryByText('Add Event')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Add Live Event/ }));

    // The distinction that was nowhere on screen before.
    expect(await screen.findByText(/A ticketed live show/)).toBeInTheDocument();
    expect(screen.getByText(/Ticketed, RSVP, or info-only/)).toBeInTheDocument();
  });

  it('goes to the performance form by default', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Add Live Event/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('performance form')).toBeInTheDocument();
  });

  it('goes to the event form when that is the kind chosen', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Add Live Event/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Community event/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('event form')).toBeInTheDocument();
  });
});
