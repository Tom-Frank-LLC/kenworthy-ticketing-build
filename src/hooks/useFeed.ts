import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { FeedItem } from '@/components/home/TrailerFeed';
import { attachUpcomingShowings } from '@/lib/feed';
import { htmlToPlainText } from '@/lib/richText';
import { MOVIE_PUBLIC_COLUMNS } from '@/lib/movieColumns';
import { isPast } from '@/lib/purchasable';
import { LOOKBACK_MS } from '@/lib/showtimes';

export type ProductionType = 'movie' | 'event' | 'concert';

export interface FullProduction {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  trailer_url: string | null;
  rating?: string | null;
  genre?: string | null;
  is_featured?: boolean;
  ticket_type?: string;
  rsvp_url?: string | null;
  /** Runtime in minutes: when this production's showings end. Null/0 → the two-hour default. */
  duration_minutes?: number | null;
  type: ProductionType;
}

export interface FeedData {
  feed: FeedItem[];
  productionsById: Map<string, FullProduction>;
}

/**
 * The columns of `showings` the feed reads. Named rather than `*` because the
 * raw showing row never leaves this file — every consumer gets a FeedItem — so
 * anything not listed here was downloaded for every visitor and then dropped.
 * Events and live performances still come back whole: their rows *do* leave
 * this file, as `productionsById`, and the detail drawer reads them.
 */
export const SHOWING_FEED_COLUMNS =
  'id,start_time,ticket_price,movie_id,event_id,live_performance_id,is_featured,no_ticket_required,manually_sold_out';

/**
 * A showing together with its production, in one read.
 *
 * The feed used to read every active film, event and performance and join
 * them in the browser. Production has 1,131 active films (2026-10-09), past
 * PostgREST's silent 1,000-row cap, so that read returned an arbitrary 1,000
 * and any showing whose film fell outside them vanished from the listings
 * with no error. Embedding reads exactly the titles the showings name, however
 * large the catalogue grows, and is still one request.
 *
 * Films are read through MOVIE_PUBLIC_COLUMNS; events and performances come
 * back whole because they leave this file as `productionsById`, and the
 * detail drawer reads them.
 */
export const SHOWING_WITH_PRODUCTION =
  `${SHOWING_FEED_COLUMNS},` +
  `movie:movies(${MOVIE_PUBLIC_COLUMNS}),` +
  'event:events(*),' +
  'live_performance:live_performances(*)';

/**
 * One cache entry for the whole public catalogue.
 *
 * The home page and the calendar read the same catalogue — every upcoming
 * showing with its production, and the standalone RSVP events — and until now each page
 * ran them again on every mount. Going home → calendar → home was three full
 * round-trips of the same data, and that is most of what "navigation feels
 * slow" was. A shared query key means the second page renders from cache and
 * revalidates in the background.
 *
 * A minute of freshness is plenty: the catalogue changes a few times a week,
 * and a showing that sells out or is pulled inside that window is still caught
 * at checkout, where the price function is the authority. Staff editing a
 * listing and checking the public page can wait a minute or reload.
 */
export const FEED_QUERY_KEY = ['feed'] as const;
export const FEED_STALE_MS = 60_000;

/** Which production a showing belongs to. Exactly one of the three is set. */
export function showingProduction(s: {
  movie_id?: string | null;
  event_id?: string | null;
  live_performance_id?: string | null;
}): { type: ProductionType; id: string } | null {
  if (s.movie_id) return { type: 'movie', id: s.movie_id };
  if (s.event_id) return { type: 'event', id: s.event_id };
  if (s.live_performance_id) return { type: 'concert', id: s.live_performance_id };
  return null;
}

/**
 * The production embedded in a `SHOWING_WITH_PRODUCTION` row, or null when it
 * is hidden. RLS already withholds an inactive title from the public; the
 * explicit check is for a signed-in staff member, who can read hidden titles
 * and should still see the public listing.
 */
export function embeddedProduction(s: any): FullProduction | null {
  const ref = showingProduction(s);
  if (!ref) return null;
  const row = ref.type === 'movie' ? s.movie : ref.type === 'event' ? s.event : s.live_performance;
  if (!row || row.is_active !== true) return null;
  return { ...row, type: ref.type };
}

/**
 * One showing row, read as a listing. Shared with the calendar's history
 * fetch so a past showing is described exactly as it was while it was on.
 * `prod` must be the production `showingProduction(s)` names.
 */
export function showingToFeedItem(s: any, prod: FullProduction): FeedItem {
  return {
    id: `${prod.type}-${prod.id}-${s.id}`,
    productionId: prod.id,
    title: prod.title,
    posterUrl: prod.poster_url,
    trailerUrl: prod.trailer_url,
    startTime: s.start_time,
    showingId: s.id,
    durationMinutes: prod.duration_minutes ?? null,
    type: prod.type,
    ticketType: prod.ticket_type,
    rsvpUrl: prod.rsvp_url,
    curatorNote: prod.description,
    isFeatured: prod.is_featured ?? false,
    isFeaturedShowing: s.is_featured ?? false,
    ticketPrice: s.ticket_price,
    noTicketRequired: s.no_ticket_required ?? false,
    manuallySoldOut: s.manually_sold_out ?? false,
  };
}

export async function fetchFeed(): Promise<FeedData> {
  // A showing stays listed until it *ends*, not until it starts: someone
  // checking what is on at 7:40 should still find the 7:00 film, and can
  // still buy into it. The end is the production's runtime (or the default),
  // which the database cannot filter on without restating the rule, so the
  // query casts the same bounded net backwards the showing page's date list
  // does and isPast decides below.
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const [showingsRes, standaloneRes] = await Promise.all([
    supabase
      .from('showings')
      .select(SHOWING_WITH_PRODUCTION)
      .eq('is_active', true)
      .gte('start_time', since)
      .order('start_time'),
    // The only productions the feed lists without a showing. Read on their
    // own, by kind, rather than as part of every active event.
    supabase
      .from('events')
      .select('*')
      .eq('is_active', true)
      .in('ticket_type', ['rsvp', 'info_only']),
  ]);

  // Only the titles the listings name. The two pages that read this map look
  // a title up from a FeedItem, so nothing else is ever asked of it.
  const byId = new Map<string, FullProduction>();

  const items: FeedItem[] = [];
  for (const s of (showingsRes.data || []) as any[]) {
    const prod = embeddedProduction(s);
    if (!prod) continue;
    if (isPast(s, prod)) continue;
    byId.set(`${prod.type}:${prod.id}`, prod);
    items.push(showingToFeedItem(s, prod));
  }

  // RSVP / info-only events have no showings of their own, so they would
  // otherwise vanish from the page. They ride along with a far-future sort key:
  // still surfaced, but below the dated calendar.
  for (const row of (standaloneRes.data || []) as any[]) {
    const prod: FullProduction = { ...row, type: 'event' };
    const hasShowings = items.some((i) => i.type === 'event' && i.productionId === prod.id);
    if (hasShowings) continue;
    byId.set(`event:${prod.id}`, prod);
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    items.push({
      id: `event-${prod.id}-standalone`,
      productionId: prod.id,
      title: prod.title,
      posterUrl: prod.poster_url,
      trailerUrl: prod.trailer_url,
      startTime: farFuture,
      showingId: null,
      type: 'event',
      ticketType: prod.ticket_type,
      rsvpUrl: prod.rsvp_url,
      curatorNote: prod.description,
      isFeatured: prod.is_featured ?? false,
      // No showing exists in this branch — these are standalone RSVP /
      // info-only events — so there is no price to carry. `s` belongs to
      // the showings loop above and is out of scope here; referencing it
      // threw a ReferenceError that took down the whole feed.
      ticketPrice: undefined,
    });
  }

  items.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return { feed: attachUpcomingShowings(items), productionsById: byId };
}

// Stable empties, so a page that renders before the first fetch resolves gets
// the same reference each time and its memos do not re-run for nothing.
const EMPTY_FEED: FeedItem[] = [];
const EMPTY_PRODUCTIONS: Map<string, FullProduction> = new Map();

export function useFeed() {
  const { data, isPending } = useQuery({
    queryKey: FEED_QUERY_KEY,
    queryFn: fetchFeed,
    staleTime: FEED_STALE_MS,
  });
  return {
    feed: data?.feed ?? EMPTY_FEED,
    productionsById: data?.productionsById ?? EMPTY_PRODUCTIONS,
    loading: isPending,
  };
}

export function filterFeed(items: FeedItem[], query: string): FeedItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) =>
      i.title.toLowerCase().includes(q) ||
      // Strip before matching, or a search for "li" hits every description
      // with a bullet list in it and "strong" hits every bolded one.
      htmlToPlainText(i.curatorNote).toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q),
  );
}
