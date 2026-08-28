---
brief: manual-curator-slide
title: A page with nothing to sell can be a curator's pick
status: built
track: feature
severity: P2
date: 2026-08-25
shipped_in: ["#218"]
verified: true
evidence: on main as f5c882c; migration 20260828030114 applied to BOTH staging and production; staging worker deployed 2026-08-28 (version 1032a9e1-0be6-45c0-914a-88234c121870). Production frontend NOT deployed.
---

# Brief (for Claude Code): Manual curator's-pick slides (promote any page, e.g. the Silent Film Festival)

**Status:** 🟢 New admin-managed content type + a merge into the curator carousel. Pairs with `BRIEF-home-layout-search-carousel-preview.md` (which turns the curator's pick into a carousel) — this adds a second source of slides to that carousel.
**Date:** August 25, 2026
**Requested by:** Tom — a way to add a **manual entry** to the curator's-pick slideshow, e.g. to feature the upcoming **Silent Film Festival** by promoting its page (`/silent-film-festival`), which has no showing/ticket to hang a feature off.

## Current state (verified) — why this is needed
- Curator's picks are **only** derived from productions. `Index.tsx buildFeed()` builds `FeedItem`s from **showings** (movies/events/live_performances) plus RSVP/info-only events, each carrying `isFeatured = prod.is_featured`. `BoothNote.tsx` then shows the featured one(s).
- So a "pick" **must be a production with a showing** (or an RSVP/info event). There is **no way to feature a standalone page** — the Silent Film Festival page (`/silent-film-festival`, `SilentFilmFestival.tsx`), the Backstage page, a rentals promo, etc. `is_featured` lives on `movies`/`events`/`live_performances` only.
- Admin sets `is_featured` inside `MovieForm`/`EventForm`/`ConcertForm`. There is no "featured slides" surface.
- Conventions to reuse: images go to a **public Supabase storage bucket** (see `BackstageTab.tsx` — timestamp-prefixed upload + `getPublicUrl`); admin sections use `Tabs` + `CollapsibleSection` (`AdminDashboard.tsx`).

## The change — a `featured_slides` content type
### 1. Data model (migration)
New table `public.featured_slides`:
- `id uuid pk`, `title text`, `blurb text` (short curator copy), `image_url text` (poster/hero for the slide), `link_url text` (where the CTA goes — an internal path like `/silent-film-festival` **or** an external URL), `cta_label text` (e.g. "Explore the Festival"), `is_active boolean default true`, `display_order int`, optional `starts_at timestamptz` / `ends_at timestamptz` (auto show/hide window), `created_at`/`updated_at`.
- **RLS/grants:** public (`anon`) **SELECT only active slides within their date window**; **admin** insert/update/delete (mirror how other admin-managed public content is gated). Column-level select is fine — no private fields here.
- **Decision 1:** dedicated `featured_slides` table (recommended — decoupled from productions, flexible) vs overloading `events` with a "link-only" pseudo-event (not recommended — pollutes the productions model).

### 2. Admin manager
A new **"Curator's Picks / Featured Slides"** section in the admin dashboard (a `CollapsibleSection`, near the listings/home-content controls):
- List existing slides with active toggle and **drag or up/down reordering** (writes `display_order`).
- Add/edit form: **title, blurb, image (upload to the storage bucket per the BackstageTab pattern, or paste a URL), link URL, CTA label, active, optional start/end dates.**
- Validate `link_url`: allow internal paths (`/silent-film-festival`) and full `https://` URLs; flag anything else. Internal links use the SPA router (`<Link>`); external open per Decision 3.
- **Decision 2:** image via upload-to-bucket (recommended, consistent with Backstage/posters) vs URL-only to start.

### 3. Merge into the curator carousel (home)
In the curator carousel (from the home-layout brief, `BoothNote`):
- Combine two sources into one ordered slide list: **manual `featured_slides`** (active, in-window) **+** the existing **featured productions** (`isFeatured` items).
- Give both a common slide shape so the carousel renders them uniformly: image, title, blurb, and a CTA. A **manual** slide's CTA is its `link_url`/`cta_label` (e.g. "Explore the Festival" → `/silent-film-festival`); a **production** slide keeps its existing "Get Tickets" behavior.
- **Ordering (Decision 4):** a single list where manual slides sort by `display_order` and productions by date — recommend letting manual slides be **pinned/ordered explicitly** (so a festival promo can lead) while productions fill in after, or a unified `display_order`-then-date sort. Pick one and make it predictable for the admin.
- Empty/fallback behavior unchanged: if there are no featured items of either kind, the carousel falls back as the home-layout brief specifies.

### 4. Render
- Manual slide = image + title + blurb + CTA button. Reuse the curator-pick slide styling from the carousel so manual and production slides look like one system (full-width band, vignette, same height — per the home-layout brief).
- Accessibility: CTA is a real link with a clear label; image has alt (from title or an alt field — **Decision 5:** add an `image_alt` column, recommended, vs reuse title).

## Using it for the Silent Film Festival (the example)
Admin adds a slide: title "Kenworthy Silent Film Festival", a festival image, blurb, CTA "Explore the Festival" → `/silent-film-festival`, active, with an end date after the festival so it auto-retires. It appears in the curator carousel linking straight to the existing festival page — no fake showing required.

## Decisions for Tom
1. Dedicated `featured_slides` table (recommended) vs pseudo-event.
2. Image: upload-to-bucket (recommended) vs URL-only.
3. External links: open in a new tab (`target=_blank` + `rel=noopener`) vs same tab; internal always in-app.
4. Carousel ordering: manual slides pinned/ordered first (recommended) vs unified order+date sort.
5. Add an `image_alt` field (recommended) vs reuse the title for alt text.
6. Scheduling: include `starts_at`/`ends_at` auto show/hide (recommended, so festival promos self-expire) vs active-toggle only.

## Test plan
- An admin can create, edit, reorder, activate/deactivate, and delete a manual curator slide; image upload lands in the bucket and renders; `link_url` validation accepts internal paths and https URLs and rejects junk.
- A manual slide appears in the **curator carousel** alongside featured productions, ordered per Decision 4; its CTA navigates to the target page (internal via router; external per Decision 3).
- Creating a "Silent Film Festival" slide linking to `/silent-film-festival` shows it in the slideshow and opens that page — with no showing/ticket involved.
- Scheduling (if enabled): a slide outside its date window, or inactive, does not render publicly; RLS keeps inactive/out-of-window slides unreadable to `anon`.
- Production ("Get Tickets") slides are unaffected; the carousel fallback/empty state still behaves per the home-layout brief.
- Accessibility: slide image has alt, CTA is a labeled link; keyboard/carousel controls work.
- `npm run build` + tests pass; add a test for the merge (manual + featured productions → one ordered list) and RLS (anon sees only active, in-window slides).

## Decisions taken (all six, with the recommended option unless noted)

1. **Dedicated `featured_slides` table.** Nothing in it pretends to be a
   production, so nothing has to be hidden from the listings, the calendar or
   the box office afterwards.
2. **Image is upload-only** — no "paste a URL" field, which is narrower than the
   brief allowed for. A stored object path is one source of truth: it is what
   delete cleans up and what the render endpoint resizes. A remote URL would be
   neither, and would put a third party's host in the critical path of the home
   page.
3. **External links open in a new tab**, `rel="noopener noreferrer"`. Internal
   paths go through the router. Which one a link is comes from its shape, and
   the shape is enforced by a CHECK constraint (`featured_slides_link_shape`),
   not only by the form — `javascript:` and `data:` in an href are script on our
   own origin, and `//evil.example.com` reads as a path while being an off-site
   URL.
4. **Manual slides lead, in `display_order`; feed picks follow, chronologically.**
   Two orders rather than one merged sort: a manual slide has no date, and a
   unified sort would have to invent one — a rule the admin cannot see. The
   sentence an admin can hold in their head is "yours first, in the order you
   gave; then what's on, soonest first".
5. **`image_alt` is its own column.** The title says what the slide is *for*;
   alt text has to say what the picture *shows*. Blank falls back to the title
   rather than to `alt=""`.
6. **`starts_at` / `ends_at` included**, both optional, both theatre time. The
   window is enforced in the RLS policy as well as in the client, so an
   out-of-window slide is unreadable to `anon` rather than merely unrequested.

Two things the brief did not ask for and this needed anyway:

- **The fallback narrowed.** The band used to fall back to the first
  chronological item when nothing was flagged. It now does that only when
  *neither* source produced a slide — stapling an unpicked film beside a
  deliberate promo would be second-guessing the admin.
- **The band is gated on either source.** `Index.tsx` rendered it only when the
  filtered feed had items, which would have hidden a manual slide on exactly the
  quiet week it exists for.

## What was verified, and how

Against staging (`rpqzrpboyhshdrfdwayk`), after `supabase db push`:

- `link_url` of `javascript:alert(1)`, `//evil.example.com` and a backwards date
  window are each refused by the database with `23514`, not merely by the form.
- Four rows — live, switched off, not yet started, finished — inserted with
  `service_role`. `anon` sees exactly one. An `anon` insert is refused 401.
- A 981 KB image uploaded to the `featured-slides` bucket comes back from the
  render endpoint at 38 KB, and the slide draws it at 640px with its own alt
  text, inside an `aria-hidden` link that is out of the tab order.
- The home page, running against staging, put the manual slide first and the
  featured production second, and went back to two production picks when the
  test rows were deleted.
- `tsc -p tsconfig.app.json --noEmit`, `vitest run` (632 passing, 24 of them
  new), `npm run build:staging`.

Then on the deployed staging worker, signed in as an admin: **Add slide** with a
title, blurb, `/silent-film-festival`, a CTA label, a 958 KB JPEG and its own
image description saved on the first try; the row listed as **Live**; the home
page put it at the front of the carousel with the image drawn at 640px and the
description as its alt text; and the button routed in-app to
`/silent-film-festival`. That test slide is still on staging — delete it from
Admin → Pages → Home when you are done with it.

Production still has only the table. The frontend change is not deployed there,
so nothing on kenworthy.org has changed yet.
