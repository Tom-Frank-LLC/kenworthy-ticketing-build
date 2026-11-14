---
brief: archive-search-and-credits
title: The film archive searches every field, opens each film in admin, and films carry director and cast
status: shipped
track: feature
date: 2026-11-13
shipped_in: ["#417"]
shipped_at: 2026-11-13
verified: true
findings: FINDINGS-archive-credits-backfill.md
---

# Brief: archive search, the admin "Every film" table, director and cast

**Requested by:** Tom, 2026-11-13, after `archive-listings` shipped.

1. On /history, "+N more" on a year filters the "Every film" table to that year. But with that
   filter cleared, typing a year into the search box showed the wrong films, or none.
2. The search box only searched titles. It should search every relevant field.
3. Put the archive table on Admin › Pages › Film Archive, so staff can open any film and add
   metadata (rating, genre, director, cast…) as on a normal listing.

## Cause of 1

The box matched titles only (`f.title.toLowerCase().includes(q)`), so "1975" found films with
"1975" in their names. "+N more" worked because it sets a separate year filter, not the
search box.

## What was built

- `src/lib/archiveFilms.ts` (tested): roll-up plus `matchesQuery`. Every word of the query
  must match some field: title, release year, any year shown, director, cast or genre. A
  partial year works as a decade ("197"). A word equal to the rating matches it whole. Case and
  accents are ignored. The table shows "Directed by … · Starring … · genre · rating" under a
  title once anyone fills them in. With a year filter on and nothing found, it says to clear
  the filter.
- **Director and cast** (Tom: add both, shown publicly): `movies.director`,
  `movies.cast_members` (`cast` is an SQL keyword), on the movie form and the showing page
  ("Directed by" / "Starring"). Visitors can read them through a column grant, mirrored in
  `MOVIE_PUBLIC_COLUMNS` and the anon-surface allowlist.
- **`archive_film_details()`**: genre, rating, director and cast of movies linked from the
  Kenworthy archive. It runs as its owner because visitors can only read active and archival
  movies, and the 181 archive films joined to our own past listings are inactive. It returns
  only columns visitors may read anyway, and only films with something filled in (173 on
  staging). Paging (`Range`) was checked as anon.
- **Admin › Pages › Film Archive**: the same table, where each title opens `/admin/movies/:id`.
  It replaces the "Find an archive film" box, which searched archive-only films by title.

Migration `20261114014016_movie_director_cast.sql`. Staging: pushed, anon-surface test returns
0 rows, and the search was checked in a browser. "1975" finds the 72 films shown that year, and
"horror" finds films by genre.

## Shipped (2026-11-13)

Production: migration pushed first (anon-surface 0 rows; the function serves 180 films with
details), then main `ec202be` deployed as worker `d88c8ed6`, rollback `7481ba74`. The changed
chunks were checked byte for byte against the live site.

## Follow-up: the data (2026-11-13)

Searching "Hitchcock" found nothing, because every film's director and cast were blank. They
were filled from Wikidata for 7,284 / 6,638 archive films, matched on title + release year,
in both environments. The cast label now reads "Cast", not "Starring". See
`FINDINGS-archive-credits-backfill.md`.
