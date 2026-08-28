/**
 * The picks the curator's carousel derives from the listings, as the admin
 * screen has to describe them.
 *
 * Three flags feed that band and they live in three different places. A
 * *production* pick is `is_featured` on a movie, an event or a live
 * performance, set on that title's own form. A *showing* pick is `is_featured`
 * on one date, set on that showing's form. A *slide* is a row of
 * `featured_slides`, written in the admin's Home tab. Nothing until now could
 * see all three at once, so "what is on the front page right now" was a
 * question that could only be answered by opening the front page.
 *
 * The awkward part, and the reason this is a module rather than three lines in
 * a component: **a flag is not the same thing as being on the page.** The home
 * feed is built from *upcoming, active* showings, so a film flagged featured
 * whose last date was Tuesday is flagged and invisible, and so is one flagged
 * before any dates were scheduled. That has already confused people — the flag
 * is set, the form says so, and the carousel does not mention it.
 *
 * These functions restate the feed's own rule (`useFeed.ts` / `Index.tsx`
 * `buildFeed`) so the admin list can say *which* of those a pick is, in a
 * word. They are the second copy of that rule, which is a cost; they are here,
 * pure and tested, so that the copy is one function rather than a handful of
 * inline date comparisons that can each drift on their own.
 */

export type ProductionKind = 'movie' | 'event' | 'concert';

/** A title flagged as the pick. One slide for the whole run. */
export interface FlaggedProduction {
  kind: 'production';
  type: ProductionKind;
  id: string;
  title: string;
  posterUrl: string | null;
  isActive: boolean;
  /**
   * An RSVP or info-only event with no showings at all.
   *
   * `buildFeed` gives these a far-future sort key and puts them in the feed
   * anyway, deliberately — the artistic team's work should not vanish for want
   * of a ticketed date. So "no upcoming dates" is not a fault here the way it
   * is for a film.
   */
  standalone: boolean;
  /** Soonest upcoming active showing, ISO, or null when there is none. */
  nextStart: string | null;
  upcomingCount: number;
}

/** One night flagged as the pick. One slide for that date only. */
export interface FlaggedShowing {
  kind: 'showing';
  type: ProductionKind;
  id: string;
  /** The production's title — a showing has none of its own. */
  title: string;
  posterUrl: string | null;
  productionId: string;
  startTime: string;
  isActive: boolean;
  productionActive: boolean;
}

export type DerivedPick = FlaggedProduction | FlaggedShowing;

/**
 * Why this pick is not on the home page, in a word — or null when it is.
 *
 * The words are chosen to be actionable rather than accurate-and-useless:
 * "No dates" tells an admin to schedule a showing, "Past" tells them the flag
 * has outlived its night, "Hidden" tells them something is switched off. A
 * badge reading "Not in feed" would be true of all three and would answer
 * nothing.
 */
export function pickStatus(pick: DerivedPick, now: Date = new Date()): string | null {
  if (pick.kind === 'production') {
    if (!pick.isActive) return 'Hidden';
    // The standalone branch of buildFeed: in the feed with no showing at all.
    if (pick.standalone) return null;
    return pick.nextStart ? null : 'No dates';
  }

  if (!pick.productionActive || !pick.isActive) return 'Hidden';
  return new Date(pick.startTime).getTime() > now.getTime() ? null : 'Past';
}

/** The date the band would sort this pick by, or null when it has none. */
export function pickSortDate(pick: DerivedPick): string | null {
  return pick.kind === 'showing' ? pick.startTime : pick.nextStart;
}

/**
 * The order the carousel would run them in: chronological, soonest first.
 *
 * A pick with no date sorts last rather than first. `buildFeed` gives a
 * standalone RSVP event a far-future sort key for exactly this reason — an
 * undated thing at the head of a running order reads as "happening now" — and
 * a flagged title with no dates at all belongs at the bottom of an admin list
 * for a plainer reason: it is the one most likely to need attention.
 */
export function orderDerivedPicks<T extends DerivedPick>(picks: T[]): T[] {
  return [...picks].sort((a, b) => {
    const da = pickSortDate(a);
    const db = pickSortDate(b);
    if (da && db) return da.localeCompare(db) || a.id.localeCompare(b.id);
    if (da) return -1;
    if (db) return 1;
    return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}

/** Which table a production pick's flag lives in. */
export const PRODUCTION_TABLE: Record<ProductionKind, 'movies' | 'events' | 'live_performances'> = {
  movie: 'movies',
  event: 'events',
  concert: 'live_performances',
};

/** Where the admin edits it. `concert` is `live_performances` everywhere but the URL. */
export function pickEditPath(pick: DerivedPick): string {
  if (pick.kind === 'showing') return `/admin/showings/${pick.id}`;
  const segment = pick.type === 'movie' ? 'movies' : pick.type === 'event' ? 'events' : 'concerts';
  return `/admin/${segment}/${pick.id}`;
}

/** What to call the kind of thing this is, on screen. */
export function pickKindLabel(pick: DerivedPick): string {
  if (pick.kind === 'showing') return 'One night';
  return pick.type === 'movie' ? 'Film' : pick.type === 'event' ? 'Event' : 'Live performance';
}
