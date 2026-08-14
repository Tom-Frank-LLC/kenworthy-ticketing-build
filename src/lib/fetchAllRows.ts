import type { PostgrestError } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

/**
 * PostgREST caps a single response at 1,000 rows and gives no error when it truncates —
 * the tail just silently disappears. Any select over a table that can exceed that (the DVD
 * library is ~1,550 titles) has to be paged.
 *
 * Takes a factory rather than a query because a supabase-js query builder can only be
 * awaited once, so each page needs a fresh one:
 *
 *   const { data, error } = await fetchAllRows((from, to) =>
 *     supabase.from('dvds').select('*').order('title').range(from, to));
 */
export async function fetchAllRows<T, E = PostgrestError>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
): Promise<{ data: T[]; error: E | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return { data: all, error: null };
}
