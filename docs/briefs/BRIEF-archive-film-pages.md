---
brief: archive-film-pages
title: Every archive film opens its own page, and archive pages have a vintage-print look
status: built
track: ux
date: 2026-11-15
verified: false
---

# Brief: link the archive films to their pages, and theme those pages

**Requested by:** Tom, 2026-11-15: "how do we get each of those archived films to
open a listing page for it? And can we give the archived listings a slight
difference in visual theme from a normal calendar listing?"

## What we found

- Every archive film **already had a page**. `import_archive_listings` (#415) made
  one archival showing per archive screening, and `/showing/:id` renders it
  ("Played at the Kenworthy on …"). But nothing public linked to them: the
  /history chips were plain badges, and the "Every film" table linked titles only
  in the admin copy (to the movie form).
- Production: 8,721 archive films; all are readable by anon and all have at
  least one showing. **Only 148 have a poster.**
- 137 films have no archival showing at all. Every archive screening of theirs
  fell within the overlap window of one of our own showings, so the import left
  it to ours. All 137 are films we still list.
- `historical_screenings` embeds its archival showing through
  `showings.historical_screening_id` (one-to-one, so PostgREST returns an object
  or null). The generated types predate that FK, so the two reads cast.

## Decisions (Tom, 2026-11-15)

- Theme: **vintage print**. A brass "From the Kenworthy archive" band, an
  aged-paper panel for the date, and posters softly sepia-toned.
- No poster: a **designed title card** built from the film's title, release year
  and the date it played here.

## What was built

**Links (/history)**
- A timeline chip opens that screening's own page. Where the screening has none
  (one of the 137), it opens the film's latest showing with us.
- An "Every film" title opens the page of its most recent screening, with the
  same fallback. `FilmEntry.showingId` comes from `rollUp`;
  `FilmArchiveTable.filmHref` now takes the film entry, and the admin table
  passes `/admin/movies/:id` through it.

**Archive page (`/showing/:id` where `is_archival`)**
- `ArchiveBand` across the top; the "Archive" pill in brass.
- `ArchiveTitleCard` in the poster column when there is no poster or trailer; a
  real poster gets `sepia-[.3]`.
- `ArchiveRun` replaces `PreviouslyScreened` on archive pages: "Played at the
  Kenworthy N times, YYYY–YYYY", with every date as a link to that date's page
  and the current one marked (`aria-current`). It shows 30 dates, then "Show all".
- `ArchivalNotice` is the aged-paper panel ("Played here / {date}").
- Back returns to /history (history back when there is one), not to the home page.
- The meta description no longer says "Tickets for…", in the app or in the
  Worker's crawler head. The Worker also emits no Event JSON-LD for an archive
  page: its time is a placeholder and it has no offer.

**Palette.** New `--archive-*` tokens in `src/index.css`, with contrast computed
there: ink on paper 11.5:1, muted ink 5.97:1, dark-brass rule 5.10:1, gold on the
band 7.62:1. Gold accent on paper is 1.58:1 and is never used as text there.

**Title card wording (Tom, 2026-11-15).** "Kenworthy presents" (no "The"); the
full date it played ("September 14, 2017"); and the building's name as it was
that night: **Kenworthy Theatre** before 1 January 2000, **Kenworthy Performing
Arts Centre** from then on (`kenworthyNameOn` in `src/lib/archiveFilms.ts`).
Every archive screening has a full date in both environments (0 null, 0 that
disagree with the showing's start), so the full date is never a guess. 85 fall
on 1 January; they spread across 1929–1997 and include New Year's Day double
features, so they read as real holiday screenings, not year-only placeholders.

**Heading row.** On a phone, a long title plus its badges widened the page
(the row could not wrap); this was on main too, for live listings. It wraps now.

## Checked

- `tsc -p tsconfig.app.json`, `check:worker`, and the full vitest run
  (1,314 passed). `archiveFilms.test.ts` covers the latest-screening link, the
  skip for a screening with no page, and the no-link case.
- In a browser against staging (dev server):
  - Casablanca's three dates each open their own page, with the current one
    marked, and the table opens the 2022 one.
  - Back returns to /history.
  - All 1,121 timeline chips rendered are links.
  - No horizontal overflow at 360px, including a 70-character title.
  - Title card at 360px: 1972 reads Kenworthy Theatre / October 8, 1972; 2017
    reads Kenworthy Performing Arts Centre (two balanced lines) / September 14, 2017.

## Not done

- The sepia poster treatment was not seen in the browser: staging has no
  archive film with a poster. The class is confirmed in the built CSS.
- The title card is not used for share-preview images; the Worker still falls
  back to the site image.
