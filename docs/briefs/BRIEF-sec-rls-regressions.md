---
brief: sec-rls-regressions
title: Anon can no longer read film terms, staff ids, promo codes or bucket listings, or call the audit switches; sold showings cannot be deleted
status: shipped
track: security
date: 2026-10-06
verified: true
findings: ../AUDIT-security-2026-10-06.md
shipped_in: ["#362", "2f6512c"]
shipped_at: 2026-10-06
evidence: "migrations 20261006225932–225937 on both; anon_surface/surface.sql 77 → 1 (rls_auto_enable, inert) on both; Worker prod 9eefed04 (rollback 0a00ae85)"
---

# RLS and grant regressions (audit 2026-10-06 M3, M4, M10, L17, L18, L19)

Six findings from the 2026-10-06 audit, all in the database layer, and one
standing check so the class does not come back. The migrations are
`20261006225932` to `20261006225937`; the check is
`supabase/tests/anon_surface/` (see its README).

## M3: film-rental terms were public

**What it was.** `movies` had a column-level grant to anon since
`20260701020754` that withheld `distributor`, `circuit` and `terms_percent`.
`20260810165116` then ran `GRANT SELECT ON <every table> TO anon,
authenticated`. A table grant supersedes column grants, so anon could read the
terms (`movies?select=terms_percent`). The 08-14 audit found the same loop had
undone `sponsorship_opportunities` and fixed that table only. Two later
migrations still added movie column grants as if the restriction held.

**What changed.** `20261006225932` revokes the table grant and grants the 18
public columns, the same list as `MOVIE_PUBLIC_COLUMNS`. Authenticated keeps
the table grant, because the admin film form and box-office receipts read the
terms.

**The sweep.** I replayed every migration up to the loop and listed every
(table, role) pair without table-level SELECT. There were four:

| table / role | state now |
|---|---|
| `movies` / anon | restored (above) |
| `qbo_connection` / authenticated | restored: `20260617055253` withheld the two Vault secret ids, even from admins. |
| `sponsorship_opportunities` / anon | 08-14 restored it to the `20260701020754` list, but `20260701185308` had also withheld `contact_name` and `contact_title`. Both are withheld again, along with `created_by`. No public page reads this table. |
| `signing_keys` / anon, authenticated | already re-revoked by `20260814214233`; still holds |

The same migration revokes anon SELECT on `film_pass_orders`,
`audit_suppression` and `square_link_dismissals`. No policy shows anon a row of
these, and only admin screens read them. It also revokes TRUNCATE, TRIGGER and
REFERENCES on every public table from anon and authenticated. Under the legacy
default ACL these were on every table; PostgREST cannot issue them, and
TRUNCATE ignores RLS. On a project without the legacy ACL the revoke changes
nothing.

## M4: hosts could edit tickets and delete sales

**What it was.**
- "Hosts can update tickets for assigned showings" let a host change any
  column of any ticket for their production, for example un-refunding one.
  Check-in has been the `check_in_ticket` RPC since August, and no host code
  path writes a ticket.
- `tickets.showing_id` and `film_pass_redemptions.showing_id` were `ON DELETE
  CASCADE`. Deleting a showing therefore erased its sales and pass admissions
  without notice. That covered a host's "Remove", an admin's delete, and a film
  delete that cascades to its showings.

**What changed.** `20261006225933`:
- drops the policy;
- makes both foreign keys `RESTRICT`;
- adds a `BEFORE DELETE` trigger on `showings` that refuses with *"This showing
  has tickets or pass admissions recorded against it, so it cannot be deleted.
  Turn it off (inactive) instead."* (SQLSTATE 23503).

`HostDashboard.removeShowing` and `AdminDashboard.deleteItem` already show
`error.message` in a toast, so the admin or host sees that sentence instead of
a silent cascade. Any ticket row counts, including refunded and failed ones,
because those rows are part of the sales record. Unsold showings still delete,
and so do their tiers, discounts and pass tagging.

**Visible change:** staff can no longer delete a showing, or a film or event,
that has any ticket. They have to deactivate it instead, or delete the ticket
rows first (admin).

## M10: anyone could switch off the audit log on production (probably)

**What it was.**
- `audit_bulk_begin` and `audit_bulk_end` are SECURITY DEFINER and checked
  nothing about the caller.
- `audit_bulk_begin` pauses the audit trigger on any tables for any number of
  minutes. Both functions take the actor as an argument.
- They were revoked `FROM PUBLIC` only. Under Supabase's legacy default ACL,
  which is how production behaves on the 08-14 audit's evidence, anon and
  authenticated keep direct grants that a PUBLIC revoke does not touch.

**What changed.** `20261006225934`:
- revokes both functions from `PUBLIC, anon, authenticated` and grants them to
  `service_role` only, which is their one caller (`_shared/audit.ts`);
- inside both, refuses any caller that is not the service role or a direct
  database session (42501), so a stray grant still does not open them;
- caps the pause at 60 minutes (callers ask for 10);
- keeps `p_actor_id`, because only the service role can reach it now.

**The sweep.** I listed every function in `public` that anon can execute
(replayed under the legacy ACL) and checked each against its callers.

Fixed:
- `resolve_account_id`: it had no caller, and its June revoke missed PUBLIC.
  Now service role only.
- `is_protected_user`: anon revoked. Only `TO authenticated` policies call it.
- `is_host_of` / `is_host_of_showing`: the seven host policies were `TO
  PUBLIC`. They are now `TO authenticated`, and anon EXECUTE is revoked. Anon
  only ever reached these through the showings SELECT policy, where
  `auth.uid()` is NULL and the answer was always false.

Kept, and why (also the allowlist in `surface.sql`):
- `get_rental_request_by_token`, `get_contract_signature`,
  `get_public_availability`, `showing_availability`, `showing_ends_at`,
  `quote_ticket_order`, `log_failed_staff_login`: intended public calls.
- `has_role`: see L19.
- Pure invoker helpers: these run with anon's own rights.
- Trigger functions: they cannot be called outside a trigger.

## L17: the contract link returned the whole rental row

`20261006225935` replaces `get_rental_request_by_token`'s `SELECT *` with
an explicit `RETURNS TABLE` of the 15 columns `RentalContract.tsx` reads.
`admin_notes`, the invoice fields, phone numbers, the signature hash and
serial, and any future column are no longer returned. Because the return type
changes, the migration drops the function and recreates it. The page code is
unchanged.

## L18: public buckets were listable

**What it was.** All six public buckets had a SELECT policy on
`storage.objects` with no role. A public bucket serves files by URL without
such a policy. What the policy added was `POST /storage/v1/object/list` for
anyone, including uploads whose row is unpublished. That undid the "unlisted,
not private" model in `BRIEF-media-bucket-privacy-model`.

**What changed.** `20261006225936` drops the six policies and adds one
admin-only SELECT policy, because Storage's `remove()` needs SELECT as well as
DELETE.

**How the app reads these buckets.** Every site read uses `getPublicUrl`, with
or without a transform. Nothing calls `list()`, `download()` or
`createSignedUrl()` on these buckets, so no page lists a bucket as anon.
Uploads are `upsert: false`.

## L19: anon reconnaissance

**Staff ids.** `staff_bios.user_id`, `featured_slides.created_by`,
`pass_type_showings.created_by`, `festival_programs.uploaded_by`,
`backstage_photos.uploaded_by` and `concession_menus.uploaded_by` (plus that
table's admin `notes`) are no longer anon-readable. Each table now has an
explicit column grant. Each public page already named its columns, with one
exception: `/about` selected `STAFF_BIO_COLUMNS`, which includes `user_id`. A
new `STAFF_BIO_PUBLIC_COLUMNS` in `src/lib/staffBios.ts` leaves it out, and
`About.tsx` uses that list. **This is the one client change, and it must
deploy before the migration** (see the deploy steps).

**Promo codes.** `ticket_discounts.code` is now hidden by row, not by column.
`discounts.ts` selects `code` as anon in order to drop coded rules from the
preview, so withholding the column would turn every discount preview into full
price. Instead, the public policy now shows only rules where `code IS NULL`.
Staff and admins still see every rule, and `price_ticket_order` (a definer
function) is unaffected.

**Role helpers.**
- `resolve_account_id`, `is_host_of*` and `is_protected_user`: fixed under M10.
- `has_role` stays anon-executable on purpose. The SELECT policies of 17
  tables anon reads call it, and Postgres checks EXECUTE on every function in a
  policy before running the query. Revoking it would turn every public read
  into a 42501 error, and rule 7 of the new check reports exactly that.
- What `has_role` leaks is "is this uuid an admin". With the staff-id columns
  gone, anon has no uuid to ask about.
- `has_role` cannot short-circuit for anon callers either:
  `log_failed_staff_login` runs as anon and calls `has_role` on a looked-up
  user id.

## The standing check

`supabase/tests/anon_surface/`:
- `surface.sql` is read-only and holds an explicit allowlist of anon's table,
  column and function access. It also requires RLS on everything anon reads,
  no anon writes, service-only functions kept from every client role, every
  function an anon policy needs still executable, and no storage policy that
  lets anon read objects.
- `behaviour.sql` holds 61 role-switched cases. They cover the refusals above
  and the site's real reads, using the app's own select constants pulled from
  `src/`.
- `run.sh` runs both against a full replay, under legacy and under staging
  default privileges.
- Live: `npx supabase db query --linked -f supabase/tests/anon_surface/surface.sql`
  should return zero rows.

## How it was proven

- `sh supabase/tests/anon_surface/run.sh`: 0 surface violations and 61/61
  behaviour cases pass, under both privilege models.
- `surface.sql` was also run against a replay that stops before these
  migrations. Under legacy defaults it reports all of the above:
  - the movies table grant and the five other blanket-granted tables;
  - the sponsorship columns;
  - `audit_bulk_*`, `resolve_account_id`, `is_host_of*` and
    `is_protected_user`;
  - the six storage policies;
  - TRUNCATE for anon on every table.

  Under staging defaults it reports the same apart from `audit_bulk_*` (which
  staging already refuses) and TRUNCATE.
- Revoking `has_role` from anon on a fixed replay makes rule 7 report 17
  policies. The check therefore fails in both directions.
- Repo checks:
  - `npx vitest run`: 1002 passed.
  - `deno test`: 433 passed.
  - `deno check`: 3 errors, the pre-existing crypto ones, none added.
  - `sh supabase/tests/pricing_rpc/run.sh`: 106/0.
  - `npx tsc -p tsconfig.app.json --noEmit` reports 9 errors and `npm run
    check:worker` fails ("worker-configuration.d.ts out of date"). Both are in
    files this branch does not touch (`NotificationsTab.test.tsx`, the
    generated wrangler types), so they come from main.

## DEPLOY STEPS

Staging first, then production. Each step must pass before the next.

1. **Pre-checks (read-only, on the target project).** Do these before any
   push:
   ```sh
   # 1a. What the target grants today. Expect violations; keep the output.
   npx supabase db query --linked -f supabase/tests/anon_surface/surface.sql
   # 1b. Settles M10: true on production means the hole was live.
   npx supabase db query --linked "select has_function_privilege('anon','public.audit_bulk_begin(text[],text,jsonb,integer,uuid)','execute')"
   # 1c. Names this branch ALTERs or DROPs must exist (ALTER POLICY fails on a missing name).
   npx supabase db query --linked "select polrelid::regclass, polname from pg_policy where polname like 'Hosts can%' order by 1,2"
   npx supabase db query --linked "select conname from pg_constraint where conname in ('tickets_showing_id_fkey','film_pass_redemptions_showing_id_fkey')"
   ```
   1c must list "Hosts can view/insert/update/delete … showings", "Hosts can
   update assigned events / live performances / movies", and both
   constraints. If production has drifted, fix the migration first.
2. **Client first.** Deploy the Worker so `/about` stops selecting
   `staff_bios.user_id` before anon loses that column. The new select works
   under the old grants too.
   ```sh
   npx wrangler deployments list --name kenworthy-ticketing-build   # record rollback id
   npm run build:production && npx wrangler deploy                  # staging: build:staging + --env staging
   ```
3. **Migrations.**
   ```sh
   npx supabase db push --linked --dry-run   # expect exactly 20261006225932..225937
   npx supabase db push --linked
   ```
   No edge function changes. No secrets.
4. **Post-deploy checks.** These use the anon key only and are read-only or
   expected refusals:
   ```sh
   npx supabase db query --linked -f supabase/tests/anon_surface/surface.sql   # expect 0 rows
   ```
   - `GET /rest/v1/movies?select=terms_percent&limit=1` returns 401/42501.
     `GET /rest/v1/movies?select=id,title,poster_url&limit=1` returns 200.
   - `GET /rest/v1/staff_bios?select=user_id&limit=1` returns 42501.
   - `GET /rest/v1/ticket_discounts?select=code&code=not.is.null` returns `[]`.
   - `POST /storage/v1/object/list/posters {"prefix":""}` returns `[]`.
   - A poster's public URL returns 200, and so does a `render/image/public`
     URL (a featured slide or pass image). **This is the one L18 assumption
     the replay cannot test: confirm it.**
   - `POST /rest/v1/rpc/audit_bulk_begin {"p_tables":[]}` returns 42501.
     `rpc/resolve_account_id` and `rpc/is_host_of` also return 42501.
   - `POST /rest/v1/rpc/get_rental_request_by_token {"p_token":"no-such-token"}`
     returns `[]` (200).
   - In a private window, load home, a showing page (with a discount preview
     if one is set), `/about` (staff section), the festival page, a film pass
     page, Backstage and Concessions.

## Rollback

Prefer rolling forward. Each migration can be reversed by hand, and every
reversal reopens the finding it fixed:
- `225932`: `GRANT SELECT ON <table> TO anon`.
- `225933`: drop the trigger and set both foreign keys back to `CASCADE`.
- `225934`: re-grant.
- `225935`: recreate the `SETOF rental_requests` version.
- `225936`: recreate the six SELECT policies.
- `225937`: drop `AND code IS NULL`.

Rolling the Worker back is harmless: the old `/about` select names `user_id`.
After `225932`, that select fails for anon and the staff section hides itself,
which is the page's own error path.

## Not done here (needs a decision or another cluster)

- **Buyer sessions.** `authenticated` keeps the table grant on `movies`, so a
  ticket buyer's recovered session (audit PUB-1) can still read the terms and
  staff ids. Columns cannot be gated per role through RLS. Closing this needs
  PUB-1's fix (no session for non-staff), or views.
- **Legacy default ACL on production** (`pg_default_acl`). This is the root
  cause of M10's class. If 1b returns true, consider `ALTER DEFAULT PRIVILEGES
  FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES, FUNCTIONS, SEQUENCES
  FROM anon, authenticated`, so production behaves like staging for every
  future migration. It was not shipped here because it cannot be verified
  without production access. The anon surface check catches its effects in
  the meantime.
- **Host showing edits.** Hosts can still set `ticket_price` and `total_seats`
  on their own showings (audit RLS-3, "consider").
- **`dvds.notes`** stays anon-readable (table grant). Check whether it is
  internal.
- **`log_failed_staff_login`** as a staff-email oracle (PUB-9) is unchanged.
