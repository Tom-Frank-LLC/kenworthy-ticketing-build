# Runbook: two-step sign-in for admin accounts

What to do to turn admin MFA on, to turn it off, and to get someone back in.
The design is in `docs/briefs/BRIEF-admin-mfa.md` (security audit 2026-10-06,
M9).

## How it works, in one paragraph

Admin and superadmin accounts sign in with their password, then a 6-digit
code from an authenticator app. The **server** enforces it, not the browser.
`has_role()` in the database answers false for every role when an admin-tier
caller's session isn't `aal2`. The edge functions refuse the same caller with
`403 { code: 'mfa_required' }` through `requireRole` in
`supabase/functions/_shared/callers.ts`, which asks the database's `role_gate()`.
All of it sits behind one switch, the `app_config` row `mfa_required_for_admins`.
Staff, hosts and patrons are never affected.

| Where | What |
|---|---|
| `/account/security` | each person sets up or removes their authenticator apps |
| `/superadmin` → Two-step sign-in | who has one; reset someone's |
| `app_config.mfa_required_for_admins` | the switch: `{"enabled": true}` / `{"enabled": false}` |
| `supabase/functions/admin-mfa-reset` | the superadmin's status view and reset, audited as `auth.mfa_reset` |

## Before turning it on

1. **TOTP is enabled in both projects.** Supabase dashboard → Authentication →
   Multi-Factor (or Sign In / Providers → Multi-Factor): *TOTP (App
   Authenticator)* must be **Enabled** for enroll and verify. Hosted projects
   have it on by default; check, don't assume. Staging
   `rpqzrpboyhshdrfdwayk`, production `vlmslygnimfbamrtwvyo`.
2. **The Supabase organisation itself has MFA on** (supabase.com → Account →
   Security). The dashboard is the break-glass below, so it must not be the
   weak door.
3. **Every admin-tier account has enrolled.** `/superadmin` → *Two-step sign-in*
   shows "N of N admin-tier accounts have an authenticator". Or, in SQL:
   ```sql
   select count(distinct f.user_id) from auth.mfa_factors f
     join public.user_roles r on r.user_id = f.user_id
    where r.role in ('admin','superadmin') and f.status = 'verified';
   -- must equal:
   select count(distinct user_id) from public.user_roles where role in ('admin','superadmin');
   ```
4. **The superadmin has two authenticators**, say a phone and a password
   manager, so losing one device isn't a lockout.

## Turn it on

Staging first, then production at a quiet time, never during a show.

```sql
update public.app_config set value = '{"enabled": true}', updated_at = now()
 where key = 'mfa_required_for_admins'
returning key, value;   -- expect one row
```

Run it in the SQL editor, or with
`supabase db query --linked "<sql>"` from a checkout linked to that project.
A superadmin can also do it through PostgREST from an `aal2` session. An `aal1`
admin cannot: the update policy goes through `has_role`.

Then check, signed in as an admin on that environment:

- Password only: every admin and staff page asks for the code. Edge functions
  answer `mfa_required`.
- After the code: everything works, including after the hourly silent refresh.
- A staff-only account: unaffected.
- `sh supabase/tests/anon_surface/run.sh`, and on the live project
  `supabase db query --linked -f supabase/tests/anon_surface/surface.sql`,
  returns 0 rows.

## Turn it off (rollback)

```sql
update public.app_config set value = '{"enabled": false}', updated_at = now()
 where key = 'mfa_required_for_admins'
returning key, value;
```

Immediate, no deploy. Enrolled factors stay, and people with one are still
asked for the code at sign-in: that's Supabase's own behaviour for an account
with a factor. The server just stops refusing without it.

## Someone lost their phone

**An admin or staff member:** they ask the superadmin. **Confirm it's them** by
phone or in person, not by email alone; a reset request is exactly what an
attacker holding a password would send. Then `/superadmin` → *Two-step sign-in*
→ **Reset** on their row. Every factor on the account is removed and the action
is logged as `auth.mfa_reset`. At their next sign-in they're sent to set up a
new app.

The superadmin's session must itself be `aal2` to reset anyone, even while the
switch is off: removing someone's second factor must never be possible with a
password alone.

If the phone was **stolen** rather than lost, also change that person's
password (and consider removing their role until it is). A reset alone leaves
any session already signed in on the stolen device valid until it expires.

**The superadmin (break-glass):** if the only superadmin loses every
authenticator, nobody in the app can reset them. Use the Supabase dashboard →
Authentication → Users → the user → *MFA factors* → delete. Then sign in and
enroll again. If the dashboard is unreachable too, turn the switch off with SQL
(above) from any linked checkout. That restores password-only access for every
admin until it's back on.

## Phase 2: passkeys

Not built. See `docs/briefs/BRIEF-admin-passkeys.md`. The enforcement above
tests the assurance level, not the factor type, so it should not need to
change. Verify that before relying on it.
