# Brief (for Claude Code): Press page + admin Press tab

**Status:** 🟢 Implemented August 14, 2026 — applied to staging, not yet deployed or applied to production. See **Results** at the end of this file for the decisions taken and how each claim was verified.
**Date:** August 14, 2026
**Requested by:** Tom — an admin Press tab where staff add links to press articles that show as previews on the Press page; two can be **featured** (pinned to top), the rest newest→oldest; plus one manually-added **photo** and one manual **text field** on the page.

## Current state (file:line)
- **Press page is a stub:** `PressPage` is a `comingSoon()` placeholder (`App.tsx:53`), routed at `/press` (`App.tsx:115`). Replace it with a real, DB-driven page.
- **Admin tab pattern:** the dashboard's top tabs are a `Tabs`/`TabsContent` set (`AdminDashboard.tsx:444+`, `topTabs` array ~L460) with sibling tab components (SponsorsTab, DvdLibraryTab, etc.). Add a **Press** tab the same way.
- **Image upload exists:** `src/components/admin/PosterUpload.tsx` uploads to Supabase storage and returns a URL — reuse it for the manual page photo and (optionally) per-article thumbnails, so staff upload rather than paste URLs.
- **CRUD template:** `SponsorsTab.tsx` (`sponsorship_opportunities` with `display_order`, `is_active`, insert/update/delete) is the closest pattern to copy.
- **Singleton content pattern:** page-level single values can live in a settings row / `app_config` (as `WageTipRules`/`LglTab` do).

## Important: link out, don't reproduce
Press articles are third-party copyrighted content. The Press page **links to** each article and shows only staff-entered preview metadata — headline, outlet, date, an optional **short** staff-written blurb (a one-line summary or brief quote), and a thumbnail. **Do not store or display the article body.** Each card is a link that opens the original at the outlet (`target="_blank" rel="noreferrer"`).

## Data model
1. **`press_articles`** — `id`, `title`, `outlet` (publication name), `url`, `published_date date`, `excerpt text` (optional, short staff blurb), `image_url text` (optional thumbnail), `is_featured boolean default false`, `feature_order int` (order among the featured), `is_active boolean default true`, `created_at`, `updated_at`. RLS: admin/staff write; public read of `is_active = true`.
2. **`press_page_content`** — a single-row settings table (or two `app_config` keys) holding the page's **one manual photo** (`photo_url`) and **one manual text field** (`intro_text`). RLS: admin write; public read.

## Admin — new **Press** tab (`PressTab.tsx`)
- **Article CRUD:** list existing articles (newest first); add/edit/delete with fields title, outlet, url, published date, short excerpt/blurb, and a thumbnail (via `PosterUpload` or URL). Delete removes the row.
- **Feature toggle (max 2):** a "Feature" switch per article; enforce **at most two** featured — when a third is toggled on, either block with a message or auto-unfeature the oldest (pick one; recommend block + a clear "you can feature two" note). Let staff set which of the two shows first (`feature_order`).
- **Page photo + text:** a small section to upload/replace the single page photo and edit the single text field (`press_page_content`).
- Wire it into `AdminDashboard`: add `press` to the `topTabs` array + a `<TabsContent value="press"><PressTab/></TabsContent>`.

## Public Press page (`/press`)
Replace the stub with a real page (mirror an existing content page's layout + the `SEO` component):
1. Optional **manual photo** (hero/banner) and **manual text** (intro paragraph) at the top, shown only if set.
2. **Featured** — the up-to-two `is_featured` articles pinned at the top as larger preview cards (thumbnail, title, outlet, date, blurb, "Read at {outlet} ↗").
3. **The rest** — remaining active articles as preview cards, **chronological newest→oldest by `published_date`**.
4. Each card links out to the article `url`.
5. Empty state if there are no articles yet.

## Decisions for Tom
1. **Featured count:** always exactly two, or **up to** two (0–2)? (Recommend up to two, so the page still works with one or none.)
2. **Third-feature behavior:** block the toggle, or auto-unfeature the oldest featured? (Recommend block with a message.)
3. **Thumbnails:** staff upload / paste a URL (recommended, simple) — or should we auto-fetch the outlet's preview image from the link (an edge function; more work, can fail)? Recommend manual for v1.
4. **Manual photo placement:** top hero banner vs a sidebar element.

## Test plan
- Add 4 articles with dates; feature two → the two appear pinned on top (in `feature_order`), the other two below in newest→oldest order.
- Toggling a third feature is prevented (or unfeatures the oldest, per decision).
- Set the page photo + intro text → they render at the top; clear them → the page still renders without.
- Each card opens the correct article URL in a new tab; delete an article → it disappears from the page.
- Non-admin/staff can't edit; public sees only active articles.
- `npm run build` passes.

---

# Results — implemented August 14, 2026

**Status:** 🟢 Built, typechecked, tested, and applied to **staging**. Not yet
deployed to a Worker and not applied to production — see **Remaining**.

## Decisions taken

1. **Up to two featured (0–2).** The page renders correctly with two, one, or
   none. `/press` is linked from the header and mobile menu, so the day it
   ships with no coverage at all is a day real visitors see it.
2. **Blocked, not auto-unfeatured.** Pinning a third shows "You can feature 2
   articles at a time — un-feature one to make room." Silently demoting
   whichever article was oldest would remove something a staff member chose
   last week without telling them.
3. **Manual thumbnails.** Upload via `PosterUpload`, or paste a URL. No
   link-preview fetcher.
4. **Hero banner.** Photo sits under the `PRESS` heading, intro text below it,
   both optional and both omitted cleanly when unset.

## What shipped

| File | |
|---|---|
| `supabase/migrations/20260814020000_press_page.sql` | `press_articles` + singleton `press_page_content`, RLS, grants, indexes |
| `src/lib/press.ts` | `safeHttpUrl`, `splitPressArticles`, `MAX_FEATURED` — shared by page and tab |
| `src/lib/press.test.ts` | 10 tests over the ordering and link-safety rules |
| `src/pages/Press.tsx` | the public page, replacing the `ComingSoon` stub |
| `src/components/admin/PressTab.tsx` | the admin tab |
| `src/lib/datetime.ts` | new `formatPlainDate` (see below) |
| `src/components/admin/PosterUpload.tsx` | optional `label` / `previewClassName` / `alt`; defaults unchanged for the three existing callers |
| `src/App.tsx`, `src/pages/ComingSoon.tsx`, `src/pages/admin/AdminDashboard.tsx` | routing and tab wiring |

## Three things worth knowing

**`published_date` is a DATE, and DATEs are not instants.**
`new Date('2026-08-01')` parses as *UTC* midnight, which is July 31 in Pacific
— every press card would have printed the day before the article ran, for
every visitor west of Greenwich. `formatPlainDate` splits the components and
builds a local-midnight `Date` instead. It is deliberately separate from
`formatShowtime`, which is for TIMESTAMPTZ instants and must keep pinning to
`VENUE_TIME_ZONE`. There is a test for the off-by-one-day case.

**The "max two featured" rule is enforced twice, on purpose.**
The admin tab refuses the third click; the page *also* slices to two. A row
edited straight in SQL can arrive with three flags set, and the page must
neither grow a third hero card nor drop the extra article — the overflow falls
back into the chronological list, in its correct date position. Tested.

**Staff-entered URLs are normalised before they become an `href`.**
`safeHttpUrl` adds `https://` to a bare domain (so `dnews.com/story` is not
treated as a path on our own site) and rejects anything that is not http(s) —
an `<a href="javascript:…">` executes on click, and admin-entered is not the
same as trusted. A row whose link can't be trusted still renders its headline,
just not as a link.

## Verified

- `npx tsc -p tsconfig.app.json --noEmit` — clean. (Bare `tsc --noEmit` is a
  no-op here; the solution-style root config has no files.)
- `npm run build:staging` — passes.
- `npm test` — 16 files / 121 tests pass, including the 10 new ones. (One run
  showed two flaky failures in the scanner suite; green on re-run, untouched by
  this work.)
- `npx eslint` on the new files reports only `no-explicit-any` from the
  `(supabase as any)` calls, which is the repo-wide pattern — 463 pre-existing
  errors of the same kind.
- Migration applied to staging (`rpqzrpboyhshdrfdwayk`, "KPAC staging"), a
  clean one-migration push with nothing else pending.
- Against the live staging REST API with the anon key: `press_page_content`
  returns its one seeded row and `press_articles` returns `[]` (public read
  works), while anon `INSERT` and `UPDATE` both return **401 / 42501** and
  leave no data behind (writes are shut). Re-read afterwards confirmed the
  probes landed nothing.

## Remaining

- Frontend deploy per `RUNBOOK-deploy-staging-prod.md` (`npm run
  build:staging` → `npx wrangler deploy --env staging`), then the manual test
  plan above against the staging Worker.
- Production: apply the same migration to `vlmslygnimfbamrtwvyo`, then
  `build:production` + deploy. Not done here.
- The Press tab is **admin-only** (`show: isAdmin`), matching Hiring. Article
  RLS is written at `staff` level so opening it to a marketing staffer later is
  a one-line UI change — but note the `posters` storage bucket's upload policy
  is admin-only, so a staff-level editor could add a link and not a thumbnail.
  Widening that is a storage-policy change, not a code change.
