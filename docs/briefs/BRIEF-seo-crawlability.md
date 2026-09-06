---
brief: seo-crawlability
title: Crawlers and share previews see each page's own title, card and JSON-LD
status: built
track: feature
severity: P1
date: 2026-09-05
verified: true
---

# Brief (for Claude Code): SEO — phased plan (crawlability, old-site cleanup, structured data)

**Status:** 🟡 Built and verified on staging (`kenworthy-ticketing-staging`,
version `0a91d8d7`). **Not yet deployed to production.** Phases 1–3 are code
in this branch; Phase 0 and parts of Phase 4 are Tom's ops, listed at the end.
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

## Not done here — Tom's ops (Phase 0 and Phase 4)

1. **Production deploy.** `npx wrangler deploy` from a checkout of the merged
   PR (RUNBOOK-deploy-staging-prod.md). Record the current version first.
   The deploy now ships a Worker script as well as assets.
2. **Search Console + Bing Webmaster** on `kenworthy.org`. Submit
   `https://kenworthy.org/sitemap.xml`. Record Coverage before, so the effect
   is measurable. Use *Removals* on old WordPress results once the 301s are live.
3. **Google Business Profile**: Kenworthy Performing Arts Centre · 508 S Main
   St · Moscow, ID 83843 · website `https://kenworthy.org`.
4. **Rich Results Test** on a live showing and the home page after the prod
   deploy (the tool needs a public URL).
5. **robots.txt**: the two `User-agent: *` groups are Cloudflare's managed
   robots.txt (zone setting) prepended to ours. Either leave it (Google
   merges same-agent groups; our file now repeats the Content-Signal) or turn
   the managed block off in the dashboard.
6. Phase 4 polish — per-page H1/alt audit, internal linking, Core Web Vitals
   from field data — is untouched by this brief.

## Known duplication

After hydration a page carries the Worker's tags and the identical ones
Helmet writes (two `og:url`, two Event blocks on a showing). Crawlers that
execute JS tolerate identical duplicates; the fix, if it ever matters, is for
`<SEO>` to skip tags whose values already match.
