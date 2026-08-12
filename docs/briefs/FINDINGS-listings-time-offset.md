# Findings: listings showed times one hour off

**Investigated:** 2026-08-12 · **Status:** cause confirmed, fixed, applied to staging + production
**Brief:** `BRIEF-listings-time-offset.md`

## Summary

Both defects the brief predicted were present, and they compounded. The stored
data was wrong *and* the display was browser-relative. Fixing either one alone
would have left the app wrong.

The through-line is exactly what the brief called: **Moscow, Idaho is in the
Pacific half of Idaho, not Mountain.** Every place the system reasoned about
"Idaho time" reached for a Mountain zone.

## What was confirmed, and how

### Defect 2 — data was Mountain-baked (confirmed, primary cause)

The import scripts are in the repo and state it outright:

```sql
SET timezone = 'America/Boise';                                  -- Mountain
... '2026-08-23 19:00:00'::timestamp AT TIME ZONE 'America/Boise'
```

`America/Boise` is Mountain. Mountain leads Pacific by exactly one hour and
both observe DST, so this is a flat year-round error, not a DST edge case —
which is why it presented as "every listing is off by an hour."

Occurrences: 2,337 in `kenworthy_import_full.sql`, 853 in
`kenworthy_showings_fix.sql`, 481 in `kenworthy_fix.sql`.

The decisive evidence is that the importer copied the venue's own published
copy into `movies.description`, so the advertised time and the stored time sit
in the same database and can be compared directly:

| Show | Advertised (venue copy) | Stored | Renders Pacific | Renders Mountain |
|---|---|---|---|---|
| Farmers Market Cartoons | "Saturdays from **9 AM** - 12 PM" | `15:00Z` | 8:00 AM ✗ | 9:00 AM ✓ |
| Camp Miasma | "Saturday, August 22 at **4 PM**" | `2026-08-22T22:00Z` | 3:00 PM ✗ | 4:00 PM ✓ |
| Camp Miasma | "Sunday, August 23 at **7 PM**" | `2026-08-24T01:00Z` | 6:00 PM ✗ | 7:00 PM ✓ |

Across the upcoming showings the Mountain rendering is the plausible one
throughout — 7:00 PM evening shows, 9:00 AM Saturday market cartoons, 1:00 PM
family matinees. The Pacific rendering gives 6:00 PM shows and 8:00 AM cartoons.

Scope: **1,789 rows in each environment**, spanning 2021-06-17 to 2026-12-20,
all from three import batches on 2026-08-10/11. No showing was ever entered by
hand, so there were no correct rows to protect.

> **Trap worth recording.** Querying `showings` with the anon key returns only
> ~34 rows -- RLS exposes just the active upcoming ones. The first pass at this
> investigation sized the problem from that filtered view and built a
> data-shape guard around it, which then failed against the real table. Any
> claim about "how many rows" here has to come from a privileged connection.

**Independent confirmation.** The venue's published calendar at kenworthy.org
was checked against the stored data. Every upcoming show matched the corrected
value and none matched the stored one -- 25 of 25, including Camp Miasma
(published 7:00 PM, stored 6:00 PM), Hadestown (12:30 PM / 11:30 AM), Cat Video
Fest (4:00 PM / 3:00 PM), Farmers Market Cartoons (9:00 AM / 8:00 AM) and
Footloose (5:00 PM / 4:00 PM). This is the strongest evidence in the
investigation because it is external to the database entirely.

### Defect 1 — display was browser-relative (confirmed, live)

`date-fns-tz` was not a dependency. Every showtime rendered through
`format(new Date(iso), …)`, which uses the *viewer's* OS zone. 24 such call
sites across 12 files, plus calendar day-grouping keys that could file a late
show under the wrong date.

The confirmation email was the one correct path — it pins the zone via
`Intl.DateTimeFormat({ timeZone: VENUE_TIME_ZONE })` in
`supabase/functions/_shared/tickets.ts:25`, default `America/Los_Angeles`.
That asymmetry is what the brief predicted, and it held.

Note the compounding: because the *data* was also wrong, the email was wrong
too — correctly rendering an incorrect instant. Email correctness was
therefore not usable as the discriminator between the two defects here; the
stored-instant comparison above was.

## What changed

**Display and write path** — added `date-fns-tz`; new `src/lib/datetime.ts`
owns `VENUE_TIME_ZONE = 'America/Los_Angeles'` (mirroring the edge function)
plus `formatShowtime`, `venueDayKey`, `toVenueWallClock`, `venueLocalToInstant`,
`instantToVenueLocalInput`. All 24 display sites and the day-grouping keys now
go through it. `ShowingForm` converts the naive `datetime-local` value from the
venue zone on save and back on edit, so an admin's machine zone no longer
leaks into stored data. Relative labels ("Tonight", "Tomorrow") are computed
against the venue day rather than the reader's.

**Data** — `supabase/migrations/20260812180000_showings_pacific_not_mountain.sql`
re-localizes all 1,789 imported rows. Its guard is structural -- every row must
move by exactly one hour -- plus an anchor assertion on a showtime verified
against kenworthy.org, and a refusal to run if the data is already corrected.
An earlier draft asserted every showing lands on a "plausible" slot; that was
calibrated on the 34 visible rows and rejected genuine historical records
(8:55 AM school screenings, a 5:45 PM, a midnight show). Guards should encode
invariants, not the shape of a sample.

**Prevention** — the three import scripts now use `America/Los_Angeles` and
carry a header explaining why; `docs/TASKS.md:137` no longer says "Mountain".

## Two corrections to the brief

1. **The backfill SQL in the brief is inverted.** It gives
   `(start_time AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Denver'`,
   which shifts times an hour *earlier* and doubles the error. The zones must
   run the other way: read the wall clock in Mountain (the advertised time),
   re-localize it as Pacific:
   `(start_time AT TIME ZONE 'America/Boise') AT TIME ZONE 'America/Los_Angeles'`.

2. **The "is the email also wrong?" discriminator does not separate the two
   defects when both are present.** A correct renderer over a wrong instant
   produces a wrong email, so the test reports Defect 2 while saying nothing
   about Defect 1. Comparing the stored instant against the advertised time is
   the reliable check; the email test only rules Defect 2 *in*, never out.

## Guarding against regression

`src/lib/datetime.test.ts` asserts `VENUE_TIME_ZONE` is Pacific, pins the
7:30 PM → `02:30Z` mapping to the same fixture the edge function's test uses,
covers the late-show day-grouping case, and checks a winter date so the offset
comes from the tz database rather than a constant. The suite passes under
`TZ=America/Denver`, which is the machine configuration that would have
exposed the original bug.
