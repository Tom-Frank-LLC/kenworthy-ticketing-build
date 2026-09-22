---
brief: duplicate-tiers-fix
title: Deleting a price tier and saving never duplicates tiers again, and the duplicates already in production are repaired
status: shipped
track: data
severity: P1
date: 2026-09-22
shipped_in: ["#327"]
shipped_at: 2026-09-22
verified: true
findings: ../FINDINGS-duplicate-price-tiers.md
---

> **Outcome (22 Sep 2026).** Diagnosed against production data and the shipped
> schema rather than the hypotheses below. The discount work was **not** the
> cause: the duplicate rows date from 9 Sep, twelve days before it shipped. The
> cause is `tickets.tier_id REFERENCES showing_price_tiers(id)` with no
> `ON DELETE` — once one ticket sells against a tier, the form's delete-all
> fails with 23503, the form swallows it, and its insert appends a fresh copy
> of every tier. Each save added another set. Decisions 1–3 were taken as
> recommended, with one refinement forced by the finding: the guard is
> "one *live* tier per (showing, name)" and persistence is a reconcile RPC,
> because a tier a ticket references cannot be deleted at all — it is retired.
> Full account, with the proof, in `docs/FINDINGS-duplicate-price-tiers.md`.
>
> **Production, 22 Sep 2026 (#327, `0701f61`).** Migration applied: 70 → 65 live
> tier rows, zero duplicate groups. Worker `9175a7d5…` → `02353347-1103-4c3a-9ca2-873de9a300b0`
> (the former is the rollback), verified byte-identical at the origin. The Paragon
> showing is left with a typo'd "Preferrred Seating" beside the correct spelling —
> different names, so not a duplicate; remove it in the form, which is now safe.

# Brief (for Claude Code): Fix duplicate price tiers on showing save

**Status:** 🔴 Data-integrity regression. Deleting a tier and saving a showing leaves **duplicate tiers** on return. Likely introduced by the (deployed) ticket-discounts work. The fix is a structural guard plus finding the double-write.
**Date:** September 22, 2026
**Requested by:** Tom — staff delete ticket tiers on a showing, save, and on return the tiers are duplicated. Suspected tied to the discount work just shipped. (Video shows a tiered showing — "General Admission $50 / Preferred Seating $75," Enable tiered pricing on — mid-save.)

## Important context for whoever fixes this
- **The deployed build is ahead of `main` as I can read it.** The live ShowingForm shows a **"DISCOUNTS — THIS SHOWING"** section (confirmed in the video), but that discount code is **not present in `origin/main` (`931e141`)** — no discount commit, no `ticket_discounts` table. So the exact regression lives in code the deployed environment has and this analysis could not see. **Claude Code should diagnose against the actual deployed/PR branch**, using the hypotheses below.
- Tom's instinct is probably right: the discount feature almost certainly added or reordered a tier write.

## What is verifiable in the code today (the structural weakness the bug rides on)
- **`showing_price_tiers` has NO unique constraint.** `CREATE TABLE` (`…8fabedf8…`) has `showing_id`, `tier_name`, `price`, `display_order` — and **no `UNIQUE(showing_id, tier_name)`** anywhere. Nothing at the DB prevents duplicate tiers; correctness depends entirely on the app deleting first.
- **The tier writer deletes-then-inserts, and swallows the delete error.** `ShowingForm.applySideEffects` (`src/pages/admin/ShowingForm.tsx` ~L639/653/674) calls `supabase.from('showing_price_tiers').delete().eq('showing_id', …)` **without checking the returned error**, then inserts the surviving tiers. If that delete is skipped, fails (RLS), or runs in the wrong order relative to another writer, the insert **appends** instead of replacing.
- **There is more than one writer.** A migration comment (`…square_showing_variations…:19`) notes "both writers of `showing_price_tiers` DELETE every tier for a showing" — i.e. the design already depends on every writer deleting first. A new discount-era path that inserts tiers **without** deleting first, or that re-seeds after the delete+insert, produces exactly this duplication.

## Root cause (to confirm in the deployed code)
Some save path introduced with discounts is inserting tiers without (or before) the delete. Candidates to check, in order:
1. **A second tier write on save** — does the new "Discounts — this showing" save, or a discount-reconcile step, persist `showing_price_tiers` in addition to the existing tier block? Two inserts, one delete → duplicates.
2. **Reordering** — was the delete moved to run *before* a template/seed or a discount step that re-inserts, so the re-insert lands after the delete?
3. **A failed/again-swallowed delete** — did a new RLS policy or trigger (e.g. the `no_ticket_required` guard on `showing_price_tiers`, or discount-related policy) start refusing the delete for some rows, silently, so the insert accumulates?
Instrument it directly: log `showing_price_tiers` rows for the showing immediately before and after a save (delete tier → save), and watch which statement adds the extra rows. Don't patch a symptom before that log identifies the writer.

## The fix
### 1. Structural guard (do this regardless of which writer is at fault)
- **Add `UNIQUE (showing_id, tier_name)` to `showing_price_tiers`** so duplicates are impossible no matter how many writers exist or how they order. **Dedupe existing rows first** (a one-off migration: keep one row per `(showing_id, tier_name)` — lowest `display_order` / current price — delete the rest) or the constraint won't apply. Normalize `tier_name` (trim) so "Adult" and "Adult " can't both slip in.
- **Convert tier persistence to an upsert** (`onConflict: 'showing_id,tier_name'`) — or keep delete-then-insert but make it a single **server-side RPC** so it's atomic (two separate client requests aren't transactional and can interleave with the other writer). Upsert-on-conflict is the smaller, robust change.
### 2. Stop swallowing the delete error
Check the result of every `showing_price_tiers` delete (L639/653/674) and surface a failure instead of proceeding to insert — a silent failed delete is precisely how this became duplication.
### 3. Clean up the damage already done
Ship the dedupe as a migration so showings that already have duplicate tiers (from this bug in production) are repaired, not just prevented going forward.

## Decisions for Tom
1. Uniqueness key: `(showing_id, tier_name)` (recommended — a showing shouldn't have two tiers of the same name) — confirm no legitimate same-name tiers exist.
2. Persistence: **upsert on conflict** (recommended, simplest robust) vs an atomic server-side RPC for delete+insert.
3. Dedupe rule for existing rows: keep the lowest `display_order` occurrence with its current price (recommended) — confirm.

## Test plan
- On a tiered showing, **delete a tier and save**: on return there is exactly one row per remaining tier — **no duplicates** — verified in the DB, not just the form.
- Saving a showing repeatedly (and double-clicking Save) never multiplies tiers.
- The `UNIQUE(showing_id, tier_name)` constraint rejects a second identical tier; the dedupe migration removes all pre-existing duplicates in production.
- A blocked/failed tier delete now surfaces an error instead of silently duplicating.
- The discount feature's own save path writes tiers through the single guarded path (no second insert); assigned-seating and walk-in (no-ticket) tier handling still behave; `npm run build` + tests pass, including a regression test for delete-a-tier-then-save.
