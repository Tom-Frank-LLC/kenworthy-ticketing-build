---
brief: multiple-genres
title: A production can carry more than one genre, stored the way the DVD library already stores them
status: shipped
track: feature
severity: P2
date: 2026-08-25
shipped_in: ["#199", "#200", "#204"]
shipped_at: 2026-08-27
verified: true
findings: ../FINDINGS-genre-backfill.md
---

> **Decisions taken (2026-08-26).** The four open decisions were settled as
> follows. **1 — Option A**, comma-separated in the existing `genre` column: no
> migration, no grant change, and it matches the convention already shipping on
> 1,456 DVDs. **2 — free-typed chips with suggestions**, drawn from the genres
> already used across the three production tables and backed by a starter list,
> because the data had almost none of its own to suggest. **3 — all three
> production types** (movies, events, live performances). **4 — show every
> genre and let the row wrap**; no cap, no "+N".
>
> **Measured before building.** Genre is very nearly unused today: **3 of 1,089
> movies** carry one (`Documentary`, `Horror`, `Adventure`) and **0 of 198
> events**. So there was no drift to clean up and nothing to migrate — but it
> also meant a suggestion list built only from existing data would have been
> empty on the day it shipped, which is why the starter lists in
> `src/lib/genres.ts` exist.
>
> **Deviation from the brief, with the reason.** DVD genres were *not* used to
> seed the suggestions. Splitting `dvds.genre` gives 26 values, but they are a
> shelving taxonomy in caps — `CRITERION`, `ECLIPSE`, `AWARD WINNER`,
> `STAR WARS`, `MIYAZAKI`, `INTERNATIONAL` — not film genres, and seeding them
> would have pushed all-caps shelf sections into the field the brief is trying
> to keep clean. The DVD *convention* is still what the storage follows.
>
> **Two consumers the brief did not list**, both of which would have broken
> silently: `AdminDashboard.tsx` builds its genre facet with `new Set(m.genre)`
> and filters with `m.genre === genreFilter` — exact equality stops matching the
> moment a second genre is added — and `MailchimpTab.tsx` holds a **second
> copy** of the favourite-genre calculation alongside `src/lib/mailchimp.ts`.
> Both now go through `src/lib/genres.ts`.
>
> **A pre-existing bug found while doing this.** `AnalyticsTab.tsx` embedded
> `concerts(genre)`, but there is no `concerts` relation — the table is
> `live_performances`. PostgREST rejects the embed outright (`PGRST200`),
> verified against **both** staging and production, so that query has been
> returning nothing and the admin Overview's **Genre Popularity and Venue
> Utilization** cards have been empty. Fixed here, because the brief's
> split-before-aggregate change would otherwise have been dead code.
> **The same broken embed is still in `src/components/pos/ConcessionPOS.tsx:47`
> (`concerts(title)`)** — left alone deliberately, as a cash-path change has no
> business riding along in a genre PR. It needs its own fix.

# Brief (for Claude Code): Allow multiple genres per movie

**Status:** 🟢 Small, mostly additive. The in-repo convention already exists (DVDs) — match it, and the one thing that must not silently break is the Mailchimp favorite-genre calc.
**Date:** August 25, 2026
**Requested by:** Tom — a movie should be able to carry more than one genre (e.g. "Drama, Comedy" or "Sci-Fi, Thriller"), not just a single value.

## Current state (verified)
- **Storage:** `movies.genre` is a single free-text `TEXT` column (migrations `…35709786…` L23; also on `events` and `live_performances`). The public `anon` role has a **column-level SELECT grant** that includes `genre` (`20260701020754…`).
- **Entry:** `MovieForm.tsx` — one text `<Input>` (L159, `placeholder="Drama"`), `useState('')` (L27), loaded at L49, saved as `genre: genre || null` (L73). `EventForm.tsx` / `ConcertForm.tsx` reference genre similarly.
- **Display:** rendered as a **single** badge — `ProductionMetaBadges` in `ProductionMedia.tsx:105` (`{genre && <Badge>{genre}</Badge>}`), reused by the Showing page (`Showing.tsx:640`), the detail drawer (`ProductionDetailDrawer.tsx:85`), and listing cards.
- **No public genre filter on the movie listings today** — `Index.tsx` / `useFeed.ts` select `genre` but don't filter by it. So multi-genre mainly affects entry + display + Mailchimp now, and *enables* a future filter.
- **The working reference already in the repo:** the **DVD library** already treats genre as **comma-separated** in a single TEXT column — `Dvds.tsx` splits on comma to build the facet list (L121) and to filter (`.split(',').map(trim).includes(...)`, L137). This is the established pattern; matching it keeps the codebase consistent (source of truth = working code, not a new invention).

## The design decision (Decision 1 — the real call)
**Option A — comma-separated in the existing `genre` column (recommended).** No schema change, no grant/RLS change, backward compatible (a single genre is a one-element list, existing rows already valid), and it **matches the DVD convention already shipping**. Entry becomes a multi-value input that stores a comma-joined string; display splits into multiple badges; downstream consumers split on comma.

**Option B — a normalized join table** (`genres` + `movie_genres`, or a `text[]` array column). Cleaner relationally and enables a controlled vocabulary and accurate per-genre analytics, but heavier: new table(s)/column, RLS + `anon` grants, a data migration of every existing `genre` string, and a join in every select that reads genre. It also diverges from the DVD convention. Choose this only if a canonical, deduplicated genre taxonomy is a near-term goal.

Recommend **A** for parity and low risk; note B as the upgrade path if controlled genres are wanted later.

## The change (assuming Option A)
1. **Entry (`MovieForm`).** Replace the single text input with a **multi-value genre input** — a chip/tag input where each entry is a genre, stored comma-joined (`genres.join(', ')`), and parsed back on load (`(data.genre || '').split(',').map(s => s.trim()).filter(Boolean)`). **Decision 2:** free-typed chips (matches DVD free text, fastest) vs a multi-select from a **canonical list** (prevents "Sci-Fi" / "Science Fiction" / "SciFi" drift that fragments filtering and the fav-genre calc). If canonical, seed the list from the distinct genres already in the data plus a standard set, and still allow an "add new."
2. **Display (`ProductionMetaBadges`).** Split the genre string and render **one badge per genre** instead of one badge for the whole string:
   `genre.split(',').map(s => s.trim()).filter(Boolean).map(g => <Badge key={g}>{g}</Badge>)`.
   Keep it from overflowing the tight layouts — cap the count or let it wrap on cards and calendar cells (the known-fragile spots from the readability brief). This one change flows to the Showing page, drawer, and cards.
3. **Mailchimp favorite-genre (must not break — `src/lib/mailchimp.ts:140–145`).** Today it does `genreCounts[g]++` on the raw string. With comma-joined genres, **split before counting** so a two-genre film credits *each* genre, and "Drama, Comedy" doesn't become a phantom bucket distinct from "Drama". Update the select/agg accordingly. `mailchimp_fav_genre` stays a single winning genre.
4. **Consistency sweep.** Apply the same split-and-render (and split-before-aggregate) anywhere else genre is shown or grouped: `AnalyticsTab.tsx`, `AdminDashboard.tsx`, `ProductionDetailDrawer.tsx`. Grep `genre` and route each display through the same split helper; add a tiny `parseGenres(s)` / `formatGenres(list)` pair (e.g. in `src/lib/datetime.ts` alongside the other formatters, or a small `src/lib/genres.ts`) so there's one definition, not five.

## Scope (Decision 3)
Tom said "movies." Events and live performances have the same single-genre column and forms. Recommend applying the same multi-genre treatment to **all three production types** for consistency (they share `ProductionMetaBadges` for display already), unless movies-only is intended.

## Cross-cutting
- **Backward compatible:** existing single-genre rows are valid one-element lists; no migration needed under Option A.
- **Whitespace/dedupe:** trim each genre, drop empties, and de-duplicate on save so "Drama, drama" or trailing commas don't create junk facets.
- **Accessibility:** multiple badges keep sensible reading order; if capped visually, the full list is still available to assistive tech / on the Showing page.
- **Future filter:** with genres split consistently, a public "filter by genre" on the listings becomes straightforward later (mirror the DVD facet) — out of scope here unless Tom wants it.

## Decisions for Tom
1. **Storage:** comma-separated in the existing column, matching DVDs (recommended) vs a normalized join table / array column.
2. **Input style:** free-typed chips (recommended for parity/speed) vs multi-select from a canonical genre list (prevents drift).
3. **Scope:** movies only vs movies + events + live performances (recommended).
4. **Cap on displayed badges:** show all (wrap) vs cap to N with a "+more" on tight cards.

## Test plan
- A movie can be saved with several genres; reload shows them all; a single-genre movie still works, and an existing single-genre row renders unchanged.
- The Showing page, detail drawer, and listing cards render **one badge per genre**, wrapping/capping cleanly at 375 / 768 / 1280 (no overflow in calendar cells or cards).
- Mailchimp recompute credits **each** genre of a multi-genre film to `mailchimp_fav_genre`; a two-genre film no longer creates a combined phantom bucket; single-genre behavior unchanged.
- Whitespace/dupes are normalized on save; empty entries produce `null`, not `", ,"`.
- No `anon` grant / RLS change needed (Option A); public reads still return genre.
- If scope includes events/live performances, the same holds for those forms and displays.
- `npm run build` + tests pass; add unit tests for `parseGenres`/`formatGenres` (empty, single, multi, messy whitespace, duplicates).

## What was built

- `src/lib/genres.ts` — the single definition. `parseGenres` / `formatGenres`
  for the round trip, `hasGenre` for filters, `tallyGenres` / `topGenre` for
  aggregates, `collectGenres` for facet lists. Case-insensitive de-duplication
  throughout, so "Drama, drama" is one genre and a stray "sci-fi" does not
  split the Sci-Fi bucket.
- `src/components/admin/GenreInput.tsx` — the chip field. Enter or a comma
  commits, blur commits (a genre typed and then Saved is not lost), Backspace
  on an empty box removes the last chip, and every chip carries a real remove
  button for keyboard and screen-reader users.
- Display: `ProductionMetaBadges` renders one badge per genre, which reaches
  the Showing page, the detail drawer and the listing cards at once; the admin
  schedule rows do the same and now wrap.
- Aggregates: `mailchimp.ts`, `MailchimpTab.tsx` and `AnalyticsTab.tsx` all
  split before counting, so a two-genre film credits each genre and no
  "Drama, Comedy" phantom bucket can win the field.
- Tests: `src/lib/genres.test.ts` (24), `GenreInput.test.tsx` (12), and three
  added to `ProductionMedia.test.tsx`.

## Not done

- No public genre filter on the listings. Out of scope, and now cheap — the
  facet helper the admin uses (`collectGenres`) is the same one a public filter
  would want.
- Option B (a join table or `text[]`) remains the upgrade path if a canonical,
  deduplicated taxonomy is ever wanted.
- The `ConcessionPOS.tsx` embed bug described above.

## Backfill (27 August 2026)

Genre was populated on **3 of 1,089** movies when this shipped, so the field
would have launched empty. `scripts/backfill-genres.mjs` filled what could be
filled honestly from Wikidata — see `docs/FINDINGS-genre-backfill.md` for the
sources measured and the two faults found while measuring.

| | staging | production |
|---|---|---|
| written | 400 | 400 |
| failed | 0 | 0 |
| movies with a genre, after | 402 / 1,088 | **403 / 1,089** |
| carrying more than one | 338 | 336 |
| distinct genre values | 20 | 20 |
| outside the app's vocabulary | none | none |

The 686 left blank are deliberate: 369 matched no film, **192 were ambiguous**
across several films sharing a title, and 9 matched but carried no mappable
genre. Staff fill those in through the chip field as titles are programmed.

Raising that ceiling needs a release year to disambiguate on, which is what a
TMDB key would provide — already proposed independently in `docs/TASKS.md` for
the admin add-a-movie flow. The script only ever fills blanks, so a later pass
would top up without disturbing anything set by hand.
