# Brief: Enrich the Showing / Ticketing Page with Drawer Elements

**Status:** 🟡 Enhancement (customer-facing, pre-launch desirable)
**Date:** August 11, 2026
**Requested by:** Tom

---

## Goal

When a customer clicks "Get Tickets" on a film/event, they land on the ticketing page (`/showing/:id`, rendered by `src/pages/Showing.tsx`). That page currently shows the title and description but omits the rich media the drawer already displays. Bring the ticketing page to parity with the `ProductionDetailDrawer` so the purchase page feels as complete as the preview.

Add: **poster, trailer, description, genre, rating** (and runtime/duration, since the drawer shows it too).

---

## Key finding — the data is already there

`Showing.tsx` **already fetches all the needed fields** and does not need new queries. The movie query (line ~101) already selects:
`title, description, poster_url, duration_minutes, rating, genre, trailer_url, release_year, release_label, ...`

Events and live performances are fetched with `select('*')`, so they carry the same fields where present.

So this is a **display-only change** — the `production` object in state already holds poster_url, trailer_url, rating, genre, and duration_minutes. Currently only `description` is rendered (line ~503). Everything else is loaded and unused. No schema, query, or data-migration work required.

---

## What the drawer renders (the parity target)

From `src/components/ProductionDetailDrawer.tsx`, the media block is:

1. **Trailer or poster** (trailer takes precedence):
   - If `trailer_url` exists → embed it. The drawer already handles three cases via helpers `getEmbedUrl()` and `isDirectVideo()`:
     - YouTube/Vimeo → `<iframe>` with the embed URL
     - Direct video file → `<video controls>`
     - Other → `<iframe>` fallback
   - Else if `poster_url` exists → `<img>` of the poster
   - (Reuse the same helpers so behaviour matches exactly — don't reimplement embed parsing.)

2. **Metadata badges row:**
   - `rating` → `<Badge>`
   - `genre` → `<Badge variant="secondary">`
   - `duration_minutes` → small `<Clock>` icon + `{duration_minutes} min`

3. **Description** → already present on the Showing page; keep it, position it consistently with the drawer (below the media + badges).

---

## Implementation notes

- **Reuse, don't duplicate.** The embed logic (`getEmbedUrl`, `isDirectVideo`) currently lives with the drawer. Consider extracting the media block into a small shared component (e.g. `ProductionMedia`) used by both the drawer and the Showing page, so the two never drift. If a shared component is too big a change right now, at minimum import the same helpers rather than copy-pasting them.
- **Poster is now full-res** (migrated to Supabase Storage), so the ticketing page will show high-quality art. Where large, constrain with sensible max-width/aspect handling as the drawer does.
- **Layout:** The Showing page has a purchase/checkout column already. Place the media + badges near the top of the informational column so the page reads: media → title → badges (rating/genre/runtime) → description → showings/'.buy' controls. Match the drawer's visual order for consistency.
- **Null-safety:** every field is nullable. Mirror the drawer's guards (`production?.rating && ...`, etc.) so missing data renders nothing rather than an empty badge.
- **Events/concerts:** these may lack `genre`/`rating`/`duration` — the same null guards handle that gracefully. Trailer/poster still apply.

---

## Acceptance criteria

- On `/showing/:id` for a **movie** with a trailer: the trailer embeds and plays, exactly as in the drawer.
- For a movie with a poster but no trailer: the full-res poster displays.
- Rating, genre, and runtime badges appear when present, are omitted when null.
- Description renders (unchanged) in a consistent position.
- Events/live performances render poster/trailer + description without breaking on missing genre/rating/runtime.
- No new network requests added (data already fetched).
- Ideally: drawer and Showing page share one media component, so future changes touch one place.

---

## Out of scope

- Pricing-tier display changes (tracked separately).
- Any checkout/seat-selection logic — untouched.
