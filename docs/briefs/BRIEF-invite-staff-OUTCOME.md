# Outcome: in-app "Invite staff member"

**Date:** August 14, 2026 · **Branch:** `feat/invite-staff` · **Commit:** `c7098ca`
**Deployed:** staging only (function + frontend). Production untouched.

## What shipped

| Piece | File |
| --- | --- |
| Edge function | `supabase/functions/invite-staff/index.ts` (new) |
| Invite dialog | `src/pages/admin/Superadmin.tsx` |
| Invite landing fix | `src/pages/ResetPassword.tsx` |

`config.toml` was deliberately **not** touched — leaving `invite-staff` out of the
`verify_jwt = false` list is what keeps `verify_jwt` at its default `true`.

## The two things the brief could not have known

**1. The invite would have dead-ended on a spinner.**
`ResetPassword.tsx` gated on `type=recovery` in the URL and on the
`PASSWORD_RECOVERY` auth event. A Supabase invite link arrives as `type=invite`
and raises `SIGNED_IN`. So the flow the brief describes — "landing on
`/reset-password`" — would have left every invited person watching "Verifying
your reset link…" forever, with no way to set the password they were invited to
set. The function would have looked perfect in testing; the failure was one
page downstream of it. Fixed, and the page now says "Set Your Password" for an
invite rather than "Reset Password".

**2. Decision 1 dissolved — `inviteUserByEmail` is already branded.**
The brief framed this as "simple but unbranded vs. branded but more work". That
tradeoff no longer exists: `send-auth-email` is registered as Supabase's **Send
Email Hook** (`hook_send_email_enabled: true`, verified on *both* projects), so
it intercepts every auth email and renders it through `_shared/auth-email.ts` —
which already carries `invite` copy ("You've been invited to the Kenworthy
Performing Arts Centre"). The simple call gets the Kenworthy-branded email for
free. No follow-up work when the email-branding brief lands.

## Decisions as built

1. **Delivery:** `inviteUserByEmail` — branded via the hook, per above.
2. **Who can invite:** superadmin only. An `admin` caller gets 403 (verified).
3. **Default `regular_user` row:** left in place, as recommended.

## RLS check the brief asked for — clean

The brief flagged that `Superadmin.tsx`'s `grant()`/`revoke()` write `user_roles`
straight from the browser, so they rest entirely on that table's RLS. Queried
live on both projects:

```
Superadmins delete roles [DELETE] · Superadmins insert roles [INSERT]
Superadmins update roles [UPDATE] · Superadmins view all roles [SELECT]
Users can view own roles [SELECT]
```

The old `"Admins can insert roles"` / `"Admins can delete roles"` policies from
migration `20260217193757` are **gone from both databases**, so there is no
admin-grants-self-superadmin path. Note this is true of the *databases* but not
of the migration history — the drop is not in a committed migration, so a
rebuild from migrations alone would reintroduce the permissive policies. Worth
a migration in the RLS-audit work.

## Test results (staging, real superadmin JWT)

| Case | Result |
| --- | --- |
| No email / malformed email | 400, nothing created |
| `role: regular_user` / unknown role | 400, nothing created |
| Caller with `regular_user` | 403 |
| Caller with `admin` | 403 — superadmin-only holds |
| No JWT at all | 401 at the gateway, before any code runs |
| Existing account, mixed-case email | `created: false`, role added to the *same* user id |
| Same call repeated | Identical result — idempotent, no duplicate role row |
| Brand-new email | `created: true`; profile + `display_name` written by the trigger; roles `regular_user` + `staff`; `invited_at` set, unconfirmed, never signed in |

Also verified: `SITE_URL` on each project hashes to that project's own origin
(staging → staging, prod → prod), so the invite redirect lands inside each
project's allowed-redirect list rather than bouncing to the other environment.

Checks: `deno check` clean · 122 deno tests pass · `tsc -p tsconfig.app.json`
clean · 155 vitest tests pass · `npm run build:staging` clean.
(`_shared/tickets_test.ts` has a pre-existing `PNG.sync` type error, untouched
by this work — it only surfaces under `deno test` without `--no-check`.)

## Left for Tom

The one step no one else can do: open the invite mailed to
`mrtomfrank+kpacstaff@gmail.com` on staging, confirm it looks like a Kenworthy
email, set a password, and sign in at `/auth`. That account is live on staging
and pending — delete it when done.

Staging worker version for rollback: `9808dfcf-956f-4dbc-a31c-6ab7c702bd30`.
