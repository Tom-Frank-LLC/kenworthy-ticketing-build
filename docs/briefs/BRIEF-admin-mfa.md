---
brief: admin-mfa
title: Everyone who signs in needs an authenticator code, enforced on the server, not only asked for in the browser
status: in-progress
track: security
severity: P1
date: 2026-10-07
verified: false
findings: ../AUDIT-security-2026-10-06.md
---

# Brief (for Claude Code): MFA for admin and superadmin accounts

**Requested by:** Tom, 2026-10-07. This is audit finding **M9**, deferred from the
2026-10-06 fix round into a brief of its own. Tom plans to activate it within a
day or two of the build landing.

## Why

Admin and superadmin access rests on one password today. With that password, an
attacker gets:
- every patron's contact details;
- refunds, comps and the Square catalog;
- payroll;
- role grants. A superadmin can mint more admins.

The sign-in open redirect (M5, fixed in #359) showed how a password can be
phished. MFA means a phished password alone is no longer enough.

## Decisions already taken

1. **Who:** accounts holding `admin` or `superadmin`. On production, 2026-10-07,
   that is 5 accounts (4 admin, 1 superadmin). All are active, and none has a
   factor enrolled (`auth.mfa_factors` is empty). Staff (16) and hosts are out of
   scope for now; see *Later*.
2. **Factor:** TOTP, an authenticator app such as 1Password, Google
   Authenticator or Authy. It's free on Supabase. SMS MFA is a paid add-on and
   weaker; not used.
3. **The server refuses, the browser only asks.** The browser asking for a code
   is UX. Enforcement has to happen where admin powers are exercised: RLS and
   RPCs (through `has_role`) and edge functions. A client-only check is what the
   audit kept finding.

## What exists today (verified 2026-10-07 at `e1d03aa`)

- **Database:** about 210 policy and RPC references go through
  `public.has_role(_user_id, _role)`, called with `auth.uid()` from the caller's
  own session. Its hierarchy is superadmin ⊇ admin ⊇ staff; host is separate.
  Anon policies on 17 tables also call it, so it must stay anon-executable and
  must stay cheap.
- **Edge functions:** 24 check a role.
  - 17 call `admin.rpc('has_role', …)` directly through a **service-role** client.
  - 6 use `_shared/callers.ts` (`callerHasRole`) or a local
    `requireAdmin`/`requireStaff`.
  - 1 also selects from `user_roles`.

  Because they ask as service_role, `has_role` can't see the caller's assurance
  level there. The edge functions need their own check (below).
- **Client:** `src/components/RoleGate.tsx` (`AdminOnly`, `StaffOnly`),
  `src/pages/Auth.tsx` (password sign-in), `src/lib/auth.tsx` (`AuthProvider`).
  supabase-js is 2.96 on the client and 2.117.2 in functions; both have the
  `auth.mfa.*` API.
- **Hosted auth settings:** not in `supabase/config.toml`. Confirm in the
  dashboard (Authentication → Multi-Factor) that **TOTP enroll and verify are
  enabled** on both projects.

## Design

### 1. Enrollment: a page for admins to set up their authenticator

- New page `/account/security`, reachable from the profile menu for anyone signed
  in. Admin-tier accounts with no verified factor are sent there after sign-in.
- Flow: `supabase.auth.mfa.enroll({ factorType: 'totp' })`, then show the QR
  code and the text secret, then `mfa.challenge` and `mfa.verify` with the
  6-digit code. Show the result.
- List enrolled factors. Unenrolling needs a fresh aal2 session (Supabase
  enforces this).
- Copy: plain, no jargon. "Open your authenticator app and scan this code."
- Accessibility: the page must pass `scripts/a11y-audit.mjs` like every other
  page. The QR needs a text alternative, which is the secret shown as text with
  a copy button.

### 2. Sign-in: ask for the code

After the password succeeds, call
`supabase.auth.mfa.getAuthenticatorAssuranceLevel()`.
- If `nextLevel === 'aal2'` and `currentLevel === 'aal1'`, show a code step
  (`mfa.challenge` + `mfa.verify`) before routing anywhere. The redirect target
  still goes through `safeRedirectPath`.
- The same check runs when the app loads with an existing session, so an admin
  whose session predates enforcement is prompted rather than finding pages
  quietly empty.

### 3. Enforcement in the database, behind a switch

- One switch, `app_config` key `mfa_required_for_admins` (boolean, default
  **false**), so the build can ship dark and be turned on after everyone has
  enrolled.
- In `has_role`: when the switch is on, the caller is the subject
  (`auth.uid() = _user_id`), the subject holds `admin` or `superadmin`, and
  `coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'`, return **false for every
  role**, staff included.
  - All-or-nothing on purpose. A phished admin password must not still open the
    POS, refunds or attendee lists at staff level.
  - Anon (no `auth.uid()`) and service_role calls are unaffected; the edge
    functions handle those.
- Keep `has_role` STABLE and cheap. It runs inside RLS on hot public reads. Read
  the switch once per statement (a STABLE helper), and check that a public page's
  query plan doesn't regress.
- Test in the throwaway-postgres harness. Use the `anon_surface` harness and the
  staff-boundaries harness as models, with JWTs whose `aal` is `aal1` and
  `aal2`, for each role, with the switch off and on. Also run
  `supabase/tests/anon_surface` to prove anon reads are untouched.

### 4. Enforcement in edge functions

- Add `requireRole(req, role)` to `_shared/callers.ts`, and move all 24
  role-checking functions onto it. This replaces 17 hand-rolled
  `rpc('has_role')` calls, so the audit's "every function gates itself" stays
  true in one place. It:
  1. resolves the caller (`getUser`);
  2. checks the role with `callerHasRole`;
  3. if the switch is on and the caller holds admin or superadmin, requires the
     **verified** token's `aal` claim to be `aal2`. Read the claim with
     `auth.getClaims()`, which verifies the signature, or from the
     gateway-verified bearer. Never trust an unverified decode; `qbo-sync` runs
     with `verify_jwt = false`.
- Refuse with `403 { error: 'Enter your authenticator code to continue' }` and a
  machine-readable `code: 'mfa_required'`, so the client can show the code step
  rather than a dead end.
- Tests: extend the handler harness (`_shared/testing/handler_harness.ts`) for
  aal1 and aal2 tokens.

### 5. Recovery: a lost phone

- **Normal path:** an admin who loses their authenticator asks the superadmin.
  The superadmin removes that user's factor through a new `admin-mfa-reset` edge
  function (superadmin-only, aal2 required, writes `logAudit`). That calls
  `auth.admin.mfa.deleteFactor`, and the admin re-enrolls at next sign-in.
- **Break-glass:** if the only superadmin (Tom) loses his device, remove the
  factor in the **Supabase dashboard** (Authentication → Users → user → MFA
  factors). The Supabase organisation account should itself have MFA on.
  Record this in `docs/RUNBOOK-secret-rotation.md` or a short
  `RUNBOOK-admin-mfa.md`.
- Recommend that Tom enrolls **two** authenticators, phone plus a password
  manager, so one loss isn't a lockout.

## As built (2026-10-08)

**Scope changed, 2026-10-08.** Tom: "let's not even gate it behind roles for
now - everyone who wants to log in must authenticate." So the switch applies to
**every signed-in session**: staff (16), hosts, admins and the superadmin. That
supersedes decision 1 above and the "Staff later" note. Patrons don't sign in
(member accounts are off), so the public site and checkout are untouched.

Tom's addendum the same day also made this **Phase 1 of two**. Phase 2 adds
passkeys as an extra factor, with the authenticator kept as the backup: see
`BRIEF-admin-passkeys.md`. So everything below handles factors generically and
tests the assurance level, never the factor type.

How "everyone" is enforced in the database. `has_role` alone isn't enough: a
survey of all 208 policies on staging found hosts and own-row grants that never
call it. Migration `20261008233835` closes three routes:

1. **`has_role`** answers false for any role when the caller asks about
   themselves from a session that `session_ok()` rejects (switch on, not aal2).
2. **`is_host_of` / `is_host_of_showing`** get the same guard. That covers host
   policies and the attendee, check-in and order RPCs.
3. **A RESTRICTIVE policy, "Signed-in sessions need their code"**, on the ten
   tables with own-row grants: donations, dvd_rentals, film_pass_redemptions,
   host_event_assignments, profiles, rental_invoice_lines, shift_requests,
   staff_square_links, tickets, user_film_passes. Postgres ANDs a restrictive
   policy with every permissive one, so no existing policy was rewritten. None
   of these tables has a signed-in read that isn't own-row or role-based.

Two deliberate exceptions: own `user_roles` rows stay readable, so the browser
can route a password-only staff session to the code step rather than home. And
admin_audit_log's INSERT already ANDs with `has_role`. The harness's last case
is structural: it fails if any policy grants on `auth.uid()` by a route not
covered here. A mutation test (dropping one restrictive policy) confirmed it
names the exposed policy.

Other choices that differ from the design above, and why:

- **The rule lives in SQL only.** Edge functions call the service-role-only
  `role_gate(user, role, aal)` → `'ok' | 'forbidden' | 'mfa_required'`, rather
  than reading the switch themselves.
- **The token's `aal` is read after GoTrue's `/auth/v1/user` accepts that exact
  token**, not via `auth.getClaims()`. Eight functions pin supabase-js 2.45.0,
  which has no `getClaims`. `/user` also checks the session still exists.
- **The switch is `app_config.mfa_required`**, not `mfa_required_for_admins`,
  since it isn't about admins any more.
- **The sign-in audit row is written after the code.** Its INSERT policy goes
  through `has_role`, so an aal1 row would be dropped.
- **Browser:** `MfaGate` sits in front of every signed-in page: the role-gated
  ones, plus `/host`, `/profile`, `/my-tickets` and `/my-passes`. It shows the
  code step on a password-only session. Once the switch is on, it sends anyone
  without a factor to `/account/security`. After sign-in, everyone without a
  factor is nudged there, and may skip while the switch is off.
- **Recovery:** `/superadmin` → *Two-step sign-in* lists every role holder's
  factor count, stragglers first (also the rollout check), with Reset.
  `admin-mfa-reset` requires aal2 for a reset even with the switch off.
- **Unenrolling the last factor** is blocked in the page while the server
  requires one.

Tests: `supabase/tests/admin_mfa/run.sh` covers 57 cases: staff, host, admin,
superadmin and patron at aal1 and aal2, switch off and on, own-row reads, host
edits, the gate, grants, and the structural guard. Also deno tests for
`requireRole` and per-function `mfa_required` refusals, and vitest
`src/components/mfaGate.test.tsx` and `src/lib/mfa.test.ts`. Operations:
`docs/RUNBOOK-admin-mfa.md`.

## Rollout

1. Build sections 1–5 with the switch **off**. Ship to staging, then production,
   per CLAUDE.md. With the switch off, nothing changes for anyone except the new
   page, and admins being sent there until they enroll.
2. **Each of the 5 admin-tier accounts enrolls** (about 2 minutes each). Check:
   ```sql
   select count(distinct f.user_id) from auth.mfa_factors f
     join user_roles r on r.user_id = f.user_id
    where r.role in ('admin','superadmin') and f.status = 'verified';   -- expect 5
   ```
3. **Staging first.** Turn the switch on and sign in as an admin:
   - No code entered: admin pages show the code step, and the edge functions
     return `mfa_required`.
   - Code entered: everything works, including a silent refresh an hour later.
   - A staff-only account is unaffected.
4. **Production:** turn the switch on, at a quiet time and not during a show.
   Every admin is prompted once at their next request.
5. **Rollback:** turn the switch off. One row, immediate, no deploy.

## Effort and risk

- **Build:** about a day. Most of it is moving the 24 functions onto
  `requireRole` and the sign-in code step. Enrollment is a small page.
- **Main risk:** an admin locked out mid-shift. Mitigations:
  - everyone enrolls before the switch flips;
  - the switch can be turned off instantly;
  - the superadmin reset function, and the dashboard break-glass.
- `has_role` is on every RLS evaluation. Measure a public page's queries before
  and after, as the performance work in #333 did.

## Later (not in this brief)

- **Staff:** 16 accounts that can refund, comp and see attendee lists. The same
  switch could take a role list. Worth doing once admins have lived with it for
  a few weeks.
- "Remember this device for 30 days" isn't something Supabase offers. Each new
  sign-in asks for a code; silent refreshes don't.

## Definition of done

- The 5 admin-tier accounts have verified factors.
- The switch is on in both projects.
- On production:
  - an aal1 admin token is refused by the database (an admin-only table returns
    0 rows or 42501) and by an edge function (`mfa_required`);
  - an aal2 token works;
  - staff and anon are unaffected;
  - `anon_surface/surface.sql` returns 0.
- The recovery runbook is written.
- This brief is marked `shipped` with evidence, and the audit report's M9 row is
  updated.
