# Findings: director, cast and genre for the film archive, from Wikidata

**Date:** 2026-11-13. **Requested by:** Tom, after searching the History page for "Hitchcock"
returned only the film titled *Hitchcock*.

## Why the search found nothing

The search box (#417) does search director and cast, but every film had both blank (0 of
9,691 in production). Director and cast were added that day, and the archive spreadsheet never
had them. So the search worked and simply had no data to find.

## Source and method

`scripts/backfill-archive-credits.mjs`, using Wikidata (keyless, CC0). The genre backfill
(`backfill-genres.mjs`) had to match by title alone, because our listings had no release year,
and reached about one row in six. Archive films carry a release year from the newspaper
listings (99% of them), and title plus year is close to unique:

| | Films |
|---|---|
| Linked from the archive | 8,721 |
| Matched to exactly one Wikidata film | 7,315 (84%) |
| No English label or alias equal to the title | 1,013 |
| Title found, but no film within 2 years | 201 |
| No release year | 65 |
| Ambiguous (two films, same title, equally near year): skipped | 57 |
| Not a film (NT Live, fundraisers…): skipped | 54 |

Filled in production and staging: **director 7,284**, **cast 6,638**, and genre on films that
had none. The import ran as 15 chunks through `audit_bulk_begin/end`, which wrote 30 audit
rows and left no suppression behind. Only blank fields are written (COALESCE), so a staff
edit is never replaced and a re-run fills only what is still empty. The two environments
produced identical matches.

## What review found, and what was done

- **Same title, same year, different label: one wrong match, overridden.** *Pinocchio* (2022)
  matched Zemeckis's Disney+ film. The Kenworthy showed del Toro's, whose English label is
  "Guillermo del Toro’s Pinocchio", so the ambiguity check never saw a second candidate.
  `OVERRIDES` in the script pins it to Q73895818. Expect a few more like this among the archive
  films. Staff can correct any film in its movie form, and a corrected field is never
  overwritten.
- **Wikidata sometimes lists writers or producers as directors.** *Torn Curtain* lists Hitchcock
  plus its two writers; *Lonely Are the Brave* and *Comanche Station* list a producer-star.
  These were left as Wikidata has them; at most 3 directors are taken.
- **Cast is ranked by fame, not billing.** Wikidata cast lists carry no billing order, so the
  6 names are the best-known by sitelink count, and a famous cameo can come first (Hitchcock in
  his own films, Tarantino in *Django Unchained*). The label therefore reads **"Cast"**, not
  "Starring", on the showing page and in the History table.
- **Misses stay blank, never wrong.** Disney's *Pinocchio* (1940) is not found under its plain
  title on Wikidata; small title differences ("The World is Not Enough", "Monsters Inc.") miss
  too. The full per-film report (matched or why not) is produced by each run; it is not kept in
  the repo.

## Re-running

See the header of the script. Export with `scripts/sql/archive-credit-candidates.sql`
(read-only), match, read `report.csv`, then apply the `apply-NN.sql` chunks with
`supabase db query --linked`, never `db push` (the bulk-audit path refuses it). The title
cleaning and genre vocabulary are shared with the genre backfill in `scripts/lib/film-titles.mjs`.
