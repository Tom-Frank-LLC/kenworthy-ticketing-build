import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BoothNote } from './BoothNote';
import type { FeedItem } from './TrailerFeed';

/**
 * The curator's pick is one slide per *production*, and that is the whole of
 * what these tests protect.
 *
 * A FeedItem is a showing, not a title — the type says so. So a featured film
 * that plays four times arrives here as four items differing only by date, and
 * the first version of the carousel built four identical slides of the same
 * poster and the same note. It read as four separate recommendations for one
 * film. The failure is invisible in staging, where only one title is ever
 * flagged, and it only appears once someone schedules a run.
 */

const base: Omit<FeedItem, 'id' | 'showingId' | 'startTime'> = {
  productionId: 'prod-divergent',
  title: 'Page to Screen: Divergent',
  posterUrl: null,
  trailerUrl: null,
  type: 'movie',
  curatorNote: 'A thriller that moves.',
  isFeatured: true,
};

/** Same production, three dates — what a film with a run actually looks like. */
const threeShowingsOfOneFilm: FeedItem[] = [
  { ...base, id: 'a', showingId: 's1', startTime: '2099-01-01T19:00:00Z' },
  { ...base, id: 'b', showingId: 's2', startTime: '2099-01-02T19:00:00Z' },
  { ...base, id: 'c', showingId: 's3', startTime: '2099-01-03T19:00:00Z' },
];

const renderBooth = (items: FeedItem[]) =>
  render(
    <MemoryRouter>
      <BoothNote items={items} />
    </MemoryRouter>,
  );

describe('BoothNote', () => {
  it('gives a film with three showings one slide, not three', () => {
    const { container } = renderBooth(threeShowingsOfOneFilm);

    expect(container.querySelectorAll('[aria-roledescription="slide"]').length).toBeLessThanOrEqual(1);
    expect(screen.getAllByText('Page to Screen: Divergent')).toHaveLength(1);
  });

  it('keeps the soonest date, so Get Tickets points at the next showing', () => {
    // Deliberately not in date order: the earliest must win on identity, not
    // on which row the caller happened to hand over first.
    const shuffled = [threeShowingsOfOneFilm[1], threeShowingsOfOneFilm[0], threeShowingsOfOneFilm[2]];
    renderBooth([...shuffled].sort((x, y) => +new Date(x.startTime) - +new Date(y.startTime)));

    const cta = screen.getByRole('link', { name: /get tickets/i });
    expect(cta.getAttribute('href')).toBe('/showing/s1');
  });

  it('still gives two different films two slides', () => {
    const { container } = renderBooth([
      threeShowingsOfOneFilm[0],
      { ...base, id: 'z', productionId: 'prod-hadestown', title: 'Hadestown', showingId: 's9', startTime: '2099-02-01T19:00:00Z' },
    ]);

    expect(container.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(2);
  });

  it('does not treat a movie and an event sharing an id as the same pick', () => {
    // productionId is only unique within a type — movies, events and live
    // performances are three separate tables.
    const { container } = renderBooth([
      { ...base, id: 'm', productionId: 'shared-id', type: 'movie', title: 'A Film', showingId: 's1', startTime: '2099-01-01T19:00:00Z' },
      { ...base, id: 'e', productionId: 'shared-id', type: 'event', title: 'An Event', showingId: 's2', startTime: '2099-01-02T19:00:00Z' },
    ]);

    expect(container.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(2);
  });

  it('falls back to the first item when nothing is flagged, and shows no arrows', () => {
    const { container } = renderBooth([
      { ...base, id: 'a', showingId: 's1', startTime: '2099-01-01T19:00:00Z', isFeatured: false },
    ]);

    // Still renders — the fallback is what stops the section going blank on a
    // week when nobody flagged anything.
    expect(screen.getByRole('heading', { name: 'Page to Screen: Divergent' })).toBeTruthy();
    expect(screen.getByText(/Featured/)).toBeTruthy();

    // One pick means no carousel at all, so there are no arrows to leave dead.
    expect(container.querySelector('[aria-roledescription="carousel"]')).toBeNull();
    expect(screen.queryByText(/Previous slide/)).toBeNull();
  });
});
