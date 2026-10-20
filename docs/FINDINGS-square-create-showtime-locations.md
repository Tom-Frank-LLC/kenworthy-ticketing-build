# FINDINGS: "Create in Square" refused a showtime because of the item's locations

**Date:** 19 Oct 2026 · **Brief:** `docs/briefs/BRIEF-square-create-showtime.md`

## Report

Admin → Live Events → "Showtimes in Square" listed one showtime to create,
**Backstage Stories: Ghost Stories — General Admission · Sunday, November 1 at
7 PM · $10.00**. Each Create click spun, re-read the catalog and left it listed.
The staffer then added the variation by hand in the Square dashboard, and the
next run recorded it. That one showtime needs no further repair.

## What actually happened (production `admin_audit_log`, UTC)

| time | call | outcome |
|---|---|---|
| 23:33:05 | `ensure_showing` (form save) | `needs_item`: no Square item had that title yet |
| (between) | staffer makes the EVENT item `2GH7LUXNVVURZFZYJJLHDPUT` in the dashboard | catalog 939 → 940 items |
| 23:36:11 | `apply`, max_batch 1 | `error`: **Square 400** |
| 23:36:31 | `apply`, max_batch 1 | `error`: **Square 400**, same message |
| 23:38:20 | `apply` | `adopt_existing` ×1: the hand-made variation `OJSRRY2ATIU76X6IFO2GN6TL` recorded in `showing_square_variations` |

The 400 in full:

> `[object_id=#showing-7977fc0b-…] Object KDVA6KYFZ4XEMEKL5GK6RMKH of type
> ITEM_VARIATION is enabled at all future locations, but the referenced object
> with token 2GH7LUXNVVURZFZYJJLHDPUT of type ITEM is not.`

(The variation id is different on each attempt because it is the id Square gave
our new variation. It is not an existing one.)

Query to reproduce: `select * from admin_audit_log where action like
'square_catalog.%' and created_at > '2026-10-19 23:30Z' order by created_at;`

## Cause

`square-showing-variations` appended the new variation with no location fields.
Square defaults a variation without them to `present_at_all_locations: true`,
and it refuses a variation that is present anywhere its parent item is not.
Every item the function had written to before was itself at all locations, so
this never failed. The item made in the dashboard on 19 Oct was limited to
specific locations, so every append to it was refused.

This was not a recent regression. The append code had not changed since #374,
and before that it had always omitted location fields.

## What the brief suspected, and why it wasn't that

- **Not an EVENT item.** The planner classifies a non-EVENT item as
  `not_event_item` (`index.ts`, classify step), and that status is never in the
  "to create" list. So it can't cause a showtime to loop there.
- **DST name mismatch between plan and apply.** Both read `variation_name` from
  the same `desiredVariations()` call in the same request, so they can't
  disagree. The fall-back-day name is still now pinned by a test
  (`square_catalog_test.ts`: "fall-back day").
- **Collateral-change guard, accepted_but_not_stored.** Neither happened. The
  outcome was `error`.

## Fix

1. `locationPresenceOf(item)` in `_shared/square-catalog.ts` copies the parent
   item's `present_at_all_locations` / `present_at_location_ids` /
   `absent_at_location_ids`, and the appended variation carries them. The
   diff guard is unaffected: the fields sit on the new element, so the diff is
   still `item_data.variations.length` alone (tested).
2. The panel lists each showtime Square did not take, with the reason from
   `results[]`. Before, the reason was in the response, but the staffer only
   saw "1 did not go through. Re-run, or check the logs."

## Not verified

The fix has not been run against an item limited to specific locations. The
shape follows from Square's error text and its documented location rules.
`square-variation-restore` has the same blind spot: it copies the historical
variation's `present_at_all_locations` and nothing else. It was left alone
because it only restores onto items that were damaged in August, which were at
all locations.
