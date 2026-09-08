/**
 * Which kind of page a path is, and what a crawler should be told about it.
 *
 * The SPA's router (`src/App.tsx`) is the source of truth for what exists;
 * this table is what the Worker knows about each route *before* any
 * JavaScript runs. `worker/routes.test.ts` asserts every `<Route path>` in
 * App.tsx is classified here, so adding a page without a row fails the test
 * rather than shipping a page that returns 404 to Googlebot.
 *
 * Titles and descriptions mirror the `<SEO>` props on each page. They are
 * duplicated rather than imported because the pages build them from state and
 * flags at render time; the client-side `<SEO>` remains authoritative for a
 * human's tab, this table is what a no-JS fetch sees.
 */

export interface StaticMeta {
  title: string;
  description: string;
  /** Attach the venue JSON-LD (only the home page wants it). */
  venueJsonLd?: boolean;
}

export type Route =
  | { kind: 'static'; path: string; meta: StaticMeta }
  | { kind: 'showing'; id: string }
  | { kind: 'pass'; id: string }
  /** Staff/patron-private surfaces: served, but told `noindex`. */
  | { kind: 'private'; path: string }
  /** A separate document in public/ (or a hashed asset): hand to the asset layer untouched. */
  | { kind: 'asset' }
  /** Not a page the app has: the SPA shell with a 404 status. */
  | { kind: 'unknown' };

const STATIC: Record<string, StaticMeta> = {
  '/': {
    title: 'Kenworthy — Films, Performances & Events in Moscow, ID',
    description:
      'A century of stories on Main Street. Browse upcoming films, live performances, and events at Kenworthy Performing Arts Centre in Moscow, Idaho.',
    venueJsonLd: true,
  },
  '/calendar': {
    title: 'Calendar — Kenworthy',
    description:
      'Browse every upcoming film, live performance, and event at Kenworthy Performing Arts Centre on Main Street in Moscow, Idaho.',
  },
  '/film-passes': {
    title: 'Film Passes — Kenworthy',
    description:
      'Prepaid film passes for KPAC in Moscow, Idaho. Collect one at the box office or have it posted, then hand it over at the door.',
  },
  '/rentals': {
    title: 'Rent Kenworthy — Historic Theatre & Marquee',
    description:
      'Rent the historic Kenworthy theatre, Main Stage, Backstage Speakeasy, or marquee for private events. Hourly rates, fees, and a live availability calendar.',
  },
  '/rental-request': {
    title: 'Rental Request — Kenworthy',
    description:
      'Request a date to rent the historic Kenworthy theatre in Moscow, Idaho for your film, performance, meeting or private event.',
  },
  '/backstage': {
    title: 'Backstage — The Kenworthy',
    description:
      "Backstage is Kenworthy's after-hours speakeasy in Moscow, Idaho — a room behind the room for private events, live music and late nights.",
  },
  '/backstage-enquiry': {
    title: 'Enquire about Backstage — The Kenworthy',
    description:
      "Ask about booking Backstage, the Kenworthy's after-hours speakeasy in Moscow, Idaho, for a private evening.",
  },
  '/about': {
    title: 'About — Kenworthy',
    description:
      "The mission, goals, board of directors, and history of Kenworthy Performing Arts Centre — Moscow's historic downtown theatre and cinematic art house.",
  },
  '/history': {
    title: 'A Century on Main Street | Kenworthy History',
    description:
      'One hundred years of films, renovations, and community at Kenworthy Performing Arts Centre in Moscow, Idaho — told as an animated vertical timeline.',
  },
  '/press': {
    title: 'Press — The Kenworthy',
    description:
      'Press coverage of Kenworthy Performing Arts Centre in Moscow, Idaho, and how to reach us for media enquiries.',
  },
  '/concessions': {
    title: 'Concessions | Kenworthy Performing Arts Centre',
    description:
      'Freshly-popped popcorn, your favorite candies, and an ice-cold beverage — in combo form or à la carte.',
  },
  '/silent-film-festival': {
    title: 'Kenworthy Silent Film Festival | Kenworthy Performing Arts Centre',
    description:
      'Silent cinema as it was meant to be seen — on a big screen, in a full room, with live music. Each night pairs a restored classic with an original score.',
  },
  '/sponsors': {
    title: 'Our Sponsors — Kenworthy Performing Arts Centre',
    description:
      "Meet the foundations, businesses, and friends whose support sustains Kenworthy, Moscow Idaho's historic non-profit cinema and performing arts centre.",
  },
  '/donate': {
    title: 'Donate — Kenworthy Performing Arts Centre',
    description:
      "Support Kenworthy Performing Arts Centre, Moscow Idaho's historic non-profit cinema, with a tax-deductible donation.",
  },
  '/volunteer': {
    title: 'Volunteer — Kenworthy',
    description:
      'Volunteer at the historic Kenworthy Performing Arts Centre in Moscow, Idaho — ushering, concessions, box office, clean-up days, and committees. 16 and older.',
  },
  '/hiring': {
    title: 'Job Opportunities — Kenworthy',
    description:
      'Staff and volunteer openings at Kenworthy Performing Arts Centre in Moscow, Idaho. Concessions, box office, clean-up, and special events — 16 and older.',
  },
  '/accessibility': {
    title: 'Accessibility — Kenworthy',
    description:
      'Accessibility at Kenworthy Performing Arts Centre in Moscow, Idaho: seating, entrances, assistive listening, and how to ask for what you need.',
  },
  '/dvds': {
    title: 'DVD Rentals — Kenworthy',
    description:
      "Browse Kenworthy's DVD lending library. Ask at the box office on Main Street, Moscow, to borrow a title.",
  },
  '/privacy': {
    title: 'Privacy Policy — Kenworthy',
    description: 'How Kenworthy Performing Arts Centre handles the personal information of patrons, donors and renters.',
  },
  '/terms': {
    title: 'Terms of Service — Kenworthy',
    description: 'The terms that apply to tickets, film passes, donations and rentals at Kenworthy Performing Arts Centre.',
  },
};

/**
 * Routes a search visitor has no business finding. They are still served (the
 * app decides who may see them), but the head says `noindex` and the sitemap
 * omits them. `public/robots.txt` disallows the same prefixes.
 */
const PRIVATE_PREFIXES = [
  '/admin',
  '/staff',
  '/host',
  '/superadmin',
  '/auth',
  '/reset-password',
  '/my-tickets',
  '/my-passes',
  '/profile',
  '/t/',
  '/contract/',
  '/verify/',
];

/** Pages that live in public/ as their own HTML document, reached without an extension. */
const STANDALONE_DOCS = new Set(['/sms', '/colorlab', '/index.html']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paths of every static page the sitemap should list, in a sensible order. */
export const INDEXABLE_STATIC_PATHS: string[] = Object.keys(STATIC).filter(
  // The DVD library is unlisted on purpose — see the `noindex` on Dvds.tsx.
  (p) => p !== '/dvds',
);

export function staticMeta(path: string): StaticMeta | undefined {
  return STATIC[path];
}

export function classify(pathname: string): Route {
  const path = pathname === '' ? '/' : pathname;

  if (STANDALONE_DOCS.has(path) || /\.[a-z0-9]{1,12}$/i.test(path)) return { kind: 'asset' };

  const meta = STATIC[path];
  if (meta) return { kind: 'static', path, meta };

  const showing = path.match(/^\/showing\/([^/]+)$/);
  if (showing) return UUID.test(showing[1]) ? { kind: 'showing', id: showing[1] } : { kind: 'unknown' };

  const pass = path.match(/^\/film-pass\/([^/]+)$/);
  if (pass) return UUID.test(pass[1]) ? { kind: 'pass', id: pass[1] } : { kind: 'unknown' };

  if (PRIVATE_PREFIXES.some((p) => path === p || path === p.replace(/\/$/, '') || path.startsWith(p.endsWith('/') ? p : p + '/'))) {
    return { kind: 'private', path };
  }

  return { kind: 'unknown' };
}

/**
 * Whether the app's router would match this path, used by the route test to
 * confirm every `<Route path>` in App.tsx is accounted for.
 */
export function isKnownAppRoute(routePattern: string): boolean {
  if (routePattern === '*') return true;
  const probe = routePattern.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
  return classify(probe).kind !== 'unknown';
}
