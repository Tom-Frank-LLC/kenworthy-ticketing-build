# Review: Restore venue + event date/time to film/event/MET listings

**Status:** ✅ Complete for everything with a data source. `square-venue-dates.csv` — 484 film/event/MET listings. **Venue filled for all 484; date/time filled for 285** (282 from descriptions, 3 from showings). The remaining 199 have no date source anywhere and are explained below.
**Date:** August 17, 2026
**Scope:** films, events, MET Live only — concessions/merch/passes excluded.

## What's in the file (one row per listing)

| Column | Notes |
|---|---|
| Item Name / Square Token | to match back to the Square item |
| Type | Film / Event / MET Live / NT Live / uncategorized |
| **Venue** | `508 S Main St, Moscow, ID 83843` — filled for **every** row |
| **Start / End** | first showing → start, last showing → end. Single-showing items have Start = End (see "Same day?") |
| Date source | `description` (accurate date+time), `showings (time approx ±1hr)`, or `NEEDS DESCRIPTION` |

## Coverage (final, from the full 1,280-production export)

- **282 dated from descriptions** — accurate date **and** time, parsed from the leading date line of each description. Multi-showing items span first→last correctly (e.g. A Complete Unknown Feb 7 → Feb 9); festival blurbs that mention other films' dates don't pollute the end date.
- **3 dated from showings** — description had no date; used the showings export (time approximate).
- **199 with no date** — see below.

## Why 199 have no date (and why another pull won't fix them)

189 of the 199 are **legacy Square-only items** — old one-off screenings (9 to 5, All About Eve, Arrival, A Few Good Men, Alien-era repertory…) that exist in Square but were **never migrated into the build**, so they aren't in the 1,280 productions and have no description in any pull. They also aren't in the showings export or in Square's own (wiped) variation data. The only remaining source for their original date/time would be a **pre-Aug-14 Square backup** (Square Support) or manual entry. They're all past and already archived, so this is low-urgency record completeness, not a live gap.

The venue **is** filled for these 189, so the only missing field on them is the event date/time.

## Applying it
Venue and event date/time aren't columns in the Square Library CSV, so this is a **table for you to apply** in the dashboard (or via a Square-API brief later if you want it automated). Suggested: apply venue to all 484, and Start/End to the 285 that have them.

## Notes
- **Year isn't in Start/End** (descriptions don't carry it), matching how we did the variations. Say the word if you want the year added from the showings dates.
- The 3 `showings (time approx ±1hr)` rows are the only approximate times left — everything else dated is from descriptions and exact.
