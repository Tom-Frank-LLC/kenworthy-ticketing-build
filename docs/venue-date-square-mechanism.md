# Where venue and event date/time live on a Square catalog item

**Status: Phase 0 complete, Phase 1 applied 2026-08-18.** Venue is set on all
484 eligible listings and dates on all 259 that have one, each read back from
Square and confirmed. See §9 for the outcome.

Companion to `INCIDENT-2026-08-14-square-catalog.md`. Read that first.

Evidence: `supabase/functions/square-event-probe` (temporary, read-only, admin
gated) run against the production catalog on 2026-08-17.

## The short version

1. The field is real, and writable in principle: an **undocumented**
   `item_data.event` block on items whose `product_type` is `EVENT`.
2. `RetrieveCatalogObject` **does** return it, so read-modify-write will not
   silently wipe it. That was the question that could have killed the job, and
   it came back clean.
3. **The CSV cannot be applied as delivered.** `start_at`/`end_at` are full
   RFC 3339 timestamps; the CSV has no year. And the CSV's venue value is a
   street address, but the field it would go in holds a *name*, with the address
   held separately by reference.
4. **Something is still deleting these blocks.** 770 of the 838 `EVENT` items
   were modified today and have no event block. This looks like an ongoing
   bleed from the dashboard CSV imports, not damage that has stopped.

## 1. The mechanism

Standard `CatalogItem` has no venue and no date field — its documented schema
lists none, and the app has never written one. But Square's
`CatalogItemProductType` includes `EVENT` ("An event which tickets can be sold
for, including location, address, and times"), created in the dashboard at
**Items & services → Item library → Create item → Item Type: Event**.

The data hangs off an undocumented `item_data.event` block. Full key set, read
from live objects:

```
item_data.event.uid
item_data.event.start_at
item_data.event.end_at
item_data.event.event_location_name
item_data.event.event_location_time_zone
item_data.event.event_location_types[]
item_data.event.address_id
item_data.event.all_day_event
```

A real, populated block (`NT LIVE: THE IMPORTANCE OF BEING EARNEST`, item
`ZICSALMNQTVGGNU56N5ZEMDC`):

```json
{
  "uid": "WZKA6PA5B7TDSRNVYRBDCNWM",
  "start_at": "2025-03-23T19:00:00+00:00",
  "event_location_time_zone": "America/Los_Angeles",
  "event_location_name": "Kenworthy Performing Arts Centre",
  "event_location_types": ["IN_PERSON"],
  "address_id": "W4DB6IPQTCSWYZJZVZSLKD2I",
  "all_day_event": false
}
```

`end_at` is absent here, so it is optional — single-showing items simply omit it
rather than repeating `start_at`.

## 2. The round-trip is safe (the question that mattered most)

The risk was that the block might be visible to `CatalogSearch` but not to
`RetrieveCatalogObject` — in which case the object we retrieve is already
missing it, and `UpsertCatalogObject`, which **replaces**, would delete the
venue and date on every item we touched. That is the Aug 14 mechanism pointed
at the exact field this job exists to restore.

It does not happen. Across list, search, and retrieve, at both API versions:

| | count |
|---|---|
| items whose event block list/search show but retrieve omits | **0** |
| `item_data.event` visible at pinned `2024-01-18` | yes |
| `item_data.event` visible at current `2025-07-16` | yes |

The pinned `SQUARE_API_VERSION` in `_shared/square.ts` is **not** a problem
here; it sees the same fields as a current version.

This clears the mechanism, not the write. Nothing has yet proved Square
*accepts* a write to this block. `square-catalog-sync/index.ts:1083` records the
precedent that makes that a real risk:

> a 2xx is not evidence of a write. At `SQUARE_API_VERSION` 2024-01-18
> `item_data.categories` is derived, not writable: sending it is accepted and
> ignored... The whole run then reports success and changes nothing.

An undocumented field is a prime candidate for the same behaviour, and the
`CatalogItemProductType` reference warns that "Connect V2 only allows the
creation of `REGULAR` or `APPOINTMENTS_SERVICE` items" — which constrains
creation, but says nothing about updating an existing `EVENT` item. **Phase 1
must start with one item, written and then read back, before anything else.**

## 3. The CSV's "Square Token" is a variation id, not an item id

All 484 tokens were absent from a full catalog walk, which first looked like the
items were gone. They are not. Two things were in the way, and both matter for
Phase 1:

- **The tokens are `ITEM_VARIATION` ids.** Square's Item Library CSV export
  emits one row per variation and its `Token` column is the variation id. All 61
  sampled tokens resolved as `ITEM_VARIATION`; every one has a parent `ITEM`
  reachable through `item_variation_data.item_id`. The event block lives on the
  **parent item**, so Phase 1 has to resolve token → parent before doing
  anything.
- ~~**`CatalogList` and `CatalogSearch` both omit archived items.**~~
  **Wrong — corrected 18 Aug.** The walks *do* return archived items: the
  current walk holds 1,004 items of which **754 are archived**. The 484 tokens
  were absent from the walk for the id-type reason above and that reason alone;
  archiving had nothing to do with it, and this note inferred a second cause
  that does not exist. 55 of the 61 sampled parents genuinely are archived, but
  that never hid them. The real lesson survives: address items **by id**, and
  never read absence from a walk as absence from the catalog — just not for the
  reason originally given.

Sample of 61 CSV rows, spread evenly across the file:

| | count |
|---|---|
| tokens that resolve | 61 / 61 |
| resolve as `ITEM_VARIATION` | 61 |
| parent `product_type` = `EVENT` | 60 |
| parent `product_type` = `REGULAR` | **1** |
| parent archived | 55 |
| parent already has an event block | 3 |

The `REGULAR` one is the interesting number. `product_type` **cannot be modified
once set**, so those rows can never hold a venue or a date by any API. At 1-in-61
that is roughly 8 of the 484; the exact list should be enumerated before Phase 1
so they can be reported rather than silently skipped.

## 4. Two reasons the CSV cannot be applied as delivered

**The year is missing.** `start_at`/`end_at` are RFC 3339 timestamps. The CSV
carries `November 16 at 7 PM`. The review note that shipped with it says so:
*"Year isn't in Start/End (descriptions don't carry it)... Say the word if you
want the year added from the showings dates."* The file has to be regenerated
with years before any date can be written. This is not a formatting detail — a
timestamp cannot be constructed without it.

**The venue value doesn't match the venue field.** The CSV's `Venue` column is
`508 S Main St, Moscow, ID 83843`, a street address, on all 484 rows. But
`event_location_name` holds a *name* — `Kenworthy Performing Arts Centre` — and
the street address lives in a separate object referenced by `address_id`.
Writing the street string into `event_location_name` would not match what the restored
items look like. The right move is to set `event_location_name` to the venue
name and reuse an existing `address_id`, which also makes the venue half of this
job independent of the CSV entirely — it's the same two constant values on every
row.

**`start_at` is a true UTC instant — settled.** Square stores
`2025-03-23T19:00:00+00:00` for `NT LIVE: THE IMPORTANCE OF BEING EARNEST`; our
own `showings` export holds `2025-03-23 19:00:00+00` for the same title.
Identical. The `event_location_time_zone` is a display hint, not an offset
applied to the stored value.

## 4a. Both problems are solved from data already on disk

Neither fix needs Square. Two exports we already hold are enough:

- `~/Downloads/kenworthy-showings-export.csv` — 1,437 showings with full
  `start_time` timestamps, **including the year**.
- `~/Downloads/Supabase Snippet Untitled query-5.csv` — the 1,279-row production
  export whose descriptions supplied the original month/day/time.

The descriptions say *which* run a title belongs to; the showings rows supply the
instants. `scripts/build-venue-dates-v2.py` joins them and writes
`square-venue-dates-v2.csv`:

| | count |
|---|---|
| rows | 484 |
| `event_location_name` (constant) | 484 |
| **`start_at` as a real timestamp** | **259** |
| `end_at` | 161 |
| had a description date but no matching showing — year unknown | 30 |
| never had a date (the `NEEDS DESCRIPTION` set) | 195 |

Two independent checks that the conversion is right:

- `BARBIE`'s description reads "September 1 at 7 PM"; converting that as local
  Pacific gives `2023-09-02T02:00:00+00:00`, exactly what `showings` stores.
- `NT LIVE: THE IMPORTANCE OF BEING EARNEST` regenerates as
  `2025-03-23T19:00:00+00:00` — byte-identical to the value **Square itself
  already holds** for that item. That is the strongest confirmation available:
  our pipeline reproduces Square's own data for the one item where both exist.

The showings export averages ~1.2 rows per title, so it cannot rebuild a
multi-day run alone; the run's end comes from the description's `End` combined
with the year from the matched showing. `A COMPLETE UNKNOWN` comes out
`2025-02-07T21:00:00+00:00` → `2025-02-10T03:00:00+00:00` (Feb 7 1 PM → Feb 9
7 PM Pacific), matching the "Feb 7 → Feb 9" span the review note described.

One discrepancy worth knowing: for `MET Live in HD: MEDEA` the regenerated
`end_at` matches Square's stored value exactly, but the `start_at` is 2 hours
earlier than Square's. Our historical MET import looks approximate on start
times. It affects a small number of MET rows and should be spot-checked rather
than trusted wholesale.

## 5. The blocks are still being destroyed

Of 838 `EVENT` items in the live catalog, only **38** still carry an event
block. The `updated_at` split is stark:

| event block | last modified | count |
|---|---|---|
| **missing** | 2026-08-17 (today) | **770** |
| missing | 2026-08-15 | 12 |
| missing | 2026-08-14 | 7 |
| present | 2026-05-02 | 32 |
| present | 2026-08-17 (today) | 3 |

The surviving blocks are almost all untouched since May. The empty ones cluster
on today. The leading explanation is today's dashboard CSV import work — a
Square Library CSV has no columns for event fields, so an import round-trip
drops them, exactly as the Aug 14 push did. The 3 present-and-modified-today are
consistent with the handful restored by hand.

This reframes the job. It is not "add data that was never there" — it is
**restoring data that is actively being destroyed**. Repairing 484 rows while
the process that empties them is still in use will not hold. Worth confirming
against Square's own item history for one affected item before accepting this
reading, but the timestamp pattern is the same kind of evidence that identified
the Aug 14 overwrite, and it points the same way.

## 6. What Phase 1 would look like, if approved

Not started, and it should not start until §4 is resolved.

1. ~~Regenerate the CSV with **years**~~ — done, `square-venue-dates-v2.csv`.
2. Set venue from constants (`event_location_name` + an existing `address_id`),
   not from the CSV's address column.
3. For each row: resolve variation token → parent item → `RetrieveCatalogObject`
   → mutate **only** `item_data.event` → `UpsertCatalogObject` with the returned
   `version`, asserting every other field is byte-identical.
4. **One item first**, then read it back and confirm Square stored it. A 2xx is
   not acceptance. Then 10. Then the rest.
5. Skip and report the `REGULAR` items; they cannot be fixed.
6. Take a full catalog export as a pre-write snapshot first.

## 7. Housekeeping

`square-event-probe` was deployed to production Supabase to run this
investigation, because the Square token exists only as a Supabase secret. It is
read-only (it refuses any non-GET except `CatalogSearch`) and admin-gated. It was
deliberately a **new** function rather than an action on `square-catalog-sync`,
because prod runs that one from an uncommitted worktree and redeploying it from
`main` could revert unmerged work. Delete it when it is no longer wanted:

```
supabase functions delete square-event-probe --project-ref vlmslygnimfbamrtwvyo
```

**Done 2026-09-04.** The production deployment is removed; the endpoint answers
404. It had outlived its own stated end by two and a half weeks — Phase 1 landed
on 18 August and this note has said "delete it" since.

The **source stays in the repo**, deliberately. Three documents cite this
function as the evidence for their conclusions —
`SQUARE-TRANSACTION-CONVENTIONS.md`, `square-catalog-history-recovery.md` and
`briefs/FINDINGS-analytics-square.md`, the last by line number — and deleting the
file would strand those citations. What was removed is the *deployment*, not the
record. If the investigation is ever reopened it is one `functions deploy` away,
and `scripts/square-inspect-events.mjs` does the same discovery from a laptop
meanwhile.

Nothing was lost and nothing was exposed while it sat there: it is admin-gated
and refuses any non-GET except CatalogSearch, both verified in the code rather
than taken from this comment. It was removed because a debug endpoint that has
finished its job is the kind of thing still running in a year because nobody
decided.

`scripts/square-inspect-events.mjs` does the same discovery from a laptop, given
a `SQUARE_ACCESS_TOKEN`. It was written before the edge-function route worked
and is kept because it needs no deploy.

## 8. Sources

- [CatalogItem](https://developer.squareup.com/reference/square/objects/CatalogItem)
- [CatalogItemProductType](https://developer.squareup.com/reference/square/enums/CatalogItemProductType)
- [New front-end event creation impacting catalog search](https://developer.squareup.com/forums/t/new-front-end-event-creation-impacting-catalog-search/25384)
- [Sell non-physical items in Square Online](https://squareup.com/help/us/en/article/6873-sell-non-physical-items-in-square-online-store)

## 9. Outcome — Phase 1 applied, 2026-08-18

Run in two passes through `square-event-write`, dry-run by default, batch-capped,
with a diff assertion before each send and a read-back after it.

### Gate test

One item first: `THE GREEN KNIGHT` (archived, Aug 2021, no event block), venue
only. Square accepted the write and minted its own event `uid`. That settled
four unknowns at once — `item_data.event` **is** writable; an **archived** item
can be upserted; an **`EVENT`** product-type item can be upserted despite the
reference saying Connect V2 only allows *creating* `REGULAR` and
`APPOINTMENTS_SERVICE`; and a single `address_id` **can be shared** across items
rather than each needing its own.

It also produced one scare worth recording. The read-back reported
`item_data.variations` as a collateral change — the Aug 14 damage class — and the
run halted. It was a false alarm caused by the diff itself: arrays were compared
whole, so the nested `version`/`updated_at` bump that every successful upsert
causes surfaced as one useless path. Confirmed harmless against the 2026-08-17
catalog export, which is an independent pre-write record: the variation's id,
name and $8.00 price were unchanged, the description was already empty
beforehand, and the category was untouched. The diff now walks arrays element by
element and excludes only the `version` and `updated_at` leaves, so a real price
or name change would still report.

### Results

| pass | attempted | written | skipped (`REGULAR`) | collateral changes | accepted-but-not-stored |
|---|---|---|---|---|---|
| venue | 484 | 480 | 4 | **0** | **0** |
| dates | 259 | 259 | 0 | **0** | **0** |

Verification, read back from Square rather than inferred from response codes:

- **Venue** — a 61-item sample spread across the file: 60 carry
  `event_location_name = "Kenworthy Performing Arts Centre"`. The single miss is
  `01 Adult`, a `REGULAR` item that structurally cannot hold one.
- **Dates** — all **259** re-read individually. 258 matched on the first sweep;
  the one failure was a Square `429 RATE_LIMITED — "Catalog locked by prior
  request"` from running three writers concurrently, and it was repaired
  serially and re-verified. Final state: **259/259 correct**.

One reported mismatch was benign: `FUNDI: THE STORY OF ELLA BAKER` had a
pre-existing `end_at` that the writer deliberately preserved because we sent
none. Its `start_at` matches exactly. Keeping existing fields rather than
overwriting them is the intended behaviour.

### Operational notes for a re-run

- Square **locks the catalog during an upsert**, so concurrent writers earn
  `429 RATE_LIMITED`. Three workers produced exactly one collision in 259 writes;
  more concurrency would produce more. Prefer serial, or keep a repair sweep.
- The whole thing is **idempotent** — re-running writes the same values.
- The read-back sweep is the real check. Run it after any bulk pass rather than
  trusting the tally.

### What is still not fixed

**The bleed.** 770 of 838 `EVENT` items lost their event block on 2026-08-17,
and a Square Library CSV export has no columns for event fields. Any further
dashboard CSV import round-trip will strip venue and dates again, from these
items and every other one. This pass restores the 484 listings in scope; it does
nothing to stop the next import undoing it. That workflow needs to change, or
this repair will need repeating.

**Coverage.** 30 listings have a description date whose year could not be
recovered, and 195 never had a date at all — they carry the venue only. Around 8
of the 484 are `REGULAR` items that can hold neither, permanently.
