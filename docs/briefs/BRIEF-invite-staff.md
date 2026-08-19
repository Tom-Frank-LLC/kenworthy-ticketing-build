# Brief (for Claude Code): In-app "Invite / Add staff member" (create account + assign role)

**Status:** ✅ Shipped — `481772b` (PR #62), `supabase/functions/invite-staff`. See `BRIEF-invite-staff-OUTCOME.md`.
**Date:** August 14, 2026
**Requested by:** Tom — now that self-signup is off, there is **no in-app way to onboard a new staff member**. Add a superadmin-only "Invite staff" flow that creates the account **and** assigns the role in one step, so onboarding no longer requires handing out Supabase dashboard access.

## The gap (verified in code)
- **Assigning a role already exists:** `/superadmin` (`src/pages/admin/Superadmin.tsx`, route `App.tsx:120`, superadmin-only) lists everyone in `profiles` joined to `user_roles` and grants/revokes `superadmin | admin | staff | host | regular_user` via a **direct client insert** into `user_roles` (`grant()` at ~L66; `revoke()` at ~L72). But it only operates on **profiles that already exist**.
- **Creating an account no longer exists in the app:** the *only* code path that mints an auth user is checkout (`_shared/buyers.ts` → `admin.auth.admin.createUser`, bypasses the signup-off setting because it's the admin API). There is **no** invite/create-user UI or edge function anywhere in admin. So a brand-new staff member who never bought a ticket has no auth user, no profile, and never appears in the `/superadmin` list to be granted a role.
- **Profile is auto-created on any new auth user:** the `on_auth_user_created` trigger → `handle_new_user()` (migration `20260217193757`) inserts a `profiles` row (`display_name` = meta or email) **and** a default `user_roles` row of `'regular_user'`. So once the auth user exists (by any means), they surface in `/superadmin` automatically — we just need a clean, gated way to create it and stamp the real role.

## Goal
A superadmin, from inside the app, enters a new staff member's **email** (+ optional display name) and a **role**, and the platform: creates the auth account (or reuses an existing one), sends them a set-password/invite link, and assigns the chosen role — all without touching the Supabase console.

## New edge function: `invite-staff`
Mirror the **auth/role-check pattern already used by `square-labor`** (`supabase/functions/square-labor/index.ts` ~L42–56): read the `Authorization` header → caller-token client → `supabase.auth.getUser()` → `supabase.rpc("has_role", { _user_id, _role })`.

Flow:
1. **CORS preflight** (reuse the shared `corsHeaders` the other functions use).
2. **Authenticate + authorize the caller:** `getUser()`; 401 if none. Then require **superadmin**: `has_role(user.id, 'superadmin')` → **403** otherwise. (Match the `/superadmin` page's own restriction — inviting is at least as privileged as granting roles.)
3. **Validate the body:** `email` (required; server-side format check + normalize/lowercase), `display_name` (optional string), `role` (must be one of `staff | admin | host | superadmin` — reject `regular_user` and unknown values). Default `role = 'staff'` if omitted.
4. **Service-role client** (`SUPABASE_SERVICE_ROLE_KEY`, like `buyers.ts`/`square-labor`) for the privileged work:
   - **Reuse if the email already exists** (idempotent): look the user up (by `profiles.email`, falling back to `admin.auth.admin.listUsers` if needed). If found, **do not create** — just ensure the role row exists (insert into `user_roles` if absent) and return a "user already existed — role granted" result. This makes "invite someone who once bought a ticket" work cleanly.
   - **Otherwise create + invite:** `admin.auth.admin.inviteUserByEmail(email, { data: { display_name }, redirectTo: '<SITE_URL>/reset-password' })` — or `createUser` + `generateLink({ type: 'invite'|'recovery' })` if we deliver the email ourselves (see Decision 1). `SITE_URL` from `Deno.env.get('SITE_URL')` with the prod-worker fallback, exactly as `_shared/deliver.ts` already does.
   - The `on_auth_user_created` trigger creates the `profiles` row + default `regular_user`. Then **insert the requested role** into `user_roles` (service role bypasses RLS — intentional and self-gated by step 2).
   - *(Optional, cosmetic)* also delete the default `regular_user` row when a real staff role is granted, so the list shows only the meaningful role.
5. **Return** `{ ok, created: boolean, userId, email, role }`; on failure return a generic message (no stack traces / internal IDs — matches the security brief's logging guidance).
6. **`supabase/config.toml`:** do **not** add `invite-staff` to the `verify_jwt = false` list — leave it at the default (`verify_jwt = true`), like `square-labor`, so a JWT is required *and* the function does its own superadmin check (belt-and-suspenders).

## Client UI (on the existing Superadmin page)
`src/pages/admin/Superadmin.tsx` — add an **"Invite staff member"** button above the roles list that opens a small dialog (reuse the app's `Dialog` + `Input`/`Select` primitives already used elsewhere in admin):
- Fields: **Email** (required), **Display name** (optional), **Role** (`Select`, default **Staff**; options staff/admin/host/superadmin).
- Submit → `supabase.functions.invoke('invite-staff', { body: { email, display_name, role } })`.
- On success: `toast.success(...)` ("Invited {email} as {role} — they'll get a set-password email"), close the dialog, and call the page's existing `load()` so the new person appears in the list with their role.
- On error: surface the function's message via `toast.error`.
- Keep the existing grant/revoke chips exactly as-is — this only **adds** the create path; role editing after the fact is unchanged.

## How onboarding works after this
Superadmin → `/superadmin` → **Invite staff member** → enter email + role → the person receives an email with a set-password link (landing on `/reset-password`) → they sign in at `/auth` (staff sign-in). No Supabase dashboard, no self-signup re-enabled.

## Security notes (ties to the audit briefs)
- **Superadmin-only**, enforced **server-side** in the function (not just by hiding the button) — the client route guard is not a boundary (per `BRIEF-security-audit-e2e.md` §5).
- The function is the *right* place for the `user_roles` write to be privileged: it runs as service_role but is gated by an explicit superadmin check. This is consistent with `BRIEF-rls-security-audit.md` finding #3 (`user_roles` = the privilege-escalation table; writes must be superadmin-only). **Note for the RLS audit:** the existing client-side `grant()`/`revoke()` in `Superadmin.tsx` insert/delete `user_roles` **directly from the browser**, so they rely entirely on the `user_roles` RLS policy being superadmin-only. Confirm that policy is correct there; this brief doesn't change those two functions.
- Validate `email`/`role` server-side; reject unknown roles and malformed emails. No email/PII in logs.

## Decisions for Tom
1. **Invite email delivery:** use **Supabase's built-in invite email** (`inviteUserByEmail`, simplest — but it uses Supabase's default template, not the Kenworthy-branded email) **vs.** `createUser` + `generateLink` and send through the platform's own branded Resend path (`_shared/deliver.ts`), matching `BRIEF-email-branding.md`. *(Recommend: ship v1 with `inviteUserByEmail` for speed; switch to branded delivery when the email-branding work lands.)*
2. **Who can invite:** **superadmin only** (recommended — matches the roles page) vs. also allow **admin** to invite staff (but never admin/superadmin). *(Recommend superadmin-only for v1.)*
3. **Default `regular_user` row:** leave it (harmless, existing behavior) or strip it when a real role is assigned (tidier list). *(Recommend leave for v1.)*

## Test plan
- As **superadmin**, invite a brand-new email as **staff** → success toast; the person appears in the `/superadmin` list with the `staff` badge; they receive a set-password email; after setting a password they can sign in at `/auth` and reach the staff-appropriate dashboard/POS.
- Invite an **existing** email (e.g. someone who once bought a ticket) → **no duplicate account**; the role is granted to their existing profile; message indicates it already existed.
- Invite as **admin** and as **staff** callers → **403** (button shouldn't render for them, and a direct `functions.invoke` is refused server-side).
- Malformed email / unknown role → rejected with a clear message; nothing created.
- `has_role` hierarchy intact (superadmin ⊇ admin ⊇ staff) after the new role is assigned.
- `npm run build` passes; no secrets/PII in function logs.
