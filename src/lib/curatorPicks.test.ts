import { describe, expect, it } from 'vitest';
import {
  orderDerivedPicks,
  pickEditPath,
  pickKindLabel,
  pickStatus,
  PRODUCTION_TABLE,
  type FlaggedProduction,
  type FlaggedShowing,
} from './curatorPicks';

/**
 * The distinction this module exists for: a flag is not the same thing as being
 * on the page.
 *
 * The home feed is built from upcoming, active showings, so a film can carry
 * `is_featured` and appear nowhere — its dates have passed, or none were ever
 * scheduled, or it was deactivated. The flag on the form says nothing about any
 * of that, which is exactly the confusion the admin list is meant to end. These
 * are the second copy of `buildFeed`'s rule, so they are pinned here.
 */

const NOW = new Date('2026-09-01T12:00:00Z');

const film = (over: Partial<FlaggedProduction> = {}): FlaggedProduction => ({
  kind: 'production',
  type: 'movie',
  id: 'm1',
  title: 'The Crowd',
  posterUrl: null,
  isActive: true,
  standalone: false,
  nextStart: '2026-09-05T02:00:00Z',
  upcomingCount: 3,
  ...over,
});

const night = (over: Partial<FlaggedShowing> = {}): FlaggedShowing => ({
  kind: 'showing',
  type: 'movie',
  id: 's1',
  title: 'The Crowd',
  posterUrl: null,
  productionId: 'm1',
  startTime: '2026-09-05T02:00:00Z',
  isActive: true,
  productionActive: true,
  ...over,
});

describe('pickStatus', () => {
  it('says nothing at all when the pick is on the page', () => {
    expect(pickStatus(film(), NOW)).toBeNull();
    expect(pickStatus(night(), NOW)).toBeNull();
  });

  it('catches a flag on a title with no upcoming dates', () => {
    // The case that prompted this list: the form says featured, the home page
    // has never mentioned it, and nothing anywhere said why.
    expect(pickStatus(film({ nextStart: null, upcomingCount: 0 }), NOW)).toBe('No dates');
  });

  it('does not fault an RSVP or info-only event for having no dates', () => {
    // buildFeed puts these in the feed with a far-future sort key on purpose,
    // so "no dates" would be a warning about correct behaviour.
    expect(pickStatus(film({ type: 'event', standalone: true, nextStart: null, upcomingCount: 0 }), NOW))
      .toBeNull();
  });

  it('reports a deactivated title as hidden, before it looks at dates', () => {
    expect(pickStatus(film({ isActive: false }), NOW)).toBe('Hidden');
    expect(pickStatus(film({ isActive: false, nextStart: null }), NOW)).toBe('Hidden');
  });

  it('reports a night that has been and gone', () => {
    expect(pickStatus(night({ startTime: '2026-08-30T02:00:00Z' }), NOW)).toBe('Past');
    // The boundary: a showing starting exactly now has started.
    expect(pickStatus(night({ startTime: NOW.toISOString() }), NOW)).toBe('Past');
  });

  it('reports a night hidden by either its own switch or its title’s', () => {
    expect(pickStatus(night({ isActive: false }), NOW)).toBe('Hidden');
    expect(pickStatus(night({ productionActive: false }), NOW)).toBe('Hidden');
  });
});

describe('orderDerivedPicks', () => {
  it('runs chronologically, the way the band does', () => {
    const ordered = orderDerivedPicks([
      film({ id: 'late', nextStart: '2026-10-01T02:00:00Z' }),
      night({ id: 'soon', startTime: '2026-09-02T02:00:00Z' }),
      film({ id: 'mid', nextStart: '2026-09-20T02:00:00Z' }),
    ]);
    expect(ordered.map(p => p.id)).toEqual(['soon', 'mid', 'late']);
  });

  it('puts the undated ones last, not first', () => {
    // An undated pick at the head of a running order reads as "happening now",
    // and in an admin list it is the row most likely to need attention.
    const ordered = orderDerivedPicks([
      film({ id: 'nodates', nextStart: null, upcomingCount: 0 }),
      film({ id: 'dated', nextStart: '2026-09-20T02:00:00Z' }),
    ]);
    expect(ordered.map(p => p.id)).toEqual(['dated', 'nodates']);
  });

  it('is total, so the list cannot reshuffle between renders', () => {
    const same = '2026-09-05T02:00:00Z';
    const ordered = orderDerivedPicks([
      film({ id: 'b', nextStart: same }),
      film({ id: 'a', nextStart: same }),
    ]);
    expect(ordered.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('does not mutate what it is given', () => {
    const input = [film({ id: 'b', nextStart: '2026-10-01T02:00:00Z' }), film({ id: 'a' })];
    orderDerivedPicks(input);
    expect(input.map(p => p.id)).toEqual(['b', 'a']);
  });
});

describe('where a pick lives', () => {
  it('knows which table carries the flag', () => {
    expect(PRODUCTION_TABLE.movie).toBe('movies');
    expect(PRODUCTION_TABLE.event).toBe('events');
    // The one that has bitten before: there is no `concerts` table.
    expect(PRODUCTION_TABLE.concert).toBe('live_performances');
  });

  it('sends the admin to the form that owns the flag', () => {
    expect(pickEditPath(film())).toBe('/admin/movies/m1');
    expect(pickEditPath(film({ type: 'event', id: 'e1' }))).toBe('/admin/events/e1');
    // ...but the *route* is /admin/concerts, unlike the table.
    expect(pickEditPath(film({ type: 'concert', id: 'c1' }))).toBe('/admin/concerts/c1');
    expect(pickEditPath(night())).toBe('/admin/showings/s1');
  });

  it('names the kind in the admin’s words, not the schema’s', () => {
    expect(pickKindLabel(film())).toBe('Film');
    expect(pickKindLabel(film({ type: 'concert' }))).toBe('Live performance');
    expect(pickKindLabel(night())).toBe('One night');
  });
});
