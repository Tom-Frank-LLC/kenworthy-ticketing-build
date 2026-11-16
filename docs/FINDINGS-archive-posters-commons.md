# Findings: 495 public-domain posters for archive films, from Wikimedia Commons

**Date:** 2026-11-16 · **Asked by:** Tom ("source the posters that you can source
through legitimate avenues") · **Applied:** production, 495 films ·
**Record:** `docs/data/archive-posters-commons-2026-11-16.csv` (every poster found,
applied or rejected, with its Commons file, page and licence)

## Why this source

Posters belong to the studios and distributors. A picture found by web search
carries no licence: the search engine only points at wherever it is hosted.
TMDB was ruled out in August (18bfa0b): its terms do not cover commercial use.

Old posters are often in the US public domain: works published in 1930 or
earlier have expired, and many later posters were published without a copyright
notice, or the copyright was never renewed. Wikimedia Commons hosts only freely
licensed files and states each file's licence. Wikidata's "film poster"
property (P3383) points a film at its Commons file. We took a file **only when
Commons marks it public domain** (licence code `pd*`, or "not copyrighted"); all
506 candidates were. The licence Commons states is recorded per file in the CSV.
It is Commons' determination, made by its uploaders and reviewers, not ours.
Anyone can check one by opening the `commons_page` link.

## What was done

`scripts/backfill-archive-posters.mjs` (usage in its header):

1. **Candidates** (`scripts/sql/archive-poster-candidates.sql`): 9,082 films with
   no working poster. That is every film the Kenworthy archive links to with a
   blank poster, plus 509 listings whose poster is a dead
   `kenworthy.org/wp-content` URL.
2. **Skipped without lookup:** 2,056 films after 1989 (from 1 March 1989 a US
   work is copyrighted without a notice, so a public-domain poster is essentially
   never there), 491 with no release year, and 9 that are not films.
3. **Matched to Wikidata** on title plus release year (within 2 years), by the
   same rules as the director/cast backfill (#419), now in
   `scripts/lib/wikidata-films.mjs`.
4. **Found:** 506 public-domain, poster-shaped files (portrait at least 1.2:1, at
   least 280px wide; 69 more were landscape lobby cards, ads or tiny scans).
5. **Every one checked by eye** on contact sheets. **11 rejected:**
   - 7 newspaper, trade or drive-in ads
   - 1 modern redrawing
   - 1 wrong film: Wikidata gives *Mexican Spitfire Out West* (1940) the
     *Mexican Spitfire* (1939) poster
   - 1 trade-paper page
   - 1 small half-sheet on a blank border

   The other 495 are the right film. One may look wrong but isn't: the poster
   for *The Sins of the Children* (1930) reads "The Richest Man in the World",
   the title it was also released under.
6. **Uploaded** as JPEG (at most 960px wide) to `posters/commons/<movie id>.jpg`
   and byte-checked at the public URL, 495 of 495.
7. **Applied** in one `audit_bulk_begin` run (`archive.backfill_posters`,
   `movies_updated: 495`). It fills a row only if its poster is still what the
   export saw. 494 were blank; 1 was a dead WordPress URL. Bulk mode records no
   per-row audit entries, so the CSV is the record of old and new values.

By era: 173 from 1930 or earlier, 308 from 1931–1963, 14 from 1964–1977.

## What did not work, and the gotchas

- **The Wikidata query service was in an outage** (16 Nov 2026), rate-limiting
  every client to 1 request a minute. Retrying into the 429 only extended the
  wait. The script now spaces requests (`--sparql-gap 65`), honours
  `Retry-After`, packs 150 titles per query (`--batch 150`), and splits a batch
  that times out so one slow title cannot sink the rest.
- **Wikimedia's image server rate-limits non-standard thumbnail widths.** 1000px
  thumbnails hit 429 after a few dozen requests. 960px is a standard width and
  downloaded without trouble. Downloads are serial.
- **`supabase storage cp -r <dir> ss:///posters/commons` nests the folder**
  (`posters/commons/<dir>/…`). Copy a folder *named* `commons` to
  `ss:///posters` instead. The 495 misplaced copies are still at
  `posters/commons/upload/`: `supabase storage rm` (with or without `-r`)
  reported `deleted: []` and left them. Nothing references them. Delete that
  folder in the Supabase dashboard (Storage → posters → commons → upload).
- **A dead poster URL rendered as a broken image** on an archive page, in place
  of the title card. `ProductionMedia` now falls back to its no-poster rendering
  when the image fails to load, and the showing page then shows the title card.
  This is a code change in the same PR; see BRIEF-archive-posters-commons.

## What is left

- **5,421 films matched a Wikidata item that has no poster on it.** This is the
  largest pool. Commons may still hold a public-domain poster for many of them,
  just not linked from Wikidata. A next pass could search Commons by title and
  year (e.g. its "<Title> (<year> film) posters" categories), with the same
  licence rule and the same by-eye review.
- 386 titles not found on Wikidata, 105 found but with no film within two
  years, 37 ambiguous. Many are retitlings or short subjects.
- The 2,056 films after 1989, and every film without a public-domain poster,
  keep the title card.
- 508 listings still have dead WordPress poster URLs (509 less the one replaced
  here). With the fallback they no longer render broken on the showing page, but
  other surfaces (calendar cards, home page) still use their own `<img>`.
  Clearing those URLs is Tom's call: they are dead, but they are the only record
  in the row of what the poster was (the audit log keeps them too).
