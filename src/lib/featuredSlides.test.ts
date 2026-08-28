import { describe, expect, it } from 'vitest';
import {
  filterSlides,
  isInternalLink,
  isSlideLive,
  linkUrlProblem,
  orderSlides,
  slideAltText,
  type FeaturedSlide,
} from './featuredSlides';

/**
 * The three rules a manual slide is governed by, none of which is a fetch.
 *
 * Two of them are written twice on purpose. `isSlideLive` restates the RLS
 * policy on `featured_slides`, because an admin can read every row and the
 * admin list has to be able to say which ones the public is seeing.
 * `linkUrlProblem` restates the `featured_slides_link_shape` constraint, so
 * the admin is told what is wrong in words rather than by a constraint
 * violation naming a regex. Duplicated rules drift, which is why they are
 * pinned here rather than eyeballed once.
 */

const slide = (over: Partial<FeaturedSlide> = {}): FeaturedSlide => ({
  id: 'a',
  title: 'Kenworthy Silent Film Festival',
  blurb: null,
  image_path: null,
  image_alt: null,
  link_url: '/silent-film-festival',
  cta_label: 'Explore the Festival',
  is_active: true,
  display_order: 0,
  starts_at: null,
  ends_at: null,
  created_at: '2026-08-01T00:00:00Z',
  ...over,
});

describe('orderSlides', () => {
  it('sorts by the order the admin set', () => {
    const ordered = orderSlides([
      slide({ id: 'c', display_order: 2 }),
      slide({ id: 'a', display_order: 0 }),
      slide({ id: 'b', display_order: 1 }),
    ]);
    expect(ordered.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the older slide in front when nothing has been ordered', () => {
    // Everything at 0 is the common case, not the edge case, so the tiebreak
    // is the rule that actually runs. Oldest first, so adding a slide does not
    // silently push the one already there down the band.
    const ordered = orderSlides([
      slide({ id: 'new', created_at: '2026-08-20T00:00:00Z' }),
      slide({ id: 'old', created_at: '2026-08-01T00:00:00Z' }),
    ]);
    expect(ordered.map(s => s.id)).toEqual(['old', 'new']);
  });

  it('is total, so two slides written in the same millisecond cannot swap', () => {
    const ordered = orderSlides([slide({ id: 'b' }), slide({ id: 'a' })]);
    expect(ordered.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('does not mutate what it is given', () => {
    const input = [slide({ id: 'b', display_order: 1 }), slide({ id: 'a', display_order: 0 })];
    orderSlides(input);
    expect(input.map(s => s.id)).toEqual(['b', 'a']);
  });
});

describe('isSlideLive', () => {
  const now = new Date('2026-09-01T12:00:00Z');

  it('is live when it is on and has no window', () => {
    expect(isSlideLive(slide(), now)).toBe(true);
  });

  it('is not live when it is switched off, whatever the dates say', () => {
    expect(isSlideLive(slide({ is_active: false }), now)).toBe(false);
    expect(
      isSlideLive(slide({ is_active: false, starts_at: '2026-01-01T00:00:00Z' }), now),
    ).toBe(false);
  });

  it('waits for its start', () => {
    expect(isSlideLive(slide({ starts_at: '2026-09-02T00:00:00Z' }), now)).toBe(false);
    expect(isSlideLive(slide({ starts_at: '2026-08-31T00:00:00Z' }), now)).toBe(true);
  });

  it('retires itself at its end', () => {
    expect(isSlideLive(slide({ ends_at: '2026-08-31T00:00:00Z' }), now)).toBe(false);
    expect(isSlideLive(slide({ ends_at: '2026-09-02T00:00:00Z' }), now)).toBe(true);
  });

  it('treats the end instant as over, and the start instant as begun', () => {
    // A festival promo ending "at midnight" should be gone at midnight, not
    // linger through it. The boundaries are half-open for that reason.
    expect(isSlideLive(slide({ ends_at: now.toISOString() }), now)).toBe(false);
    expect(isSlideLive(slide({ starts_at: now.toISOString() }), now)).toBe(true);
  });
});

describe('linkUrlProblem', () => {
  it('accepts a path on this site and a full https address', () => {
    expect(linkUrlProblem('/silent-film-festival')).toBeNull();
    expect(linkUrlProblem('https://kenworthy.org/tickets')).toBeNull();
    expect(linkUrlProblem('  /rentals  ')).toBeNull();
  });

  it('refuses a script URL', () => {
    // The one that matters: an href is a place script runs, and this field is
    // a text box an admin types into. The database constraint is what holds;
    // this is what explains it before the round trip.
    expect(linkUrlProblem('javascript:alert(1)')).toMatch(/Only https/);
    expect(linkUrlProblem('data:text/html,<script>')).toMatch(/Only https/);
  });

  it('refuses a protocol-relative link, which is not the path it looks like', () => {
    expect(linkUrlProblem('//evil.example.com')).toMatch(/another site/);
  });

  it('refuses http, which the browser would warn about', () => {
    expect(linkUrlProblem('http://kenworthy.org')).toMatch(/https/);
  });

  it('refuses a bare word and an empty box', () => {
    expect(linkUrlProblem('silent-film-festival')).not.toBeNull();
    expect(linkUrlProblem('')).not.toBeNull();
  });
});

describe('isInternalLink', () => {
  it('is true only for a rooted path', () => {
    expect(isInternalLink('/backstage')).toBe(true);
    expect(isInternalLink('https://example.com')).toBe(false);
    // Not a path. Handing this to <Link> would send the reader off-site in the
    // same tab with no rel="noopener" on the way out.
    expect(isInternalLink('//example.com')).toBe(false);
  });
});

describe('slideAltText', () => {
  it('prefers the description, because the title says what the slide is for', () => {
    expect(slideAltText(slide({ image_alt: 'An organist at the Wurlitzer' })))
      .toBe('An organist at the Wurlitzer');
  });

  it('falls back to the title rather than claiming the image is decorative', () => {
    expect(slideAltText(slide({ image_alt: '   ' }))).toBe('Kenworthy Silent Film Festival');
  });
});

describe('filterSlides', () => {
  it('matches the title and the blurb', () => {
    const slides = [
      slide({ id: 'fest', title: 'Silent Film Festival' }),
      slide({ id: 'rent', title: 'Rent the theatre', blurb: '<p>Weddings and receptions.</p>' }),
    ];
    expect(filterSlides(slides, 'silent').map(s => s.id)).toEqual(['fest']);
    expect(filterSlides(slides, 'wedding').map(s => s.id)).toEqual(['rent']);
    expect(filterSlides(slides, '').map(s => s.id)).toEqual(['fest', 'rent']);
  });

  it('matches the words, not the markup', () => {
    // The blurb is editor HTML. Searching the raw string would make "strong"
    // hit every slide with a bolded word in it.
    const slides = [slide({ id: 'x', title: 'A slide', blurb: '<p><strong>Two nights</strong> only</p>' })];
    expect(filterSlides(slides, 'strong')).toHaveLength(0);
    expect(filterSlides(slides, 'two nights')).toHaveLength(1);
  });
});
