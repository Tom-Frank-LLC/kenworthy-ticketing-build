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

## Restoring is not done

Only that the data is *readable* has been established. Putting it back is a
write pass over ~682 items and has not been attempted or approved. Notes for
whoever does it:

- Read-modify-write, as always. Take the historical object, copy `description` /
  `description_html` / `image_ids` onto the **current** object, and send that
  back. Do not send the historical object wholesale — it predates every
  legitimate change since, including the venue and dates written on 18 August.
- Square **locks the catalog during an upsert**, so concurrent writers earn
  `429 RATE_LIMITED — "Catalog locked by prior request"`. Go serial.
- A 2xx is not evidence. Read back and compare.
- `square-catalog-CURRENT-2026-08-18.json` is the rollback point.
