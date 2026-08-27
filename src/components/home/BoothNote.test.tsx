import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BoothNote } from './BoothNote';
import { attachUpcomingShowings } from '@/lib/feed';
import type { FeedItem } from './TrailerFeed';

/**
 * What a curator's pick is a pick *of* — a title, or one night of it.
 *
 * A FeedItem is a showing, not a title, so a film flagged at the production
 * level arrives here as one item per date. The first carousel built a slide
 * from each and showed the same poster and note four times over. That failure
 * is invisible in staging, where only one title is ever flagged, and appears
 * the moment someone schedules a run — which is why it is pinned here rather
 * than left to the next person to notice.
 *
 * Two flags now feed this: `isFeatured` on the production and
 * `isFeaturedShowing` on the date. They are independent, and a title carrying
 * both produces two slides rather than one silently winning.
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

  /**
   * Two independent flags: `isFeatured` is the production (the film is the
   * pick), `isFeaturedShowing` is one date (this night is the pick). A picked
   * production speaks for its whole run and lists the other dates; a picked
   * showing speaks for one night and stays quiet about the rest.
   */
  describe('production picks versus showing picks', () => {
    it('lists the rest of the run when the film is the pick', () => {
      renderBooth(attachUpcomingShowings(threeShowingsOfOneFilm));

      // The soonest is named above; the other two are offered as chips.
      expect(screen.getByText('Also playing')).toBeTruthy();
      expect(screen.getAllByRole('link', { name: /get tickets for/i })).toHaveLength(2);
    });

    it('names no other dates when a single showing is the pick', () => {
      const picked = attachUpcomingShowings(
        threeShowingsOfOneFilm.map((i, n) =>
          n === 1 ? { ...i, isFeatured: false, isFeaturedShowing: true } : { ...i, isFeatured: false },
        ),
      );
      renderBooth(picked);

      expect(screen.getByRole('heading', { name: 'Page to Screen: Divergent' })).toBeTruthy();
      expect(screen.queryByText('Also playing')).toBeNull();
      expect(screen.queryAllByRole('link', { name: /get tickets for/i })).toHaveLength(0);
    });

    it('shows both when a film and one of its nights are each flagged', () => {
      // The decision here is deliberate: the narrower flag does not override
      // the broader one. It reads as "see this film, and especially this
      // night", so both earn a slide.
      const items = attachUpcomingShowings(
        threeShowingsOfOneFilm.map((i, n) => (n === 1 ? { ...i, isFeaturedShowing: true } : i)),
      );
      const { container } = renderBooth(items);

      expect(container.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(2);
      expect(screen.getByText(/2 picks/)).toBeTruthy();
    });

    it('does not collapse two flagged nights of the same film', () => {
      // Showing picks are not deduped — two singled-out nights are two
      // deliberate choices, unlike the production case where the duplicates
      // are an artefact of the feed being per-showing.
      const items = attachUpcomingShowings(
        threeShowingsOfOneFilm.map((i, n) =>
          n === 2 ? { ...i, isFeatured: false } : { ...i, isFeatured: false, isFeaturedShowing: true },
        ),
      );
      const { container } = renderBooth(items);

      expect(container.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(2);
    });
  });
});
