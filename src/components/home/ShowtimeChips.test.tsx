import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ShowtimeChips } from './ShowtimeChips';
import type { UpcomingShowing } from './TrailerFeed';

/**
 * Two behaviours share this component and they disagree about one date: the
 * listings leave out the night already named above the chips, and the
 * ticketing page keeps it and marks it. Both are guarded here because the
 * failure mode is silent either way — a duplicate date reads as two
 * screenings, and a missing one makes the reader count to find themselves.
 *
 * The absence case is guarded hardest. A production that plays once must
 * render nothing at all: a lone chip beside the Get Tickets button above it
 * looks like a feature working rather than a feature misfiring.
 */

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function showing(overrides: Partial<UpcomingShowing> = {}): UpcomingShowing {
  return {
    id: 'showing-a',
    start_time: iso(24 * HOUR),
    ticket_price: 10,
    ...overrides,
  };
}

function renderChips(props: Partial<Parameters<typeof ShowtimeChips>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ShowtimeChips
        showings={props.showings ?? []}
        currentShowingId={props.currentShowingId ?? 'showing-a'}
        headingId="chips"
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('ShowtimeChips', () => {
  it('renders nothing when the production plays only once', () => {
    const { container } = renderChips({ showings: [showing({ id: 'showing-a' })] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing in mark mode either when the only date is the current one', () => {
    // The guard has to count *other* dates, not visible ones: in mark mode a
    // single chip is still there to render, and rendering it would put a
    // heading over the date the reader is already looking at.
    const { container } = renderChips({
      showings: [showing({ id: 'showing-a' })],
      currentMode: 'mark',
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves the current date out by default', () => {
    renderChips({
      showings: [showing({ id: 'showing-a' }), showing({ id: 'showing-b', start_time: iso(48 * HOUR) })],
    });
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', '/showing/showing-b');
  });

  it('keeps the current date in mark mode, as text rather than a link', () => {
    renderChips({
      showings: [showing({ id: 'showing-a' }), showing({ id: 'showing-b', start_time: iso(48 * HOUR) })],
      currentMode: 'mark',
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // Exactly one link: the other date. The current one must not point at the
    // page it is already on.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/showing/showing-b');
    expect(document.querySelector('[aria-current="page"]')).not.toBeNull();
  });

  it('drops a date that has already ended', () => {
    renderChips({
      showings: [
        showing({ id: 'showing-a' }),
        showing({ id: 'showing-past', start_time: iso(-6 * HOUR) }),
        showing({ id: 'showing-b', start_time: iso(48 * HOUR) }),
      ],
      currentMode: 'mark',
    });
    expect(screen.queryByText(/showing-past/)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('keeps a long programme that started but has not ended', () => {
    // Three hours in, five hours long. Without the resolved runtime this
    // would fall back to the 120-minute default and vanish while it is still
    // selling. This is the case the duration_minutes field exists for.
    renderChips({
      showings: [
        showing({ id: 'showing-a' }),
        showing({ id: 'marathon', start_time: iso(-3 * HOUR), duration_minutes: 300 }),
      ],
      currentMode: 'mark',
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('marks a free date and a sold-out date in the chip and in its label', () => {
    renderChips({
      showings: [
        showing({ id: 'showing-a' }),
        showing({ id: 'free-night', start_time: iso(48 * HOUR), no_ticket_required: true }),
        showing({ id: 'full-night', start_time: iso(72 * HOUR), manually_sold_out: true }),
      ],
    });
    expect(screen.getByText('· Free')).toBeInTheDocument();
    expect(screen.getByText('· Sold Out')).toBeInTheDocument();
    expect(screen.getByLabelText(/free, no ticket needed/)).toBeInTheDocument();
    expect(screen.getByLabelText(/sold out/)).toBeInTheDocument();
  });

  it('names a venue only when it differs from the one beside the chips', () => {
    renderChips({
      showings: [
        showing({ id: 'showing-a', venue_name: 'Main Theatre' }),
        showing({ id: 'same-room', start_time: iso(48 * HOUR), venue_name: 'Main Theatre' }),
        showing({ id: 'other-room', start_time: iso(72 * HOUR), venue_name: 'Backstage' }),
      ],
      currentVenueName: 'Main Theatre',
      currentMode: 'mark',
    });
    expect(screen.getByText('· Backstage')).toBeInTheDocument();
    expect(screen.queryByText('· Main Theatre')).toBeNull();
  });

  it('names no venue at all when the caller passes none', () => {
    // The listings pass neither, and a chip row there should read as bare
    // dates exactly as it did before venues were carried at all.
    renderChips({
      showings: [
        showing({ id: 'showing-a' }),
        showing({ id: 'other-room', start_time: iso(48 * HOUR), venue_name: 'Backstage' }),
      ],
    });
    expect(screen.queryByText('· Backstage')).toBeNull();
  });
});
