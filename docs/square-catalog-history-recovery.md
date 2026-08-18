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

These counts cover every item in the catalog, archived included — a walk returns
archived items (754 of the current 1,004 are archived), contrary to what an
earlier note in `venue-date-square-mechanism.md` claimed.

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

## What is still outstanding

Measured by diffing the two snapshots field by field. Descriptions and images
are done and verified separately; everything below is what the 14 August
overwrite took and this pass did **not** put back.

| loss | items | notes |
|---|---|---|
| **extra variations** | **270 items, 497 variations** | the substantive one — see below |
| `reporting_category` | 11 | |
| `categories` | 1 | `Met Live in HD: THE MAGIC FLUTE` |
| `modifier_list_info` | 1 | `THE BOY AND THE HERON` |
| `tax_ids` | **0** | nothing lost |
| items deleted outright | **0** | |

Two "renames" are noise, not damage: Square trimmed a trailing space from
`MFS BIRTHDAY BIG POSTER ` and `Centennial Candy `.

### The variations are showtimes and price tiers

`pushItem` rebuilt each item with a single variation named `Regular`, so
whatever structure the item had collapsed to one row. What that destroyed:

```
EMILY THE CRIMINAL      4 -> 1    Friday, September 16 at 7 PM      $7.00
                                  Saturday, September 17 at 4 PM    $7.00
                                  Saturday, September 17 at 7 PM    $7.00
                                  Sunday, September 18 at 4 PM      $7.00
                        now:      Regular                           $7.00

MET Live in HD: FEDORA  4 -> 1    Adult - January 14 at 9:55 AM    $20.00
                                  Student - January 14 at 9:55 AM  $15.00
                                  Adult - January 16 at 6 PM       $20.00
                                  Student - January 16 at 6 PM     $15.00
                        now:      Regular                          $20.00

Backstage with the Band 2 -> 1    General Admission                $25.00
                                  VIP                              $50.00
                        now:      Regular                          $25.00
```

So the loss is per-showtime variations and **price tiers** — Adult/Student,
GA/VIP. Where tiers differed, the survivor kept the *higher* price, because
`pushItem` took the first variation.

This is recoverable the same way: the historical variations are in the
pre-damage snapshot, with their names, prices and ids.

**It has not been done, and it should not be done casually.** Variations carry
prices and SKUs, are referenced by past orders, and are what a storefront
actually sells. Restoring them re-creates sellable options — including
per-showtime rows for screenings that happened in 2022. The right shape is
probably to restore tiers on items that are still sold and leave dead
per-showtime rows alone, which is a judgement call about the business, not a
mechanical repair.

## Process for the missing variations

Two findings decide the shape of this, and both were checked rather than assumed.

**1. The original variation objects are gone, not soft-deleted.** Retrieving a
destroyed variation id returns a hard `404 NOT_FOUND`. Square assigns ids on
create, so a restore cannot reuse them: it produces **new objects that resemble
the old ones**. Restoring is therefore forward-looking — it makes the catalog
sellable again — and cannot repair any historical linkage.

**2. Nothing historical needs repairing.** Square order line items carry `name`,
`variation_name` and `base_price_money` **on the order**, e.g.
`"Adult - Sunday, August 23 at 12:30 PM"` at `$50.00`. Sales history, receipts
and reporting are intact regardless of catalog deletions.

Together: **restoring archived past listings buys nothing.** It would mint new
sellable objects for screenings in 2022 whose sales records are already correct.
The pre-damage snapshot is the historical record; that is what a record is for.

### What is actually wrong today

| | items | variations |
|---|---|---|
| archived past listings | 253 | 473 |
| **live in the item library** | **17** | **25** |

Only the 17 live items are a present-tense inaccuracy, and the damage there is
specific: `pushItem` kept the **first** variation, so an item that offered
Adult $20 / Student $15 now offers a single `Regular` at **$20**. The cheaper
tier is not mispriced — it is missing, and the survivor kept the higher price.
13 of the 17 lost tiers this way.

### The pass

1. **Freeze imports.** A dashboard CSV import round-trip re-flattens variations.
   Nothing is durable until that workflow changes.
2. **Generate a proposal** from the snapshot: for each of the 17, the current
   single variation against the historical set, with names and prices.
3. **Review it as a pricing decision, not a repair.** Names encode showtimes
   (`Friday, September 16 at 7 PM`) that are meaningless for a past run, and
   2022 prices may not be today's. Typically: keep the tiers, drop dead
   per-showtime rows. This step is the client's call and cannot be automated.
4. **Apply read-modify-write.** Take the current object, **append** approved
   variations with `#temp` ids, and leave the existing variation in place — it
   may carry sales. Never send the historical object.
5. **Read back**, and assert variation count, names and prices, with nothing
   outside `item_data.variations` changed.
6. **Check the storefront** for the live items, since these are on sale.

### Recommendation

Do the 17. Leave the 253. Restoring dead per-showtime rows for past events adds
clutter and sellable surface area in exchange for nothing the snapshot does not
already preserve.
