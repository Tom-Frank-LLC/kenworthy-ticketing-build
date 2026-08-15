# Deferred: the screened-films Archive

The searchable record of films that have screened at the Kenworthy
(`historical_screenings`) was **turned off across the platform on August 14, 2026**
so it wouldn't ship with the launch. Nothing about it is user-visible anymore.

This folder is the complete preservation bundle: code, data, schema, and the
steps to bring it back. Everything needed to restore the feature is here or in
the git tag below.

**Not part of this removal:** the History page's milestone photos and text. Those
come from `kenworthy_history` plus a hardcoded `SEED` list and are untouched — the
History page still renders the full timeline, just without films on it.

## Where the original code lives

Git tag **`deferred/archive-feature`** points at the last commit where the feature
was whole (`06af6ac`). That's the authoritative copy, with full history and
context:

```bash
git show deferred/archive-feature:src/pages/History.tsx
git diff deferred/archive-feature <the-removal-commit> -- src/
```

`code/` here mirrors the same files at repo-relative paths, so a restore can be a
straight copy-back. `code/src/pages/History.tsx` and
`code/src/components/history/HistorySearch.tsx` are the *pre-removal* versions —
they were edited rather than deleted, so keep them for reference but re-apply by
diff, not by blind overwrite (both have since picked up unrelated changes).

## What the DB looks like right now

**The table was left dormant, not dropped.** `public.historical_screenings` still
exists in production and staging with all 21,452 rows intact. No application code
reads it. That makes the restore path short and means the data is not riding on
the export files alone.

Because the table still exists, `src/integrations/supabase/types.ts` still
contains its generated types. That is correct and intentional — those types are
generated from the live schema, so hand-removing them would only cause drift and
be undone by the next regeneration.

## Contents

| Path | What it is |
| --- | --- |
| `code/` | Every removed/edited source file, at repo-relative paths |
| `data/historical_screenings.csv.gz` | All 21,452 rows, CSV, exported from **production** |
| `data/historical_screenings.sql.gz` | The same rows as re-insertable `INSERT`s (idempotent) |
| `schema/restore-historical-screenings.sql` | DDL to recreate the table — only needed if it is ever dropped |
| `schema/ORIGINAL-creating-migration.sql` | Copy of the migration that first created it, for reference |

Unpack the data files with `gunzip -k data/historical_screenings.sql.gz`
(they're compressed to keep ~9 MB of text out of the repo).

### A trap in the original migration

`supabase/migrations/20260608170228_b912e070-bc5f-4c18-a3be-523daf12956a.sql`
creates **three** tables: `historical_screenings`, `kenworthy_history`, and
`financial_entries`. The latter two are live and unrelated to the archive.

**Do not re-run that migration to restore the archive** — it would fail on the
existing tables. Use `schema/restore-historical-screenings.sql`, which is the
`historical_screenings`-only subset.

## How to restore

### 1. The data (only if the table was dropped)

It wasn't, as of this writing — check first:

```bash
psql "$DB_URL" -c "SELECT count(*) FROM public.historical_screenings;"
```

If that returns 21452, skip to step 2. If the table is gone:

```bash
psql "$DB_URL" -f schema/restore-historical-screenings.sql
gunzip -c data/historical_screenings.sql.gz | psql "$DB_URL"
```

The data file is wrapped in a transaction and uses `ON CONFLICT (id) DO NOTHING`,
so re-running it is safe and won't duplicate rows.

### 2. The code

```bash
git checkout deferred/archive-feature -- \
  src/components/admin/ArchiveTab.tsx \
  src/components/PreviouslyScreened.tsx \
  src/components/history/FilmArchiveTable.tsx \
  src/lib/normalizeTitle.ts \
  src/lib/parseHistoricalXlsx.ts \
  src/lib/parseHistoricalXlsx.test.ts \
  supabase/functions/match-historical-screenings/
```

Then re-apply the three integration points by diffing against the tag:

- **`src/pages/admin/AdminDashboard.tsx`** — the `ArchiveTab` import, the
  `{ value: 'archive', … show: isSuperadmin }` entry in `topTabs`, the
  `<TabsContent value="archive">` block, and `Archive` in the `lucide-react` import.
- **`src/pages/Showing.tsx`** — the `PreviouslyScreened` import and its render,
  guarded by `productionType === 'movie' && showing?.movie_id`.
- **`src/pages/History.tsx`** — the paginated `historical_screenings` fetch, the
  `screeningsByYear` and `filmIndex` memos, the `screenings`/`onSeeMore` props
  threaded through `TimelineItem` → `ItemCard`, the "On screen that year" chip
  list, and the `<FilmArchiveTable>` block with its `yearFilter`/`tableQuery` state.
- **`src/components/history/HistorySearch.tsx`** — the `films` prop, the
  `SearchFilm` type, and the `'film'` and `'year'` arms of `HistorySearchResult`.
  Search currently returns milestones only.

### 3. The edge function

`match-historical-screenings` was deleted from the production project on
August 14, 2026 (it was never deployed to staging). Redeploy it:

```bash
supabase functions deploy match-historical-screenings --project-ref <ref>
curl -i https://<ref>.supabase.co/functions/v1/match-historical-screenings  # confirm it boots
```

It is invoked only by `ArchiveTab`, to auto-match archive rows to `movies`.

## One thing worth knowing before you restore

At the time of removal, **every one of the 21,452 rows had `matched_movie_id` set
to NULL** — the matching job had never been run against this data.

`PreviouslyScreened` filters on `matched_movie_id`, so it was rendering nothing on
every showing page; removing it changed nothing visually. If the feature comes
back and you want that block to actually appear, run the
`match-historical-screenings` function first and confirm rows get matched.
