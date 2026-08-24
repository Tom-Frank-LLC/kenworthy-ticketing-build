# Brief (for Claude Code): Build the Silent Film Festival page

**Status:** 🟢 New public page. The route exists but renders a placeholder.
**Date:** August 18, 2026
**Requested by:** Tom — a `/silent-film-festival` page that (1) lets the public **review past years' festival programs** (PNG + PDF archival files), (2) **sells the current-year festival pass**, and (3) **shows the current-year screenings** with info and ticketing links (deliberately redundant with the calendar).

## Current state (verified)
- **The route is a stub.** `App.tsx:126` maps `/silent-film-festival` → `SilentFilmFestivalPage`, but that's exported from `ComingSoon.tsx` (`App.tsx:63`) — a placeholder. This brief replaces it with the real page (new `src/pages/SilentFilmFestival.tsx`, wire the route to it).
- **Reusable patterns already in the repo — build on these, don't invent:**
  - **File archive:** `ConcessionMenusTab.tsx` is the template — a storage bucket (`concession-menus`) + a table (`concession_menus`, with `file_path`) + admin upload (`storage.upload` then table insert) + preview + remove. Mirror it for festival programs.
  - **Festival passes:** `film_pass_types` + `pass_type_showings` (migration `20260814093200_pass_eligibility_by_type.sql`) already model a festival pass as a pass type whose `pass_type_showings` rows point at the festival's screenings. Reuse this — the festival's current-year screenings **are** the showings linked to the Silent Film Festival pass type.
  - **Pass purchase UI:** `src/pages/FilmPasses.tsx` already sells passes — reuse its purchase flow scoped to the SFF pass type.
  - **Ticket links:** each screening links to `/showing/:id` (`Showing.tsx`), the same page the calendar links to.

## Part A — Program archive: data model + storage
1. **Storage bucket** `festival-programs`, **public read** (these are meant for public review, so use `getPublicUrl` like `posters`, not the signed-URL flow the menus tab uses for admin preview). Admin-only write via RLS/policies.
2. **Table** `festival_programs`:
   - `id uuid pk`, `festival_slug text not null default 'silent-film-festival'` (so the same mechanism can serve other festivals later — see Decision 4), `year int not null`, `title text`, `file_path text not null`, `file_type text check (file_type in ('pdf','image'))`, `display_order int default 0`, `is_published boolean default false`, `uploaded_by uuid`, `created_at timestamptz default now()`.
   - **RLS:** public `SELECT` where `is_published = true`; `INSERT/UPDATE/DELETE` gated by `has_role(auth.uid(),'admin')` — the same pattern as `concession_menus`.

## Part B — Admin management (mirror `ConcessionMenusTab`)
A new admin tab (e.g. "Festival Programs") to: upload a program file (choose **year**, **title**, PDF **or** image), set display order, **publish/unpublish**, preview, and remove (delete storage object + row). Accept both `application/pdf` and image types (`image/png`, `image/jpeg`); set `file_type` accordingly. Tom uploads his archival PNGs/PDFs here — no files ship with this brief.

## Part C — The public page (`/silent-film-festival`)
Three sections, top to bottom:

1. **Hero / about** — festival name, a short blurb, current-year dates. (Copy is content — leave a clearly-marked editable block; Tom supplies final wording.)
2. **This year** —
   - **Buy the festival pass:** surface the current-year Silent Film Festival pass type and let people buy it **inline**, reusing the `FilmPasses` purchase flow scoped to that pass type (fallback link to `/film-passes`). Use the green `--success` "Get Tickets/Buy" treatment per the design tokens.
   - **Screenings:** list the festival's current-year screenings (title, date/time, short synopsis if available), each with a **"Get Tickets"** button → `/showing/:id`. Source these from the showings linked to the SFF pass type via `pass_type_showings` (single source of truth; falls back to none/empty-state gracefully before the year is set up). Show an empty-state ("This year's lineup is coming soon") when there are no current-year screenings.
3. **Past programs archive** — the published `festival_programs` for `silent-film-festival`, **grouped by year** (newest first). Render image programs as thumbnails that open full-size; PDFs as a labeled card that opens/downloads in a new tab. Keyboard-accessible, alt text = "{year} Silent Film Festival program".

## Cross-cutting
- **Readability & mobile:** this is a public, patron-facing page — honor the larger default type/contrast work (`BRIEF-readability-font-size.md`) and the mobile layout guidance; archive thumbnails should reflow cleanly at ~375px.
- **Nav:** add the page where the other content pages live in the header/footer nav (confirm placement — Decision 5).
- **Performance:** lazy-load archive images; don't ship megabytes of program scans on first paint.
- **Reuse, don't fork:** import the existing pass-purchase and showing-card components rather than reimplementing; keep reconciliation/checkout untouched.

## Decisions for Tom
1. **Which pass type is "the Silent Film Festival pass"?** Identify by exact `film_pass_types.name`, or add a small `festival_slug`/`kind` marker on the pass type so the page finds it reliably (recommended — names drift; the Square catalog even has the SFF pass **three times**). This also fixes which screenings appear (via `pass_type_showings`).
2. **Pass purchase: inline vs link.** Recommend inline on the festival page, with a fallback link to `/film-passes`.
3. **Screening source:** `pass_type_showings` of the SFF pass type (recommended) vs a title match (`"Silent Film Festival:%"`) vs a manual pick. The pass linkage keeps "what the pass covers" and "what's listed" identical.
4. **Generalize now or later?** The `festival_slug` column makes this reusable for the Palouse French Film Festival etc. Build SFF-only now, keep the door open (recommended), or build a generic festival page shell?
5. **Nav placement + URL:** keep `/silent-film-festival`; where in the nav (under an "Events"/"Festivals" group, or top-level)?
6. **Past screenings in the archive?** Just the program files (recommended), or also list past years' screening lineups as text?

## Test plan
- `/silent-film-festival` renders the real page (not ComingSoon); route points to the new component.
- **Archive:** an admin uploads a PDF and a PNG for a past year → both appear publicly, grouped by year, only when **published**; unpublish hides them; remove deletes the file and row; a signed-out visitor can view published programs and cannot see unpublished ones (RLS).
- **Pass:** the current SFF festival pass is purchasable from the page; a completed purchase creates the pass (reuses the existing flow; no checkout regressions).
- **Screenings:** current-year festival screenings list with correct date/time and a working "Get Tickets" link to `/showing/:id`; empty-state shows before the lineup exists.
- **A11y/mobile:** images have alt text and are keyboard-navigable; layout holds at 375/768/1280; type/contrast match the readability defaults.
- RLS: public read limited to published rows; only admins can upload/change; `npm run build` + tests pass.
