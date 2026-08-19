---
brief: staging-auth-email-hook
title: Fix staging password-reset "email rate limit" — wire the Send Email hook to Resend
status: shipped
track: ops
date: 2026-08-18
verified: false
---

> ## ⚠️ SUPERSEDED — do not execute
>
> Investigated 2026-08-18. **The diagnosis in this brief is wrong.** The Send
> Email hook was already enabled and correctly wired on staging; the function
> was deployed and both secrets were set (staging's hook secret was created
> 33 seconds after prod's, on 2026-08-12). Steps 1 and 2 are no-ops.
>
> The "email rate limit" error is the project-wide hourly cap, which **still
> applies when the hook is enabled** — it is not evidence of an unwired hook.
> The error cleared on its own when the window reset, with no config change.
>
> See `FINDINGS-staging-auth-email-rate-limit.md`. Note in particular that
> running Step 1's deploy from a feature branch can *regress* staging.

# Brief (for Claude Code): Fix staging password-reset "email rate limit" — wire the Send Email hook to Resend

**Status:** ✅ Resolved — no code change needed; the Send Email hook was already wired correctly. See `FINDINGS-staging-auth-email-rate-limit.md`.
**Date:** August 18, 2026
**Symptom (Tom):** clicking **Forgot password** on **staging** returns an **email rate limit** error.

## Diagnosis (verified in repo)
Auth email is delivered through a Supabase **Send Email hook** → `supabase/functions/send-auth-email/index.ts` → **Resend**. Its header says it plainly: with the hook on, "Supabase stops sending auth email itself… no SMTP is configured anywhere and Supabase's rate-limited built-in mailer is never used." Password resets, magic links, signup confirmations and email changes all flow through it.

A **rate-limit** error means staging is **falling back to Supabase's built-in mailer** (throttled to a couple of emails/hour) — i.e. the Send Email hook is **not enabled / not wired** on the staging project (`rpqzrpboyhshdrfdwayk`). Each Supabase project has its own Auth config and secrets, and staging never got this one. Prod (`vlmslygnimfbamrtwvyo`) has it, which is why prod is fine.

## Step 0 — Confirm the cause (read-only, ~1 min)
Trigger Forgot-password on staging, then check the **staging** Edge Function logs:
- `send-auth-email` **not invoked** → hook is off → built-in mailer → the rate limit. (Expected.)
- `send-auth-email` invoked but erroring → hook is on but misconfigured; read the logged reason (`SEND_EMAIL_HOOK_SECRET is not set`, `RESEND_API_KEY is not set`, Resend 4xx) and fix that instead of re-enabling.

## Step 1 — Deploy the function + set its secrets on staging
```
npx supabase functions deploy send-auth-email --project-ref rpqzrpboyhshdrfdwayk
```
Set the secrets the function reads (`index.ts:29–34`) on the **staging** project:
```
npx supabase secrets set \
  RESEND_API_KEY=<staging Resend key> \
  TICKET_FROM_EMAIL="Kenworthy <tickets@kenworthy.org>" \
  TICKET_REPLY_TO="events@kenworthy.org" \
  --project-ref rpqzrpboyhshdrfdwayk
```
(`SEND_EMAIL_HOOK_SECRET` is set in Step 2, after the dashboard generates it.) `verify_jwt = false` is already declared for this function in `supabase/config.toml:15–16`, which the deploy honours — required, because Supabase calls the hook with a Standard-Webhooks signature, not a JWT.

## Step 2 — Enable the Send Email hook (dashboard; generates the secret)
In the **staging** project → **Authentication → Hooks → Send Email hook**:
- Enable it, type **HTTPS**, URL = the staging `send-auth-email` function URL
  (`https://rpqzrpboyhshdrfdwayk.supabase.co/functions/v1/send-auth-email`).
- Copy the generated signing secret (`v1,whsec_…`) and set it on staging:
  ```
  npx supabase secrets set SEND_EMAIL_HOOK_SECRET="v1,whsec_..." --project-ref rpqzrpboyhshdrfdwayk
  ```
- Re-deploy `send-auth-email` if needed so it picks up the secret.

Once the hook is on, Supabase hands every auth email to Resend and **the built-in rate limit no longer applies**.

## Step 3 — Two staging-specific things to check
- **Reset link origin.** The reset email's link uses `SITE_URL` (`resetPasswordForEmail … redirectTo: <origin>/reset-password`). Confirm staging's `SITE_URL` secret is the **staging** origin (per `docs/RUNBOOK-deploy-staging-prod.md`: `https://kenworthy-ticketing-staging.mrtomfrank.workers.dev`), so the link doesn't bounce a tester to prod.
- **Resend sending domain.** Resend only sends from a **verified domain**. Confirm the from-address domain (`kenworthy.org`) is verified in the Resend account/key used for staging. If it isn't, the symptom changes to a Resend send failure (not a rate limit) — worth ruling out now.

## Verify (acceptance — by read-back, not the absence of an error)
- Forgot-password on staging now: **staging logs show `send-auth-email` invoked → Resend 200 → `sent recovery to <masked>`**, and the reset email arrives with a **staging** reset link that completes a password change.
- No "rate limit" error on a normal (non-hammered) request.
- Note the normal, expected limit that is **not** a bug: Supabase enforces a ~**60-second cooldown per email address** on reset requests even with the hook on — rapid repeat clicks on the same address will still 4xx. Wait a minute between attempts when testing.

## Notes
- No frontend/app code changes — `Auth.tsx` / `ResetPassword.tsx` already call `resetPasswordForEmail`; this is purely staging Auth config + function deploy.
- Keep the hook secret and Resend key in Supabase's secret store only; never commit them.
- This closes a staging/prod parity gap; if any other staging auth flow (magic link, signup confirm, email change) was also silently on the built-in mailer, this fixes all of them at once since they share the hook.
