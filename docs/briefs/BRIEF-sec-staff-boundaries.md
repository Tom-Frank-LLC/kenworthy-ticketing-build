---
brief: sec-staff-boundaries
title: Staff can no longer read payroll, book unpaid card sales, double-refund, or write the audit log in someone else's name
status: built
track: security
severity: P1
date: 2026-10-06
verified: false
findings: ../AUDIT-security-2026-10-06.md
---

# Staff boundaries and insider integrity

Cluster 6 of the 2026-10-06 security audit: **M6, L1, L3, M11, L14**, the
square-terminal and square-invoice parts of **L15**, and the POS defect
**RLS-9**. Every one of them needs a signed-in staff account. Together they are
the places where a staff session could do more than its job, or do it without
leaving a name behind.

Code: branch `fix/sec-staff`. Tests: `supabase/tests/staff_boundaries/`
(52 SQL cases against a full migration replay), plus Deno and vitest unit tests
named below.

## What each finding was, and what changed

### M6 · square-labor gave every staff member the payroll

`list_team`, `list_shifts`, `list_scheduled_shifts` and `labor_summary` were
staff-callable. They return every coworker's email and hourly rate, raw shifts
with wages, and revenue against labor cost. The UI only showed them to admins.
`clock_out`, `start_break` and `end_break` accepted any `shift_id`, so a staffer
could end a coworker's shift, which is what the admin-only `force_close_shift`
does. The id also went into the Square path unencoded.

- The four reads are in `ADMIN_ACTIONS` (`square-labor/team.ts`).
- Staff mutate only their own shift. `mutateShift` reads the shift from Square
  first, as it already did, and refuses with 403 unless its `team_member_id` is
  the caller's `staff_square_links` row. Admins pass.
- Shift and scheduled-shift ids are `encodeURIComponent`ed (`pathId`).
- The staff TimeClockWidget needed no new variant. It already uses
  `current_shift` and `my_upcoming_shifts`, which are scoped to the caller and
  carry no coworker wages.

### L1 · staff could record sales that Square never received

- **`create_ticket_order`** (migration `20261006225712`). A signed-in session
  can no longer pass `p_square_payment_id`, or write a `confirmed` card or
  online row. The counter card path writes `pending` with no payment id, and
  `square-terminal` confirms it after reading Square. Cash stays confirmable:
  staff are trusted with the till, and Square has nothing to vouch for. The
  service role (ticket-checkout, square-terminal) is unchanged.
- **One payment, one order.** A trigger on `tickets`
  (`tickets_payment_belongs_to_one_order`) refuses, with `PT423`, a
  `square_payment_id` that is already on a different order, or on a film pass
  or pass order. It covers every writer: create_ticket_order, confirm_sale,
  the cash-sale stamp and the ticket-checkout confirm. An advisory lock on the
  payment id serialises two racing confirms.
- **`confirm_sale`** requires the checkout's `reference_id` to be this order's
  token (`square-terminal/binding.ts`). `start_sale` already wrote it; nothing
  checked it. Before the update it also refuses a payment id that is already
  used, with a counter-readable 409. The trigger is the backstop.
- **Legacy `get_checkout`** refuses `SIM_` ids in production instead of
  answering COMPLETED.
- **Film-pass `activate` (walk-in card).** Only a card sale may carry a payment
  id, and the id is verified with `GET /v2/payments/{id}`. It must be
  COMPLETED, at our location, not refunded, at least the pass price plus tax,
  and not already on a ticket, pass or pass order
  (`film-pass-checkout/counter_payment.ts`). In production a card activation
  with no payment id is refused. In the sandbox, a simulated reader still
  activates.
- **Counter gifts are capped** at `MAX_BUNDLED_DONATION_CENTS` ($1,000) in
  `square-cash-sale` and `square-terminal` `start_sale`. That is the same
  ceiling the POS donation box already enforces, so no staff-visible change.
- **Not done here:** `square-donation` `record_in_person` (another cluster owns
  that file). See "Needs another cluster" below.

### L3 · refund edge cases

`square-refund` now runs in this order:

1. **Claim.** One `UPDATE … SET status='refunded' WHERE id IN (…) AND
   status='confirmed' RETURNING`. Only the returned rows are refunded, so two
   overlapping requests can never both hold one ticket.
2. **Refund by tender** (`square-refund/plan.ts`):
   - Card or online: Square refund. If Square refuses, the claim is released
     (back to `confirmed`, only where no `square_refund_id` was recorded).
   - Cash: "refund the customer from the till" is always said again, as it was
     before the cash sale started stamping a CASH tender. If a CASH tender
     exists, its reversal is also recorded in Square for the books. If Square
     refuses that, staff get a note, and the refund stands.
   - Film pass: see 3.
   - Comp, or $0: nothing to return.
3. **Pass credit** goes through `refund_film_pass_redemption`, which is
   service-role only. It locks the redemption and the pass, credits in place,
   and deletes the redemption. A void or expired pass is not credited: staff
   are told, and the redemption is kept so the history still matches the
   balance. A depleted pass that can afford an admission again becomes
   `active`, the mirror of `admit_with_film_pass`.

Staff-visible: a refund that collides with another one now answers 409
("refunded a moment ago"). Cash tickets show the till warning again. A refund
against a void or expired pass says it was not credited.

### M11 · staff actions through the service role were unattributed

Two halves, both in `_shared/audit.ts`:

- **`actorHeaders(user.id)`** goes on every service-role client a staff-gated
  function uses for writes. The new `admin_audit_log` BEFORE INSERT guard reads
  `x-kw-actor-id` from `request.headers` and fills a NULL actor with it. It does
  this only when the request's JWT role is `service_role`, so a browser that
  sends the header is ignored. The result is that every trigger-written row
  (refund flips, confirms, cash stamps, pass activations, voids, admissions,
  contract signatures, rental invoice saves, catalog mapping writes) names the
  staff member. **Verified against a real PostgREST v12** in a throwaway
  container: a PATCH sent with the service-role JWT and the header produced a
  `tickets.update` entry with the staff member's id and email.
- **`logStaffAction` / `auditedHandler`** cover what is not a row change:
  - `tickets.refund`: amounts, payment ids, refund ids, warnings.
  - `tickets.card_sale_confirmed` and `tickets.cash_sale_recorded`.
  - `rental_requests.invoice_created`.
  - `user_film_passes.batch_printed`: sticker inserts are not row-audited.
  - `square_catalog.*` for real (non-dry-run) writes by square-event-write,
    square-variation-restore, square-catalog-restore and
    square-showing-variations, with the outcome summary.

### L14 · audit-log integrity and coverage

Migration `20261006225810_audit_log_integrity.sql`:

- **Guard on browser inserts.** A session (`anon` / `authenticated` inserting
  directly) may write only `auth.login` / `auth.logout`. The guard forces the
  row to be about the caller: actor, email from `auth.users`, `entity_type =
  'auth'`, `entity_id` = the caller, and `{}` details. `src/lib/auditClient.ts`
  is the only browser inserter, and it writes exactly that. Every other path
  (definer functions, the trigger, the service role) keeps its row, but
  `actor_email` is always read from `auth.users` when there is an `actor_id`.
- **Coverage.** Every table here was confirmed to exist on a full replay.
  - Row-level: `host_event_assignments`, `staff_square_links`,
    `production_price_tiers`, `account_mappings`, `chart_of_accounts`,
    `qbo_connection` (it holds vault secret ids, not tokens),
    `payroll_exports`, and `signing_keys`. For `signing_keys`,
    `private_key_b64` is redacted by `audit_is_secret_key`, and a test asserts
    the literal never reaches the log.
  - Statement-level (new `log_audit_statement`: one entry per statement with
    the count and up to 50 redacted rows): `production_seat_tiers`,
    `showing_seat_tiers`, `pass_type_showings`, `financial_entries`. These are
    written in bulk, a row per seat or a ledger import, and per-row entries
    would bury the log.
- Not done: anon can still mint `auth.login_failed` rows for staff addresses
  (rate-limited, content fixed). Left as is. It is the documented design of
  `log_failed_staff_login`.

### L15 (this cluster's part) · tokens and provider bodies in logs

- `square-terminal` logs 8 characters of an order token (`logToken`), never the
  whole bearer credential.
- `square-invoice` logs Square errors as `category/code (field)`
  (`square-invoice/log.ts`), not the body, which echoes the renter's email.

### RLS-9 · the POS "release" of a failed card sale did nothing

Staff have no UPDATE on `tickets`, so the POS's direct `update … status =
'failed'` matched 0 rows, and supabase-js reported success. The seats stayed
held for the 15-minute hold window and the rows stayed `pending` forever.

The fix is `release_pending_card_sale(order_token, reason)`, a SECURITY DEFINER
function, rather than an UPDATE policy for staff. It moves card rows of one
order from `pending` to `failed`, and nothing else. Staff can release only
their own sale (POS rows carry the staff member as `user_id`); admins can
release any. The POS calls it through `src/lib/posRelease.ts` and compares the
returned row count with what it wrote. A shortfall is a visible warning, not a
silent success.

## How it was proven

- `sh supabase/tests/staff_boundaries/run.sh` replays **every** migration into
  postgres:15, then runs 52 cases across L1, RLS-9, L3, L14, M11 and coverage.
  The result is **52/52 pass**. With `BEFORE=1` (main, without the two
  migrations) **37 fail**. That is the before/after: on main, one swipe
  confirms a second order, a staffer plants `tickets.refund` as an admin, and a
  service-role refund is filed under nobody.
- The paths production uses still pass: the staff cash sale (confirmed), the
  staff pending card sale, the service-role online order with its payment id,
  a status flip on a stamped order, the cash-sale stamp, and the auditClient
  sign-in.
- `sh supabase/tests/pricing_rpc/run.sh` gives **106/0**. A scratch copy that
  also applies `20261006225712` (the redefined create_ticket_order and the
  trigger) also gives **106/0**.
- The header path was run end to end through a real PostgREST v12 container
  (above). The harness stub's `auth.role()`/`auth.uid()` were changed to
  Supabase's real definitions, which also read `request.jwt.claims`.
- Deno: `square-labor/team_test.ts` (ownership, admin reads, path encoding),
  `square-refund/plan_test.ts`, `square-terminal/binding_test.ts`,
  `film-pass-checkout/counter_payment_test.ts`, `square-invoice/log_test.ts`
  and `_shared/audit_test.ts`. Vitest: `src/lib/posRelease.test.ts`.

## DEPLOY STEPS

Order matters: migrations first. Both are safe under the current functions and
Worker. The POS sends no payment id from the browser today, and functions that
do not send the header leave the actor NULL, which is today's behaviour.

1. Record rollback points:
   `npx wrangler deployments list --name kenworthy-ticketing-build` (the list
   is oldest-first) and the staging equivalent.
2. **Migrations, staging, then production:** `supabase db push` with
   `20261006225712_staff_sale_integrity.sql` and
   `20261006225810_audit_log_integrity.sql`. Verify each applied:
   `select version from supabase_migrations.schema_migrations where version in
   ('20261006225712','20261006225810');`.
3. **Read-only checks against production before the functions ship:**
   - `select count(*) from (select square_payment_id from tickets where
     square_payment_id is not null group by 1 having count(distinct
     order_token) > 1) x;`
     This shows how many legacy payment ids already span orders. The trigger
     ignores existing rows, but a non-zero count is worth knowing before a
     refund touches them.
   - `select has_function_privilege('authenticated','public.refund_film_pass_redemption(uuid)','execute');`
     should be false.
   - `select has_function_privilege('anon','public.release_pending_card_sale(text,text)','execute');`
     should be false.
4. **Functions, staging, then production:** `supabase functions deploy` for
   `square-labor square-terminal square-refund square-cash-sale
   square-showing-variations square-event-write square-variation-restore
   square-catalog-restore square-invoice sign-contract film-pass-batch
   film-pass-checkout`. `film-pass-checkout` is also edited by the checkout
   cluster, so deploy it once, from the merged tree.
5. **Worker** (the StaffPOS release): `npm run build:production`, confirm
   `release_pending_card_sale` is in the bundle and the bundle carries the
   production ref, then `npx wrangler deploy`. Staging: `npm run
   build:staging && npx wrangler deploy --env staging`.
6. **Post-deploy checks** (safe):
   - Anon, expected refusal: `POST /rest/v1/rpc/release_pending_card_sale` →
     401/42501. `POST /rest/v1/admin_audit_log` → refused.
   - Staging, signed in as staff: `square-labor` `list_team` → 403 "Admin
     required". The time clock still loads.
   - Staging sandbox, POS: start a card sale and cancel it on the reader. The
     rows read `failed` and the seats are back. Refund one sandbox card sale.
     `admin_audit_log` should show `tickets.update` with your email, and a
     `tickets.refund` entry.
   - Staging sandbox, walk-in **card** pass activation. This exercises
     `GET /v2/payments/{id}`. If Square answers 401/403, the access token lacks
     PAYMENTS_READ, and card pass activations will be refused until it is
     granted.

## Rollback

- Functions: redeploy each from `origin/main` before this merge.
- Worker: `npx wrangler rollback <version-id>`.
- Database: roll forward if you can. To undo:
  - `drop trigger tickets_payment_belongs_to_one_order on tickets;`
  - `drop trigger admin_audit_log_guard on admin_audit_log;`
  - Re-run the `create_ticket_order` body from
    `20260922170258_comps_through_pricing.sql`.
  - Drop the `audit_*` triggers this migration added. The new functions are
    inert without them.
  - Do not drop `release_pending_card_sale` or `refund_film_pass_redemption`
    while the new Worker or square-refund is live.

## Needs another cluster

- **`square-donation` `record_in_person` (L1).** It files a receipted gift and
  an LGL record for any amount, with no payment evidence. Remediation:
  - For `paymentChannel: 'terminal'`, require `squarePaymentId` and verify it
    the way `counter_payment.ts` does.
  - For `'cash'`, require the `orderToken` of a cash ticket order whose
    `square-cash-sale` recording carried this donation.
  - Cap at `MAX_BUNDLED_DONATION_CENTS`.
  - Pass `actorHeaders(user.id)` on its service client.
- `pricing_rpc/run.sh` does not apply `20261006225712`. Whoever next edits that
  harness should add it, with `user_film_passes` / `film_pass_orders` stubs.

## Decisions taken (flag if wrong)

- Counter gifts are capped at $1,000 server-side, the POS input's existing cap.
- A staffer can release only their own pending card sale; an admin can release
  anyone's.
- A refund against a void or expired pass still refunds the ticket (the seat
  goes back) but credits nothing, with a warning.
- Seat-tier, pass-eligibility and ledger tables log one entry per statement,
  not per row.
