> **CORRECTION, 18 Aug 2026 — the damage is recoverable after all.**
> This note concluded that descriptions, images and extra variations "cannot be
> restored from here — only from a Square-side backup or export". **That was
> wrong.** Square retains historical catalog versions and serves them through
> the ordinary Catalog API: pass `catalog_version=<epoch ms>` to a read and you
> get the catalog as it stood at that instant. No export, no Support ticket.
> Reading as of 14 Aug 21:00 UTC — after the over-pull, before the 22:27
> overwrite — **682 descriptions and 539 images** that are gone today came back,
> and the `IMAGE` objects they point at still exist and are undeleted. Captured
> to `square-catalog-PRE-DAMAGE-2026-08-14T21-00Z.json` (989 items, 3.5 MB).
> See `docs/square-catalog-history-recovery.md`. The claim below stood
> unchallenged for four days because nobody tested it; the test was one query
> parameter.

# Incident — Square catalog over-pull and overwrite (14 Aug 2026)

Two separate faults in `square-catalog-sync`. The first flooded the public site
and was visible immediately. The second damaged the **live Square catalog** and
was invisible from the site — it was found only by looking at timestamps.

## What happened

**19:41 UTC — the over-pull.** Someone clicked "Pull from Square". The pull
listed every `ITEM` in the catalog with no scoping and wrote all of it into
`concession_items`, stamping `is_active: !o.is_deleted`. The Kenworthy's Square
catalog is their entire sales history, so **998 rows** — past films, MET
broadcasts, rentals, posters, passes — landed as *active* concessions on the
live home page.

**22:27–23:09 UTC — the overwrite.** The flood was cleared by switching items
off by hand in the admin UI. `toggleActive` called `pushToSquare`, and
`pushItem` rebuilt the Square object from our four columns:

```
item_data: { name, variations: [{ name: "Regular", price_money: … }] }
```

Square's `UpsertCatalogObject` **replaces** the object it is given. Every field
not sent is cleared. So each toggle overwrote a live catalog entry, losing its
description, images, category, taxes, and any variation past the first.
**906 items** were pushed this way.

## How the overwrite was identified

`is_active` is not a Square concept and was never sent, so nothing looked wrong
in Square's dashboard — items remained present and available. The signal was
`square_synced_at`, which only `pushItem` writes, and only after a 2xx:

```sql
SELECT date_trunc('minute', square_synced_at) AS m, count(*),
       count(*) FILTER (WHERE abs(extract(epoch FROM (square_synced_at - updated_at))) < 5)
FROM concession_items WHERE square_catalog_id IS NOT NULL GROUP BY 1 ORDER BY 1 DESC;
```

Every row's `square_synced_at` matched **its own** `updated_at` within 5s,
spread across ~40 minutes. A bulk pull stamps all rows with one timestamp; only
per-item pushes produce that pattern. Confirmed independently by Tom in the
Square dashboard.

### Scope of the damage

| | Count |
|---|---|
| Items pushed (overwritten) | 906 |
| …that had a real category to lose | **401** |
| …that were already uncategorized | 505 |

The 505 were **already uncategorized before the incident** — the pull recorded
them as `General` at 19:41, ~3 hours before the first push. That is pre-existing
catalog disorganization, not damage.

Only the category is recoverable, because `concession_items.category` held the
Square category *name*. Descriptions, images, taxes and extra variations were
never stored on our side and **cannot be restored from here** — only from a
Square-side backup or export.

## Why clicking through the admin list could not finish the job

`ConcessionItemsTab.loadItems` was unpaged, and PostgREST truncates at 1,000
rows with no error. With 1,006 rows in the table the admin list could never show
the tail, so the last items stayed active and invisible. Both this and
`ConcessionsPreview` are paged with `fetchAllRows` now.

## Fixes

| Fault | Fix |
|---|---|
| Pull imported the whole catalog | Category allowlist in `app_config.square_concession_categories` (8 categories, 60 items) |
| Pull auto-activated everything | Never sets `is_active` on an existing row; new rows staged **inactive** |
| One-click mass import | `preview` action dry-runs with per-category counts; server refuses >200 items |
| Push destroyed Square objects | `pushItem` is **read-modify-write** — retrieves the object, edits only name and the tracked variation's price |
| Toggling pushed to Square | `toggleActive` no longer pushes at all |
| Delete removed from Square | Site-only by default; Square deletion is a second explicit confirmation |
| 1,000-row cap | Both concessions selects paged |

## Recovery artifacts

`square_catalog_snapshot_20260814` — 998 rows, every Square item as it stood
before the damage, with `likely_overwritten` flagged. RLS on, revoked from
`anon`/`authenticated`. **This is the only source for the category repair**, and
it had to be captured before the out-of-scope rows were deleted from
`concession_items`.

`repair_categories` drives the repair from it, from the admin UI:

- `mode=restore` — re-files the 401 items whose category was wiped.
- `mode=organize` — files items Square never categorized (44 proposed:
  17 MET, 11 NT Live, 8 merch, 6 passes, 2 redeem), matching anchored prefixes
  and word boundaries only. Substring matching is what filed
  `GUILLERMO DEL TORO'S PINOCCHIO` under merch, for containing "pin".

Both dry-run by default and list every affected name; applying passes
`only_names`, so a reviewed list can have entries dropped first.

## Cleanup performed

938 out-of-scope Square rows deleted from `concession_items` **via SQL** — the
database has no hook back to Square, so this never contacted the API. 68 rows
remain: 60 real Square concessions (inactive) and 8 hand-made (3 active).

## Category restore — done (15 Aug)

All 381 wiped categories are back on the live catalog. **Confirmed by
re-measurement, not by the tool reporting success:** a fresh dry run reads the
live catalog and compares it against the snapshot, and it now returns **0
mismatches** — the same measurement that originally found 392.

It took three failed attempts, each instructive:

1. **381 of 392 rejected** — the write set `category_id` *and* `categories`,
   which puts two entries at ordinal 0:
   `duplicate int value 0 ... for attribute additional_category`.
2. **The whole run died with no body** — supabase-js reported only
   "Edge Function returned a non-2xx status code". Adding an error-triggered
   fallback made it three sequential Square calls per item; ~1,200 round trips
   exceeded the edge function's wall clock. Fixed by batching 40 at a time.
3. **1,040 writes on a 381-item job** — the batch loop re-planned from
   `/catalog/list`, which does not reflect a write made a second earlier, so
   repaired items looked unrepaired and were written again. Not destructive
   (read-modify-write, re-setting the same value) but pure churn. Fixed by
   tracking the remaining set on the client instead of asking Square.
4. **Reported success, changed nothing.** `item_data.categories` is *derived,
   not writable* at `SQUARE_API_VERSION` 2024-01-18: sending it is accepted and
   discarded, while clearing `category_id` removes the field that counts. A
   well-formed no-op returning 200. An error-triggered fallback cannot catch a
   failure that never errors — the write now reads the category back out of
   Square's own response and only counts an item if it stuck.

## Poster restore — done to 55% (15 Aug)

**196 of 355 poster-bearing items have their artwork back**, at no cost: no
TMDB, no API key, no vision model, and no licensing question at any step. Each
attachment was confirmed by reading `image_ids` back off the item.

| Source | Items |
|---|---|
| kenworthy.org event calendar | 117 |
| Square's own orphaned images, re-attached | 79 |
| **Attached** | **196** |
| Left unsourced | 156 |

Two sources, both free, both found by questioning the framing rather than by
building:

**The theatre's own website.** kenworthy.org runs Modern Events Calendar with a
public REST API — 1,518 past events, 1,368 carrying a poster. That is
title → poster, and the Square items know their titles, so the repair is a
string join. Tom suggested this after a vision-model design had already been
written; it was better on every axis and the vision tool went unused.

**The orphaned images themselves.** 954 of the 1,039 orphans carry a filename.
An earlier pass reported 0 of 1,040 matchable, which read as "they have no
names" — that was a matcher bug, not missing data. Filenames carry production
noise the catalog title never has (`square`, `web`, `scaled`, `-200x300`,
`poster`, `final`), and they are *abbreviated*: `square butch.jpg` for
BUTCH CASSIDY AND THE SUNDANCE KID. Stripping the noise and matching by
containment rather than equality turned 0 into 79 — required unique in both
directions, since an image matching two items is as unusable as the reverse.

Re-attaching an orphan is also the cleanest possible source: the theatre's own
image, already in their account, going back where it was. Nothing is acquired,
so nothing needs licensing. (TMDB was ruled out separately — its licence does
not cover commercial use, and a cinema selling tickets is commercial.)

**The remaining 156 are accepted as collateral damage** (Tom, 15 Aug) — relinked
by hand if and when a specific listing needs its art. They break down as ~60
ambiguous filename matches (`square black.jpg` legitimately matches several
titles), 85 orphans with no filename at all, and local live acts whose artwork
may not survive anywhere.

## Still open

- **Variations.** Damaged items have *no variation at all* — confirmed in the
  dashboard. An item with no priced variation generally cannot be rung up, so
  this matters more than the categories did. It affects tickets and merch; the
  concession stand was never touched. Restorable in principle: the snapshot holds
  each item's real `square_variation_id` and price, though the variation *name*
  is lost and would come back as `Regular`.
- Descriptions and images on the 906 items — needs a Square
  export or Square Support; nothing on our side can reconstruct them.
- `Poster Design` and `Poster Print` are proposed as merch but look like
  billable services.
- `SILENT FILM FESTIVAL PASS` exists **three times** in Square — duplicate SKUs,
  unrelated to this incident.

## Rules this leaves behind

1. **Never reconstruct a vendor object from our columns.** We store four fields;
   Square stores dozens. Anything built from scratch is a deletion of the rest.
   Read-modify-write, always.
2. **An import must be scoped and must not self-publish.** Arriving inactive is
   what makes a mis-scoped pull survivable.
3. **Vendor-side damage is invisible from our UI.** The site looked fine
   throughout. Timestamps were the only evidence.
