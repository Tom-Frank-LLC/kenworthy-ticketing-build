---
brief: showing-movie-1000-cap
title: The 1000-row cap on the movie picker — fix and data audit
status: shipped
track: data
date: 2026-08-14
shipped_in: ["f01527f"]
verified: true
---

# The 1000-row cap on the movie picker — fix and data audit

**Status:** ✅ Fixed in code. Data audit complete: **no rows need correcting** —
the links were never lost, the admin form just could not draw them.
**Date:** August 14, 2026

## What was wrong

`ShowingForm` loaded the movie picker with a bare
`.select(...).order('title')` and no `.range()`, so it took PostgREST's default
1,000-row response and stopped. PostgREST does not report the truncation — there
is no error and no flag, the tail simply is not in the response.

Because the query was ordered by title, the rows it dropped were the
**alphabetical tail**. The picker's search box filters the array that was
loaded, so a title that never arrived could not be found by typing it either.
That is why it looked like a search bug and was not one.

Measured against the live API with the browser's own anon key
(`scripts` used for this are in the session scratchpad, not committed):

| | production | staging |
|---|---|---|
| movies in catalog | 1,088 | 1,087 |
| titles the old picker loaded | 1,000 | 1,000 |
| last title it could reach | *The Marx Brothers: Horse Feathers* | *The Naked Gun* |
| titles recovered by the fix | **88** | 87 |

The cut point was confirmed twice by independent routes — ranking the catalog
in SQL (`row_number() over (order by title, id)`) and replaying the old HTTP
query — and both name the same title. Paging the fixed query returns all 1,088
with **zero duplicate ids across the page boundary**, which is what the
secondary `.order('id')` buys: without a unique tiebreak, rows with equal titles
can shift between pages and be dropped or double-counted.

## The fix

`src/lib/fetchAllRows.ts` already existed as the repo's canonical pager (it was
written for the ~1,550-row DVD library). Nothing new was written; the broken
call sites were moved onto it. `AdminDashboard`'s private `fetchAllPages` copy
was reduced to a thin wrapper over the same helper, so the paging logic now
lives in exactly one place.

| file | table | rows | was it biting? |
|---|---|---|---|
| `ShowingForm.tsx` | movies | 1,088 | **yes** — the reported bug |
| `HostManagementTab.tsx` | movies | 1,088 | **yes**, and worse: no `order` at all, so it took an *arbitrary* 1,000 |
| `PassEligibilityPanel.tsx` | pass_type_showings | 1,108 | **yes** — see below |
| `QboExportTab.tsx` | showings | 1,789 | **yes** — see below |
| `AdminDashboard.tsx` | movies, showings, tickets | — | already paged; consolidated onto the shared helper |

### Two more instances the fix caught

**The QuickBooks export was misbooking revenue.** `QboExportTab` builds a
showing → production map to decide which account each ticket's takings belong
to, and read all ~1,789 showings unpaged. A ticket whose showing is missing from
that map falls through to the `'film'` default, so **live-event and concert
takings for showings past the cut were silently booked as film revenue** in an
export that looked complete. Worth re-running any export already handed to the
bookkeeper.

**The film-pass eligibility panel was misreporting.** The 10-film pass is tagged
to 1,108 screenings, so the unpaged read dropped 108 of them and the panel drew
screenings that *do* accept the pass as "Not accepted". Checked before
concluding: applying only ever writes the rows an admin explicitly selected, so
this misreported the state and **never untagged anything**. No data damage.

### Left alone deliberately

`events` (198), `live_performances` (0), `venues` (1) and `profiles` (<500) are
far from the ceiling; the sibling selects in `ShowingForm` carry a comment
saying so. `ConcessionPOS` reads showings but filters to active and future ones,
which cannot approach 1,000. `ArchiveTab` takes a count, not rows.

## What "the showing is not tied to the movie" actually was

This is the symptom that surfaced the bug, on the **Train Dreams** screening of
Aug 30. It is worth stating precisely, because the first pass of this audit
looked for the wrong thing and declared the data clean on a technicality.

The showing's `movie_id` was never lost. It points, correctly, at
*Train Dreams ~ Roots of a Nation: An Idaho Film Festival* — which ranks
**1,033rd** by title, past the 1,000-row cut. So when that showing was opened in
the admin form, the picker had never loaded the film it was tied to, and
`SearchableSelect` renders its placeholder when `options.find(o => o.value ===
value)` comes back empty. **The field looked unset while the database link was
intact.** That is the whole defect: a display failure that reads exactly like a
data failure.

Two things follow, both checked rather than assumed:

- **Saving from that form did not blank the link.** `ShowingForm` keeps the real
  id in state (`setItemId(data.movie_id)`) and writes that same value back;
  `onChange` only fires when someone actually clicks an option. So an admin who
  opened the showing, saw an empty film box and saved anyway did no damage.
- **The blank-picker showing is not unique to Train Dreams.** 88 films sit past
  the cut and they carry **143 showings** between them, every one of which would
  have drawn an empty film field. Only **one is still upcoming** — the Aug 30
  Train Dreams screening. The other 142 are historical.

Verified against production with the anon key: both Train Dreams rows were
`MISSING` from the old picker's response and are `PRESENT` in the paged one. The
fix is what closes this; there is no row to correct.

On the two Train Dreams records — they are not a duplicate to merge. The plain
*Train Dreams* had a three-showing run in Nov 2025, now inactive; the
festival-suffixed row is the Aug 30 festival booking, following the same
`<Film> ~ <Festival>` convention as *1776 ~ Roots of a Nation* and *Sacajawea of
the Salmon River Valley ~ Roots of a Nation*. The Aug 30 showing is tied to the
right one. (Worth a human glance, since only staff know the intent.)

Note the near-miss: the duplicate check below matches on exact normalised title,
so it never saw this pair — the two rows differ by the festival suffix. Any
future duplicate hunt needs fuzzier matching than that.

## The rest of the data audit

The remaining worry was that showings created while the picker was broken got no
film, the wrong film, or a duplicate film made as a workaround. Instrumented
rather than assumed, against production:

- **The bug window opened 2026-08-10 23:53:24 UTC** — the instant of the
  historical bulk import, which is when the catalog crossed 1,000. (Oldest and
  1000th movie share that timestamp; the catalog went from small to over-cap in
  one write.)
- **Only three write batches touched `showings` in that whole window:** 238 event
  showings and 382 mixed rows, both bulk imports that set `movie_id` in SQL and
  never touched the picker — and **one** hand-created showing, on Aug 13.
- **That one showing is `film pass test`**, a deliberate test record from the
  film-pass work, pointing at a movie ranked 224 — reachable the whole time.
- **0 showings** have no production at all (`movie_id`, `event_id` and
  `live_performance_id` all null), on either project.
- **0 dangling `movie_id`s** — every reference resolves to a real row.
- **One duplicate title pair** exists (*Kino Short Film Festival*), but both
  halves were written in the same bulk-import instant, so it is an import
  artifact and not a workaround. Both carry showings (1 and 3); left alone
  rather than merged blindly.

So essentially no one used the admin UI to create a movie showing during the
window, and nothing needs correcting. `updated_at` could not be used to find
*edits* in the window — a past migration bumped it on all 1,789 rows — but the
invariants that would reveal a bad edit (no orphans, no dangling FKs) hold, and
a wrong-but-valid film swap is not machine-detectable in any case. With exactly
one UI-created showing in the window, that exposure is nil.

## Verification

- `tsc -p tsconfig.app.json --noEmit` clean, `npm run build:staging` passes, 155
  unit tests pass.
- The paging loop was replayed against both projects' live REST APIs: 1,088 and
  1,087 titles returned, ending at *Young Washington*, no duplicates.
- **Confirmed in a browser (Aug 14):** the showing that surfaced this now shows
  its film instead of an empty box. That was the original report, and it is
  closed.

Deployed to staging (`c413f8ac`) and production (`39345b14`) on Aug 14. Frontend
worker only — no migrations pushed and no edge functions deployed. The prod page
appeared to serve the old bundle for a few minutes; that was a Cloudflare edge
cache `HIT` on `index.html`, not a bad deploy, and a cache-busted request served
the new hash straight away.

## Follow-up not covered here

Any **QuickBooks export already handed to the bookkeeper** was built from the
truncated showings map, so live-event and concert takings past the cut were
booked as film revenue. Those exports are worth re-running now that the map
reads all ~1,789 showings.
