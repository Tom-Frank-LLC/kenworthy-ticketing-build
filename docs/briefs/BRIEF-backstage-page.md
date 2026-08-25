---
brief: backstage-page
title: A hidden Backstage page, reached only by clicking the neon sign
status: shipped
track: feature
severity: P3
date: 2026-08-18
evidence: migration 20260820203112_backstage_page.sql; /backstage returns 200 in production and renders its headings; existing evidence line retained below; prior note — migration 20260820203112_backstage_page.sql; src/pages/Backstage.tsx; src/components/admin/BackstageTab.tsx
shipped_in: ["#143", "#152", "#153"]
shipped_at: 2026-08-25
verified: true
---

# Brief (for Claude Code): Add the hidden "Backstage" page

**Status:** 🟡 Built, not deployed. Migration applied to **staging only**.
**Date:** August 18, 2026
**Requested by:** Tom — a `/backstage` page reachable **only by clicking the "Backstage" neon sign** at the bottom of the home page (not in nav). It shows **images of past events** and **a description of how the space is used for events**.

## What shipped

### Part A — the sign is the door
`src/components/home/BackstageTeaser.tsx` wraps the neon sign in a
react-router `<Link to="/backstage">` with `aria-label="Enter Backstage"`.
No CTA text was added: the sign is the only affordance, per the request.
Hovering or focusing turns the existing pink glow up rather than adding a
border or an underline that the styling would fight; the scale-up is behind
`motion-safe:`. The decorative gradients around it were already
`pointer-events-none` and stayed that way.

### Part B — `/backstage`
`src/pages/Backstage.tsx`, routed in `App.tsx` and lazy-loaded like every
other non-home page.

- **Header** — the same `backstage-logo.svg`, the same warm-lamp glow and
  vignette as the teaser, so the click reads as walking through the door
  rather than landing on a different site. The sign *is* the `<h1>`; its alt
  text is the document's level-one heading, which avoids printing the word
  "Backstage" underneath a sign that already says it.
- **How the room gets used** — the paragraph from
  `backstage_page_content`, split on blank lines and rendered as `<p>`s.
  Never as HTML.
- **Past events** — published `backstage_photos` in grid order; a click opens
  a lightbox with arrow-key and button navigation that wraps.
- **Footer** — the address, plus an "Enquire about booking Backstage" button
  to `/rental-request`.

### Part C — data, storage, admin
Migration `20260820203112_backstage_page.sql`:

- Bucket `backstage-photos` — public read, admin write, and
  `allowed_mime_types` + `file_size_limit` **set at creation**, per the
  standing rule recorded in `20260820164402`.
- `backstage_photos` — `is_published` defaults false; the anon SELECT policy
  filters on it; admins see drafts too.
- `backstage_page_content` — one row, `press_page_content`'s exact shape.

Admin tab: **Pages → Backstage** (`src/components/admin/BackstageTab.tsx`),
mirroring `FestivalProgramsTab`. Upload, caption, display order,
publish/unpublish, full-size preview, delete (row first, then object). Every
write ends in `.select()` and checks the row count, because an RLS denial is
a 204 with no error.

## Decisions taken

| # | Decision | Taken | Why |
|---|---|---|---|
| 1 | Unlisted vs gated | **Unlisted** | Matches "click the sign". Nothing checks a session. Additionally `noindex, nofollow` — see below. |
| 2 | Nav | **Out of all nav** | The sign is the only link on the site. |
| 3 | "Book Backstage" CTA | **Linked to `/rental-request`** | `rental_requests.venue_area` has carried `backstage_speakeasy` all along; this is the first page that says so. |
| 4 | Shared vs dedicated table | **Dedicated `backstage_photos`** | Simplest, and the festival archive's needs (year, file_type, thumbnails, per-year trailers) have already diverged far enough that one shared table would be mostly-null columns. |
| 5 | Copy | **Placeholder, seeded in the migration** | Written in the teaser's voice so the page looks finished on day one. The admin tab says in as many words that it is placeholder. **Tom's real wording still needed.** |

### One thing the brief did not ask for: `noindex`

The brief called the page unlisted and compared it to the Color-Lab secret
link. Once the home page links to it, a crawler finds it like any other link
and it becomes a search result — at which point "hidden" is only true of the
nav. `public/colorlab.html` already carries `noindex, nofollow` for exactly
this reason, so `SEO` gained an optional `noindex` prop and `/backstage`
passes it. `/backstage` is deliberately **not** in `public/sitemap.xml`, and
deliberately **not** in `robots.txt` either — a `Disallow:` line is a public
list of the things you did not want found.

## Verified on staging

Migration applied to `rpqzrpboyhshdrfdwayk` only.

### Policies, with the anon key

| check | result |
|---|---|
| `GET backstage_page_content` | returns the seeded paragraph |
| `GET backstage_photos` | `[]` — the published-only policy holds |
| `POST backstage_photos` | `401` |
| `POST` an SVG to the bucket | `415 InvalidMimeType` — refused server-side, before RLS |
| `POST` a JPEG to the bucket | `403` RLS — bucket exists, anon cannot write |
| a bucket that does not exist | `404 NoSuchBucket`, for contrast |

### The full admin round trip, in a real signed-in admin session

Run against staging through the dev server, with the anon key checked after
each step to see what the public would actually get:

| step | result |
|---|---|
| `?section=pages&page=backstage` | opens the Backstage sub-tab — the new `PAGES_SUB_TABS` path resolves |
| two photos uploaded, captions + display order 0 and 1 | both land as **Draft** |
| anon read with two drafts outstanding | `[]` — nothing leaks |
| publish one | anon sees exactly that one row |
| public page | one card, thumbnail `200` through the render endpoint |
| lightbox | opens full size, caption below, no arrows with a single photo |
| publish the second | two cards, in display order |
| `→` in the lightbox | advances, then wraps back to the first |
| unpublish one | anon drops back to one row |
| delete | row gone **and** the storage object gone (`400` on its public URL) while the other one still `200`s |
| the prose editor | Save disabled until dirty, saves, `updated_at` advances, restores |

Staging was left clean: no rows, no objects, and the seeded copy byte-identical
to what the migration wrote.

One property worth stating rather than discovering later: **an unpublished
photo's bytes are still reachable by direct URL.** The bucket is public, so
`is_published` controls listing, not access — which is why upload paths carry a
timestamp prefix. Unlisted, not private, at both levels. If a photo is ever
genuinely sensitive, it does not belong in this bucket.

`tsc -p tsconfig.app.json --noEmit` clean; `vitest` 28 files / 282 passing;
`build:staging` clean.

## Still to do

1. **Tom's real copy**, replacing the placeholder.
2. **Tom's photographs.** None ship with this work.
3. **Deploy.** The migration is on staging only; production needs the
   migration *and* `wrangler deploy`. Merging does not deploy.
