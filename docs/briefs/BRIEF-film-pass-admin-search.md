---
brief: film-pass-admin-search
title: Film-pass admin — search, status filter/sort, delete cancelled
status: shipped
track: feature
date: 2026-08-14
evidence: migration 20260814214812_search_film_passes.sql is on main
verified: true
---

# Brief (for Claude Code): Film-pass admin — search, status filter/sort, delete cancelled

**Status:** 🔵 Built on `feat/film-pass-admin-search`, not yet deployed
**Date:** August 14, 2026
**Requested by:** Tom — the issued-passes list is already getting cluttered. Add search (by number, name, email, phone), a delete for cancelled passes, and filter/sort by status.

## Current state (file:line) — `src/components/admin/FilmPassesTab.tsx`
- The issued-pass list queries `user_film_passes` joined to `profiles(display_name)` + `film_pass_types(name)`, **`.neq('status','unassigned')`**, ordered by `purchased_at`, **`.limit(50)`** (`~L88-98`). No search, no status filter, no sort control.
- **Status vocabulary already exists** (`STATUS_LABEL`, `~L59-63`): `active` → **Active**, `unassigned` → **Blank**, `depleted` → **Used up** (this is your "empty"), `expired` → **Expired**, `void` → **Cancelled**.
- `voidPass()` exists (`~L209`, calls `film-pass-checkout` `action: 'void'`) — cancels a pass. There is **no delete** for issued passes (only `deleteType` for pass *types*).
- The row model (`UserPass`) currently exposes `qr_code`, `status`, `remaining_balance`, `expires_at`, and `profile.display_name` — but **not email/phone**, so those aren't searchable yet.

## 1. Search (by number, name, email, phone)
Add a search input above the list. Match against:
- **Number** → the pass `qr_code` (`PASS:<uuid>`), and a friendly `pass_number` if one is added (see the scanner brief's open decision — recommend adding it, since "look up by number" is easier with a short number than a uuid).
- **Name / email / phone** → the buyer's contact. These live on the linked account (`profiles.display_name/email/phone`) and/or the purchase (`film_pass_orders.buyer_name/buyer_email/buyer_phone`).

**Search the whole table, not just the loaded 50.** The current `.limit(50)` means a client-side filter would only search a truncated page. Do it server-side — cleanest is a `SECURITY DEFINER` RPC or a view (e.g. `search_film_passes(q text, status text, sort text)`) that flattens pass + buyer contact and applies `ILIKE` across `qr_code`/`pass_number`/name/email/phone. That also fixes the truncation for the whole feature. (Alternatively, denormalize buyer name/email/phone onto `user_film_passes` at activation and `.or()`-filter — but a view/RPC keeps it clean.)

## 2. Filter + sort by status
- **Status filter** dropdown: All · Active · Used up (empty) · Expired · Cancelled · Blank (unassigned). Note the list currently **hides** `unassigned` (`.neq`) — keep that as the default ("issued" view), but let the filter opt into Blank to see un-activated stickers.
- **Sort** control: newest (purchased_at, default), soonest-expiring (`expires_at`), highest/lowest balance (`remaining_balance`), name (A–Z).
- Show a count per status (or a small summary) so staff can see "12 active, 3 cancelled" at a glance.

## 3. Delete cancelled passes
- Add a **Delete** action available **only** on passes with `status = 'void'` (Cancelled) — a hard delete of the `user_film_passes` row. `film_pass_redemptions` FK is `ON DELETE CASCADE`, so redemption history for that pass goes with it (confirm that's desired — see Decisions).
- **Admin-gated.** Route it through a service-role path (extend `film-pass-checkout` with a `delete` action, or an admin RPC) OR confirm `user_film_passes` has an admin DELETE RLS policy. Do not expose delete for `active`/`depleted`/`expired` — cancel first, then delete.
- Confirm dialog naming the pass (number + holder) before deleting.

## Data / cross-refs
- **Friendly pass number:** the only current identifier is `qr_code` (`PASS:<uuid>`). Adding a short sequential `pass_number` (open decision in `BRIEF-scanner-filmpass-pos.md`) makes "search by number" and this whole tab far more usable — recommend doing it here or there, once.
- Reuse the existing `STATUS_LABEL`/`STATUS_VARIANT` so the filter, badges, and list stay consistent.

## Decisions — answered by Tom, Aug 14 2026
1. **Delete scope:** **Cancelled + Blank + Used up.** `void`, `unassigned` and `depleted` are deletable. `active` and `expired` are not — cancel first. (Expired is excluded because expiry is a clock, not a decision: a wrongly-dated pass gets its date corrected, not destroyed.)
2. **Redemption history on delete:** **allow, but warn with the count.** The confirm dialog names the pass and states how many recorded admissions go with it; the toast afterwards repeats the number actually removed, because the count in the dialog was read from a possibly-stale list.
3. **Pass number:** **added.** Sequential, starting at 1000, assigned at mint, printed on the sticker.

## What was built

**Migrations**
- `20260814214733_film_pass_number.sql` — `user_film_passes.pass_number`, a sequence starting at 1000, backfilled over existing rows in `created_at` order, unique, defaulted at insert so the *sequence* is the only thing that picks a number (two simultaneous print runs cannot collide). Sequence `USAGE` is service-role only.
- `20260814214812_search_film_passes.sql` — `search_film_passes(q, status, sort, limit, offset)`, `SECURITY DEFINER`, staff/admin gated, returns `{total, counts, passes}`. Plus indexes on `film_pass_orders(pass_id)` and `film_pass_redemptions(pass_id)`.

**Why one function rather than a view plus a counts function:** the page and the per-status counts share a search predicate. Two copies of that predicate drift, and the first time they do, the filter says "3 cancelled" while the list shows two — with nothing on screen to say which is lying. Counts are taken *after* the text search and *before* the status filter, so they tell you in advance what switching the filter will turn up.

**Search covers all three places a pass's contact details can live:** `profiles` (linked account), `film_pass_orders` (the buyer — and for a **bearer pass this is the only contact that exists**), or neither (walk-in bearer pass, anonymous by design). Phone matching compares digits-to-digits, so `(208) 555-1234` is found by typing `2085551234`. Pass numbers match by prefix, not substring — every number contains a `1`, so a contains-match would return the whole table for a one-digit query.

**Edge functions**
- `film-pass-checkout` gained `action: 'delete'` — admin-gated, service-role. Reads the pass first so a refusal can say *why* ("still active — cancel it first") rather than just "nothing happened", and re-states the status filter on the delete itself so a sticker activated at the counter mid-click cannot be deleted out from under the till.
- `film-pass-batch` returns `pass_number` from `create` and `list`, and orders a reprint by number rather than `created_at` (a batch is one insert, so its rows can share a timestamp to the microsecond).

**Why delete is server-side:** the original schema does have an `Admins can delete passes` RLS policy, but `20260813000000` revoked the `DELETE` grant on `user_film_passes` from `authenticated`. A browser delete would fail at the grant — and fail *silently*, since PostgREST reports a blocked delete as a success with no rows. The UI would have reported a pass as gone while it sat in the table.

**Audit:** the existing `AFTER DELETE` trigger writes the entire deleted row into `admin_audit_log.details.old`, so a deleted pass is reconstructible even though its redemption rows are not. The trigger reads `auth.uid()`, which is NULL for a service-role write, so the function stamps `actor_id`/`actor_email` onto that entry afterwards — a pass can only be deleted once, so `entity_id` + action names exactly one row. Without it the record would read "a pass was destroyed and nobody did it".

**Verification:** both migrations were applied to a throwaway `postgres:15` with stub tables and 20 assertions run against real plpgsql — backfill ordering and gaplessness, the mint default continuing the run, the role gate refusing a non-staff caller, each contact source reachable, phone-format independence, every sort key, paging covering the set exactly once with no duplicates, and the delete cascade sparing the purchase record. Test files are in the session scratchpad (`stub.sql`, `assert.sql`).

## Follow-up found during acceptance (PR #65)

Deleting a pass **type** (not a pass — they are a click apart in this tab) showed
`violates foreign key constraint "user_film_passes_pass_type_id_fkey"`. Pre-existing,
not caused by this work: `deleteType` piped `error.message` straight into a toast.

`pass_type_id` is `ON DELETE RESTRICT` and rightly so — deleting a type would orphan
passes patrons are holding. The defect was that the UI did not know the rule existed,
so it offered an action it could not perform and then explained the failure in SQL.
Fixed by loading the per-type pass count, showing an **"N issued"** badge on the card,
and refusing in advance with the two real options: switch the type to **Inactive** to
retire it (passes already issued keep working), or clear those passes first under
Issued Passes — which this brief's new pass delete makes possible for blanks,
cancelled and used-up passes. `deleteType` also gained the `.select()` row-count
check, since a delete blocked by RLS returns success with no rows.

Verified in a browser on staging: both type cards show the badge, the tooltip reads
"Cannot delete — N pass(es) issued…", and clicking produces the actionable toast with
the type left intact.

## Known gap (not in this brief's scope)
Every other service-role write in `film-pass-checkout` — `void`, `mark_posted`, `activate` — logs to `admin_audit_log` with a NULL actor, for the same reason `delete` did. Only `delete` is fixed here, because it is the irreversible one. Fixing it generally means threading the caller through every one of those paths.

## Test plan
- Search "Smith" / an email / a phone / a pass number → matches across the **whole** table (not just 50), regardless of status filter.
- Filter Cancelled → only void passes; each shows a Delete; deleting removes it and it's gone on reload. Active/expired/used-up show **no** Delete.
- Sort by expiry and by balance reorders correctly.
- A non-admin (staff) cannot delete.
- `npm run build` passes.

### Status of the test plan
Green locally: `tsc -p tsconfig.app.json --noEmit`, `vitest` (155 passed, incl. 4 new StickerSheet tests), `deno check` on both touched functions, `deno test` (122 passed), `npm run build:staging`. The SQL behaviour behind every bullet above is covered by the throwaway-Postgres assertions.

Still to do by hand, after deploy: the browser pass on staging, and confirming a staff (non-admin) account gets 403 from `action: 'delete'`.

**Deploy ordering matters.** Push the migrations *before* the frontend: a bundle that calls `search_film_passes` against a database that does not have it yet shows an empty Issued Passes list with an error, and `film-pass-batch` would select a `pass_number` column that does not exist. Order: migrations → `film-pass-checkout` + `film-pass-batch` → frontend.

### Note for whoever prints next
Stickers already printed do not carry a number — only ones printed after this ships. Existing passes still have numbers in the database and are still searchable by name, email, phone and QR code; they just cannot be looked up by a number read off the paper. Reprinting a pre-existing batch omits the number rather than inventing one.
