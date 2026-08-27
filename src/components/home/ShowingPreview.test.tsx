import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ShowingPreview } from './ShowingPreview';
import { attachUpcomingShowings } from '@/lib/feed';
import type { FeedItem } from './TrailerFeed';

/**
 * The showtime chips replaced an "All showings" button that opened a drawer,
 * and the thing worth protecting is the *absence* case: a film that plays once
 * — most of them — must render no chip row at all. A single chip duplicating
 * the Get Tickets button directly above it is the regression this guards,
 * because it looks like a feature working rather than a feature misfiring.
 */

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'movie-prod-1-showing-a',
    productionId: 'prod-1',
    title: 'The Gold Rush',
    posterUrl: null,
    trailerUrl: null,
    startTime: iso(24 * HOUR),
    showingId: 'showing-a',
    type: 'movie',
    ...overrides,
  };
}

const renderPreview = (i: FeedItem) =>
  render(
    <MemoryRouter>
      <ShowingPreview item={i} />
    </MemoryRouter>,
  );

describe('ShowingPreview showtime chips', () => {
  it('renders no chip row when the production plays only once', () => {
    renderPreview(
      item({
        upcomingShowings: [{ id: 'showing-a', start_time: iso(24 * HOUR), ticket_price: 9 }],
      }),
    );

    expect(screen.queryByText('Also playing')).toBeNull();
    expect(screen.getByRole('link', { name: /^Get Tickets$/i })).toBeTruthy();
  });

  it('links each other date to its own showing page', () => {
    renderPreview(
      item({
        upcomingShowings: [
          { id: 'showing-a', start_time: iso(24 * HOUR), ticket_price: 9 },
          { id: 'showing-b', start_time: iso(48 * HOUR), ticket_price: 9 },
          { id: 'showing-c', start_time: iso(72 * HOUR), ticket_price: 9 },
        ],
      }),
    );

    const list = screen.getByRole('list', { name: 'Also playing' });
    const chips = within(list).getAllByRole('link');

    // Two, not three: the previewed showing is the green button, and offering
    // the same link twice under two labels is the bug.
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.getAttribute('href'))).toEqual([
      '/showing/showing-b',
      '/showing/showing-c',
    ]);
  });

  it('drops a date that has already finished', () => {
    renderPreview(
      item({
        upcomingShowings: [
          { id: 'showing-a', start_time: iso(24 * HOUR), ticket_price: 9 },
          // Started five hours ago, so it is over on any runtime we assume.
          { id: 'showing-past', start_time: iso(-5 * HOUR), ticket_price: 9 },
          { id: 'showing-c', start_time: iso(72 * HOUR), ticket_price: 9 },
        ],
      }),
    );

    const chips = within(screen.getByRole('list', { name: 'Also playing' })).getAllByRole('link');
    expect(chips.map((c) => c.getAttribute('href'))).toEqual(['/showing/showing-c']);
  });

  it("keeps the remaining dates reachable once the previewed showing is over", () => {
    // The panel is sticky and this is a tab people leave open. When the
    // showing being previewed passes, Get Tickets disappears — the chips are
    // then the only way out of the panel, which is why they are not gated on
    // it.
    renderPreview(
      item({
        startTime: iso(-5 * HOUR),
        upcomingShowings: [
          { id: 'showing-a', start_time: iso(-5 * HOUR), ticket_price: 9 },
          { id: 'showing-b', start_time: iso(48 * HOUR), ticket_price: 9 },
        ],
      }),
    );

    expect(screen.queryByRole('link', { name: /^Get Tickets$/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Get tickets for/i }).getAttribute('href')).toBe(
      '/showing/showing-b',
    );
  });

  it('survives a FeedItem built without the field', () => {
    renderPreview(item());
    expect(screen.queryByText('Also playing')).toBeNull();
  });
});

describe('ShowingPreview trailer', () => {
  it('offers no trailer button when the production has no trailer', () => {
    renderPreview(item());
    expect(screen.queryByRole('button', { name: /Watch trailer/i })).toBeNull();
  });

  it('opens the trailer in a dialog rather than navigating', async () => {
    renderPreview(item({ trailerUrl: 'https://youtu.be/dQw4w9WgXcQ' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Watch trailer/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('The Gold Rush trailer');
    expect(within(dialog).getByTitle('The Gold Rush trailer').getAttribute('src')).toContain(
      'youtube.com/embed/dQw4w9WgXcQ',
    );
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    renderPreview(item({ trailerUrl: 'https://youtu.be/dQw4w9WgXcQ' }));

    const trigger = screen.getByRole('button', { name: /Watch trailer/i });
    // Focus first: Radix restores focus to whatever held it before the dialog
    // opened, and `fireEvent.click` dispatches the event without the focus a
    // real click (or a keyboard activation) carries with it.
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Radix hands focus back to the trigger, which is what makes the lightbox
    // usable from the keyboard — Esc from a trapped dialog that dumps focus on
    // <body> loses the reader their place in the list.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

/**
 * The chips are only as good as the set handed to them, and that set is
 * rebuilt from a feed of one-item-per-showing in two separate places.
 */
describe('attachUpcomingShowings', () => {
  it('gives every showing of a production the whole run, soonest first', () => {
    const feed: FeedItem[] = [
      item({ id: 'a', showingId: 'showing-b', startTime: iso(48 * HOUR), ticketPrice: 9 }),
      item({ id: 'b', showingId: 'showing-a', startTime: iso(24 * HOUR), ticketPrice: 9 }),
      item({
        id: 'c',
        productionId: 'prod-2',
        title: 'Other',
        showingId: 'showing-z',
        startTime: iso(12 * HOUR),
      }),
    ];

    const [first, second, other] = attachUpcomingShowings(feed);

    expect(first.upcomingShowings?.map((s) => s.id)).toEqual(['showing-a', 'showing-b']);
    expect(second.upcomingShowings?.map((s) => s.id)).toEqual(['showing-a', 'showing-b']);
    // A different production does not inherit its neighbour's dates.
    expect(other.upcomingShowings?.map((s) => s.id)).toEqual(['showing-z']);
  });

  it('gives a standalone event with no showing an empty list, not undefined', () => {
    const [only] = attachUpcomingShowings([item({ showingId: null })]);
    expect(only.upcomingShowings).toEqual([]);
  });
});

/**
 * "Free · Details" instead of "Get Tickets".
 *
 * The regression this guards is the quiet one: a walk-in night that still
 * offers to sell a ticket. The button would work — it links to the showing
 * page either way — so nothing errors and nothing looks broken. A patron just
 * arrives expecting to have bought something.
 *
 * The free-*ticketed* case is pinned alongside it deliberately. Both are $0,
 * and the whole feature is the claim that price alone cannot tell them apart.
 */
describe('ShowingPreview and the no-ticket flag', () => {
  it('offers "Free · Details" instead of "Get Tickets" for a walk-in showing', () => {
    renderPreview(item({ noTicketRequired: true, ticketPrice: 0 }));

    expect(screen.getByRole('link', { name: /Free · Details/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Get Tickets/i })).toBeNull();
  });

  it('still links through to the showing page — the details are the point', () => {
    renderPreview(item({ noTicketRequired: true, ticketPrice: 0 }));

    expect(
      screen.getByRole('link', { name: /Free · Details/ }).getAttribute('href'),
    ).toBe('/showing/showing-a');
  });

  it('keeps "Get Tickets" for a free showing that still issues a ticket', () => {
    // $0 and ticketed: the RSVP case. It really does issue a ticket, so the
    // purchase framing is the honest one.
    renderPreview(item({ noTicketRequired: false, ticketPrice: 0 }));

    expect(screen.getByRole('link', { name: /^Get Tickets$/i })).toBeTruthy();
    expect(screen.queryByText(/Free · Details/)).toBeNull();
  });

  it('keeps "Get Tickets" for an ordinary paid showing', () => {
    renderPreview(item({ ticketPrice: 9 }));

    expect(screen.getByRole('link', { name: /^Get Tickets$/i })).toBeTruthy();
  });

  it('marks only the free dates in the chip row, not the whole run', () => {
    // A run can mix the two — a paid week with one free community screening in
    // it. The flag rides per date through attachUpcomingShowings, so the chips
    // have to disagree with each other.
    renderPreview(
      item({
        upcomingShowings: [
          { id: 'showing-a', start_time: iso(24 * HOUR), ticket_price: 9 },
          { id: 'showing-b', start_time: iso(48 * HOUR), ticket_price: 0, no_ticket_required: true },
          { id: 'showing-c', start_time: iso(72 * HOUR), ticket_price: 9 },
        ],
      }),
    );

    const chips = within(screen.getByRole('list', { name: /Also playing/i }));
    expect(chips.getByRole('link', { name: /free, no ticket needed/i })).toBeTruthy();
    expect(chips.getAllByRole('link', { name: /^Get tickets for/i })).toHaveLength(1);
  });
});

/**
 * A showing an admin closed by hand, as the listings render it.
 *
 * The point of carrying the flag this far is that a reader should be able to
 * tell before clicking. Only the *manual* flag reaches here — capacity
 * sold-out would cost a ticket count per card — so a card without it is not a
 * promise that seats remain.
 */
describe('ShowingPreview and a manually sold-out showing', () => {
  it('says "Sold Out" instead of offering tickets', () => {
    renderPreview(item({ manuallySoldOut: true, ticketPrice: 9 }));

    expect(screen.getByRole('link', { name: /^Sold Out$/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Get Tickets$/i })).toBeNull();
  });

  it('still links through to the showing page', () => {
    // The date, the venue and the trailer are still what somebody deciding
    // whether to ring the box office needs, and the chip row below may offer a
    // night that is still open.
    renderPreview(item({ manuallySoldOut: true, ticketPrice: 9 }));

    expect(screen.getByRole('link', { name: /^Sold Out$/i }).getAttribute('href')).toBe(
      '/showing/showing-a',
    );
  });

  it('keeps "Get Tickets" when the flag is absent or false', () => {
    renderPreview(item({ ticketPrice: 9, manuallySoldOut: false }));
    expect(screen.getByRole('link', { name: /^Get Tickets$/i })).toBeTruthy();
  });

  it('marks only the sold-out dates in the chip row', () => {
    // Same per-date discipline as the free flag: a run sells out one night at
    // a time, and "Get tickets for Friday" is the wrong promise on the Friday
    // that has none.
    renderPreview(
      item({
        upcomingShowings: [
          { id: 'showing-a', start_time: iso(24 * HOUR), ticket_price: 9 },
          { id: 'showing-b', start_time: iso(48 * HOUR), ticket_price: 9, manually_sold_out: true },
          { id: 'showing-c', start_time: iso(72 * HOUR), ticket_price: 9 },
        ],
      }),
    );

    const chips = within(screen.getByRole('list', { name: /Also playing/i }));
    expect(chips.getByRole('link', { name: /sold out/i })).toBeTruthy();
    expect(chips.getAllByRole('link', { name: /^Get tickets for/i })).toHaveLength(1);
  });

  it('carries the flag per date through attachUpcomingShowings', () => {
    // The mapping the chips depend on. It is one line in lib/feed.ts and
    // dropping it would silently take the marking off every chip.
    const [first] = attachUpcomingShowings([
      item({ showingId: 'showing-a', manuallySoldOut: true, ticketPrice: 9 }),
    ]);

    expect(first.upcomingShowings?.[0].manually_sold_out).toBe(true);
  });
});
