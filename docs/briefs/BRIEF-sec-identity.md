---
brief: sec-identity
title: Identity is auth.users and a session is not a role — buyers cannot sign in, edit their identity, or pass as staff
status: shipped
track: security
date: 2026-10-06
verified: true
findings: ../AUDIT-security-2026-10-06.md
shipped_in: ["#360", "0d9cf1a"]
shipped_at: 2026-10-06
evidence: "migration 20261006225756 on both (unique index created; 0 drifted profiles, 0 role-less sign-ins, 0 mismatched invite reuse on production beforehand); 7 functions on both; Worker prod 0a00ae85 (rollback 4be74067); access-token hook installed, NOT enabled"
---

# Identity is auth.users, and a session is not a role

Fixes **H1, M1, M7 and L9** from `docs/AUDIT-security-2026-10-06.md`, plus the
parts of L10 and L15 that are in `mailchimp-subscribe`.

**Tom's decision (2026-10-06):** an account with no staff, host, admin or
superadmin role must not be able to sign in.

## The root cause

CLAUDE.md used to say that `authenticated` means staff. That stopped being true
when checkout began creating a confirmed auth account for every guest buyer.
Any buyer could then use "Forgot password?" to get a real session. Three things
followed:

- **H1.** A buyer could update their own `profiles.email` and `phone`, and two
  server paths treated `profiles.email` as identity:
  - **Buyer resolution.** This let a buyer capture another patron's tickets and
    QR codes.
  - **`invite-staff`.** A buyer could set their profile to an address an admin
    was about to invite, and receive the invited role, up to admin.
- **M1.** Several gates checked only that a user was signed in, not that the
  user held a role.
- **L9.** Service-role identity was taken from an unverified JWT claim.

## What changed

### H1: identity

- **Buyers and invitees are resolved against `auth.users`.** The new RPCs
  `auth_user_id_by_email` and `auth_user_id_by_phone` can only be called by
  `service_role`. Nothing reads `profiles` for identity any more
  (`_shared/buyers.ts`).
  - The old profiles-first lookup existed to get an answer in one round trip.
    The RPC keeps that.
  - If the RPC errors (for example, the migration is not applied yet), the
    lookup falls back to the paged `listUsers` scan. That scan also reads
    `auth.users`, so the fallback is slower but still correct.
- **Phone matching is deliberately narrow.** A phone number is not a verified
  identity: anyone can type any number at checkout, and the first checkout to
  use a number owns it in auth.
  - A phone match is used only when the buyer gave no email. A buyer who gave an
    email is identified by that email. Previously, an email that matched nobody
    fell through to the phone and attached the order to whichever account held
    the number, under a different address.
  - The match is against `auth.users.phone` only, never `profiles.phone`.
  - It never returns an account that holds staff, host, admin or superadmin.
    Those accounts can sign in, so a stranger's order on one would expose its
    QR codes.
  - Auth requires phone numbers to be unique. If the number already belongs to
    another account, `findOrCreateBuyer` creates the new account without an auth
    phone and keeps the number on the profile, where delivery reads it.
- **`profiles` UPDATE is now column-scoped.** The table-wide grant to
  `authenticated` is revoked. Clients can update only `display_name`,
  `marketing_opt_in` and the five `mailchimp_*` cache columns. Every client write
  was found by grep (listed in the migration).
  - `email`, `phone` and `signer_title` are no longer client-writable.
  - `Profile.tsx` no longer writes `phone`. The field is now read-only, with the
    note "To change your phone number, ask the box office." **This is a visible
    change for staff and hosts.**
- **`profiles.email` now follows `auth.users.email`.** A trigger keeps it in
  step on every change, and the migration repairs any row that has drifted.
  - The `audit_profiles` trigger records each repaired row with its old value.
    Any H1 tampering that already happened therefore ends up in
    `admin_audit_log` as `profiles.update` with `changes.email.old`.
- **A unique index on `lower(profiles.email)` is created only if the data
  allows it.** If any address is held by more than one profile, the index is
  skipped with a NOTICE instead of failing the deploy.
  - After the repair, the only possible duplicates are case variants of one
    address on two auth accounts. Choosing which account keeps the address is a
    human merge, not a deploy step.
  - The replay had none. Run pre-deploy query 2 below to check production.
  - Trade-off: once the index exists, creating an auth user whose address
    differs from an existing one only by case fails in `handle_new_user`.
    Checkout cannot reach that state, because the lookup matches
    case-insensitively first. Only the dashboard could.
- **`invite-staff` re-checks the address before granting.** Before granting a
  role onto an existing account, it asserts that the account's own
  `auth.users.email` equals the invited address (`invite-staff/target.ts`). On
  a mismatch it returns 409 and grants nothing.
  - Reuse is now explicit in both the response and the audit row:
    `reused_existing_account`, plus a `notice` saying that no invitation email
    was sent and the person should use "Forgot password?".

### Refusing sign-in to role-less accounts

- **`send-auth-email` no longer sends sign-in emails to role-less accounts.** It
  checks `user_roles` for staff, host, admin or superadmin. If the account has
  none, the hook sends only:
  - `invite`; and
  - Supabase's token-less `*_notification` emails.

  It suppresses `recovery`, `magiclink`, `signup`, `email_change*`,
  `reauthentication`, and any new email type Supabase adds later.
- **Why invites are let through:** `invite-staff` calls `inviteUserByEmail`
  before it upserts the role (verified in the code). A genuine invitee
  therefore has no role yet when the hook runs.
- **A suppressed email is answered exactly like a sent one** (200 `{}`), so the
  endpoint cannot be used to find out which addresses have accounts. For an
  unknown address, GoTrue's `/recover` returns the same 200 without calling the
  hook. A hook error, by contrast, is passed back to the client, which would
  give the difference away.
  - A failed role lookup returns a 503 hook error. Its cause does not depend on
    which user asked.
  - Each suppression writes `auth.email_suppressed.<type>` to the audit log,
    with the address masked.
  - Residual leak: a suppressed request skips the Resend call, so it returns
    slightly faster. That separates staff from patrons by timing. It reveals
    nothing that an unknown address does not already reveal.
- **Existing passwords and sessions are not reached by the email change.** It
  does nothing about a buyer who already set a password, or a refresh token
  that is still live. With the M1 gates below, such a session can do very
  little:
  - It can read its own tickets.
  - It can edit its own display name and marketing flag.
  - It is treated as anonymous by `mailchimp-subscribe`, and as an own-order,
    one-send caller by `send-ticket-confirmation`.

  But the audit's broader M1 sweep, which is to check every RPC granted to
  `authenticated` for a role check, is not finished. **Recommendation: turn on
  the Custom Access Token hook.**
  - The migration installs `public.refuse_roleless_access_token(event jsonb)`.
    It is inert until it is selected in the dashboard.
  - Once selected, it refuses every token issuance for a role-less account:
    password sign-in, OTP and link verification, and refresh. Existing patron
    sessions therefore end at their next refresh (at most the JWT expiry).
  - Roles pass with their claims untouched, and invitees pass because the role
    exists before they click.
  - Replay-tested (see below). Enabling it is a manual step (deploy step 6).

### M1: role gates instead of "has a session"

- **`mailchimp-subscribe`:** a caller is trusted only if it is the verified
  service role or holds `has_role(staff)`. A host, a buyer's session or a bad
  token gets the anonymous path.
- **`apply_production_template_to_showing`:** now raises 42501 for anyone who is
  not admin, matching `set_showing_price_tiers`. Its only caller is
  `ShowingForm`, behind `<AdminOnly>`.
- **`send-ticket-confirmation`:** `force` and `account_created` are honoured for
  operators (staff or the service role) only, through `flagsFor` in
  `_shared/confirmation_auth.ts`.
  - An owner's resend is therefore limited to one delivery. The `already_sent`
    guard is the limit, and `force` was the only way around it. No separate
    limiter was needed.
- **`shift_requests`:** an INSERT must come from staff, for their own request,
  with status `pending` and unresolved. UPDATE requires staff, with a
  WITH CHECK.
  - The only writer is `TimeClockWidget`, which is on StaffPOS.
  - Previously, any session could insert a row already `approved`, or approve
    its own row.
  - Which staff may approve is part of M6 and is not changed here.
- **`dvd_rentals`:** INSERT requires staff. The member clause served only the
  patron reserve button, which is off along with member accounts. If member
  accounts relaunch, restore the clause together with sign-in.

### M7 and L10/L15: `mailchimp-subscribe`

- **Anonymous callers can only create.** The function now POSTs
  `/lists/{id}/members` with `status: pending`, the name only, and allowlisted
  tags. "Member Exists" is answered exactly like success, and the existing
  member is left untouched.
  - The handler is in `mailchimp-subscribe/handler.ts`, so it can be tested
    against a stubbed Mailchimp.
- **`source:` tags come from an allowlist** of the 10 values the repo actually
  sends. This applies to every caller; anything else is dropped.
- **Provider errors are summarised as `status title`** in logs and in trusted
  responses. Anonymous callers get a generic message. Mailchimp's `detail`
  field often quotes the email address, so it is never logged.

### L9: proving the service role

- **`_shared/callers.ts` no longer trusts a role claim.**
  - `isServiceRoleCaller` is synchronous and local. It compares the presented
    key, constant-time, against `SUPABASE_SERVICE_ROLE_KEY` and every value in
    `SUPABASE_SECRET_KEYS`. Both are injected; staging's `secrets list` shows
    both names.
  - `verifyServiceRoleCaller` (async) adds one more check. If a token claims
    `service_role` but is not one of the local keys, it asks auth's admin API
    for the all-zero user. Only a genuine service-role token gets 404
    `user_not_found`. This covers a legacy dashboard JWT when the environment
    holds `sb_secret_`.
  - Both checks fail closed.
- **`send-ticket-confirmation`'s duplicate decoder is deleted.** That copy also
  used a non-constant-time `===`. The function now uses
  `verifyServiceRoleCaller`.
- **Real callers traced:**
  - Nothing in the code calls `send-ticket-confirmation` with a service key.
    Its callers are StaffPOS and UndeliveredOrdersCard (staff), plus manual
    operator use.
  - `ticket-checkout` and `square-donation` call `mailchimp-ecommerce` with
    `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`. That is the literal env value, which
    `isServiceRoleCaller` still matches.

## How it was proven

- **Migration replay.** All 149 migrations were replayed into a throwaway
  `postgres:15`. The only error was the pre-existing data-anchored
  `20260812180000`. The audit's fixtures were then loaded, and probes run as
  each role. The harness is in the session scratchpad (`sec-identity/`:
  `run.sh`, `probes.sh`, `assert.sh`).

| Probe (as `authenticated`) | Before | After |
|---|---|---|
| patron UPDATE own `profiles.email` | updated | permission denied |
| patron UPDATE own `phone` / `signer_title` | updated | permission denied |
| patron UPDATE `display_name` + all `mailchimp_*` cache columns | updated | updated |
| patron `apply_production_template_to_showing` | 1 tier seeded | 42501 Admin access required |
| admin / superadmin `apply_production_template_to_showing` | seeded | seeded |
| patron INSERT `shift_requests` `approved` / `pending` | inserted | RLS refused |
| patron UPDATE own request to `approved` | approved | 0 rows |
| staff INSERT pending / approve a request | ok | ok |
| staff INSERT already-`approved` | inserted | RLS refused |
| patron / host INSERT `dvd_rentals` | inserted | RLS refused |
| staff INSERT `dvd_rentals` | inserted | inserted |

- **Running the migration over existing data.** It was applied on top of a main
  replay in which a patron's profile email had been tampered with, plus a
  case-variant duplicate:
  - The tampered row was repaired, and the audit row recorded
    `{"email":{"old":"newmanager@kenworthy.org","new":"patron@x.test"}}`.
  - The index was skipped with a NOTICE and the migration still exited 0.
  - With the duplicate removed and the migration run again, the index was
    created. The migration can be re-run safely.
- **SQL assertions after the migration:**
  - `anon` and `authenticated` are refused EXECUTE on both lookups. Only
    `service_role` has it, plus `supabase_auth_admin` on the hook.
  - The email lookup ignores case and surrounding spaces, prefers the exact
    form over a case variant, and ignores a tampered `profiles.email`.
  - The phone lookup matches a role-less account (formatting tolerant), never a
    staff or host account, and never a blank number.
  - The sync trigger carries an auth email change through to `profiles`.
  - The unique index refuses a case-variant duplicate.
  - The access-token hook refuses a role-less user (and a missing `user_id`),
    passes host, staff, admin and superadmin with their claims intact, and
    passes an invitee as soon as the role is upserted.
- **Deno tests (all stubbed; nothing reaches Mailchimp, Resend, Twilio or a
  live auth server):**
  - `_shared/buyers_lookup_test.ts`: 13 tests. Covers the RPC, that profiles
    are never read, the phone rules, retrying without the phone, and the scan
    fallback.
  - `_shared/callers_test.ts`: 7 tests. Covers forged `alg:none` and HS256
    claims, odd auth answers, unreachable auth, both env key sources, and
    verification of a legacy JWT.
  - `_shared/confirmation_auth_test.ts`: 2 new tests for `flagsFor`.
  - `_shared/auth_email_test.ts`: 5 new tests for the role-less suppression
    rule and the role lookup, including that it fails closed.
  - `mailchimp-subscribe/handler_test.ts`: 8 tests. Covers POST-only for anon,
    Member Exists, no unsubscribe, the rate limit, redaction, and that the
    trusted upsert and tags are unchanged.
  - `invite-staff/target_test.ts`: 3 tests.

## Deploy steps (lead / Tom; in this order)

**0. Rollback ids.** Record `npx wrangler deployments list --name
kenworthy-ticketing-build` (and `--env staging`). Record each function's
current version from the dashboard.

**1. Pre-deploy, read-only queries against production** (SQL editor):

```sql
-- 1. Drift: rows the migration will repair. Each is either a stale copy or H1 used.
select p.id, p.email as profile_email, u.email as auth_email, p.updated_at
  from public.profiles p join auth.users u on u.id = p.id
 where p.email is distinct from u.email;
-- 2. Would the unique index be skipped?
select lower(email), count(*) from public.profiles
 where email is not null group by 1 having count(*) > 1;
-- 3. Role-less accounts that have signed in (buyers holding sessions):
select count(*), max(u.last_sign_in_at) from auth.users u
 where u.last_sign_in_at is not null
   and not exists (select 1 from public.user_roles r where r.user_id = u.id
                   and r.role in ('staff','host','admin','superadmin'));
-- 4. Accounts invite-staff reused whose auth address != invited address:
select l.created_at, l.entity_id, l.details->>'invited_email', u.email
  from public.admin_audit_log l join auth.users u on u.id = l.entity_id
 where l.action = 'user_roles.invite' and (l.details->>'created')::boolean = false
   and lower(u.email) <> lower(l.details->>'invited_email');
```

Any rows from query 4 are an H1 escalation that already happened. Revoke that
role first.

**2. Migration, staging then production:** `supabase db push`, which applies
`20261006225756_identity_is_auth_users.sql`. Read the NOTICEs: the repaired
row count, and whether `profiles_email_lower_unique` was created. Then verify:

```sql
select count(*) from pg_indexes where indexname = 'profiles_email_lower_unique';
select has_function_privilege('authenticated','public.auth_user_id_by_email(text)','execute'); -- f
```

**3. Edge functions, staging then production.** Every function that bundles a
changed `_shared` file:
`supabase functions deploy send-auth-email invite-staff mailchimp-subscribe send-ticket-confirmation ticket-checkout film-pass-checkout mailchimp-ecommerce`.

- `ticket-checkout` and `film-pass-checkout` import `_shared/buyers.ts`; the
  H1 lookup fix is not live until they are redeployed. Other security clusters
  may be changing those two files too, so deploy from the merged main.
- `mailchimp-ecommerce` imports `_shared/callers.ts`.

The migration goes before the functions. If the order is reversed, buyers.ts
falls back to the auth scan and phone matching is off until the RPC exists.
Neither is unsafe.

**4. The Worker** (Profile.tsx):

```bash
npm run build:production
npx wrangler deploy
```

Run `npx wrangler deploy --env staging` first.

**5. Post-deploy checks.** All are safe: each is read-only or an expected
refusal.

- Anon calls:
  - `POST /rest/v1/rpc/auth_user_id_by_email` with the anon key should return
    401 or 403 (permission denied).
  - `POST /rest/v1/rpc/apply_production_template_to_showing` with the anon key
    should be refused.
- On staging, as Tom (staff):
  - Use "Forgot password?" for your own address. The email should arrive.
  - Resend a confirmation from Undelivered Orders. It should be delivered.
  - Sell a $0 or cash counter sale on StaffPOS and deliver it.
- On staging, a role-less test buyer: "Forgot password?" for their address
  should say it was sent, but no email arrives. The audit log should show
  `auth.email_suppressed.recovery`.
- On staging, invite a fresh address of Tom's. The invite email should arrive,
  the link should set a password, and sign-in should work.
- Do **not** exercise `mailchimp-subscribe` live. Staging writes to the
  production audience.

**6. Manual: Custom Access Token hook** (recommended; staging first, then
production):

1. In the dashboard, go to Authentication → Hooks → Customize Access Token
   (JWT) Claims hook.
2. Choose Postgres, schema `public`, function `refuse_roleless_access_token`.
3. On staging, verify:
   - Staff and host sign-in still works, and a refresh after an hour still
     works.
   - A role-less test account with a password is refused at sign-in with "Sign-in
     is for Kenworthy staff…".

Unverified: whether Supabase passes the hook's `error` object back as a refusal
for every grant type. Supabase documents an error return for its hooks, but it
was not exercised here. This is why staging comes first.

To roll back the hook, disable it in the same screen.

## Rollback

- **Functions:** redeploy the previous versions from the parent of the merge
  commit. If you roll back `ticket-checkout` or `film-pass-checkout` alone, they
  go back to the profiles-first lookup, which reopens H1 buyer theft. That
  lookup still works against the migrated database.
- **Migration:** roll forward. Each part can be reverted on its own:
  - `GRANT UPDATE ON public.profiles TO authenticated` restores the old grant,
    which reopens H1.
  - `DROP TRIGGER on_auth_user_email_changed ON auth.users` removes the sync.
  - `DROP INDEX profiles_email_lower_unique` removes the index.
  - The old policies are in `20260625183135` and `20260626153407`.
  The previous function code does not depend on anything this migration
  removed.
- **Worker:** `npx wrangler rollback <recorded version>`.

## Not done here, and needing another file's owner

- **`ticket-checkout`, `film-pass-checkout` and `square-donation` → the
  `mailchimp-subscribe` sync.** They send only `apikey`, with no `Authorization`.
  The audit's staging probe found that the gateway rejects a missing
  `Authorization` header even when `apikey` is present, so these marketing syncs
  probably never arrive today. Even when they do, they are now anonymous, so
  they are create-only and do not tag a returning buyer.
  - Fix: send `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, the same
    pair they already use for `mailchimp-ecommerce`. They are then trusted and
    keep tagging existing members.
- **`mailchimp-ecommerce`** should call `await verifyServiceRoleCaller(req)`
  instead of `isServiceRoleCaller`, to accept a legacy dashboard JWT as well.
  Its real callers still pass with the synchronous check.
- **`InviteStaffDialog.tsx`** could show the new `notice` when an account is
  reused. Today its toast says "already had an account — granted", without the
  "use Forgot password" hint.
- **`docs/TICKET-DELIVERY.md:225-229`** still advises reading the `role` claim.
  That advice is now wrong.
- **The rest of the M1 sweep.** Every other function and RPC granted to
  `authenticated` still needs checking for an explicit role check. This brief
  covered the four the audit named.
- **Edge case:** a phone-only guest checkout using the phone number of a staff
  or host member now creates an account with neither email nor phone. If
  GoTrue refuses that, the checkout fails with an account error. This was not
  exercised; the realistic case is staff buying for themselves, who can give an
  email.
