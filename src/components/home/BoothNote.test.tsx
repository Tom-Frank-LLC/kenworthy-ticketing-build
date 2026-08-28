import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BoothNote } from './BoothNote';
import { attachUpcomingShowings } from '@/lib/feed';
import type { FeedItem } from './TrailerFeed';
import type { FeaturedSlideView } from '@/lib/featuredSlides';

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

const renderBooth = (items: FeedItem[], slides: FeaturedSlideView[] = []) =>
  render(
    <MemoryRouter>
      <BoothNote items={items} slides={slides} />
    </MemoryRouter>,
  );

/** A hand-written slide, the kind with no production behind it. */
const manual = (over: Partial<FeaturedSlideView> = {}): FeaturedSlideView => ({
  id: 'festival',
  title: 'Kenworthy Silent Film Festival',
  blurb: null,
  image_path: null,
  image_alt: null,
  imageUrl: null,
  link_url: '/silent-film-festival',
  cta_label: 'Explore the Festival',
  is_active: true,
  display_order: 0,
  starts_at: null,
  ends_at: null,
  created_at: '2026-08-01T00:00:00Z',
  ...over,
});

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

  /**
   * The second source: slides written by hand, for pages with nothing to sell.
   *
   * The ordering rule is the thing worth pinning. Manual slides lead, in the
   * admin's own order; the picks derived from the feed follow, chronologically.
   * Two orders rather than one, because a manual slide has no date to sort by
   * — a festival in November and a standing rentals promo are not points on the
   * same line as "Thursday at 7" — and any unified sort would have to invent
   * one, which is a rule the admin cannot see.
   */
  describe('hand-written slides', () => {
    it('puts the manual slides in front of the featured films', () => {
      const { container } = renderBooth(threeShowingsOfOneFilm, [manual()]);

      const slides = container.querySelectorAll('[aria-roledescription="slide"]');
      expect(slides).toHaveLength(2);
      expect(slides[0].textContent).toContain('Kenworthy Silent Film Festival');
      expect(slides[1].textContent).toContain('Page to Screen: Divergent');
    });

    it('orders the manual slides by the order the admin gave them', () => {
      const { container } = renderBooth([], [
        manual({ id: 'b', title: 'Rent the theatre', display_order: 1, link_url: '/rentals' }),
        manual({ id: 'a', title: 'Silent Film Festival', display_order: 0 }),
      ]);

      const slides = container.querySelectorAll('[aria-roledescription="slide"]');
      expect(slides[0].textContent).toContain('Silent Film Festival');
      expect(slides[1].textContent).toContain('Rent the theatre');
    });

    it('renders with no showings at all, which is the whole point', () => {
      // A page with nothing to sell has to be promotable on a week when
      // nothing is on. Nothing in the feed can produce this slide.
      renderBooth([], [manual()]);

      expect(screen.getByRole('heading', { name: 'Kenworthy Silent Film Festival' })).toBeTruthy();
      const cta = screen.getByRole('link', { name: /Explore the Festival/i });
      expect(cta.getAttribute('href')).toBe('/silent-film-festival');
      expect(cta.getAttribute('target')).toBeNull();
    });

    it('opens an outside link in a new tab, with the opener cut', () => {
      renderBooth([], [manual({ link_url: 'https://example.org/tickets', cta_label: 'Buy from the venue' })]);

      const cta = screen.getByRole('link', { name: /Buy from the venue/i });
      expect(cta.getAttribute('href')).toBe('https://example.org/tickets');
      expect(cta.getAttribute('target')).toBe('_blank');
      expect(cta.getAttribute('rel')).toContain('noopener');
    });

    it('does not staple an unpicked film to a deliberate slide', () => {
      // The fallback exists so the band never renders empty. A manual slide
      // means it is not empty, so the fallback has nothing to do — pulling in
      // a film nobody flagged would be second-guessing the admin.
      renderBooth(
        [{ ...base, id: 'a', showingId: 's1', startTime: '2099-01-01T19:00:00Z', isFeatured: false }],
        [manual()],
      );

      expect(screen.queryByText('Page to Screen: Divergent')).toBeNull();
      expect(screen.getByRole('heading', { name: 'Kenworthy Silent Film Festival' })).toBeTruthy();
    });

    it('describes the picture by its own description, not the headline', () => {
      renderBooth([], [manual({
        imageUrl: 'https://example.test/organ.jpg',
        image_alt: 'An organist at the Wurlitzer',
      })]);

      expect(screen.getByAltText('An organist at the Wurlitzer')).toBeTruthy();
    });
  });
});
