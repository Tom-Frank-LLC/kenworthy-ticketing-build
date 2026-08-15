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

## Still open

- Descriptions, images and extra variations on the 906 items — needs a Square
  export or Square Support; nothing on our side can reconstruct them.
- `Poster Design` and `Poster Print` are proposed as merch but look like
  billable services.
- `SILENT FILM FESTIVAL PASS` exists **three times** in Square — duplicate SKUs,
  unrelated to this incident.
- The frontend changes are committed but not yet deployed.

## Rules this leaves behind

1. **Never reconstruct a vendor object from our columns.** We store four fields;
   Square stores dozens. Anything built from scratch is a deletion of the rest.
   Read-modify-write, always.
2. **An import must be scoped and must not self-publish.** Arriving inactive is
   what makes a mis-scoped pull survivable.
3. **Vendor-side damage is invisible from our UI.** The site looked fine
   throughout. Timestamps were the only evidence.
