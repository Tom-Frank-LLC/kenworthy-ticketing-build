---
brief: admin-passkeys
title: Anyone who signs in can add a passkey as a second factor, keeping their authenticator app as the backup
status: queued
track: security
severity: P3
date: 2026-10-08
verified: false
---

# Brief: passkeys for admin accounts (Phase 2 of admin MFA)

**Requested by:** Tom, 2026-10-08. Phase 1 is `BRIEF-admin-mfa.md`: authenticator
apps (TOTP), enforced on the server by assurance level. This phase adds passkeys
as an **additional** second factor. TOTP stays enrolled as the backup.

## Why Phase 1 makes this additive

Enforcement asks whether the session is `aal2`, never which factor got it
there. In code, that's `session_ok()` and `role_gate()` in
`supabase/migrations/20261008233835_admin_mfa_enforcement.sql`. The browser side lists factors by type (`src/lib/mfa.ts`
`FACTOR_LABELS`, `codeFactors`), and `/account/security` already handles an account
holding several. A passkey that raises a session to `aal2` should need no server
change.

## Verify first; don't assume (checked 2026-10-08, not yet tested)

- **supabase-js already has the API.** The installed 2.96 declares
  `FactorType = 'totp' | 'phone' | 'webauthn'`, `mfa.webauthn`, and webauthn
  variants of `enroll` / `challenge` / `verify`, and `listFactors()` returns a
  `webauthn` bucket. No upgrade is needed to *call* it.
- **What hosted Supabase ships is a different thing.** "Passkeys for Supabase
  Auth (Beta)", May 2026, is **passwordless primary sign-in**
  (Dashboard → Authentication → Passkeys). The changelog does not describe it as
  an MFA factor and does not say what `aal` a passkey sign-in gets.
  - Test 1, on staging: does `mfa.enroll({ factorType: 'webauthn' })` work on
    the hosted project? Does verifying it produce an `aal2` session with
    `amr` `mfa/webauthn`?
  - Test 2: if the passkey *primary* sign-in is ever enabled, what `aal` does it
    produce? If it's `aal1`, Phase 1's gate refuses it for everyone (correct,
    but confusing). If it's `aal2` from a single passkey, decide whether that
    counts as two factors for this theatre. A passkey is phishing-resistant, and
    NIST treats a user-verified passkey as multi-factor, but it changes what
    "two-step" means here.
- **Developer accounts.** For passkeys on the **web**, the Relying Party ID is the
  bare domain (`kenworthy.org`) and the origins are the site URLs. No Apple or
  Google developer account appears to be needed. Associated domains and
  `assetlinks.json` matter for native apps, which this platform doesn't have.
  Confirm before treating the developer-account approval as a blocker.

If native webauthn-as-MFA isn't available on hosted projects, this phase waits
for it. Don't hand-roll WebAuthn verification.

## Build (once verified)

1. `/account/security`: "Add a passkey" beside "Add an authenticator app"
   (`navigator.credentials.create` through `mfa.webauthn`). Label "Passkey"
   (already in `FACTOR_LABELS`).
2. Code step (`src/components/MfaCodeStep.tsx`): when the account has a verified
   passkey, offer "Use your passkey" first, with "Use a code instead" for the
   authenticator. `codeFactors()` already excludes webauthn; the component
   already handles an account whose only factors take no code.
3. **Backup guarantee:** refuse removing the last verified TOTP factor while a
   passkey is the only other one. Enforce it in the page, and note it in the
   runbook. Auth doesn't enforce it.
4. `admin-mfa-reset`: already removes every factor type, and its status view
   already reports `factor_types`. No change expected.
5. Tests: aal2 reached by a webauthn factor passes `role_gate`. The SQL harness
   case is the same as for TOTP, since it only sees `aal`.

## Out of scope

Passkeys as passwordless primary sign-in for admins. That's a bigger change.
Revisit after this phase.

## Sources

- [Passkeys for Supabase Auth (Beta), changelog](https://supabase.com/changelog/46458-passkeys-for-supabase-auth-beta)
- [Discussion #46458](https://github.com/orgs/supabase/discussions/46458)
- [Supabase MFA (TOTP)](https://supabase.com/docs/guides/auth/auth-mfa/totp)
