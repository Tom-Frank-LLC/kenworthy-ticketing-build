# Findings: duplicate price tiers on showing save

**Date:** 22 September 2026
**Brief:** `docs/briefs/BRIEF-duplicate-tiers-fix.md`
**Migration:** `supabase/migrations/20260922174957_price_tiers_reconcile.sql`
**Harness:** `sh supabase/tests/price_tiers/run.sh` (39 checks, throwaway `postgres:15`)

## What was reported

Delete a tier on a tiered showing, press Update, reopen the showing: the tiers
are duplicated. Suspected to have arrived with the ticket-discounts work that
shipped on 21 Sep.

## What production actually holds

Read over PostgREST with the anon key — the SELECT policy on
`showing_price_tiers` is `is_active = true OR staff/admin`, so every live tier
row is visible without privilege (70 rows in total). Exactly **one** showing
carries duplicates, `e53371fe-5b04-491f-8e04-198482a2bbe5`, the Paragon Ragtime
Orchestra concert on 25 Sep:

| tier | rows | created |
|---|---|---|
| General Admission $50 | 4 | 31 Aug 15:20 · **9 Sep 13:32** · 22 Sep 16:43 · 22 Sep 16:50 |
| Preferrred Seating $75 | 3 | 31 Aug 15:20 · 22 Sep 16:43 · 22 Sep 16:50 |

Every duplicate has the same price and `display_order` as its original; no
group differs by case or whitespace. The two 22 Sep timestamps are Tom's two
saves in the video. The 9 Sep row is the important one: it predates the
discount work by twelve days, so whatever appended it was already in place.

## The mechanism

`tickets.tier_id uuid REFERENCES showing_price_tiers(id)` — created in
`20260403002353`, never altered — has **no `ON DELETE` clause**, so it is
`NO ACTION`: a tier row that any ticket references cannot be deleted.

Both writers of the table deleted every tier for the showing and reinserted
the form's list, and neither checked the delete:

```ts
// src/pages/admin/ShowingForm.tsx (before this change)
await supabase.from('showing_price_tiers').delete().eq('showing_id', showingId);
const { error: tierError } = await supabase.from('showing_price_tiers').insert(...)
```

Once one ticket had sold against the 31 Aug General Admission row, that
`DELETE` raised `23503` on every save. Nothing was deleted (a statement is
atomic), the error was discarded, and the insert that followed appended a full
copy of whatever was in the form. The row pattern is the history of the form's
list at each save: 9 Sep saved with GA only (+1 GA); the two 22 Sep saves with
GA + PS (+2 each). GA ×4 / PS ×3.

`SeatTierEditor.writeShowingTiers` had the same shape and one worse property:
it deleted `showing_seat_tiers` first (which succeeds), then failed the tier
delete silently, then appended — so an assigned-seating showing with sales
would lose its painted map and gain duplicate tiers in one press.

The harness proves this against the shipped trigger and a faithful copy of the
FK: `delete-all-tiers is refused once a ticket references one (23503)` and
`the shipped schema accepts the duplicate insert` both pass on the pre-migration
schema.

### What was ruled out

- **Discount work adding a tier write.** `DiscountRulesEditor` only reads
  `tier_name`. `square-showing-variations` only reads. The pricing RPCs read
  by id. No new writer exists on `origin/main` (checked every reference).
- **RLS making the delete match zero rows.** The INSERT and DELETE policies
  are both `has_role(auth.uid(), 'admin')`, and `has_role` has honoured the
  superadmin hierarchy since `20260812063211`. A delete that silently matched
  nothing would have been followed by an insert that was refused with an
  error the form *does* report.
- **The `no_ticket_required` trigger.** It fires on INSERT/UPDATE only, and
  the showing is ticketed.

## Why the brief's recommended fix had to change

The brief recommends `UNIQUE (showing_id, tier_name)` plus an upsert. The FK
finding rules out anything built on deleting a tier that has sold, and it
also means the dedupe cannot simply delete the extras: one of the 9 Sep
duplicates may itself be referenced by tickets bought between 9 and 22 Sep,
when the patron page showed "General Admission" twice.

Every sales-side reader already ignores `is_active = false` — the patron page,
the POS, `desiredVariations` in the Square planner, and `price_ticket_order`
(which refuses an inactive tier with "no longer on sale"). So the design that
fits is: **a removed tier that tickets reference is retired, not deleted.**

That gives:

1. **Guard.** A *partial* unique index, `(showing_id, lower(btrim(tier_name)))
   WHERE is_active` — one live tier per name. Partial because a retired
   "Student" may sit beside a live "Student" that was added back later.
2. **Writer.** `set_showing_price_tiers(p_showing_id, p_tiers jsonb)`, the
   only writer. Reconciles by name: update in place (the id, and every ticket
   pointing at it, survives a save), insert new names, delete removed tiers
   nothing references, retire removed tiers a ticket references. One
   transaction, `FOR UPDATE` on the showing so a double-clicked Save
   serialises. `SECURITY DEFINER` with its own `has_role(…, 'admin')` check —
   the same gate as the table's RLS — because it has to read `tickets`, which
   staff cannot, to choose delete-versus-retire.
3. **Repair.** Keep the oldest row per name (the one most tickets reference),
   repoint any seat assignments onto it, delete extras nothing references,
   retire the rest. For Paragon Ragtime: 2 live rows, and any 9 Sep row with
   tickets against it stays as a retired row those tickets still resolve to.
4. **Trigger.** `enforce_no_tier_on_no_ticket_showing` now only refuses a
   *live* priced tier. Without that, flipping a sold showing to walk-in would
   be refused at the very statement that retires its tiers.

Both writers now call `setShowingPriceTiers()` in `src/lib/priceTiers.ts` and
report a failure instead of proceeding. The three admin loaders
(`ShowingForm`, `SeatTierEditor`, `DiscountRulesEditor`) read live tiers only.

## What the harness checks

`supabase/tests/price_tiers/`: `before.sql` seeds production's exact pattern
plus an assigned-seating case, a healthy showing and a legitimate
retired-beside-live pair, and proves the 23503 mechanism; the migration runs;
`after.sql` asserts the repair, the index (case/whitespace variants included),
and the RPC — admin gate, validation codes, delete-a-tier-then-save twice,
retire-then-revive, rename/reorder/recolour in place, empty list on a walk-in
showing with sales, and that the seat editor gets ids back.

One gotcha worth recording: an assertion that put the RPC call and a state
read in the same `SELECT` failed intermittently, because two uncorrelated
subplans are evaluated in no guaranteed order. Each call now sits in its own
statement.

## Not done

- **Square variations for the retired rows.** `showing_square_variations` is
  keyed on `(showing_id, tier_name)`, so the repair does not touch it and the
  planner sees one GA and one PS as before.
- **Regenerating `types.ts`.** The `set_showing_price_tiers` entry was added
  by hand in the generator's shape; a regeneration from a clean DB is still
  the outstanding follow-up from the pricing work.
- **A production check of which 9 Sep rows have tickets.** Not readable from
  the anon key; the migration handles either case, and the harness covers
  both.
