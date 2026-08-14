# DVD inventory import data

`dvds_inventory_import.csv` — **1,556 rows** covering the restored DVD library (1,550 as
delivered, plus 6 from the dual-format split below). Loaded into production
(`vlmslygnimfbamrtwvyo`) and staging (`rpqzrpboyhshdrfdwayk`) on 2026-08-13 with
`node scripts/import-dvds.mjs`.

Two transforms were applied to the delivered file, in order. Both are one-shot scripts kept
for the record, and both are idempotent:

1. `scripts/normalize-dvds-csv.mjs` — the `notes` delimiter fix (see below).
2. `scripts/normalize-dvd-formats.mjs` — the format cleanup (see below).

The live tables were brought to the same state with `scripts/data/fix-dvd-formats.sql`. The
CSV and both databases have been verified identical on `(title, notes)` — keep it that way.

## This is not byte-identical to the delivered CSV

The CSV delivered with `docs/briefs/BRIEF-dvd-inventory-import.md` separated the `notes`
segments with `"; "`:

```
Format: DVD; Keywords: HITCHCOCK
```

`parseNote` in `src/pages/Dvds.tsx` matches ``new RegExp(`${label}:\\s*([^|]+)`)`` — it
splits on **`|`**, not `;`. Against the delivered file, `Format:` therefore captured the
whole remainder of the string, so the Format dropdown would have listed 30+ options like
`"DVD; Keywords: HITCHCOCK"` and the 43 affected titles would have been unreachable under
the real `DVD` / `BLU-RAY` options. The brief itself specifies the pipe form
(`notes = "Format: DVD | Keywords: FRENCH"`), so the delivered file did not match its
own spec.

`scripts/normalize-dvds-csv.mjs` rewrote those 43 `notes` values to use `" | "`. Every
other field is untouched — verified field-by-field against the delivered file; `notes` was
the only column that changed.

## Format cleanup

The spreadsheet's `Format:` column held five values that weren't formats. Resolved 2026-08-13
on the box office's instruction, by `scripts/normalize-dvd-formats.mjs` (CSV) and
`fix-dvd-formats.sql` (live tables):

| Was | Rows | Now |
| --- | ---: | --- |
| `DVD / BLU-RAY` | 4 | **Split into two rows**, one `DVD` and one `BLU-RAY` — the title is held on both discs |
| `DVD + BLU-RAY` | 1 | Split the same way |
| `DVD/BLU-RAY` | 1 | Split the same way |
| `DVD X2` | 2 | `DVD`. A double-disc set is still one item you check out, so the copy count is unchanged |
| `SAME?` | 1 | `DVD` (see the duplicate note below) |

The split is not an invention: 15 other titles were *already* listed twice in the source with
different formats (`COOL HAND LUKE` as DVD and 4K-ULTRA, `PERSEPOLIS` as DVD and BLU-RAY, …).
Splitting the six combined rows makes them consistent with how the spreadsheet handled every
other dual-format holding. 21 titles now legitimately appear twice under different formats.

The Format filter on `/dvds` now offers exactly **DVD, BLU-RAY, 4K-ULTRA**.

## Still open, carried over verbatim

Not import bugs — source-data questions that change inventory meaning, so they're the box
office's call rather than something to normalise silently.

| Quirk | Rows | Effect |
| --- | ---: | --- |
| No `Format:` segment at all (9 with empty `notes`, 8 with only `Source: Original tab`) | 17 | Titles appear in the list but match no Format filter option |
| **Exact duplicate listings** — `RICKY - FRENCH` and `WB ACADEMY AWARDS ANIMATION`, each twice as `Format: DVD` | 4 | Indistinguishable in the catalog. `RICKY` is the one whose second row was annotated `SAME?`, which most likely meant "is this the same as the row above?" — i.e. probably one disc listed twice, not two copies. Unverified against the physical shelf |

`dvds` has no unique constraint on `title`, by design — 21 titles legitimately repeat across
formats, so a constraint on title alone would be wrong.

## Re-importing

`scripts/import-dvds.mjs` refuses to run against a non-empty `dvds` table unless passed
`--force`, because the table has no unique constraint on `title` — a second unguarded run
would duplicate all 1,556 rows. To genuinely reload, delete first, then import.
