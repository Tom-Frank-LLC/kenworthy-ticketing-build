---
brief: square-link-ignore-archived
title: Linking a production or pass to Square ignores archived items, and an archived-only title says "unarchive" instead of "create"
status: built
track: bug
severity: P1
date: 2026-10-22
verified: false
---

# Square item linking should ignore archived items

**Reported by:** staff, via Tom. Linking a ticket listing to Square "searches
through archived events as well as active ones". A new **Backcountry Film
Festival** listing reported more than one Square item with that name; only one
is active, the rest are archived.

## Cause

`supabase/functions/square-showing-variations/index.ts` matched a title to Square
items by name and product type only. `/v2/catalog/list` returns archived items
alongside live ones, and the archived state (`item_data.is_archived`) was read
nowhere in matching:

- **Productions**: `resolveItem` took every EVENT item with the title. One live
  item plus archived namesakes counted as several, became `ambiguous_title` →
  `ambiguous_item`, and nothing was linked.
- **Film passes** (`plan_film_passes`): `exactAll` did the same for non-EVENT
  items, so `matching_items` counted archived duplicates. The per-variation
  `archived` badge was computed from `is_deleted` only, so an archived item
  never showed as archived either.

A side effect worth knowing: the ambiguous-item message told staff to "archive
the duplicate in Square". Before this fix, doing that changed nothing, because
archived items were still counted.

`is_archived` was added to `CatalogItem` at Square API version 2023-08-16
([changelog](https://developer.squareup.com/docs/changelog/connect-logs/2023-08-16)),
before the `2024-01-18` we pin, so the field is present on what we read.

## Change

- `_shared/square-catalog.ts`: `exactTitleMatches(items, title, accept)` returns
  the exact-title matches split into `active` and `archived` (deleted items
  dropped). `isArchivedItem(item)` reads `item_data.is_archived`.
- Both match sites use it. Only `active` items are candidates and count toward
  ambiguity or `matching_items`.
- **Archived-only titles get a new status, `archived_match`** (production plan
  rows, `needs_dashboard_item`, and pass rows), carrying `archived_items`. Simply
  hiding archived items would have turned "Square has this, archived" into
  `needs_item`, whose advice is to create an item — a fresh duplicate. The UI
  (`SquareCatalogTab`, `SquareLinkPanel`, and the save toast in
  `src/lib/squareLink.ts`) says to unarchive it in Square and refresh. A pass in
  this state is not offered "Create in Square" (and `create_pass_item` still
  counts archived items as clashes, so it would refuse anyway).
- Variation `archived` badges now include `is_archived`. Archived same-name items
  are left out of a pass's "also filed under 9 Film Passes" options, since they
  are the duplicates the name match set aside.

Unchanged: a production or pass already linked by stored id resolves by that id
first, archived or not. Fuzzy `possible_matches` suggestions still include
archived items. Dropping them would recreate the "create a duplicate" problem for
a near-title archived item. The append path (read-modify-write, diff assertion,
read-back) is untouched; this change only narrows which item a title resolves to.

## Tests

- `square-showing-variations/archived_items_test.ts` drives the real handler
  with a stubbed catalog: one live + archived namesakes resolves to the live item
  (`title_match`, no `needs_dashboard_item`); two live items stay
  `ambiguous_item`; archived-only is `archived_match`; passes no longer count
  archived duplicates. Four of its six tests fail against the pre-fix function.
- `_shared/square_catalog_test.ts` covers `exactTitleMatches`, and
  `src/lib/squareLink.test.ts` covers the `archived_match` save message.

## Still to check (data, not code)

The fix only helps if the Backcountry duplicates really are **archived** in
Square, not just old. Any still-active namesake will keep the title ambiguous;
the remedy then is to archive it in the dashboard. Linking by hand remains
available either way.

The related brief this was written against, `BRIEF-create-in-square-not-taking.md`,
is not in the repo, so it was not cross-checked beyond the code. The append path
it concerns is untouched here.
