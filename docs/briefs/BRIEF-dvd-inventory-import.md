---
brief: dvd-inventory-import
title: Restore the DVD inventory
status: shipped
track: data
date: 2026-08-13
shipped_in: ["65503b1"]
verified: true
---

# Brief (for Claude Code): Restore the DVD inventory

**Status:** ✅ Shipped and verified 2026-08-13 — 1,550 rows in `dvds` on both projects. See [Result](#result) for two things the brief did not anticipate.
**Date:** August 13, 2026
**Context:** The DVD inventory was uploaded on the old Lovable build (lbgk project) and never carried over to the current projects — the `dvds` table schema exists but is empty. The source spreadsheet has been transformed into a ready-to-import CSV.

## Goal
Load all 1,550 DVD titles into the `dvds` table on **production** (`vlmslygnimfbamrtwvyo`) and **staging** (`rpqzrpboyhshdrfdwayk`), so the `/dvds` page and the admin DVD Library are populated.

## ⚠️ Do NOT add a `format` column or change the DVD filters
The `/dvds` page (`src/pages/Dvds.tsx`) **already** filters by Year, Genre, **Format**, and Keyword. Format and Keyword are read out of the `notes` field by `parseNote`, whose regex is `` `${label}:\s*([^|]+)` `` — i.e. **pipe-delimited** segments. The CSV already stores them that way:

```
notes = "Format: DVD | Keywords: FRENCH"
```

So the Format/Keyword filters light up automatically on import. Adding a dedicated `format` column would **break** the working filter. Match the existing convention; do not refactor it as part of this task.

## The CSV
`dvds_inventory_import.csv` — header row + 1,550 data rows. Columns map 1:1 to the `dvds` insertable columns; `id`, `created_at`, `updated_at` are left to their defaults.

```
title, year, director, genre, synopsis, cover_url, copies_total, copies_available, rental_price, is_active, notes
```

Mapping already applied (for reference — no action needed):
- **title** ← Film Title (verbatim, incl. "- FRENCH"/"(1957)"); **year** extracted from a parenthesised year when present (33 rows).
- **genre** ← the spreadsheet's category columns, comma-joined (e.g. `CRITERION, INTERNATIONAL`).
- **notes** ← `Format: <DVD|BLU-RAY|4K-ULTRA>` and, when present, `| Keywords: <…>` (Hitchcock, Wes Anderson, French…). Nine titles found only on the "Original" tab also carry `| Source: Original tab`.
- **Defaults** (not in the sheet): `copies_total = copies_available = 1`, `rental_price = 3.00`, `director/synopsis/cover_url` blank, `is_active = true`.

## Import — pick one

**Option A — Supabase dashboard (simplest, one-shot).** For each project (`vlmslygnimfbamrtwvyo`, then `rpqzrpboyhshdrfdwayk`): Table Editor → `dvds` → Insert → **Import data from CSV** → upload `dvds_inventory_import.csv` → confirm the column mapping (names match) → Import. Only do this against an **empty** `dvds` table (it has no unique constraint on title, so a second import would duplicate).

**Option B — script (if automating).** Add `scripts/import-dvds.mjs`: read the CSV, insert via `@supabase/supabase-js` with the **service-role** key from env, in batches of ~500. Guard: **refuse to run if `dvds` already has rows** (query `count`) unless passed `--force`, so a re-run can't duplicate. Print inserted count. Run once per project (point `SUPABASE_URL`/`SERVICE_ROLE_KEY` at each). Do **not** commit any key.

## Verify
- `select count(*) from dvds;` → **1550** per project.
- `/dvds` lists titles; the **Format** filter offers DVD / BLU-RAY / 4K-ULTRA; **Genre** offers INTERNATIONAL, CRITERION, AWARD WINNER, …; **Keyword** offers HITCHCOCK, WES ANDERSON, …
- Spot-check: "12 ANGRY MEN (1957)" shows year 1957, genre CLASSIC, format DVD.

## Optional follow-ups (separate tasks, not required here)
- Add a **CSV import** button to the admin DVD Library tab (`DvdLibraryTab.tsx`) so a future reload is in-app, not a dashboard import.
- Expose a **Format** field in the admin add/edit form that reads/writes the `Format:` segment of `notes` (today format isn't editable there).
- If you ever want format as a first-class column, that's a migration + a refactor of the `Dvds.tsx` filter + the admin form — deliberately deferred so this restore stays low-risk.

---

## Result

Executed 2026-08-13 via Option B. `dvds` was empty on both projects beforehand; both now hold
exactly 1,550 rows, and all 1,550 are visible to the anon key (RLS is not filtering the table).
Spot-check passes: `12 ANGRY MEN (1957)` → year 1957, genre CLASSIC, format DVD.

Artifacts added: `scripts/import-dvds.mjs` (batches of 500, refuses a non-empty table without
`--force`, `--dry-run`), `scripts/lib/csv.mjs`, `scripts/data/dvds_inventory_import.csv` +
`README.md`, `scripts/normalize-dvds-csv.mjs`, `src/lib/fetchAllRows.ts`. No key is committed —
the service-role key was pulled from the Supabase Management API into the environment for the
run only.

### Two things the brief did not anticipate

**1. The CSV used `;`, not `|`, as the `notes` separator.** The brief states the CSV "already
stores them that way" in pipe-delimited form, but the delivered file contained zero `|`
characters — 43 rows read `Format: DVD; Keywords: HITCHCOCK`. Since `parseNote` matches
`` `${label}:\s*([^|]+)` ``, `Format:` would have captured the entire remainder, giving the
Format dropdown 30+ junk options and hiding those 43 titles from the real `DVD` / `BLU-RAY`
options. Fixed in the data to match the brief's own stated spec; only the `notes` column
changed, verified field-by-field. Details and the surviving source-data quirks (17 rows with no
format, `DVD X2`, `SAME?`, 17 repeated titles) are in `scripts/data/README.md`.

**2. Loading 1,550 rows crossed PostgREST's 1,000-row response cap.** `Dvds.tsx` and
`DvdLibraryTab.tsx` selected `dvds` with no `.range()`, so the page silently received 1,000 of
1,550 titles — everything alphabetically after `NOVO - FRENCH` vanished, along with any
Genre/Format/Keyword option unique to those rows. This was invisible while the table was empty
and would have looked like a bad import. Fixed with `src/lib/fetchAllRows.ts`, which pages until
a short page comes back; applied to the three unbounded `dvds` selects. The filters themselves
were not touched, per the constraint above.

Typecheck (`tsc -p tsconfig.app.json --noEmit`) and `vitest run` (111 tests) pass; a staging
build succeeds.

### Follow-up, same day: format cleanup and list-only layout

The Format filter exposed five values that weren't formats. On the box office's instruction:
the six combined-format rows (`DVD / BLU-RAY`, `DVD + BLU-RAY`, `DVD/BLU-RAY`) were **split
into two rows each**, since those titles are held on both discs — which is how the source
spreadsheet already listed 15 other dual-format holdings. `DVD X2` (a double-disc set) and
`SAME?` (a stray annotation) became plain `DVD`. Applied to the CSV by
`scripts/normalize-dvd-formats.mjs` and to both live tables by `scripts/data/fix-dvd-formats.sql`.

**Both projects now hold 1,556 rows** and the Format filter offers exactly DVD / BLU-RAY /
4K-ULTRA. The CSV and both databases were verified identical on `(title, notes)`.

`/dvds` is now **list-only** — the grid layout was removed. Poster sourcing was dropped:
TMDB's API terms exclude "charging users a fee for Your Application" that uses TMDB content,
and the $3 rental fee sits in the same flow, so the free tier doesn't cleanly cover this use
(commercial licensing is $149/mo). `cover_url` remains settable per title in the admin form,
and the list keeps an artwork slot for it.

Two exact duplicate listings survive and are unresolved — see `scripts/data/README.md`.
