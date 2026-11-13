---
brief: archive-listings
title: The film archive is back, every archive film is a listing, and the History timeline is editable
status: built
track: feature
severity: P2
date: 2026-11-13
verified: false
supersedes: remove-archive-section
---

# Brief: restore the film archive, list every archive film, make the History timeline editable

**Requested by:** Tom, 2026-11-13.

1. "We previously had editable milestones for the history page… does it still exist?" No.
   It was a card inside the superadmin **Archive** tab, and it went when that tab was
   removed on 2026-08-14 (`9eb7448`, brief `remove-archive-section`).
2. Bring back the film archive and the milestone editor, and let staff edit each
   milestone's text and photo.
3. Create a movie listing, with a showing on its date, for every film in the archive.
   Cross-reference it against our existing listings first.

## What we found

| Fact | Evidence |
|---|---|
| `kenworthy_history` had **0 rows** in production and staging. All 26 milestones on /history came from a `SEED` array in `History.tsx`. So the old editor could add milestones but could never change one that was on the page. | anon `count=exact` against both projects, 2026-11-13 |
| The archive holds 10,028 Kenworthy screenings (1926 to 29 Nov 2025): 8,721 distinct films (title + release year) under 8,417 distinct titles. 99% of rows have a release year. The dates are real opening dates. | staging SQL |
| `matched_movie_id` was NULL on every row. The edge function `match-historical-screenings` that was supposed to fill it **could never finish**: on each pass it re-read "the first 500 unmatched rows", and a row that didn't match stayed unmatched, so the same batch came back forever. | code reading, `deferred-archive/code/supabase/functions/…` |
| `PreviouslyScreened` said "Last played here on" and then printed the **earliest** date. | code reading; now covered by `src/lib/screeningHistory.test.ts` |
| None of our movies has `release_year` set, so matching our listings to the archive can only use the title. | staging: `count(release_year) = 0` |
| Visitors (anon) can read **every past showing**: the policy includes `start_time < now()`. They can read only **active** movies. | `pg_policies` |
| The SQL normalisation matches `src/lib/normalizeTitle.ts` on **all 21,452** archive rows (0 mismatches). | staging, inside a rolled-back transaction |

## Decisions (Tom, 2026-11-13)

- **Overlap:** where we already have our own showing of the film during the archive run
  (3 days before to 14 days after the opening date), keep ours and don't make an archival
  showing. The archive row is still linked to the movie.
- **Visibility:** archival listings are **public**. For now they appear only on the
  History page. The calendar may later reach back far enough to show them; until then
  `useCalendarHistory` filters out `is_archival`, and removing that one filter turns it on.
- **Significance:** when a current showing is a film that last played here decades ago,
  the showing page says so: "Back on our screen for the first time in N years".
- **Time:** the archive has dates only, so archival showings are set to 7:00 PM Pacific
  as a placeholder. The showing page hides the time for them.
- **Dashboard cost:** we accept it, and keep it small (see below).
- **Tied to the movie:** an archive film we already list joins **that** movie, so the
  history goes wherever the current listing goes.

## What was built

**Migrations**
- `20261113214659_kenworthy_history_seed.sql` inserts the 26 seed milestones (idempotent,
  keyed on year + title). The photos moved from Vite-hashed imports to stable paths under
  `public/images/history/`.
- `20261113223015_archive_listings.sql` adds:
  - `normalize_film_title()`;
  - `movies.is_archival`;
  - `showings.historical_screening_id` (unique, ON DELETE CASCADE) and a generated
    `showings.is_archival`;
  - partial indexes for the live-only reads;
  - an anon column grant for `movies.is_archival`;
  - the movies SELECT policy, now `OR is_archival`;
  - two triggers that clear `movies.is_archival` when a film is made active or gets a
    live showing;
  - `import_archive_listings(p_dry_run DEFAULT true)`.

  The import is not run by the migration.
- `20261113234834_archive_films_unrated.sql`: archive-only films get rating
  NULL, not "NR". The archive has no rating column. The first import didn't name
  `rating`, so the column default `'NR'` badged all 8,545 archive films as
  unrated. This migration makes the import insert NULL, then runs a plain UPDATE
  clearing `'NR'` from archival films (0 rows on production, where it lands
  before the import). On staging, the 8,545 were cleared first through
  `db query` with the bulk path (2 audit rows). The bulk path can't run inside
  `db push`: `audit_bulk_begin` admits only a session whose *login* user is
  postgres, and push logs in as a temporary CLI role, so the first push failed
  with 42501 and rolled back. Rehearsed inside rolled-back transactions: 0 live
  films touched, and a film the import recreates comes out NULL.

**`import_archive_listings`** links each unmatched archive film to, in order:
1. an archival movie it made earlier for the same title and year;
2. one of our listings with the same title (at most one archive film per title: the
   year-matching one, else the most recent; among duplicate listings, the one shown most
   recently);
3. otherwise, a new archival movie (inactive, `release_year` from the archive, runtime
   hidden).

It then makes one showing per archive row except where an overlap applies, and returns
counts plus the list of links to existing listings for review. A dry run does all the work
and rolls it back. Rows marked `rejected` or already linked (including `manual`) are left
alone, and a second run only picks up new rows. Run from the server, it uses
`audit_bulk_begin/end` (one started row and one summary row instead of ~18,500 audit
rows). Run by an admin from the UI, it audits row by row.

**Dry run on staging (2026-11-13, rolled back):** 176 films linked to existing listings,
8,545 archival movies, 9,775 showings, 253 screenings left to our own showings, 10,028
rows linked.

**Admin › Pages**
- **History**: list, add, edit and delete milestones, including the photo (upload to
  `posters/history/` or paste a URL).
- **Film Archive**: counts, Preview / Create listings, search for archive films (which
  links to the movie form), and workbook upload (adds rows). "Clear archive" was dropped:
  through the cascade it would delete about 10,000 showings with one `confirm()`. The full
  export is in `deferred-archive/data/`. Old `?section=archive` links redirect here.

**Keeping archival rows out of operational screens** (from a read-only audit of every
reader of showings and movies): `.eq('is_archival', false)` on the dashboard's movies and
showings reads, the showing-form movie picker, host assignment, pass eligibility, discount
scoping, contact export, BOR film picker, calendar history, and `scripts/backfill-genres.mjs`.
`HostDashboard` was reading every showing **unpaged, oldest first**. Behind the 1,000-row
cap that would have returned only 1926-era rows, so it now asks for the host's own
productions, live rows only, paged. Readers that filter by `is_active`, by a future date
window or by id are unaffected; the audit is summarised in this brief's PR.

**Public**
- `/history` reads milestones from the table only, and the film chips, the "Every film"
  table and film/year search are back.
- An archival `/showing/:id` page reads "Played at the Kenworthy on …", with no time,
  price or checkout.
- Every movie showing gets the "From the Kenworthy archive" panel (`PreviouslyScreened`,
  `src/lib/screeningHistory.ts`). For films away 25 years or more it leads with "Back on
  our screen for the first time in N years".
- The movie form offers a matching archive listing when a new film's title is typed in,
  so a returning film keeps its history.

## Rollout

1. Staging: `supabase db push` (linked to staging). It needs the two `feat/host-magic-link`
   migrations present locally (they are applied there). Then:
   `select import_archive_listings(true);` (review) followed by
   `select import_archive_listings(false);`
2. Deploy staging, check /history, an archival showing page, Pages › History / Film
   Archive, and the dashboard load.
3. Production: the same, **dry run first** against production's own catalogue, then the
   real run, then `wrangler deploy`. Order: migrations → import → code. The old bundle
   reads `kenworthy_history` and merges in SEED by year + title, so once the seed migration
   lands it shows each milestone once, from the table.

## Not done / follow-ups

- The calendar reaching back past 12 months (a filter to remove in `useCalendarHistory`,
  plus month navigation that can go that far).
- Titles in the History "Every film" table could link to each film's archival showing.
- The links to existing listings are title-only (no release year on our movies). Review
  the 176 in the dry-run output. To undo a wrong link: set that row's
  `match_confidence='rejected'`, delete its archival showing, and re-run.
