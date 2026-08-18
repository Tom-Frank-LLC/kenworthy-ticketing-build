# Runbook — keeping the Square catalog intact

**18 August 2026.** How the catalog gets damaged, why it kept happening
unnoticed, and what to do about it. Companions:
`INCIDENT-2026-08-14-square-catalog.md`, `venue-date-square-mechanism.md`,
`square-catalog-history-recovery.md`.

## The one root cause

**Square's `UpsertCatalogObject` replaces the whole object. Every field not sent
back is deleted.** Three separate incidents share that single mechanism:

| when | trigger | lost |
|---|---|---|
| 14 Aug | `pushItem` rebuilt items from four of our columns | 906 items: descriptions, images, categories, every variation past the first |
| 15–17 Aug | dashboard **CSV import** round-trips | per-showtime variations re-flattened |
| 17 Aug | dashboard **CSV import** round-trips | `item_data.event` (venue + date) on 770 of 838 `EVENT` items |

The code fault was fixed in August: `pushItem` is read-modify-write now, and
`toggleActive` no longer pushes at all.

**The CSV fault is not code and cannot be fixed in code.** Nothing in this repo
imports CSV — a search finds only *exports* (timecards, attendee sheets, the QBO
journal). The damage is done by a person in the Square dashboard.

## Why CSV round-trips destroy things

A Square Item Library CSV is a flat, one-row-per-variation file. It has:

- **no column for the event block.** Venue, `start_at`, `end_at` are an
  undocumented `item_data.event` structure. A CSV cannot carry them, so
  re-importing an item **always** strips them.
- **no way to express a variation set.** Rows that are absent from the file are
  variations that get deleted. Export a filtered view, edit, re-import, and every
  variation you filtered out is gone.

So a round-trip is lossy by construction, not by mistake. It is not a matter of
being careful with the file.

## Rule

> **Do not use the Square dashboard's CSV import on this catalog.** Not for bulk
> edits, not for price changes, and above all not for restores.

Export is fine — reading is harmless. It is the **import** that deletes.

### What to do instead

| you want to… | use |
|---|---|
| fix categories in bulk | `square-catalog-sync` → `repair_categories` (dry-run first) |
| restore descriptions/images | `square-catalog-restore` (reads version history) |
| restore flattened variations | `square-variation-restore` |
| set venue / event dates | `square-event-write` |
| change one item's price or name | the Square dashboard **item editor** — editing one item in the UI is a normal edit, not a replace |
| add per-showtime variations | `square-showing-variations` |
| find out what is broken right now | `square-catalog-guard` → `check` |

Every one of those is read-modify-write, dry-run by default, and reads back after
writing.

## The guard

The real failure both times was not the deletion — it was that **nobody knew**.
The Aug 14 overwrite was found days later by noticing that `square_synced_at`
matched each row's own `updated_at`. The Aug 17 bleed was found because somebody
ran a probe on a hunch. Neither was caught by a system.

`square-catalog-guard` is that system.

```jsonc
// Record what the catalog looks like now. Writes nothing to Square.
{ "action": "snapshot" }

// Walk it again and report what was LOST. Writes nothing to Square.
// This is the default action and is safe to run on a schedule.
{ "action": "check" }

// Put back what version history still holds. Gated and capped.
{ "action": "repair" }                                             // dry run
{ "action": "repair", "dry_run": false, "confirm": "REPAIR", "max_batch": 5 }
```

It reports **loss only** — `lost_event_block`, `lost_variations`,
`lost_category`, `vanished`, and `flattened_to_regular` (the Aug 14 signature: many
variations replaced by one named "Regular"). A catalog that legitimately grows —
new items, new showtime variations, a renamed film — reports nothing, because an
alarm that fires on ordinary editing is an alarm everybody learns to ignore.

Variations are matched **by id**, so a rename is not mistaken for a deletion.

### Repair reads Square, not us

Square keeps historical catalog versions and serves them from the ordinary read
endpoints:

```
GET /v2/catalog/object/{id}?catalog_version=<epoch ms>
```

So a repair pulls the **authentic prior object** from Square as of the last
known-good instant, takes the missing field out of it, and applies that field to
the object Square holds *now*. It never rebuilds an item from our columns — that
is exactly what destroyed 906 items. The baseline table records *shape*, so we
know what went missing; it is deliberately not enough to reconstruct an item
from.

Restored variations come back with **new ids** (Square will not take a deleted id
back). Sales history is unaffected: Square order lines carry the name,
variation name and price on the order itself, not by reference.

## Running it

1. **Snapshot once**, after the catalog is in a state worth defending.
2. **Check on a schedule.** There is no scheduler in this repo yet — the check
   needs one wired at deploy time (pg_cron + pg_net, or any external caller with
   an admin JWT). Daily is enough to catch a bleed inside one working day;
   hourly if a bulk edit is underway.
3. **Re-snapshot after any deliberate bulk change**, otherwise the next check
   reports your own intended work as loss.

A repaired item is re-baselined automatically, so the same finding does not
repeat forever.

## Known limits

- **A loss is only detectable against a baseline.** Anything deleted before the
  first snapshot is invisible to the guard; use the version-history restores for
  that.
- **Version history is not infinite.** Repair depends on Square still serving the
  object at the known-good instant. The sooner a check runs after the damage, the
  more likely the repair works — which is the argument for scheduling it.
- **`lost_category` is reported but not repaired here.** Category writes have a
  writable-shape hazard at this API version (`item_data.categories` is derived and
  silently ignored); `square-catalog-sync`'s `repair_categories` already handles
  that correctly and should keep owning it.
- **The guard cannot stop the import.** It shortens the time-to-discovery from
  days to one cycle and makes the repair a single call. Prevention is the rule at
  the top of this page.

## Deployed state, 18 August 2026

`square-catalog-guard` is deployed to **production** (`vlmslygnimfbamrtwvyo`) and
to staging, and the baseline tables are migrated on both.

### The first real reading

```
snapshot →  items_seen 1002 · EVENT items 837 · with_event_block 500
            total_variations 1654
check    →  1002 baselined, 1002 healthy, no findings
```

Two things worth drawing out of that:

- **337 `EVENT` items still have no event block.** Phase 1 restored the 484
  listings that were in scope (480 written); these are the remainder, which were
  never in scope. They are not new damage, but they are the population a future
  venue/date pass would target.
- **Phase 1's work is still intact.** 500 items carry a block, which is the ~480
  Phase 1 wrote plus those that never lost one. Had a CSV round-trip run since
  18 August, that number would have fallen. So there is **no evidence the bleed
  has recurred** — but note this is one reading against a baseline captured the
  same day. The point of the schedule is that the *next* drop is detectable
  without anybody having to suspect it.

### Still to do

The check has no scheduler. Until one is wired, it only runs when somebody calls
it, which is most of the problem it was built to solve. Daily is enough to catch
a bleed inside one working day.

Re-snapshot after any deliberate bulk change, or the next check reports your own
intended work as loss.
