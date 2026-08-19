---
brief: restore-history-movies
title: Restore Per-Year Movies on the History Page
status: shipped
track: ux
date: 2026-08-12
verified: false
---

# Brief: Restore Per-Year Movies on the History Page

**Status:** ✅ **Done — imported to production and staging (Aug 13, 2026)**
**Date:** August 12, 2026 · executed August 13, 2026
**Reported by:** Tom — the Lovable build listed movies that screened during each year; wants that restored.

---

## Outcome (Aug 13, 2026)

Tom supplied the workbook from Dropbox (`TOM FRANK LLC/KENWORTHY/site build/`).
**21,452 rows imported to production and staging** — 10,028 of them Kenworthy,
spanning all 100 years 1926–2025 with no gaps.

| Venue | Rows | Years |
|---|---|---|
| Kenworthy | 10,028 | 1926–2025 |
| Nuart | 4,150 | 1935–2000 |
| Cordova | 2,537 | 1958–2005 |
| Big Sky | 2,375 | 1958–1983 |
| Audian | 1,613 | 1958–1996 |
| Vandal | 749 | 1926–1935 |

Those venue lifespans corroborate the workbook's own annotation columns
("Vandal closes" 1935, "Big Sky closes" 1983), which is independent evidence the
venue attribution is right.

### The parser silently dropped 20 years — fixed before importing

`parseHistoricalXlsx.ts` skipped any column whose header was blank. **From 2006
the workbook stops labelling venues** (the Kenworthy is the only theater left in
the list), so those sheets carry a bare `Date` header. The importer would have
reported success and silently dropped **2,220 cells across 2006–2025** — the most
recent and most relevant fifth of the archive.

Fix: an unlabelled *first* column is the Kenworthy. This is derived, not guessed —
column 1 reads exactly `"Kenworthy"` in all 80 labelled sheets, and is blank only
in the contiguous 2006–2025 block, which names no venue anywhere. Later unlabelled
columns stay excluded: they hold annotations, not screenings ("Kenworthy closes for
renovations", "*Kibbie Dome drive-in", "* First in 3-D"). Covered by
`src/lib/parseHistoricalXlsx.test.ts`.

**Not imported:** ~85 film-like cells under unlabelled columns at index ≥2
(1926 col E, 1944 col D). They belong to an unidentifiable venue, so guessing one
would be inventing data. They do not affect `/history`, which is Kenworthy-only.

### Also shipped

- **Searchable film table** on `/history` (`FilmArchiveTable.tsx`) — 8,749 distinct
  films with screening counts and the years each played, searchable by title,
  filterable to a single year, 25 per page.
- **Timeline badges capped at 10** (was 24), with "See all N films from YYYY"
  linking into the table filtered to that year.
- **Per-year badge de-duplication.** One row per screening *date* means a week-long
  run produced seven identical badges — 2019 showed "Boy Erased" three times and
  filled 10 slots with 7 films. Years now collapse to distinct films, which also
  makes the "see all N" count agree with the table.

### Still true, and unchanged

Badges only appear on years that have a timeline milestone. `kenworthy_history` is
empty in production, so only the 26 hardcoded `SEED` years render — about 23 of them
have screenings. **Tom's call: leave milestones as-is**; the full archive is reachable
through the film table instead. The other ~77 years of data are in the table and feed
the Showing page's archive cross-links.

### Sequencing risk is now cleared

The archive is populated, so the Archive-removal brief is no longer blocked by this
one. Keep in mind `ArchiveTab` remains the only *re-import* path.

---

## Diagnosis executed (Aug 13, 2026) — the brief's hypothesis was correct

**`historical_screenings` is empty in BOTH production and staging. Zero rows.**

| Environment | Project ref | Row count |
|---|---|---|
| Production | `vlmslygnimfbamrtwvyo` | **0** |
| Staging | `rpqzrpboyhshdrfdwayk` | **0** |

Measured over the REST Data API with each environment's publishable key
(`Prefer: count=exact` → `content-range: */0`, `HTTP 200`).

**This is not an RLS artifact.** The migration grants `SELECT` on the table to
`anon` and defines `CREATE POLICY "Anyone can read historical screenings" …
USING (true)` — an unconditional read policy. An anon client sees every row that
exists, so zero returned means zero present. (This is the opposite of the
`showings` table, where RLS *does* hide most rows from the anon key — worth not
confusing the two.)

**Corollary:** the `venue_name = 'Kenworthy'` mismatch theory (step 3 of the
original recommendation) is moot — there are no rows of *any* venue to mismatch.
It becomes relevant again only *after* an import; see the caveat below.

### Code claims re-verified — all accurate, nothing to build

- `History.tsx:496-498` paginates `historical_screenings` filtered to
  `venue_name = 'Kenworthy'`, ordered by year.
- `History.tsx:532` builds `screeningsByYear`; `:595` passes it per milestone.
- `History.tsx:447` renders the **"On screen that year"** heading, with
  `film_title_display` + `film_year` badges capped at 24 and a "+N more" tail
  (`:456-470`).
- `ArchiveTab` is still imported and rendered
  (`AdminDashboard.tsx:19`, `:867`) — the importer is intact and reachable.

**So the page is fully built and will light up the moment the table has rows.**

### The blocker: the source workbook could not be located

Searched, all negative:

- Repo working tree and **entire git history** — no `.xlsx`/`.xls`/`.csv` has
  ever been committed.
- `~/Downloads`, `~/Desktop`, `~/Documents` — no matching workbook.
- The connected Google Drive account — searched by title (`Palouse`,
  `Full List of Movies`, `Theaters`, `1926`), by spreadsheet MIME type, and by
  `kenworthy.org` owner. The only Kenworthy spreadsheets present are
  *Kenworthy Video Collection* (a DVD/Blu-ray inventory — different data) and
  the *Income and Expenses* books.

**Tom needs to supply "Full List of Movies at Palouse Theaters 1926–2026."**
Nothing else blocks this task.

### Confirmed: the root SQL files are NOT this data

`kenworthy_import_full.sql`, `kenworthy_fix.sql`, and `kenworthy_showings_fix.sql`
contain **zero** references to `historical_screenings`. Their hundreds of
"Palouse" hits are venue-name strings in the operational `movies`/`showings`
import — exactly the confusion this brief warned about. They cannot be reused.

### Caveat for when the workbook arrives

`parseHistoricalXlsx.ts:48,58,71` takes `venue_name` **verbatim from each
sheet's column header**. `History.tsx:498` filters on the exact string
`'Kenworthy'`. If the workbook's column reads "Kenworthy Theatre" or
"The Kenworthy", the import will succeed and the page will still render nothing.
**Verify `SELECT DISTINCT venue_name` immediately after importing**, before
concluding anything is wrong.

### Sequencing risk is now live

`ArchiveTab` is the table's **only** load path. Because the table is empty,
the Archive-removal brief **must not be executed until this import is done** —
removing it first destroys the only way to load this data.

> **Headline finding.** The code that shows "the movies that screened each year"
> **already exists in `History.tsx` today** — this was not lost in the migration
> off Lovable. And the data does **not** come from Lovable; it comes from a
> spreadsheet ("Full List of Movies at Palouse Theaters 1926–2026") loaded through
> the Archive importer into the `historical_screenings` table. So "restore" almost
> certainly means: **make sure that table has rows in production.** One query
> settles it.

---

## Current state (file:line) — the feature is implemented

`src/pages/History.tsx` is not just archival photos. It already:
- fetches `kenworthy_history` milestones and merges them with a hardcoded `SEED` array (`:485-489`, `:523-530`);
- paginates `historical_screenings` where `venue_name = 'Kenworthy'`, ordered by year (`:491-505`);
- groups them into a `screeningsByYear` map (`:532-539`);
- renders per-year **distinct movie badges** under an **"On screen that year"** heading — `film_title_display` + `film_year`, capped at 24 with "+N more" (`ItemCard`, `:439-471`).

The same data also powers the Showing page's "From the Kenworthy archive" block (`PreviouslyScreened.tsx:16-22`), joining `historical_screenings.matched_movie_id → movies.id`.

## Where the data comes from (answering your question directly)

**Not from Lovable — from a spreadsheet, loaded via the Archive tool.**
- No migration seeds `historical_screenings` (searched all migrations — no `INSERT`). The table is created empty.
- The only load path is the ArchiveTab xlsx import (`ArchiveTab.tsx:62-87` → `parseHistoricalXlsx.ts:33`), parsing the "Full List of Movies at Palouse Theaters 1926–2026" workbook.
- Schema: migration `20260608170228_…sql` — columns `screening_date, year, venue_name, film_title_normalized, film_title_display, film_year, is_double_feature, matched_movie_id`.

**Do not confuse this with the "383 multi-day showings / `days` field" import.** That work populated the operational `showings`/`movies` tables (calendar + analytics) via `kenworthy_showings_fix.sql`. The history page reads the **separate** `historical_screenings` archive. Different tables, different data.

## The one query that decides everything

Run against **production**:
```sql
SELECT venue_name, COUNT(*) AS rows, MIN(year) AS first_year, MAX(year) AS last_year,
       COUNT(*) FILTER (WHERE matched_movie_id IS NOT NULL) AS matched
FROM historical_screenings
GROUP BY venue_name;
```

- **Rows present across 1926–2026 for `Kenworthy`** → nothing to restore; the History page already shows the per-year movies. If it *looks* empty on the live site, the likely cause is the `venue_name = 'Kenworthy'` filter not matching the imported label (check what `venue_name` values actually exist) rather than missing data.
- **Zero rows** → the fix is a **data import, not a Lovable retrieval**: re-run the "Full List of Movies…" xlsx through ArchiveTab (**before** removing it per the Archive brief), or load the workbook via SQL. Then optionally re-run title matching to populate `matched_movie_id` (that only affects the Showing-page cross-links, not the History-page badges, which render from `film_title_display`).

## Recommendation

1. **First**, run the count query. This is the whole diagnosis.
2. If empty: import the workbook via ArchiveTab **before** the Archive-removal brief is executed. (If you no longer have the xlsx, that's the one thing that might need retrieving — from wherever the original "Palouse Theaters 1926–2026" list lives, not necessarily Lovable.)
3. If populated but not showing: inspect `SELECT DISTINCT venue_name FROM historical_screenings` and reconcile with the `= 'Kenworthy'` filter in `History.tsx:494-505` (the imported label may differ, e.g. "Kenworthy Theatre").
4. Consider moving the per-year grouping to a server-side view/`group by` if the table is large enough that client-side pagination feels slow — optional.

## Risk / sequencing
The Archive tool is the only importer for this table. **If the table is empty, import before removing Archive** (Brief: remove Archive section). If populated, the two briefs are independent.

## How to verify
- Count query returns Kenworthy rows spanning the expected years.
- `/history` shows "On screen that year" badges on years with data.
- A current movie with a historical match shows "From the Kenworthy archive" on its `/showing/:id`.
