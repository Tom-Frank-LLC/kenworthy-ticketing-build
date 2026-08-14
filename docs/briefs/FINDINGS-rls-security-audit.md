# Findings: full RLS / permissions audit before launch

**Audited:** 2026-08-14 · **Brief:** `BRIEF-rls-security-audit.md`
**Scope:** all 50 tables in `public`, on **both** Supabase projects
(staging `rpqzrpboyhshdrfdwayk`, production `vlmslygnimfbamrtwvyo`)
**Status:** corrective migration `20260814214233_rls_permissions_hardening.sql`
applied and re-tested on staging **and** production.

## Method

Policy text alone cannot answer "can this role read this table" — a permissive
policy over a missing grant is denied, and a missing policy over a broad grant
is denied too. So every cell below was **measured**, not inferred:

1. **Static** — `pg_policies` + `has_table_privilege()` for `anon`,
   `authenticated` and `service_role`, dumped from both projects and diffed.
2. **Live probes** — synthetic staff / admin / superadmin / host principals
   created inside a plpgsql `EXCEPTION` block (a subtransaction), used to run
   real `SELECT`/`INSERT`/`UPDATE`/`DELETE`, then unwound by a `RAISE`. plpgsql
   variables live in memory rather than in the transaction, so the verdicts
   survive the rollback while the writes do not. Every run was followed by a
   check that no probe rows remained; all came back clean.

Two probe bugs were caught and fixed mid-audit, both of which had produced
**false criticals** worth recording so the next audit does not repeat them:

- `insert into t select * from t` looks like a valid INSERT probe. It is not:
  when RLS hides the source rows the inner `SELECT` returns nothing, the INSERT
  touches zero rows and *succeeds trivially*. It reported anon as able to write
  `user_roles`, `tickets` and `profiles` on production — all wrong. The fix is
  to stage the source row into a temp table as the owner, outside RLS, and to
  check `row_count` so a zero-row insert is never read as success.
- Running every principal's writes in one subtransaction lets an earlier
  principal's successful `DELETE` shrink the row counts a later principal reads.
  Each principal now gets its own rolled-back block.

## The one live exploit

**A plain `admin` on production could make themselves `superadmin`.** Measured,
before the fix:

```
### PRODUCTION ###                        ### STAGING ###
admin INSERT superadmin role : ALLOWED      denied (insufficient_privilege)
admin DELETE others' roles   : ALLOWED      denied (insufficient_privilege)
```

`user_roles` is the privilege-escalation table: writing a row grants a role.
Both layers were wrong on production, and they failed independently:

- **Policy layer (wrong on *both* projects).** `"Admins can insert roles"` and
  `"Admins can delete roles"` gate on `has_role(auth.uid(),'admin')`. Because
  `has_role()` implements the hierarchy superadmin ⊇ admin ⊇ staff, *any* admin
  satisfies them — so an admin could grant themselves `superadmin` and delete
  the real superadmin's row.
- **Grant layer (wrong on production only).** Staging never had the table grant,
  so the bad policy was unreachable there. Production carries legacy
  Lovable-era grants and had it.

There are **2 admin accounts and 1 superadmin on production**, so this was
reachable by real people, not just in theory. Fixed: the admin policies are
dropped, leaving the pre-existing superadmin-only policies as the gate.

## Environment drift was the root cause of most of this

The two projects' **policies were byte-identical**; their **grants had drifted
badly**, and each environment had a different half of the problem:

- **Production** carried legacy grants handing `anon` INSERT/UPDATE/DELETE on
  **20 tables**, including `user_roles`, `tickets`, `profiles`, `showings`,
  `movies` and `events`. Measured: RLS *did* hold the line for anon on every one
  of them — but that is single-layer defence, and it directly contradicts the
  intent written into `20260811214728`, which explicitly lists those tables as
  "deliberately EXCLUDED (security-sensitive)".
- **Staging**, built fresh from migrations, was *missing* grants the app needs.
  Consequence: **staff ticket sales fail on staging.** `StaffPOS.tsx:301` and
  `HostDashboard.tsx:457` insert ticket rows directly from the client, and a
  staff principal was measured being refused. Production works only by accident
  of the legacy grant.

So the migration does **not** copy one environment onto the other. It states the
intended privilege for each table explicitly, and both converge on it. They are
now identical in both grants and policies — which means the next drift shows up
in a diff instead of hiding.

## Findings

| # | Finding | Where | Status |
|---|---|---|---|
| 1 | `admin` can self-promote to `superadmin`; can delete others' role rows | prod (live), policy wrong on both | **fixed** |
| 2 | `account_mappings` + `chart_of_accounts`: `SELECT USING (true)` to `authenticated` — every staff account read all 88 mappings and all 124 accounts | both | **fixed** |
| 3 | `admin_audit_log` SELECT allowed `staff` — 12,280 rows of admin activity on prod | both | **fixed** |
| 4 | `anon` held INSERT/UPDATE/DELETE on 20 tables | prod | **fixed** |
| 5 | `sponsorship_opportunities` column-grant regression: anon could read `contact_email` / `contact_phone` | both | **fixed** |
| 6 | `donations` INSERT was a dead patron policy acting as a staff write hole into a financial table | both | **fixed** |
| 7 | Staff ticket sales broken (no INSERT grant on `tickets`) | staging | **fixed** |
| 8 | `user_roles` had no UPDATE policy, so host re-assignment (an upsert) failed | both | **fixed** |
| 9 | `get_rental_request_by_token` returns the *entire* rental row to anon, including `admin_notes` and Square invoice fields | both | **open — see below** |

### Finding 5 in detail: blanket grants silently erase column grants

`20260701020754` deliberately withheld `contact_email` and `contact_phone` from
anon via a column-level `GRANT SELECT (…)`. `20260810165116_grant_public_read_access.sql`
then ran a blanket `GRANT SELECT ON <every table> TO anon` to fix unrelated
inconsistent grants — and a table-wide grant supersedes a column grant, so the
restriction was silently undone. Verified before the fix, on both projects:

```
anon reads sponsorship contact PII: Colin Mannex / executive@kenworthy.org / 208.892.9752
```

This is the general hazard worth remembering: **a loop that grants across all
tables will quietly revert every column-level protection in the schema.** The
restored grant now lists columns explicitly, so a column added later is withheld
from anon by default rather than exposed by default.

## Premises in the brief that were already resolved

Three of the brief's "fix-first" items turned out to be already correct. Stating
them so they are not re-investigated:

- **There is only one role source.** `is_admin()` does not exist on either
  project — it was dropped in `20260217193757`, the migration immediately after
  the one that created it. Every policy uses `has_role()` + `user_roles`. The
  remaining `is_admin` hits in the repo are comments in later migrations and in
  `src/lib/availability.ts` / `StaffPOS.tsx` describing the historical bug.
- **The `app_role` enum is complete:** `admin, regular_user, staff, host, superadmin`.
  No policy references a non-existent value.
- **`signing_keys` is already correct** — RLS on, *zero* policies, so it is
  service-role only. Measured: invisible to anon, staff, admin and superadmin
  alike (1 row on production). The migration additionally revokes the inert
  table grants both client roles held.

Also confirmed and not previously noted:

- **RLS is enabled on all 50 tables**, and stays that way: an `ensure_rls` event
  trigger fires on `CREATE TABLE` in `public` and enables RLS automatically.
- **There are no views in `public`**, so there is no `security_invoker` bypass.
- **Missing `WITH CHECK` on UPDATE policies is not a hole.** Postgres reuses the
  `USING` expression as the check when `WITH CHECK` is omitted, so the ~20
  policies shaped `FOR UPDATE USING (has_role(...))` are sound as written.
- The `SECURITY DEFINER` functions reachable by anon or by any authenticated
  session each do their own authorisation: `check_in_ticket` authorises *before*
  revealing whether a QR code exists; `qbo_save_tokens` / `qbo_disconnect` raise
  unless the caller is admin. The `EXECUTE` grants on trigger functions
  (`handle_new_user`, `log_audit_event`, the `enforce_*` set) are inert —
  Postgres refuses to call a trigger function directly.

## The role × operation matrix (after the fix)

Measured on staging; production is identical (grants and policies both diffed
clean). Read cells are rows visible / total. Write cells show which of
`I`/`U`/`D` got through **both** the grant and the policy.

`denied` = no privilege at all · `0` = policy filtered every row ·
`—` = write refused · `svc` = service_role, bypasses RLS by design (intended
for every table; edge functions do their own auth).

| table | anon | staff | admin | superadmin |
|---|---|---|---|---|
| **Public content — anon reads, staff/admin write** ||||
| `movies` | 1087/1087 | read | read **IUD** | read **IUD** |
| `events` | 198/198 | read | read **IUD** | read **IUD** |
| `live_performances` | active only | read | read **IUD** | read **IUD** |
| `showings` | 37/1792 (active only) | 1792 | **IUD** | **IUD** |
| `venues` | 1/1 | read | read **IU—** | read **IU—** |
| `venue_seats` | 265/265 | read | read **IUD** | read **IUD** |
| `seats` | 265/265 | read | read — | read — |
| `showing_price_tiers` | 4/4 | read | read **IU—** | read **IU—** |
| `showing_seat_tiers` | 66/66 | read **IUD** | **IUD** | **IUD** |
| `production_price_tiers` | read | **IUD** | **IUD** | **IUD** |
| `production_seat_tiers` | read | **IUD** | **IUD** | **IUD** |
| `film_pass_types` | 2/2 | read | read **IU—** | read **IU—** |
| `pass_type_showings` | 2/2 | read **I—D** | **I—D** | **I—D** |
| `dvds` | 1556/1556 | read **IUD** | **IUD** | **IUD** |
| `dvd_settings` | 1/1 | read | read — | read — |
| `concession_items` | 17/17 | read | read **IUD** | read **IUD** |
| `concession_menus` | active only | read | read **IUD** | read **IUD** |
| `concession_combo_items` | read | read | read **IUD** | read **IUD** |
| `historical_screenings` | 21452/21452 | read | read **IUD** | read **IUD** |
| `kenworthy_history` | read | read | read **IUD** | read **IUD** |
| `press_articles` | active only | read **IU—** | read **IUD** | read **IUD** |
| `press_page_content` | 1/1 | read | read **—U—** | read **—U—** |
| `job_postings` | active only | read **IU—** | read **IUD** | read **IUD** |
| `staff_bios` | 2/3 | 3 **IU—** | **IUD** | **IUD** |
| `sponsorship_opportunities` | 1/1 **public cols only** | read **IU—** | **IUD** | **IUD** |
| `app_config` | 1/1 (`hiring_enabled` row only) | read | read **IU—** (hiring flag only) | read **IU—** (any key) |
| **Patron PII / transactions — anon NONE at the table** ||||
| `tickets` | **denied** | 15 **I——** | 15 **IUD** | 15 **IUD** |
| `donations` | **denied** | 0 | read — | read — |
| `film_pass_orders` | **denied** | read | read — | read — |
| `user_film_passes` | **denied** | 6 — | 6 — | 6 — |
| `film_pass_redemptions` | **denied** | 4 — | 4 — | 4 — |
| `dvd_rentals` | **denied** | read **IUD** | **IUD** | **IUD** |
| `rental_requests` | **denied** (INSERT only) | read | read **—UD** | read **—UD** |
| `rental_invoice_lines` | **denied** | read **IUD** | **IUD** | **IUD** |
| `profiles` | **denied** | own row only **—U—** | all — | all — |
| **Staff / ops** ||||
| `shift_requests` | **denied** | read/own **IU—** | **IUD** | **IUD** |
| `host_event_assignments` | **denied** | own only | 1 **I—D** | 1 **I—D** |
| `staff_square_links` | **denied** | own row only | **IUD** | **IUD** |
| `concession_sales` | **denied** | read **I——** | **IUD** | **IUD** |
| `concession_sale_items` | **denied** | read **I——** | **I—D** | **I—D** |
| `labor_settings` | **denied** | 0 | 1 **IUD** | 1 **IUD** |
| **Finance / accounting — admin+** ||||
| `financial_entries` | **denied** | 0 | **IUD** | **IUD** |
| `chart_of_accounts` | **denied** | **0** (was 124) | 124 **IUD** | 124 **IUD** |
| `account_mappings` | **denied** | **0** (was 88) | 88 **IUD** | 88 **IUD** |
| `qbo_connection` | **denied** | 0 | read — | read — |
| `qbo_sync_jobs` | **denied** | 0 | read — | read — |
| `payroll_exports` | **denied** | 0 | **IUD** | **IUD** |
| **Config / security** ||||
| `admin_audit_log` | **denied** | **0** (was 12227), INSERT only | 12227, append-only | 12227, append-only |
| `user_roles` | **denied** | own rows, — | all, **—** | all, **IUD** |
| `signing_keys` | **denied** | **denied** | **denied** | **denied** |

Tables empty on staging (`concession_*`, `donations`, `dvd_rentals`,
`financial_entries`, `job_postings`, `kenworthy_history`, `live_performances`,
`payroll_exports`, `press_articles`, `production_*`, `qbo_*`,
`rental_invoice_lines`, `rental_requests`, `shift_requests`,
`staff_square_links`, `signing_keys`) cannot be probed for row visibility, so
their cells are classified from policy text plus the measured grant. Everything
with a row count was measured directly.

## Re-test note

Run after the migration, on **both** projects. All pass.

```
--- privilege escalation, both projects ---
admin INSERT superadmin role : denied (insufficient_privilege)
admin DELETE others' roles   : no rows matched by policy
staff INSERT admin role      : denied (42501)

--- role management still works, both projects ---
superadmin INSERT role   : OK
superadmin UPSERT role   : OK      <- host re-assignment, broken before
superadmin DELETE role   : OK (2)

--- public site intact, production ---
anon reads sponsorship PUBLIC cols : OK -> Summer Family Matinees | Colin Mannex
anon reads sponsorship contact PII : blocked (correct)
anon SELECT movies      -> 1088     anon SELECT historical_screenings -> 21452
anon SELECT events      -> 198      anon SELECT press_page_content    -> 1
anon SELECT showings    -> 35       anon SELECT concession_items      -> 17
anon SELECT venues      -> 1        anon SELECT app_config            -> 1
anon SELECT seats       -> 265      anon SELECT staff_bios            -> 1
anon SELECT dvds        -> 1556     anon SELECT pass_type_showings    -> 1109
anon SELECT film_pass_types -> 1
```

Every anon row count matches its pre-migration value exactly — the public site
reads nothing it read before, and nothing less.

**`user_roles` data verified intact on production after every probe run:**
9 rows, `regular_user=6, superadmin=1, admin=2`, zero probe rows left behind.

### One regression caught by the re-test, and its structural cause

The first pass **broke anon's read of `showings` outright** (`42501`). The cause
was not a typo — it is worth understanding, because it will recur:

> **An RLS policy's subquery runs as the invoking role, not as the policy
> author.** `"Hosts can view assigned showings"` hand-rolled an `EXISTS` over
> `host_event_assignments`, so every role reading `showings` also needed a
> `SELECT` grant on `host_event_assignments` merely to *evaluate* the policy —
> including anon, reading the public showtimes. Revoking that grant therefore
> broke the public schedule.

The fix is the pattern the schema already uses everywhere else: `is_host_of()`
is `SECURITY DEFINER`, and the sibling policies (`Hosts can insert/update/delete
assigned showings`) all call it. The read policy now does too, which removes the
hidden grant dependency and makes the four showings host policies consistent.
The predicate is unchanged — `ha.event_id IS NOT NULL AND ha.event_id = X` and
`X IS NOT NULL AND ha.event_id = X` are equivalent, since the equality already
implies both sides are non-null. `showings` went straight back to 37/35 rows for
anon.

A second, inverted instance of the same trap: revoking the `user_roles` grant
from `authenticated` closed the admin escalation but also **locked superadmin
out of role management**, because a policy can only be reached through a grant.
The escalation is closed by the policy naming the right principal, not by
removing the door.

## Decisions taken (confirmed with Tom)

1. **Superadmin-only surface:** role assignment (`user_roles`) and
   `signing_keys`. Nothing further — `app_config` already has the right shape
   (admin may write only the `hiring_enabled` row; superadmin may write any key).
2. **Dead patron policies:** dropped only where one was an actual hole — the
   `donations` INSERT policy. The harmless own-row `SELECT` policies stay, so the
   membership model survives for when patron accounts return. No table is left
   protected *only* by a dead patron policy.
3. **Read scope:** `admin_audit_log` and `donations` are both admin+.

## Still open

- **`get_rental_request_by_token` returns the whole `rental_requests` row** to
  any anon caller holding a token — including `admin_notes`, `contract_data`,
  `signed_pdf_sha256`, `signature_serial` and the Square invoice id/URL/status.
  The token gate is correct and intentional (the renter portal has no session),
  but the function should project only the columns `RentalContract.tsx` renders
  rather than `SELECT *`. That is a signature-change touching the renter portal
  UI, so it is deliberately **not** bundled into a security migration — it wants
  its own change with a UI check.
- **`DvdLibraryTab` still shows renters as "member"** — carried over from
  `FINDINGS-staff-rls-audit.md`; it needs renter identity per rental, which does
  not fit `showing_attendees()`. Cosmetic, unchanged by this audit.
- **`concession_sales` has no UPDATE/DELETE policy for staff.** No void/refund
  button exists today, so nothing fails. When one is added it will silently
  no-op for staff — RLS-filtered updates return 204, which supabase-js reports
  as success.
