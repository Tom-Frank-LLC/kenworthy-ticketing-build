---
brief: seo-crawlability
title: Crawlers and share previews see each page's own title, card and JSON-LD
status: shipped
track: feature
date: 2026-09-05
shipped_in: ["#294"]
shipped_at: 2026-09-08
verified: true
---

# Brief (for Claude Code): SEO — phased plan (crawlability, old-site cleanup, structured data)

**Status:** 🟢 Shipped. Merged as #294 and deployed to production on
2026-09-08 (Worker version `f5011572`; rollback point `123df6fc`, which was
byte-identical to main). Phases 1–3 are live; Phase 0 is under way (property
verified, sitemap submitted); the Phase 4 leftovers are listed at the end.
**Date:** September 5, 2026

## The problem (confirmed with a raw fetch)

A no-JS fetch of `/showing/:id` returned the home page's card: site title,
base description, `og:image` = the favicon, `og:url` = `/`, no Event JSON-LD.
Everything the app knows about a page is written by `react-helmet-async` after
JavaScript runs, and share scrapers and basic crawlers never run it. The
sitemap was a static file listing seven URLs. Google still held the old
WordPress pages, which the SPA answered with a 200 home-page shell.

## What shipped

### Phase 2 — the Worker (`worker/`)

`wrangler.jsonc` now has a `main` (`worker/index.ts`), an `ASSETS` binding
and `run_worker_first: ["/*", "!/assets/*"]`. Without `run_worker_first` the
asset layer answers `/` and every SPA fallback itself and the Worker never
sees a document; the hashed bundles under `/assets/` skip it.

Per request the Worker: 301s legacy WordPress URLs; renders `/sitemap.xml`
from live rows; hands any file or standalone document (`/sms`, `/colorlab`)
to the asset layer untouched; and for every app route fetches the shell and
rewrites `<head>` with HTMLRewriter — for every visitor, not only crawlers
(Decision 1/2: one path, nothing to cloak, negligible cost).

| route | head |
|---|---|
| `/showing/:id` | production title (three-size rule in `src/lib/showingTitle.ts`), plain-text description, canonical + `og:url` = the showing, `og:image` = poster, `ScreeningEvent` / `MusicEvent` / `Event` JSON-LD |
| `/film-pass/:id` | pass name, worth line + fine print, pass image, `Product` JSON-LD |
| static pages | title/description mirrored from each page's `<SEO>` (`worker/routes.ts`) |
| `/` | + the venue JSON-LD (`PerformingArtsTheater` + `MovieTheater`, address, geo, phone) |
| private prefixes (`/admin`, `/staff`, `/t/`…) | site defaults + `noindex` |
| unknown path, missing/inactive showing or pass | shell with **404** + `noindex` |

Reads go over the anon REST API with the same RLS a patron's tab has, cached
at the edge for 60 s (`caches.default`). A failed read falls back to the site
defaults; the page never breaks because the card did.

`worker/routes.test.ts` parses `src/App.tsx` and asserts every `<Route path>`
is classified, so a new page without a row fails the test rather than
returning 404 to Googlebot.

### Phase 1 — old site

- Canonical host was already settled: kenworthy.org serves the build and
  `www` 301s to apex (Cloudflare rule, see RUNBOOK-golive-kenworthy-org.md).
- `worker/redirects.ts` maps the old WordPress page sitemap (Wayback capture
  2026-02-01) individually (Decision 4): `/contact-us/`→`/about`,
  `/support/`→`/donate`, `/donate/our-supporters/`→`/sponsors`,
  `/theatre-rental-request-form/`→`/rental-request`, `/events/*`→`/calendar`,
  etc.; trailing-slash spellings of current routes 301 to the bare route;
  `/wp-*`, feeds and `xmlrpc.php` answer 410. Anything else unknown is a real
  404 now, which is the signal that retires a stale result.

### Phase 3 — structured data

Event JSON-LD carries `offers` (lowest active tier or flat price, `USD`,
`availability` = SoldOut / InStock / Discontinued from the same
`purchasable.ts` helpers the buy button uses), `isAccessibleForFree`,
`endDate` from the runtime chain, `location` with geo, `organizer`,
`performer`, and `workPresented` for films. Venue JSON-LD gained geo, image,
logo and an `@id` the events point at. `index.html` keeps a copy as the
no-Worker fallback.

### Also

- `public/og-default.jpg`, a 1200×630 crop of the marquee photo, replaces the
  favicon as the default share image (Worker, `SEO.tsx`, `index.html`).
- `public/sitemap.xml` is deleted; the Worker serves it.
- `src/lib/plainText.ts` holds `htmlToPlainText`/`toMetaDescription` without
  DOMPurify so the Worker can share them; `richText.ts` re-exports.
- `_headers`: the two JSON-LD hashes were recomputed for the new block. The
  Worker's per-route JSON-LD is *not* hashed — a data block is never
  prepared as a script — and headless Chrome on staging reports no CSP
  violation on any page.
- `robots.txt` repeats Cloudflare's `Content-Signal` line in our own group.
- New check: `npm run check:worker` (types up to date + `tsc -p tsconfig.worker.json`).

## Verified on staging (2026-09-05)

- No-JS fetch of `/showing/26e6becd…`: film title, poster `og:image`,
  showing `og:url`/canonical, one `ScreeningEvent` block. `/film-pass/…`:
  Product card. `/`: venue JSON-LD. `/admin`: noindex. `/no-such-page`: 404.
- `/contact-us/` → 301 `/about`; `/events/foo/` → 301 `/calendar`;
  `/calendar/` → 301 `/calendar`; `/wp-content/x.jpg` → 410.
- `/sitemap.xml`: 63 URLs (21 static + `/sms` + 39 showings + 2 passes), no
  `%SITE_URL%`.
- Hashed JS still `text/javascript`, `/favicon.svg`, `/sms`, `/robots.txt`
  pass through; the boot-watchdog hash is unchanged in the served HTML.
- Headless Chrome: `/showing/…`, `/`, `/calendar` hydrate (`h1` present,
  `document.title` matches the served one), zero console errors, zero
  `securitypolicyviolation` events.

## Search Console baseline (Tom, 2026-09-08, before the production deploy)

| view | reading |
|---|---|
| Performance, 28 days (data exists for 9/5–9/6 only: the property is new) | 316 clicks · 2.09K impressions · CTR 15.1% · avg position 5.1 |
| Sitemaps | none submitted |
| Pages | not indexing (reasons to be recorded from the report) |
| Enhancements → Events | 85 valid items with warnings, crawled 6/9–8/31: missing organizer.name, organizer.url, image, performer, location.address, location.name, offers.price; 1 invalid price format |

The 85 Event items are the old WordPress site's (Modern Events Calendar)
markup — the client-side Event in Showing.tsx has an organizer, location and
image, so none of those warnings can be ours. The Worker's Event carries every
field on that list. After the deploy, use *Validate fix* on each row; the old
items retire as their URLs 301 to `/calendar`.

## Verified in production (2026-09-08, kenworthy.org)

- No-JS fetch of `/showing/c0787cef…` with a scraper user agent: film title,
  poster `og:image`, showing `og:url` and canonical, one `ScreeningEvent`.
  `/`: venue JSON-LD. `/admin`: noindex. `/no-such-page`: 404.
- `/contact-us/` → 301 `/about`, `/support/` → 301 `/donate`,
  `/events/foo/` → 301 `/calendar`, `/calendar/` → 301 `/calendar`,
  `/wp-content/x.jpg` → 410, `www.kenworthy.org/calendar` → 301 apex.
- `/sitemap.xml`: 91 URLs, `application/xml`, no workers.dev or token.
- Hashed JS `text/javascript`, `/og-default.jpg` 204 KB `image/jpeg`, `/sms`
  passes through; the boot-watchdog hash in served HTML is unchanged.
- `cf-cache-status: HIT` appears on every document — that is the asset
  layer's label, and each route's body carried its own head, so it is not a
  stale zone cache.
- Headless Chrome: showing, home, calendar hydrate with one `<title>`,
  matching `document.title`, and no error from our code.
- **Pre-existing, not from this change:** Chrome reports a CSP violation on
  every page for `https://static.cloudflareinsights.com/beacon.min.js`.
  That is Cloudflare Web Analytics, injected at the zone level, and blocked
  by the `script-src` that #280 enforced on 2026-09-03. Staging shows no
  violation because workers.dev has no zone injection. Fix is either to add
  `https://static.cloudflareinsights.com` to `script-src` (and
  `https://cloudflareinsights.com` to `connect-src`) or to switch Web
  Analytics off for the zone.

## Follow-ups (state as of 2026-09-10)

Done:
- Production deploy (2026-09-08, `f5011572`); CSP fix for the zone-injected
  Web Analytics beacon and the sitemap orphan filter (#302, #303, deployed
  2026-09-10 as `22dac98e`).
- Search Console: Domain property verified, sitemap submitted, *Validate fix*
  run on the Event warnings — seven of eight closed. The eighth, "Invalid
  price format", is one old WordPress item still recrawling; every live
  showing serves a two-decimal numeric price (68/68 checked), so it closes
  when Google sees the 301. Pages report: no reason left that is ours.
- Bing Webmaster: imported from Search Console.

Waiting on time, not on work:
- One-week comparison against the baseline table above (from 2026-09-15).
- *Removals* for any old WordPress result still listed after that.
- Core Web Vitals needs 28 days of field data on the new domain.

Still open, off-site:
- Google Business Profile: claim/confirm NAP and website `https://kenworthy.org`.
- Rich Results Test on a live showing and the home page (needs a browser;
  the markup is the same the headless check read, but the tool's warnings
  are the thing to record).
- Decide whether to keep Cloudflare's managed robots.txt block (harmless either way).

Not part of this brief — Phase 4 polish (one H1 per page, poster/hero alt
text, related-title links, home→calendar links crawlable without JS) is a
separate unit of work and wants its own brief when it is picked up.

## Known duplication

After hydration a page carries the Worker's tags and the identical ones
Helmet writes (two `og:url`, two Event blocks on a showing). Crawlers that
execute JS tolerate identical duplicates; the fix, if it ever matters, is for
`<SEO>` to skip tags whose values already match.
