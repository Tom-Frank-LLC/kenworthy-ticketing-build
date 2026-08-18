# The Square catalog has version history, and the Aug 14 damage is readable

**18 Aug 2026.** Correction to `INCIDENT-2026-08-14-square-catalog.md`, which
concluded that the descriptions, images and extra variations destroyed on 14
August could only come back "from a Square-side backup or export". They are
readable from Square's own API, and always were.

## The mechanism

Square keeps historical versions of catalog objects and serves them through the
ordinary read endpoints. Add `catalog_version=<epoch milliseconds>` to
`RetrieveCatalogObject` or `ListCatalogObjects` and the response is the catalog
as it stood at that instant.

```
GET /v2/catalog/object/{id}?catalog_version=1786741200000
GET /v2/catalog/list?types=ITEM&catalog_version=1786741200000
```

`1786741200000` is 2026-08-14 21:00 UTC — after the over-pull at 19:41, which
only wrote to our database, and before the destructive pushes that ran
22:27–23:09.

## What it gives back

Comparing that walk against today's catalog:

| | count |
|---|---|
| items whose **description** is gone today but present then | **682** |
| items whose **images** are gone today but present then | **539** |
| items that still have their description | 85 |
| items in the historical walk | 989 |

`THE GREEN KNIGHT` is representative. Today: empty description, no image. As of
14 Aug 21:00: a 509-character Moscow Film Society write-up and image
`ZRIAZGFHUVUBMDSS7ZUZGPK7`.

The images are not dangling references. That `IMAGE` object still exists —
`is_deleted: false`, a live S3 URL, filename `square GREEN.jpg`. Re-linking the
`image_ids` restores real pictures.

These counts are a floor, not a ceiling: both walks omit archived items, and
many listings were archived on 17 August.

## The snapshots

Square documents no retention window for catalog history, so it is not something
to depend on. Both states are now files we own:

| file | contents |
|---|---|
| `square-catalog-PRE-DAMAGE-2026-08-14T21-00Z.json` | 989 items, 3.5 MB, 767 with descriptions, 771 with images |
| `square-catalog-CURRENT-2026-08-18.json` | 1,004 items, 1.6 MB |

The size difference is the damage, in bytes.

Captured by `square-event-probe` with `snapshot_version`, which walks the
catalog at that version, writes the JSON to the private `catalog-snapshots`
Supabase Storage bucket, and returns a one-hour signed URL to pull it down.

## Why this was missed for four days

The incident note asserted the data was unrecoverable, and every subsequent
session treated that as settled fact and planned around it — including the
venue/date restore, which was scoped as "fill in what was lost" precisely
because refilling by hand looked like the only option.

Nobody tested the assertion. The test is one query parameter, and it took about
a minute. **A conclusion that closes off a whole class of solution deserves a
cheap experiment before it is written down as fact** — especially one that is
going to be read as a constraint by everyone who comes after.

## The restore — done, 18 Aug 2026

Run through `square-catalog-restore`, dry-run by default, with a diff assertion
before each write and a read-back after it.

| | count |
|---|---|
| items in scope | 704 |
| **restored** | **694** |
| already restored (idempotent no-op) | 10 |
| accepted-but-not-stored | **0** |
| collateral changes | **0** |
| errors | **0** |

Verified by re-running the plan afterwards: **0 items still needing a
description or an image**. Down from 682 and 539.

The rule that mattered: the historical object was never sent back wholesale. It
predates every legitimate change since — including the venue and event dates
written the same day. Each write took the **current** object and copied the
three lost fields onto it. `THE GREEN KNIGHT` is the proof the layers compose:
it now carries its restored 509-character description, its image, the venue, and
its event dates, all at once.

Two Square behaviours were checked rather than assumed, then whitelisted:

- `description_plaintext` is derived read-only. Restoring a description
  repopulates it to a matching length without our sending it.
- Square **normalises whitespace** in `description`: a historical value with
  three consecutive newlines comes back with two, every other character
  identical. So a restored length landing 1–2 characters short of the historical
  one is expected, not a failure.

Left alone, deliberately: **extra variations**, also lost on 14 August. They
carry prices and SKUs and are referenced by orders, so resurrecting them is a
separate decision with a different risk profile.

Operational note: Square locks the catalog during an upsert, so concurrent
writers earn `429 RATE_LIMITED — "Catalog locked by prior request"`. Three
workers with a single retry-after-pause absorbed every collision — zero losses
across 704 items. `square-catalog-CURRENT-2026-08-18.json` remains the rollback
point.
