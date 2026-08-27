---
brief: showing-level-curator-pick
title: A curator's pick can be a whole run or a single night, and says which
status: built
track: feature
severity: P2
date: 2026-08-27
verified: false
---

# Brief: curator's pick, at the production level *or* the showing level

**Requested by:** Tom, 27 Aug 2026 — "when the movie itself is selected as the
curator's pick, it should list all the showings within that pick, like on the
listing preview window", with single-showing display kept as an option the
admin gets by picking the showing rather than the film.

## The problem

`is_featured` existed on `movies`, `events` and `live_performances` — on the
*title*. The home page then had to choose a date for it, and chose the soonest.

That is the right answer for a film with a run, but it silently threw the rest
of the run away: a film playing three nights was recommended as though it
played one. And it could not express the other case at all — the single night
worth singling out. A 35mm print, a director Q&A, the one screening with the
live score. Those are properties of the *showing*, not of the film.

## What changed

**A new flag, `showings.is_featured`**, independent of the production-level one.
Migration `20260827004853_showings_curator_pick.sql`. Defaults false, so nothing
moves until someone ticks the box.

**Two kinds of pick, and the slide says which it is:**

| flagged | the slide shows |
|---|---|
| the production | the soonest date, **plus the rest of the run** as chips |
| one showing | that date alone, no other dates |
| both | **two slides** — see the decision below |

**Admin:** a "Curator's pick — this screening" checkbox on the showing form,
next to the existing "Curator's pick" switch on the film/event/concert forms.
The helper text on each points at the other, because the difference between
them is the whole point and is not guessable from either one alone.

**`ShowtimeChips`** is extracted from `ShowingPreview` and shared, so the pick
offers literally the same dates control as the listing preview rather than a
lookalike that drifts.

## Decision: both flags set is not a conflict

Asked and answered before building. A film flagged at both levels produces
**two slides** — one for the run, one for the singled-out night — rather than
the narrower flag overriding the broader one.

The rejected alternative was "the showing wins". It is tidier, but it makes the
production flag silently do nothing, which is the failure mode this project has
been bitten by before. Two slides reads as what the admin actually said: *see
this film, and especially this night.*

Showing picks are deliberately **not** deduped. Two flagged nights of one film
are two choices. Production picks **are** deduped, because there the duplicates
are an artefact of the feed being one item per showing rather than anything a
curator asked for.

## Verified

- Migration applied to staging; `anon` can read the new column via both an
  explicit select and `select=*`. Worth checking rather than assuming —
  `movies` carries a *column-scoped* grant, so a column added there would have
  been invisible to patrons. `showings` does not.
- The admin write was made through the real form on staging and then read back
  from the API. RLS denials return 204 with no error on this project, so a
  toast is not evidence.
- All three cases observed on the deployed staging home page: a showing pick
  with no other dates, a production pick that plays once (no chips), and a
  production pick with a run (headline date + "Also playing" chip, CTA on the
  soonest).
- 9 component tests, each confirmed to fail when the behaviour is removed.

## Note

Staging test data was left flagged so the feature can be seen: the 28 Aug
*Hadestown* showing (showing-level) and *Palouse Cult Film Revival: Psycho
Beach Party* (production-level, two dates). Un-flag them when done.
