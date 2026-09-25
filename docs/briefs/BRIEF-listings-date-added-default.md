---
brief: listings-date-added-default
title: After adding a movie or live event, Listings opens sorted by date added so the new title is on top
status: shipped
track: ux
date: 2026-09-24
shipped_in: ["#343"]
shipped_at: 2026-09-24
verified: true
---

# Brief (for Claude Code): Jump Listings to "Date added (newest)" right after adding a title

**Status:** 🟢 Small and surgical. **Supersedes the earlier "flip the default sort" version of this brief.** The page default stays exactly as it is today (Showtime, upcoming first); the sort switches to "Date added (newest)" only in the moment a new movie/event is created, so the thing the admin just added lands at the top. No dashboard logic changes — the redirect carries it.
**Date:** September 24, 2026
**Requested by:** Tom — keep the current default load, but once a team member adds a movie/show, automatically re-sort Listings to Date added (newest) so their new entry surfaces. (Accommodates a frequent admin user without changing the default for everyone.)

## Why this is the clean approach (verified, build `312a93b`)
- **The "Date added" sort already exists and works.** `AdminDashboard.tsx`: `SortOrder` includes `'newest' | 'oldest'` (L102), the Select offers "Date added (newest/oldest)" (L639–640), and `sortItems` sorts by `created_at` (L408–412), applied to Movies (L426) and Live Events (L439).
- **The dashboard already reads its sort from the URL.** `sortOrder` initializes from `searchParams.get('sort')` or `DEFAULT_SORT` (L180–181), and the active section/sub-tab come from `?section` / `?tab`. So a redirect that includes `?sort=newest` makes the dashboard open in newest order with **no dashboard code change**.
- **Adding a title happens on its own page and redirects back on save.** `MovieForm` create → `navigate('/admin')` (L115); `EventForm` create → `navigate('/admin?tab=live-events')` (L136). Both use `isEdit` to tell create from edit (MovieForm L23, EventForm L53). A brand-new row's `created_at` is strictly later than every existing row, so under "newest" it is guaranteed to be first.

Result: the only work is appending the right query params to the **create** redirect in two forms. `DEFAULT_SORT` stays `'showtime_desc'` — untouched — so every normal visit, reload, and return-from-edit is exactly as today.

## The change
### 1. MovieForm — on create, return to the movies list sorted newest
`src/pages/admin/MovieForm.tsx` ~L114–115: the post-save `navigate('/admin')` is shared by create and edit. Split it on `isEdit`:
- **Create** (`!isEdit`): `navigate('/admin?section=listings&tab=movies&sort=newest')`.
- **Edit**: keep `navigate('/admin')` (unchanged — editing must not re-sort).

### 2. EventForm — same, for live events
`src/pages/admin/EventForm.tsx` ~L136: `navigate('/admin?tab=live-events')` is shared. Split on `isEdit`:
- **Create** (`!isEdit`): `navigate('/admin?section=listings&tab=live-events&sort=newest')`.
- **Edit**: keep `navigate('/admin?tab=live-events')` (unchanged).

That's the whole feature. The dashboard already honors `sort`, `section`, and `tab`, so nothing there changes. `DEFAULT_SORT` is not touched.

### 3. (Optional polish) stable tiebreaker on the date sorts
The `newest`/`oldest` comparators (L408–412) have no fallback, so the bulk-imported batch (near-identical `created_at`) can shuffle order between loads. Give both a secondary sort by title — mirroring how `byShowtime` already falls back to `byTitle` (L386, L389). Not required for this feature (the freshly added row still tops the list on its own strictly-later timestamp), but it makes the rest of a newest/oldest view deterministic. Include or skip per Decision 2.

## What deliberately stays out
- **Default load is unchanged.** Showtime (upcoming first) remains the default and its rationale comment (L104–109) stays as-is. Only the post-create redirect carries `sort=newest`.
- **Editing a title does not re-sort** — only creating a new one does (gated on `!isEdit`).
- **Adding a *showtime* to an existing title is not included.** A showtime is added via `ShowingForm` against an existing movie/event; it doesn't create a new listing row and wouldn't move anything in a date-added order. Left out unless Tom wants otherwise (Decision 1). Concerts have no create path (edit-only), so they need no change.

## Decisions for Tom
1. **Scope of "add":** trigger the jump when a **movie or a live event** is created (recommended — those are the "add a listing" actions) vs. also after adding a showtime to an existing title (not recommended — it doesn't change date-added order).
2. **Tiebreaker:** add the title tiebreaker to the date sorts for stable ordering (recommended, tiny) vs. leave the comparators as they are.

## Test plan
- Opening the admin dashboard normally still shows **Showtime (upcoming first)**; a reload and a return-from-edit are unchanged; bookmarked `?sort=…` still works.
- **Creating a movie** returns to Listings → Movies tab sorted **Date added (newest)** with the just-created movie at the very top; the Sort control shows "Date added (newest)" selected.
- **Creating a live event** returns to Listings → Live Events tab sorted newest, new event on top.
- **Editing** an existing movie/event returns without changing the sort (still whatever it was / the default).
- Adding a showtime is unaffected (per Decision 1); concerts (edit-only) unaffected.
- With the tiebreaker (if chosen), the imported batch holds a stable title order across loads.
- `npm run build` + tests pass (add/adjust a test asserting the create redirect includes `sort=newest` and the edit redirect does not).

## Outcome (2026-09-24)

Built as recommended on both decisions: the jump fires only when a movie or a
live event is *created*; the title tiebreaker was added to both date sorts
(`byCreated` in `AdminDashboard.tsx`, mirroring `byShowtime`).

One deviation from the URLs above: the redirects are `/admin?sort=newest` and
`/admin?tab=live-events&sort=newest`, not the longer `section=listings&tab=movies`
form. Those two are the dashboard's defaults and its URL effect strips them on
first render, so the shorter form is what the address bar shows either way,
and it matches the existing `/admin` and `/admin?tab=live-events` redirects.

Tests: `MovieForm.test.tsx` and `EventForm.test.tsx` each gained a "where it
goes after saving" block asserting the create redirect carries `sort=newest`
and the edit redirect does not.

Walked through on staging (dev server, `--mode staging`, 2026-09-24) with a
throwaway movie, deleted afterwards:

- `/admin` cold: no `sort` param, control reads "Showtime (upcoming first)",
  top film is the one with the furthest-out showing. Unchanged.
- Create → landed on `/admin?sort=newest`, control reads "Date added
  (newest)", the new film is the first row, followed by the next-newest.
  Further down, the bulk-imported batch sits in title order — the tiebreaker.
- Edit the same film → landed on `/admin`, "Showtime (upcoming first)".
- Create a live event (throwaway, deleted afterwards) → landed on
  `/admin?tab=live-events&sort=newest`, Live Events tab active, "Date added
  (newest)", the new event is the first row.

When the sort goes back to showtime: the sort is nothing more than the
`?sort=` query parameter plus the matching Select state, so it lasts exactly
as long as the URL carries it. Anything that lands on a bare `/admin` — the
Admin nav link, a form's Back button, the redirect after an edit, a fresh
visit — is the default again; so is the list's Reset button. A reload or
browser Back onto a URL that still has `?sort=newest` keeps newest, which is
the same contract every other filter on the page has.
