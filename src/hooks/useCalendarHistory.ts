import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { format, subMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import type { FeedItem } from '@/components/home/TrailerFeed';
import { venueLocalToInstant } from '@/lib/datetime';
import { MOVIE_PUBLIC_COLUMNS } from '@/lib/movieColumns';
import { isPast } from '@/lib/purchasable';
import {
  FEED_STALE_MS,
  SHOWING_FEED_COLUMNS,
  type FullProduction,
  type ProductionType,
  showingProduction,
  showingToFeedItem,
} from './useFeed';

/**
 * What already played, for the /calendar month grid only.
 *
 * The shared feed (`useFeed`) lists only showings that have not ended, and the
 * home page, the carousel and the showing pages depend on that. History is a
 * separate fetch with its own cache key so none of them change.
 *
 * Loaded **one month at a time, when the reader pages to it**, plus the month
 * before as a prefetch. The archive runs back to June 2021 at roughly 35
 * showings a month (about 1,800 in all, measured on production 2026-10-09), so
 * loading it all up front would cost every calendar visit a large download to
 * show the few readers who page back. A month is one small query.
 *
 * Two rules of the data shape this relies on:
 *
 *  - **No `is_active` filter.** Almost every past showing is from the August
 *    2026 archive import, which wrote them `is_active = false` (1,749 of 1,827
 *    on production). Filtering on the flag would show two months of history.
 *    Anon can read every past showing: the SELECT policy admits
 *    `start_time < now()` (20260909180838_showings_past_readable_by_anon.sql).
 *    The flip side is that a showing staff deactivated to cancel it also
 *    appears here once its date has passed. None exists today
 *    (no past inactive showing was created after the import).
 *  - **Productions are fetched by id, not as "every active title".** There are
 *    1,131 active films on production, past PostgREST's silent 1,000-row cap,
 *    so a catalogue-wide read would drop some at random. A month's showings
 *    name a few dozen titles at most. Hidden titles stay hidden: RLS still
 *    requires `is_active` on movies/events/live_performances, and a showing
 *    whose title is hidden is dropped.
 */

/** `yyyy-MM`, the cache key of one month of history. */
export type MonthKey = string;

export const monthKey = (month: Date): MonthKey => format(month, 'yyyy-MM');

const HISTORY_QUERY_KEY = 'calendar-history';

const PRODUCTION_TABLE: Record<ProductionType, { table: string; columns: string }> = {
  movie: { table: 'movies', columns: MOVIE_PUBLIC_COLUMNS },
  event: { table: 'events', columns: '*' },
  concert: { table: 'live_performances', columns: '*' },
};

/** The venue's midnight on the 1st of `key`'s month, as an instant. */
function monthStartInstant(key: MonthKey): Date {
  return venueLocalToInstant(`${key}-01T00:00`);
}

/**
 * Every showing in one venue-calendar month that has ended, as read-only
 * feed items. Exported for the tests.
 */
export async function fetchHistoryMonth(key: MonthKey, now: number = Date.now()): Promise<FeedItem[]> {
  const from = monthStartInstant(key);
  const [y, m] = key.split('-').map(Number);
  const next = monthStartInstant(monthKey(new Date(y, m, 1)));
  if (from.getTime() >= now) return [];
  const until = new Date(Math.min(next.getTime(), now)).toISOString();

  const { data: showings, error } = await supabase
    .from('showings')
    .select(SHOWING_FEED_COLUMNS)
    .gte('start_time', from.toISOString())
    .lt('start_time', until)
    .order('start_time');
  if (error) throw error;
  const rows = (showings ?? []) as any[];
  if (rows.length === 0) return [];

  const idsByType: Record<ProductionType, Set<string>> = {
    movie: new Set(),
    event: new Set(),
    concert: new Set(),
  };
  for (const s of rows) {
    const ref = showingProduction(s);
    if (ref) idsByType[ref.type].add(ref.id);
  }

  const byId = new Map<string, FullProduction>();
  await Promise.all(
    (Object.keys(idsByType) as ProductionType[]).map(async (type) => {
      const ids = [...idsByType[type]];
      if (ids.length === 0) return;
      const { table, columns } = PRODUCTION_TABLE[type];
      const { data, error: prodError } = await supabase.from(table as any).select(columns).in('id', ids);
      if (prodError) throw prodError;
      for (const row of (data ?? []) as any[]) byId.set(`${type}:${row.id}`, { ...row, type });
    }),
  );

  const items: FeedItem[] = [];
  for (const s of rows) {
    const ref = showingProduction(s);
    if (!ref) continue;
    const prod = byId.get(`${ref.type}:${ref.id}`);
    if (!prod) continue;
    // Still playing belongs to the live feed, which lists it until it ends.
    if (!isPast(s, prod, now)) continue;
    items.push({ ...showingToFeedItem(s, prod), ended: true });
  }
  return items;
}

/** The first showing on record: how far back the arrows may go. */
async function fetchEarliestShowing(): Promise<Date | null> {
  const { data, error } = await supabase
    .from('showings')
    .select('start_time')
    .lt('start_time', new Date().toISOString())
    .order('start_time')
    .limit(1);
  if (error) throw error;
  const first = (data as any[] | null)?.[0]?.start_time;
  return first ? new Date(first) : null;
}

/**
 * The months worth asking for, given the months on screen: those, the one
 * before the earliest (so paging back one month is already loaded), and
 * nothing after the current month, which cannot hold anything that has ended.
 */
export function historyMonthsFor(visible: Date[], now: Date = new Date()): MonthKey[] {
  if (visible.length === 0) return [];
  const current = monthKey(now);
  const wanted = [subMonths(visible[0], 1), ...visible].map(monthKey);
  return [...new Set(wanted)].filter((k) => k <= current).sort();
}

const EMPTY: FeedItem[] = [];

export function useCalendarHistory(visibleMonths: Date[]) {
  const wanted = useMemo(() => historyMonthsFor(visibleMonths), [visibleMonths]);
  const current = monthKey(new Date());

  // Every month asked for this visit, not just the ones on screen now. The
  // cache holds them anyway, and the grid needs the set of populated days to
  // only ever grow while the reader pages: it re-anchors the view when a day
  // drops out (that is how it notices a search), and a month that fell out of
  // this list on paging would look exactly like one.
  const [seen, setSeen] = useState<MonthKey[]>([]);
  const keys = useMemo(() => [...new Set([...seen, ...wanted])].sort(), [seen, wanted]);
  useEffect(() => {
    if (keys.length !== seen.length) setSeen(keys);
  }, [keys, seen.length]);

  const earliest = useQuery({
    queryKey: [HISTORY_QUERY_KEY, 'earliest'],
    queryFn: fetchEarliestShowing,
    staleTime: Infinity,
  });

  const months = useQueries({
    queries: keys.map((key) => ({
      queryKey: [HISTORY_QUERY_KEY, key],
      queryFn: () => fetchHistoryMonth(key),
      // A finished month never changes. This month gains a showing each time
      // one ends, so it refreshes on the feed's own schedule.
      staleTime: key < current ? Infinity : FEED_STALE_MS,
    })),
  });

  const signature = months.map((q) => q.dataUpdatedAt).join(',');
  const items = useMemo(() => {
    const all = months.flatMap((q) => q.data ?? []);
    return all.length === 0 ? EMPTY : all;
    // `months` is a new array every render; its data changes only with this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Only the months on screen count as loading or failed; the prefetch is
  // silent.
  const visibleKeys = new Set(visibleMonths.map(monthKey));
  const onScreen = months.filter((_, i) => visibleKeys.has(keys[i]));

  return {
    items,
    earliest: earliest.data ?? null,
    loading: onScreen.some((q) => q.isPending),
    failed: onScreen.some((q) => q.isError),
  };
}
