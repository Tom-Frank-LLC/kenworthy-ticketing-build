import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProductionShowings } from './ProductionShowings';

/**
 * The Live Events listing showed a title, some badges and one aggregate ticket
 * count. The nights it played were not on the screen at all, and the only way
 * to add one was through the Movies tab. This is the block both listings share
 * now — "Showings" under a film, "Shows" under a live event.
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

describe('ProductionShowings — what the child rows are called', () => {
  it('says Showings by default, for a film', () => {
    renderShowings([showing()]);
    expect(screen.getByText('Showings')).toBeInTheDocument();
  });

  it('says Shows when the listing asks for it', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ProductionShowings
            showings={[showing()]}
            productionTitle="Palouse Jazz Quartet"
            heading="Shows"
            getSold={() => 0}
            getScanned={() => 0}
            onOpenAttendees={vi.fn()}
            onToggleSoldOut={vi.fn()}
            onDeleteShowing={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Shows')).toBeInTheDocument();
    expect(screen.queryByText('Showings')).toBeNull();
  });
});
