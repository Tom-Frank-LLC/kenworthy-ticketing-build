# Backfilling movie genres — what the sources actually give us

**Date:** 27 August 2026 · **Script:** `scripts/backfill-genres.mjs`

Written because the next person to look at this will assume it is a lookup
problem. It is a *matching* problem, and the reason is one column.

## The constraint everything follows from

`movies.release_year` is populated on **3 of 1,089 rows**. A title is therefore
all we have to match on, and film titles are heavily reused — five distinct
films on Wikidata are labelled exactly `The Odyssey`, and six are labelled
`Paprika`, spanning comedy, drama and cyberpunk. Writing the union of those onto
our row would put confident, wrong words on a badge a patron reads.

Titles are also *programmed*, not clean: 843 of 1,089 contain a colon, and the
part before it is almost always a strand — `Moscow Film Society` (156),
`Summer Family Matinee` (85), `Cinema Classics` (31). `Moscow Film Society:
Casablanca` matches nothing; `Casablanca` matches the film.

## Sources measured, not assumed

| Source | Key | Match rate | Verdict |
|---|---|---|---|
| kenworthy.org WordPress (`mec_category`) | none | — | Five terms — Movie, Event, Opera, Theatre, Live Music. A *type*, not a genre. |
| iTunes Search API | none | **0 / 60** | Returns `resultCount: 0` for every movie query. HTTP 200, empty body — not an error, the catalogue is simply gone. |
| Wikidata SPARQL | none | **36 %** raw | Usable only with a strict ambiguity rule; see below. |
| TMDB | free key | not measured | The upgrade path. Its search ranks by popularity, which resolves precisely the ambiguity that caps us here, and it returns release dates — which would also fix the column that caused this problem. |

## The rule that makes Wikidata safe

A row is written only when **all** of these hold:

1. the title cleans to something plausibly a film — strands stripped, and the
   non-film strands excluded outright (`APOD Productions` is the local theatre
   company; `NT Live` and `MET Live in HD` are filmed stage and opera);
2. **exactly one** film on Wikidata carries that exact label — any ambiguity is
   skipped, never guessed;
3. at least one of its genres maps onto the vocabulary the app already suggests.

Rows that already carry a genre are never touched: staff entry outranks this.

Result on staging: **400 written, 686 left blank** — 369 no match, 192 ambiguous,
9 matched but carried no mappable genre. Roughly one row in three. That is the
honest ceiling of a keyless source with no release year.

## Two things that were quietly wrong on the first pass

**Animation lives in `P31`, not `P136`.** Wikidata models it as *instance of*
`animated film` / `anime film`, not as a genre. A `P136`-only query returned
Animation for **2** of 400 films and filed *My Neighbor Totoro* and *Spirited
Away* as live action. Reading both properties took it to **75**. The tell was
the distribution looking wrong for a catalogue with a standing anime strand.

**A `.slice(0, 4)` cap threw away the best word.** Wikidata returns genres in no
useful order, so the cap dropped whichever came last — including `Silent` on a
1926 picture, which for this theatre is the most informative label on the badge.
Format markers now sort first.

## Known limits

- **`Silent` is on only 2 rows.** Of 14 Silent Film Festival titles just three
  matched at all, and one is not tagged `silent film` upstream. Under-coverage,
  not error.
- Compound genres are lossy. `comedy-drama` now yields both halves, but a film
  with seven Wikidata genres still gets its best four.
- ~71 rows under the `MET Live in HD` / `NT Live` strands are deterministically
  Opera and Theatre from our own titles. That is more reliable than any match
  here, but it is a different mechanism and was left out of this pass.

## Re-running

```bash
SUPABASE_SERVICE_KEY=$(npx supabase projects api-keys --project-ref <ref> …) \
  node scripts/backfill-genres.mjs --env staging          # dry run + CSV
  … --apply                                               # write
```

The script is re-runnable and additive: it only ever fills blanks, so a later
pass with a TMDB key would top up what Wikidata could not reach without
disturbing anything already set.
