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
 * Normalise a staff-entered link, or reject it.
 *
 * Two jobs. The first is a courtesy — someone pasting `kenworthy.org/story`
 * without a scheme gets https:// rather than a link that resolves relative to
 * our own domain. The second is not: an `<a href>` accepts `javascript:` and
 * `data:` URLs and will run them, so a href that reaches the public page has
 * to be proved http(s) first. Admin-entered content is not the same as
 * trusted content — the account could be someone else's tomorrow.
 *
 * Returns null when there is nothing safe to link to; callers render a plain
 * card instead of a broken or dangerous link.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

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
