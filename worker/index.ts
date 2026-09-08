/**
 * The Worker in front of the static assets.
 *
 * Why it exists: a share preview, a search crawler and a no-JS fetch all read
 * `<head>` and stop. The app writes its titles, cards and JSON-LD with
 * react-helmet-async *after* JavaScript runs, so every one of them used to
 * see the home page's card on every URL — site title, favicon for an image,
 * `og:url` pointing at `/`. (Confirmed with a raw fetch; see
 * docs/briefs/BRIEF-seo-crawlability.md.)
 *
 * What it does, per request:
 *   1. Legacy WordPress URLs → 301 to their successor (worker/redirects.ts).
 *   2. `/sitemap.xml` → rendered from live showings and passes.
 *   3. Any file, hashed asset or standalone document → the asset layer, untouched.
 *   4. An app route → the SPA shell with its `<head>` rewritten for that route
 *      (worker/routes.ts for the static pages, a Supabase read for a showing
 *      or a film pass), for every visitor, bot or human. Humans then hydrate
 *      as before; the client-side <SEO> writes the same values again.
 *
 * Rewriting for everyone rather than for crawler user agents only is
 * deliberate (Decision 1/2): there is nothing to cloak, HTMLRewriter streams,
 * and one code path is one thing to be wrong.
 *
 * The routing above happens because wrangler.jsonc sets
 * `assets.run_worker_first` for everything but `/assets/*` (the hashed
 * bundles). Without that, the asset layer would answer `/` and every SPA
 * fallback itself and this code would never run for a document.
 */
import { classify, INDEXABLE_STATIC_PATHS, staticMeta } from './routes';
import { resolveRedirect } from './redirects';
import { renderHead, type PageHead } from './head';
import { showingJsonLd, venueJsonLd, productionOf } from './jsonld';
import { fetchPass, fetchShowing, fetchSitemapRows, passImageUrl } from './data';
import { renderSitemap } from './sitemap';
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE_PATH, DEFAULT_TITLE } from './site';
import { htmlToPlainText, toMetaDescription } from '../src/lib/plainText';
import { showingTitle } from '../src/lib/showingTitle';

/** `en-US` date in the theatre's own time zone, matching formatShowtime(). */
function showDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function defaultHead(env: Env, path: string): PageHead {
  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: `${env.SITE_URL}${path}`,
    image: `${env.SITE_URL}${DEFAULT_OG_IMAGE_PATH}`,
    ogType: 'website',
    noindex: false,
    jsonLd: [],
  };
}

interface Resolved {
  head: PageHead;
  status: number;
}

async function resolveHead(env: Env, path: string): Promise<Resolved> {
  const route = classify(path);
  const base = defaultHead(env, path);

  switch (route.kind) {
    case 'static': {
      const meta = staticMeta(route.path)!;
      return {
        status: 200,
        head: {
          ...base,
          title: meta.title,
          description: meta.description,
          jsonLd: meta.venueJsonLd ? [venueJsonLd(env.SITE_URL)] : [],
        },
      };
    }
    case 'private':
      return { status: 200, head: { ...base, noindex: true } };

    case 'showing': {
      const showing = await fetchShowing(env, route.id);
      const production = showing && productionOf(showing);
      if (!showing || !production) return { status: 404, head: { ...base, noindex: true } };
      const when = showDate(showing.start_time);
      const ld = showingJsonLd(showing, env.SITE_URL);
      return {
        status: 200,
        head: {
          ...base,
          title: showingTitle(production.title, when),
          description:
            toMetaDescription(production.description) ||
            `Tickets for ${production.title} at Kenworthy Performing Arts Centre in Moscow, Idaho on ${when}.`,
          image: production.poster || base.image,
          ogType: 'event',
          jsonLd: ld ? [ld] : [],
        },
      };
    }
    case 'pass': {
      const pass = await fetchPass(env, route.id);
      if (!pass) return { status: 404, head: { ...base, noindex: true } };
      const films = Math.floor(Number(pass.initial_balance) / Math.max(Number(pass.redemption_price), 1));
      const worth = pass.ticket_face_value
        ? `Good for ${films} films — tickets that cost $${Number(pass.ticket_face_value).toFixed(2)} each at the door.`
        : `Good for ${films} films.`;
      return {
        status: 200,
        head: {
          ...base,
          title: `${pass.name} — Kenworthy`,
          description:
            `${worth} ${htmlToPlainText(pass.fine_print)}`.trim() ||
            `Buy the ${pass.name} for Kenworthy Performing Arts Centre in Moscow, Idaho.`,
          image: pass.image_path ? passImageUrl(env, pass.image_path) : base.image,
          ogType: 'product',
          jsonLd: [
            {
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: pass.name,
              description: htmlToPlainText(pass.fine_print) || worth,
              image: pass.image_path ? passImageUrl(env, pass.image_path) : undefined,
              url: `${env.SITE_URL}/film-pass/${pass.id}`,
              offers: {
                '@type': 'Offer',
                price: Number(pass.price).toFixed(2),
                priceCurrency: 'USD',
                availability: 'https://schema.org/InStock',
                url: `${env.SITE_URL}/film-pass/${pass.id}`,
              },
            },
          ],
        },
      };
    }
    case 'unknown':
      return { status: 404, head: { ...base, noindex: true } };
    case 'asset':
      // Unreachable: the caller hands assets to the asset layer before this.
      return { status: 200, head: base };
  }
}

/** The app shell from the asset layer, fetched fresh (no conditional headers). */
async function fetchShell(env: Env, origin: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(`${origin}/`, { method: 'GET' }));
}

/**
 * Strip what the build wrote, append what this route needs. The removals
 * matter as much as the additions: a crawler that finds two `og:url`s picks
 * whichever it likes.
 */
function rewriteHead(shell: Response, headHtml: string, status: number): Response {
  const rewritten = new HTMLRewriter()
    .on('head > title', { element: (el) => { el.remove(); } })
    .on('head > meta[name="description"]', { element: (el) => { el.remove(); } })
    .on('head > meta[property^="og:"]', { element: (el) => { el.remove(); } })
    .on('head > meta[name^="twitter:"]', { element: (el) => { el.remove(); } })
    .on('head > link[rel="canonical"]', { element: (el) => { el.remove(); } })
    .on('head > script[type="application/ld+json"]', { element: (el) => { el.remove(); } })
    .on('head', { element: (el) => { el.append(`\n    ${headHtml}\n`, { html: true }); } })
    .transform(shell);

  const headers = new Headers(rewritten.headers);
  // The body no longer matches the asset's ETag, and must not be revalidated as if it did.
  headers.delete('etag');
  headers.delete('last-modified');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.set('vary', 'Accept-Encoding');
  return new Response(rewritten.body, { status, headers });
}

async function sitemap(env: Env): Promise<Response> {
  let rows = { showings: [], passes: [] } as Awaited<ReturnType<typeof fetchSitemapRows>>;
  try {
    rows = await fetchSitemapRows(env);
  } catch (err) {
    console.log(JSON.stringify({ level: 'error', msg: 'sitemap rows failed', error: String(err) }));
  }
  return new Response(renderSitemap(env.SITE_URL, INDEXABLE_STATIC_PATHS, rows), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return env.ASSETS.fetch(request);
    }

    const redirect = resolveRedirect(url.pathname, url.search, (p) => classify(p).kind !== 'unknown');
    if (redirect) {
      if (redirect.status === 410) return new Response('Gone', { status: 410 });
      return Response.redirect(`${url.origin}${redirect.location}`, 301);
    }

    if (url.pathname === '/sitemap.xml') return sitemap(env);

    if (classify(url.pathname).kind === 'asset') return env.ASSETS.fetch(request);

    let resolved: Resolved;
    try {
      resolved = await resolveHead(env, url.pathname);
    } catch (err) {
      // Never let the card break the page: fall back to the site defaults.
      console.log(JSON.stringify({ level: 'error', msg: 'head resolve failed', path: url.pathname, error: String(err) }));
      resolved = { status: 200, head: defaultHead(env, url.pathname) };
    }

    const shell = await fetchShell(env, url.origin);
    if (!shell.ok || !(shell.headers.get('content-type') ?? '').includes('text/html')) {
      return shell;
    }
    return rewriteHead(shell, renderHead(resolved.head), resolved.status);
  },
} satisfies ExportedHandler<Env>;
