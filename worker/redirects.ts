/**
 * Where the old WordPress site's URLs go now.
 *
 * kenworthy.org ran WordPress until the 2026 cutover, and Google still holds
 * those pages. On the SPA every one of them resolves through the catch-all
 * as a 200 home-page shell, which reads to a crawler as a soft 404 and to a
 * patron as a page that lost its content. A 301 hands the old URL's standing
 * to the page that replaced it and retires the stale result.
 *
 * The list is the old site's page sitemap (Wayback Machine capture,
 * 2026-02-01) mapped by hand — Decision 4 in BRIEF-seo-crawlability.md:
 * map the real pages individually rather than send everything to `/`.
 * WordPress internals (`/wp-*`, feeds) answer 410 so crawlers stop asking.
 */

const EXACT: Record<string, string> = {
  '/contact-us': '/about',
  '/support': '/donate',
  '/donate/our-supporters': '/sponsors',
  '/naming-opportunities': '/donate',
  '/privacy-policy': '/privacy',
  '/terms-and-conditions': '/terms',
  '/ticket-info-policies': '/terms',
  '/theatre-rental-request-form': '/rental-request',
  '/rental': '/rentals',
  '/events-calendar': '/calendar',
  '/events-page': '/calendar',
  '/full-calendar': '/calendar',
  '/full-calendar-2': '/calendar',
  '/the-met-live-in-hd': '/calendar',
  '/the-met-live-in-hd-24-25': '/calendar',
  '/pass-sale': '/film-passes',
  '/take-out': '/concessions',
  '/take-out/thank-you': '/concessions',
  '/intermission': '/concessions',
  '/gallery': '/history',
  // Retired features with no successor page.
  '/virtual-cinema': '/',
  '/blog': '/',
  '/shop': '/',
  '/moviesale': '/',
  '/social-sharing': '/',
  '/home-2': '/',
  '/orighome': '/',
  '/materialis': '/',
  '/profiles': '/',
  '/library-tabs': '/',
  '/donation-failed': '/donate',
  '/donation-history': '/donate',
  '/rsvp-jan-4-2020': '/',
};

/** `[prefix, destination]` — anything under the prefix goes to the destination. */
const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  // Modern Events Calendar plugin: /events/<slug>/ per event, plus its taxonomies.
  ['/events/', '/calendar'],
  ['/mec-category/', '/calendar'],
  ['/mec_category/', '/calendar'],
  ['/aec-', '/'],
  ['/category/', '/'],
  ['/tag/', '/'],
  ['/author/', '/'],
  ['/page/', '/'],
];

const GONE = [/^\/wp-(?:admin|content|includes|json|login|cron)\b/, /^\/xmlrpc\.php$/, /^\/feed\/?$/, /^\/comments\/feed\/?$/];

export type Redirect = { status: 301; location: string } | { status: 410 };

/**
 * The redirect for a request path, or null when it is not a legacy URL.
 *
 * Also normalises a trailing slash on a current route (`/calendar/` was the
 * WordPress spelling; the SPA's is `/calendar`), which is why the caller must
 * pass a predicate for "is this a page the app has".
 */
export function resolveRedirect(
  pathname: string,
  search: string,
  isAppPage: (path: string) => boolean,
): Redirect | null {
  if (GONE.some((re) => re.test(pathname))) return { status: 410 };

  const bare = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  // ?p=123 and friends are WordPress's own permalinks.
  if (bare === '/' && /(?:^|[?&])(?:p|page_id|cat|s|feed)=/.test(search)) {
    return { status: 301, location: '/' };
  }

  const exact = EXACT[bare];
  if (exact !== undefined) return { status: 301, location: exact + search };

  for (const [prefix, dest] of PREFIXES) {
    if (bare.startsWith(prefix) || bare + '/' === prefix) return { status: 301, location: dest };
  }

  if (bare !== pathname && isAppPage(bare)) return { status: 301, location: bare + search };

  return null;
}
