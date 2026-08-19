---
brief: concessions-square-overpull
title: 🚨 EMERGENCY — Square catalog over-pull flooded concessions on the LIVE site
status: shipped
track: bug
date: 2026-08-14
shipped_in: ["#78", "20e5d3f", "5b5ab23"]
verified: true
---

# Brief (for Claude Code): 🚨 EMERGENCY — Square catalog over-pull flooded concessions on the LIVE site

**Status:** ✅ Shipped — the Concessions tab was hidden until it could take payment (`20e5d3f`, PR #78) and the push disabled (`5b5ab23`).
**Date:** August 14, 2026
**Requested by:** Tom — (1) remove the remaining entries from the live home page NOW, then (2) find the root cause and fix it so a pull can't do this again.

---

## PART 1 — IMMEDIATE removal (do this first, on PRODUCTION)

### Why manual didn't finish it (verified)
- The home page renders `concession_items WHERE is_active = true` (`src/components/home/ConcessionsPreview.tsx:37–42`), ordered `category, price`, **unpaginated → capped at PostgREST's 1000 rows.**
- The **admin** list `ConcessionItemsTab.loadItems()` (`src/components/admin/ConcessionItemsTab.tsx:53–57`) is **also unpaginated** → it only ever showed the first ~1000 (ordered `category, name`). So thousands were pulled, but the admin UI could only display ~1000 of them — **the leftovers on the home page are rows Tom never saw in the admin list.** Clicking one-by-one can't win this; a bulk DB fix can.

### The clean lever (verified in schema)
Every Square-imported row carries a **non-null `square_catalog_id`** (and `square_synced_at`); hand-created concessions have `square_catalog_id = NULL` (`concession_items` schema + `square-catalog-sync/index.ts:122`, `upsert onConflict: 'square_catalog_id'`). So the Square junk is exactly `square_catalog_id IS NOT NULL`.

**Step 1 — count first (sanity check), on the PROD Supabase SQL editor:**
```sql
SELECT count(*) FILTER (WHERE is_active) AS still_active,
       count(*)                          AS total_square_rows
FROM concession_items
WHERE square_catalog_id IS NOT NULL;
```
**Step 2 — deactivate all Square-pulled items in one shot:**
```sql
UPDATE concession_items
SET is_active = false
WHERE square_catalog_id IS NOT NULL AND is_active;
```
This leaves genuine hand-made concessions (null `square_catalog_id`) untouched. **Deactivate, don't delete yet** — reversible, and deleting Square-synced rows risks them being re-pulled/re-activated if anyone hits the button again before Part 2 lands.

**Step 3 — confirm the home page is clear.** `ConcessionsPreview` refetches on load and hides itself when `items.length === 0` (L70), so once no Square rows are active it disappears (assuming the real concessions are also currently inactive; if Tom wants the *real* stand shown, re-activate only those). **Watch the PWA cache:** the site's service worker can serve a stale home page (the known network-first issue). Verify in a fresh/incognito load or after a hard refresh; if it persists, bump the SW/cache version so live visitors get the corrected page without a manual refresh.

### Optional faster containment
If for any reason the SQL can't run immediately, the fallback is to set **all** concessions inactive (`UPDATE concession_items SET is_active=false;`) to clear the public page, then selectively re-activate the few real items — but the scoped `square_catalog_id` update above is precise and preferred.

---

## PART 2 — Root cause & fix (so a pull can't nuke the site again)

### What happened (verified in `supabase/functions/square-catalog-sync/index.ts`)
1. **It imports the ENTIRE Square catalog with no scoping.** The `pull` action lists `types: "ITEM,CATEGORY"` from `/catalog/list` (L97–100) and upserts **every ITEM** into `concession_items` (L110–135). The Kenworthy's Square catalog contains their whole sales history — movies, events, merch — so all of it became "concessions."
2. **It auto-activates everything:** `is_active: !o.is_deleted` (L129) → every non-deleted Square item imported **active** → instantly public on the home page. No staging/review.
3. **It reuses Square CATEGORY names as the concession `category`** (L106, L116–117), so "Movies / Events / Merchandise" showed up as concession categories.
4. **No guardrail on the button.** `ConcessionItemsTab` "Pull from Square" (L72, L236) fires the pull with no dry-run, no count, no confirmation — one click imported thousands, onto a live site.

### The fix
1. **Scope the import to actual concessions (the core fix).** Only import items in a designated Square **category** (e.g., a "Concessions" category id) or a specific **location/catalog** — never arbitrary `ITEM`s. Make the concessions category/location id configurable (`app_config` or a function env var). Filter server-side in the pull so nothing outside that scope is ever written. **Decision 2 below: Tom needs to tell us which Square category/location = concessions.**
2. **Never auto-activate on import.** On upsert, **do not flip `is_active`**: for a *new* row default `is_active = false` (staged); for an *existing* row **preserve** its current `is_active` (don't overwrite from `!is_deleted`). Let an admin activate deliberately. This alone would have prevented the public flood even with a bad scope.
3. **Add a confirmation / dry-run to the button.** First return "N items will be imported from category X" and require an explicit confirm; refuse or warn on an unexpectedly large N (e.g. > 100) so a mis-scoped pull can't silently mass-import.
4. **Fix the 1000-row cap on both concessions queries** (same bug class as the movie-picker brief): page `ConcessionItemsTab.loadItems` and `ConcessionsPreview` with the repo's `fetchAllPages` helper, so admins can actually see/manage every row and nothing hides past the ceiling. (Without this, even a correct dataset > 1000 is unmanageable.)
5. **Sandbox vs production.** The function is hardcoded to Square **sandbox** (`connect.squareupsandbox.com`, sandbox token — L13, L30). Reconcile with `BRIEF-square-production-cutover.md`: make it env-aware, and re-verify the scoping + no-auto-activate behavior against the **production** catalog before any prod pull. Given the domain is now live, treat every Square pull as production-affecting.

### Cross-references
- `BRIEF-square-production-cutover.md` (platform-wide Square audit before going live in Square) — this incident is a concrete finding for it.
- `BRIEF-showing-movie-1000-cap.md` — same 1000-row cap bug class; share the `fetchAllPages` fix.
- The earlier "Pull from Square → Sync failed" note (generic client error hiding the real message) — improve the error surface while in here.

---

## Decisions for Tom
1. **Deactivate vs delete the Square rows:** deactivate now (recommended, reversible), then delete the non-concession ones later **after** the sync is scoped/fixed. Or delete now? (Delete-now risks re-import if the button is hit again pre-fix.)
2. **Which Square category/location is "concessions"?** Required to scope the import — the category id (or name) or the location id. Everything else must be excluded.
3. **Import default:** new items staged **inactive** (recommended) vs. some other default; and confirm we should **preserve** existing `is_active` on re-pull.
4. **Real concessions:** do you want the genuine hand-made concession items shown on the home page now, or kept off until launch? (The bulk update only touches Square rows; the real ones keep whatever state they're in.)

## Test plan
- **Part 1:** after the `UPDATE`, `SELECT count(*) FROM concession_items WHERE square_catalog_id IS NOT NULL AND is_active` returns **0**; the live home page shows **no** stray concession entries (verified on a fresh load / cache busted).
- **Part 2:** a "Pull from Square" now (a) imports **only** items in the concessions scope, (b) imports them **inactive** (or preserves state) so nothing appears publicly without an admin activating, (c) shows a count/confirm before writing, (d) the admin list and home preview both display **all** rows (no 1000 cutoff). Re-running a pull twice is idempotent and never re-activates or re-floods.
- Regression: real hand-made concessions (null `square_catalog_id`) are never touched by the sync; `npm run build` passes.
