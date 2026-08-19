# The Silent Film Festival page

`/silent-film-festival`, built 2026-08-19 from
`docs/briefs/BRIEF-silent-film-festival-page.md`.

Three sections that fail independently — hero, this year, past programs — because
on the day this shipped only one of the three had data behind it.

## What is wired to what

```
film_pass_types.festival_slug = 'silent-film-festival'
        │
        │  the page finds ONE pass by this slug
        ▼
   the festival pass ──────────► /film-passes?pass=<id>
        │                        (sold there, not here — see below)
        │
        │  pass_type_showings rows
        ▼
   this year's screenings ─────► /showing/:id  ("Get Tickets")

festival_programs (festival_slug, year, is_published)
        │
        ▼
   past programs archive, grouped by year, newest first
```

The lineup is derived from the pass rather than listed separately, so what the
page advertises and what the pass actually admits to cannot drift apart. The
cost is that **no pass means no lineup** — which is the state the page shipped
in, and why every section has an empty state.

## Why the pass is not sold on this page

The brief asked for inline purchase. It is a link instead, and the reason is
that a festival pass is not a special kind of pass: it is an ordinary row in
`film_pass_types`. `/film-passes` already queries every active pass type and
renders them all, so the festival pass appears there the moment it exists, with
no code that knows festivals exist.

Selling it inline would have meant lifting the Square Web Payments card form,
guest checkout, pickup-vs-mail fulfilment, the per-pass tax rounding that has to
agree with `film-pass-checkout`, and the idempotency key out of `FilmPasses.tsx`
— a refactor of live checkout to save one click. The link carries `?pass=<id>`
so the buyer lands on the pass they clicked rather than the cheapest one.

## Why `festival_slug` and not the pass's name

The page has to find one row and cannot do it by name:

- `SILENT FILM FESTIVAL PASS` exists **three times** in the Square catalog as
  duplicate SKUs.
- The name is an editable field in the admin form.
- The failure would be silent and total — no pass found means no buy button
  *and* no screenings.

`festival_slug` is NULL on an ordinary pass and carries the festival's slug on a
festival pass, with a partial unique index so one festival cannot have two.

It is **not** a second eligibility mechanism. What a pass admits to is still
`pass_type_showings` and only that; this column answers only "which pass does
this page advertise", so the door's behaviour cannot drift from the page's.

## Storage: public bucket, gated rows

`festival-programs` is a **public** bucket, unlike `concession-menus` (private,
ten-minute signed URLs). A program is published *at* the public and was already
handed out on the night; signed URLs would mean a round trip per thumbnail and
would expire behind a reader who left the tab open.

Publication is still gated: `is_published` defaults to false and the anon SELECT
policy filters on it. An unpublished row is unlisted, not secret — its bytes sit
in a public bucket behind a timestamped, unguessable path. Do not put anything
in this bucket that would matter if it were found.

## Which screenings count as "this year"

`selectFestivalLineup` in `src/lib/festival.ts`. The anchor is the next
screening that has not happened yet; the lineup is every tagged screening in
that screening's calendar year. Two deliberate consequences:

- A screening that has already played **stays in the list** while later ones are
  still to come, marked as passed with no ticket link. A three-week festival
  should not show a shrinking programme on its middle Wednesday.
- Once the last screening ends the list goes **empty** rather than falling back
  to the year just finished. A finished festival belongs in the archive below,
  not under a heading that reads as still purchasable.

"Every screening the pass covers" would accumulate old years; "the current
calendar year" would break a January festival tagged the previous December.

## Setup still required (none of this is code)

The 2026 screenings are already live in `showings`; the pass is not.

1. **Admin → Passes → new pass type.** Name it, price it, set *Festival page* to
   `silent-film-festival`. Leave *Standard pass for ordinary films* **off** — a
   festival pass must not turn on at the ordinary Tuesday film.
   Consider *Uses per screening* = 1: a festival pass is priced per admission
   precisely because it is not meant to admit a party.
2. **Tag the three screenings** (Sept 2 / 9 / 16) to that pass under
   Eligibility. Until this is done the page shows "This year's lineup is coming
   soon" — the pass alone is not enough.
3. **Optionally set `square_variation_id`** on the pass so sales land against the
   right Square item. Note the catalog has the pass three times; pick one and
   retire the others. Left NULL, the sale is billed as an ad-hoc line — which is
   what the existing 10-film pass does today.
4. **Admin → Festival → upload programs**, then publish each. Nothing is public
   until published.

## Loading the archive

`scripts/import-festival-programs.mjs` walks a folder of scans and uploads them.

```
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
node scripts/import-festival-programs.mjs "<archive dir>" --dry-run
```

Drop `--dry-run` to upload. Rows land **unpublished**, so nothing is public
until someone has looked at it in Admin → Festival. `--replace` re-imports a
year that already has rows; `--publish` publishes on the way in.

It is shape-based rather than a fixed list of files, because no two years were
handed over in the same form:

- a **directory** with a year in its name → its images are that year's pages, in
  filename-number order;
- a **PDF** with a year in its name → every page is rendered to an image so the
  year is browsable, *and* the PDF is uploaded for download.

PDFs found *inside* a year directory are skipped. In the 2023 folder those are
the printer's spreads — back cover and front cover imposed on one landscape
sheet — which is the right artefact for reprinting and the wrong one for reading
online; the same content is already there as single portrait pages.
`--include-spreads` keeps them.

### What was in the 2026-08 handover

| Year | Source | Imported as |
| --- | --- | --- |
| 2023 | 8 portrait page PNGs (~33 MB) + 4 print spreads | 8 page images; spreads skipped |
| 2024 | one 12-page PDF, 9.4 MB | 12 page images + the PDF |
| 2025 | one 8-page PDF, 6.2 MB | 8 page images + the PDF |

Two traps that folder contains, both of which a naive importer walks straight
into:

- The 2024 and 2025 PDFs are **Dropbox online-only placeholders**. `du` reports
  them as 0 B; `stat` gives the true size and reading them hydrates the file.
  Anything that sizes files with `du` will upload nothing and report success.
- `sips -Z` fits the **longest** side. On a portrait page that caps the height
  and leaves the width ~35% short of every PDF-rendered page, so the years come
  out at visibly different quality. The script uses `--resampleWidth`.

## Image sizes: one file, two sizes

Stored pages are normalised to 2000px wide (JPEG q88) — wide enough that the
body copy is comfortably legible, against a 24 MB source for 2023's cover alone.

The archive grid does **not** fetch those. Tiles request Supabase's image
transform endpoint off the same object:

```
getPublicUrl(path, { transform: { width: 500, quality: 70 } })
```

Verified working on **both** production and staging (2026-08-19). One stored
file serves the thumbnail and the click-through; nothing is uploaded twice.

Note this is the first use of the transform endpoint in the repo. Posters
elsewhere (`Index.tsx`, `Showing.tsx`) still ship at full print resolution —
~1.1 MB each — and would benefit from the same treatment, but that is a
site-wide change and was deliberately left out of this page's scope.
