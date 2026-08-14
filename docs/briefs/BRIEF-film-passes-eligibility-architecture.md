# Brief (for Claude Code): Generalize pass eligibility (festival passes + per-showing use limits)

**Status:** 🟡 Built and verified locally, **not yet deployed**. See **Results** at the end of this file for the decisions taken, what changed, how each claim was verified, and the deploy ordering this change requires.
**Date:** August 14, 2026
**Requested by:** Tom — add a **festival pass** (usable at a discount across a multi-day/-week festival's screenings, **not** redeemable on non-festival screenings). Rather than a one-off, generalize the model so any pass type can be scoped to specific showings, and let staff cap uses per showing.

## Why generalize (not one-off)
Today eligibility is a single boolean `showings.film_pass_eligible` that only works for movies (a DB trigger forces events/live performances ineligible). A festival pass needs the opposite shape: *this specific pass* is valid on *this specific set of screenings* (which may include events/performances), and *not* on anything else. That's a **many-to-many between pass types and showings**, which also cleanly expresses "standard film pass ← standard $8 movies," "festival pass ← festival screenings," and anything future.

## Current model (file:line)
- `showings.film_pass_eligible boolean` — set on the showing form; **movies only** (`ShowingForm.tsx:46-48,91,144,265-280` — "Events cannot be eligible… a database trigger forces this"). Redemption checks it.
- `film_pass_types` (`name, price, initial_balance, redemption_price, expiration_days, is_active`) — created in `FilmPassesTab.tsx` (`:128-133`). No per-showing use limit, no per-pass eligibility.
- `film-pass-checkout` enforces: eligible screening + not-already-through + balance + expiry.
- (Note: `BRIEF-scanner-filmpass-pos` removed the unique `(pass_id, showing_id)` guard — "one pass, many friends." That becomes a *configurable* limit here.)

## New architecture

### 1. Pass-type ↔ showing eligibility (many-to-many)
- New table `pass_type_showings` (`pass_type_id uuid → film_pass_types`, `showing_id uuid → showings`, unique on the pair, admin/staff write RLS, public/anon read of the pair for the customer-facing "which passes work here"). A showing is eligible for a pass type **iff** a row exists.
- **Remove the movies-only restriction:** drop the trigger that forces events/live-performance showings ineligible, so a festival pass can cover event and performance *screenings* too. Eligibility is now purely "is there a `pass_type_showings` row for (this pass's type, this showing)?" — category-agnostic.
- **Migrate existing data:** for every showing with `film_pass_eligible = true`, insert a `pass_type_showings` row linking it to the existing standard film-pass type(s). Then **deprecate** `showings.film_pass_eligible` (keep the column read-only for one release for safety, or drop after the migration verifies).

### 2. Per-showing use limit on the pass type
- Add `per_showing_use_limit int NULL` to `film_pass_types` — **blank/NULL = unlimited** (bring friends, bounded only by balance); `1` = once per screening; `N` = up to N. This makes the removed unique-index behavior configurable per pass type.

### 3. Admin UI
- **Showing form (`ShowingForm.tsx`)** — this already handles all three categories (movie / event / live performance) via the category picker, so it's the one place to set eligibility for any of them. Replace the single "Accept film passes at the door" checkbox with: an **"Eligible for pass(es)?"** checkbox → when checked, a **multi-select of pass types** (`film_pass_types`) to choose which passes work for this screening. Writes `pass_type_showings` rows for the showing. (If you also want per-content defaults on `EventForm`/`ConcertForm`, that's an optional convenience — see Decisions.)
- **Pass creation (`FilmPassesTab.tsx`)** — add a **"Limit to N uses per showing"** field (number; placeholder "blank = unlimited") writing `per_showing_use_limit`. A **festival pass** is then just a pass type created here with its discounted `redemption_price` and, if desired, a per-showing limit — its eligibility is set by tagging the festival's showings in step 3.

### 4. Redemption (`film-pass-checkout`)
- Eligibility: replace the `film_pass_eligible` check with "exists a `pass_type_showings` row for `(pass.pass_type_id, showing_id)`?" → else verdict **`not_eligible_for_pass`** ("this pass isn't valid for this screening").
- Enforce the limit: if `per_showing_use_limit` is set, count this pass's redemptions for this showing; if `>= limit` → verdict **`per_showing_limit_reached`**. Blank = no cap.
- Keep balance/expiry/void/full checks and the `redemption_price` deduction unchanged.

### 5. Other references to update
- `TicketScanner.tsx` uses `showing.film_pass_eligible` to label screenings "(no passes)" and gate pass admission — update to the new model (e.g. "eligible for ≥1 pass type," or show *which* passes). 
- Anywhere the customer UI advertises "film pass accepted" should reflect the per-showing pass set.

## Festival pass — how it's expressed in this model
A festival pass is a `film_pass_types` row (e.g. a set price/balance, a discounted `redemption_price`, optional `per_showing_use_limit`) whose eligibility rows point **only** at the festival's screenings. Because eligibility is explicit per (pass, showing), it is automatically **not** redeemable on any non-festival screening. No special-case code — same redemption path, different eligibility rows.

## Decisions for Tom
1. **Granularity:** eligibility set per-**showing** (recommended — a festival is a specific set of screenings) vs. also a per-content default on Event/Live-Performance forms that auto-tags their showings. Recommend per-showing, with an optional "apply to all showings of this production" convenience.
2. **Bulk-tagging:** festivals have many screenings — want a quick "tag these N showings as festival-eligible" action (multi-select in the schedule list), or is per-showing enough to start?
3. **Pass label:** add an optional `kind`/label on `film_pass_types` (e.g. "standard" vs "festival") purely for admin/reporting clarity, or leave them as plain named types?
4. **`film_pass_eligible`:** keep the column read-only for one release, or drop immediately after the data migration?

## Test plan
- Create a "Festival Pass" type with a discounted `redemption_price` and (say) `per_showing_use_limit = 2`.
- Tag 3 festival screenings (a movie, an event, a live performance) as eligible for it; leave a normal $8 movie eligible only for the standard pass.
- Redeem the festival pass at a festival screening → admitted, discounted deduction. At the **non-festival** movie → `not_eligible_for_pass`, no deduction. Scan a 3rd time on one screening (limit 2) → `per_showing_limit_reached`.
- Standard pass still works on standard movies and is **not** eligible at a festival-only screening (unless also tagged).
- Migration check: previously-`film_pass_eligible` movies still accept the standard pass (eligibility rows created).
- `npm run build` + film-pass tests pass.

---

# Results

Built on `feat/pass-eligibility` from `f12c397`. Everything below was run; nothing is asserted from reading the code alone.

## One premise checked before building

The brief says `BRIEF-scanner-filmpass-pos` "removed the unique `(pass_id, showing_id)` guard". At the start of this session that was **not** true of `main` — it was still a draft. It became true mid-session: PR #49 merged as `f12c397` while this work was being scoped. Verified against the staging **database**, not the branch: `film_pass_redemptions_pass_showing_key` is gone, replaced by a non-unique `film_pass_redemptions_pass_showing_idx`, and `admit_with_film_pass` no longer returns `already_admitted`. So the premise holds and `per_showing_use_limit` is genuinely restoring a removed behaviour as a per-type choice, not fighting an existing constraint.

## Decisions taken

1. **Granularity — per showing.** No per-production default. Plus Tom's addition: the pass checkbox follows the **ticket price** for movies. A new movie at the standard $8 pre-ticks the default passes; moving the price off $8 unticks them; the admin can retick. `STANDARD_MOVIE_TICKET_PRICE` lives in `src/lib/passEligibility.ts` with a comment on why it is a constant and not derived. **The door never consults the price** — `20260813000000` deliberately refused to derive eligibility from price so a price change could not silently start accepting passes, and that still holds. This only moves a checkbox in front of someone who can see it move.
2. **Bulk-tagging — built.** As `PassEligibilityPanel`, under Film Passes rather than in the schedule list. The schedule is organised by production across a Movies tab and a Live Events tab, and a festival crosses both; selecting across two tabs is not one gesture. The panel is one flat, date-filtered list of every screening regardless of category — which is the shape a festival actually has.
3. **Standard pass — `film_pass_types.is_default_for_movies`,** not a cosmetic label. It answers two questions a label cannot: which types the backfill links previously-eligible showings to, and which the showing form pre-ticks on a new screening.
4. **`showings.film_pass_eligible` — dropped,** in this release, in a second migration. See the deploy ordering below.

## What was built

**Migrations**
- `20260814093200_pass_eligibility_by_type.sql` — `pass_type_showings` (unique pair, public read, staff write, cascades both ways); `film_pass_types.per_showing_use_limit` (NULL = unlimited, `CHECK > 0`) and `.is_default_for_movies`; seeds `is_default_for_movies` on every currently-active type; backfills eligibility from `film_pass_eligible`; rewrites `admit_with_film_pass`.
- `20260814093300_drop_film_pass_eligible.sql` — drops the trigger, its function, and the column.

**Redemption.** `film-pass-checkout` needed **no change**: the `admit` action already forwards the RPC verdict verbatim, and every rule lives in `admit_with_film_pass`. Eligibility is now the existence of a `pass_type_showings` row and nothing else — no category test — verdict `not_eligible_for_pass`. The limit check sits where `already_admitted` used to, before expiry and balance, so a capped pass is never refused as "insufficient balance". Both the count and the insert are inside the existing `FOR UPDATE` on the pass, so the limit is race-free rather than advisory.

**Admin.** `ShowingForm` shows the pass picker for **all three categories** (the movies-only trigger is gone). `FilmPassesTab` gained the limit field, the standard-pass toggle, and — beyond the brief — an **edit** path: pass types had no editor at all, so a type created before this change could never acquire a limit except by deleting a pass patrons already hold.

**Scanner.** `TicketScanner` lists the passes a screening accepts by name rather than a yes/no. A festival screening refusing a standard pass is the new common refusal, and "not valid for this screening" without saying *which* pass works is an argument at the door.

## Verified

**Database — the migrations were run, not just read.** Postgres 15 in Docker, stub schema matching staging's nullability and defaults, seeded to look like staging today. 17 checks, all passing:

- Backfill created exactly one pair — the standard pass against the one `film_pass_eligible` movie. The premium movie and the two non-movies got nothing, matching yesterday's behaviour precisely.
- Festival pass admitted at a festival **event** and a festival **live performance** at its discounted $4 — both impossible under the dropped trigger.
- Festival pass at the ordinary movie → `not_eligible_for_pass`, **balance unchanged at $32.00**.
- Limit 2: second admission admitted, third → `per_showing_limit_reached`, **balance unchanged at $28.00**.
- Standard pass still works on the standard movie, and scans **twice** for it (NULL limit = unlimited).
- Standard pass refused at a festival-only screening and at the premium movie.
- Seats minted with `payment_method='film_pass'` against the right screenings.
- `per_showing_use_limit = 0` rejected by the CHECK; duplicate pairs rejected by the unique constraint; both cascades verified; column and trigger confirmed gone.

**Application.** `tsc -p tsconfig.app.json --noEmit` clean (plain `tsc --noEmit` is a no-op here — solution-style config). 135 vitest tests pass, including 3 new scanner tests: the named refusal, the per-screening limit, and the legacy `ineligible` verdict. `npm run build:staging` succeeds. `deno check` clean on `film-pass-checkout`; 99 deno tests pass. No new lint errors — the 4 my changes initially added were fixed; the remainder are pre-existing on `main`.

## Deploy ordering — this matters

The two migrations must be applied **either side of** the frontend deploy:

1. Apply `20260814093200` — new model live, old column still intact.
2. Deploy the frontend (`npm run build:staging` → `wrangler deploy --env staging`).
3. Apply `20260814093300` — the old column goes.

Dropping the column in one step would break `TicketScanner` for any device still on the old bundle: it selects `film_pass_eligible`, and a failed query renders as "nothing scheduled" — at a door, with no way to scan a pass. Steps 1 and 3 are the same release, minutes apart.

## Not done / open

- **Not deployed.** Nothing has been applied to staging or production. Staging is also missing two unrelated local migrations (`20260814030000`, `20260814040000` — the rental work), which will apply alongside these unless pushed separately.
- **One claim not yet provable locally:** the scanner's nested embed `pass_type_showings(film_pass_types(name))` is unambiguous by FK and typechecks, but PostgREST embed resolution can only be confirmed against a real database. Check the scanner's screening list on staging immediately after step 2.
- **Customer-facing "pass accepted" badge** (brief §5, second bullet) — no such UI exists today on `Showing.tsx` or anywhere else, so there was nothing to update. Worth adding separately if patrons should see which passes a screening takes before they arrive.
- **`film_pass_types` delete** already fails with an FK violation for any type with issued passes. Pre-existing, unchanged, and arguably correct — but the error surfaces raw.
