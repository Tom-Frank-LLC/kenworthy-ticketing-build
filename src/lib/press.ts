// Shared rules for the Press page and its admin tab.
//
// Both screens have to agree about two things — what counts as a usable link,
// and which articles are pinned to the top — so both live here rather than
// being written twice and drifting.

export interface PressArticle {
  id: string;
  title: string;
  outlet: string;
  url: string;
  published_date: string | null;
  excerpt: string | null;
  image_url: string | null;
  is_featured: boolean;
  feature_order: number;
  is_active: boolean;
}

/**
 * How many articles can be pinned to the top of /press.
 *
 * "Up to" two, not exactly two: the page has to work on the day the Kenworthy
 * has one piece of coverage, or none.
 */
export const MAX_FEATURED = 2;

/**
 * Normalise a staff-entered link, or reject it. The rule lives in safeUrl.ts,
 * shared with every other stored URL that reaches an href; it is re-exported
 * here because the Press page and its admin tab import it from this module.
 */
export { safeHttpUrl } from './safeUrl';

/** Newest first; undated coverage sorts to the end rather than the top. */
function byPublishedDesc(a: PressArticle, b: PressArticle): number {
  if (!a.published_date && !b.published_date) return 0;
  if (!a.published_date) return 1;
  if (!b.published_date) return -1;
  return b.published_date.localeCompare(a.published_date);
}

/**
 * Split a list of active articles into the pinned ones and the rest.
 *
 * The slice to MAX_FEATURED is what makes this safe rather than decorative.
 * The admin tab refuses to feature a third article, but a row edited straight
 * in SQL can still arrive with three flags set, and the page must not respond
 * to that by growing a third hero card — or, worse, by dropping the extra
 * article on the floor. The overflow falls back into the chronological list,
 * where it is still visible and still in the right place.
 */
export function splitPressArticles(articles: PressArticle[]): {
  featured: PressArticle[];
  rest: PressArticle[];
} {
  const featured = articles
    .filter(a => a.is_featured)
    .sort((a, b) => a.feature_order - b.feature_order || byPublishedDesc(a, b))
    .slice(0, MAX_FEATURED);

  const pinned = new Set(featured.map(a => a.id));
  const rest = articles.filter(a => !pinned.has(a.id)).sort(byPublishedDesc);

  return { featured, rest };
}
