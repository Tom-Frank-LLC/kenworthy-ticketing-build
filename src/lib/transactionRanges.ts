import { venueDayKey } from '@/lib/datetime';

/**
 * What the Transactions tab's date buttons mean.
 *
 * Kept out of the component for the same reason `adminSections.ts` is: it is
 * the part of that screen with a rule in it, and a rule about dates is worth
 * testing rather than eyeballing once. Importing the component into a test
 * also drags in the Supabase client, which has no URL under vitest.
 *
 * Everything here is a **venue-local calendar date** (`YYYY-MM-DD`), matching
 * `_shared/square-reporting.ts` and Square's own `dateRange`, so "this week"
 * means the same week on this screen, on the Overview, and in Square's
 * dashboard. Computing from the browser's midnight would put the boundary in
 * the wrong place for anyone not sitting in Pacific time.
 */

/**
 * Shortest range first, and `today` is the default.
 *
 * Cost, measured on production 23 Aug 2026: today 4.0s, 7 days 4.5s, 30 days
 * 6.8s, 90 days 13.8s, year to date 31.8s — and every keystroke-pause in the
 * search box pays it again, because the function has no working cache (the
 * edge runtime hands each request a fresh isolate). Opening on 30 days made
 * the commonest question — what have we taken today — the slowest way to ask
 * it.
 */
export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
] as const;

export type RangeKey = typeof RANGES[number]['key'];

/** Where the tab opens. The box office's first question is about today. */
export const DEFAULT_RANGE: RangeKey = 'today';

export function presetRange(
  key: RangeKey,
  now: Date = new Date(),
): { start: string; end: string } {
  const end = venueDayKey(now);

  if (key === 'today') return { start: end, end };
  if (key === 'ytd') return { start: `${end.slice(0, 4)}-01-01`, end };

  // Arithmetic on the calendar date, not on the instant. Subtracting 24h in
  // milliseconds shifts the wall clock by an hour across a DST change, which
  // lands on the wrong day at the boundary — twice a year, for one day, in a
  // way nobody would think to look for.
  const [year, month, day] = end.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));

  if (key === 'week') {
    // The current calendar week so far, Sunday through today. "This week" at a
    // box office means the week you are in, not the last seven days — which is
    // why it is not labelled "7 days" alongside the rolling windows below.
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  } else {
    // Inclusive of today, so "30 days" spans 30 dated buckets.
    start.setUTCDate(start.getUTCDate() - (key === '90d' ? 89 : 29));
  }

  return { start: start.toISOString().slice(0, 10), end };
}
