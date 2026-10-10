import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { format, subMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import type { FeedItem } from '@/components/home/TrailerFeed';
import { venueDayBounds, venueDayKey, venueLocalToInstant } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import { FEED_STALE_MS, SHOWING_WITH_PRODUCTION, embeddedProduction, showingToFeedItem } from './useFeed';

/**
 * What already played, for the /calendar month grid only.
 *
 * The shared feed (`useFeed`) lists only showings that have not ended, and the
 * home page, the carousel and the showing pages depend on that. History is a
 * separate fetch with its own cache key so none of them change.
 *
 * **Twelve months back, no further** (Tom, 2026-10-10). The archive runs to
 * June 2021, but the calendar shows the last year: `HISTORY_MONTHS` before
 * today, from the venue's midnight on this date last year.
 *
 * Loaded **one month at a time, when the reader pages to it**, plus the month
 * before as a prefetch. At roughly 35 showings a month, loading the year up
 * front would cost every calendar visit a download to show the few readers
 * who page back. A month is one small query.
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
 *  - **Productions are embedded in the showing read** (`SHOWING_WITH_PRODUCTION`,
 *    the same select the live feed uses), never read as "every active title",
 *    which is past PostgREST's 1,000-row cap. Hidden titles stay hidden: a
 *    showing whose title is not active is dropped, as it is in the feed.
 */

/** `yyyy-MM`, the cache key of one month of history. */
export type MonthKey = string;

export const monthKey = (month: Date): MonthKey => format(month, 'yyyy-MM');

const HISTORY_QUERY_KEY = 'calendar-history';

/** How far back the calendar shows. */
export const HISTORY_MONTHS = 12;

/**
 * The first instant the calendar shows history for: the venue's midnight on
 * this date `HISTORY_MONTHS` ago. The grid's back arrow stops at this
 * instant's month; days of that month before it stay empty.
 */
export function historyCutoff(now: Date = new Date()): Date {
  return venueDayBounds(subMonths(now, HISTORY_MONTHS)).start;
}

/** The venue's midnight on the 1st of `key`'s month, as an instant. */
function monthStartInstant(key: MonthKey): Date {
  return venueLocalToInstant(`${key}-01T00:00`);
}

/**
 * Every showing in one venue-calendar month that has ended, as read-only
 * feed items. Exported for the tests.
 */
export async function fetchHistoryMonth(key: MonthKey, now: number = Date.now()): Promise<FeedItem[]> {
  const cutoff = historyCutoff(new Date(now));
  const monthStart = monthStartInstant(key);
  const from = monthStart < cutoff ? cutoff : monthStart;
  const [y, m] = key.split('-').map(Number);
  const next = monthStartInstant(monthKey(new Date(y, m, 1)));
  if (from.getTime() >= now || next <= cutoff) return [];
  const until = new Date(Math.min(next.getTime(), now)).toISOString();

  const { data, error } = await supabase
    .from('showings')
    .select(SHOWING_WITH_PRODUCTION)
    .gte('start_time', from.toISOString())
    .lt('start_time', until)
    .order('start_time');
  if (error) throw error;

  const items: FeedItem[] = [];
  for (const s of (data ?? []) as any[]) {
    const prod = embeddedProduction(s);
    if (!prod) continue;
    // Still playing belongs to the live feed, which lists it until it ends.
    if (!isPast(s, prod, now)) continue;
    items.push({ ...showingToFeedItem(s, prod), ended: true });
  }
  return items;
}

/**
 * The months worth asking for, given the months on screen: those, the one
 * before the earliest (so paging back one month is already loaded), nothing
 * before the cutoff's month, and nothing after the current month, which
 * cannot hold anything that has ended.
 */
export function historyMonthsFor(visible: Date[], now: Date = new Date()): MonthKey[] {
  if (visible.length === 0) return [];
  const current = monthKey(now);
  const first = monthKey(subMonths(now, HISTORY_MONTHS));
  const wanted = [subMonths(visible[0], 1), ...visible].map(monthKey);
  return [...new Set(wanted)].filter((k) => k >= first && k <= current).sort();
}

const EMPTY: FeedItem[] = [];

export function useCalendarHistory(visibleMonths: Date[]) {
  const wanted = useMemo(() => historyMonthsFor(visibleMonths), [visibleMonths]);
  const current = monthKey(new Date());
  // Moves once a day; a fresh Date every render would move the grid's floor
  // every render.
  const today = venueDayKey(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const from = useMemo(() => historyCutoff(), [today]);

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
    /** Where the grid's back arrow stops. */
    from,
    loading: onScreen.some((q) => q.isPending),
    failed: onScreen.some((q) => q.isError),
  };
}
