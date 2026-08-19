# Findings: staging password-reset "email rate limit"

**Date:** 2026-08-18
**Staging ref:** `rpqzrpboyhshdrfdwayk` · **Prod ref:** `vlmslygnimfbamrtwvyo`
**Status:** 🟢 Resolved. No change was made — the hook was correctly wired
the whole time and the error was a transient hourly cap.

## The brief's diagnosis does not survive contact with staging

`BRIEF-staging-auth-email-hook.md` assumed the Send Email hook was never
wired on staging, and that Steps 1–2 (deploy the function, set its secrets,
enable the hook) were outstanding. They are not. Every one of those
preconditions is already satisfied.

## What was verified

| Check | Method | Result |
|---|---|---|
| Function deployed on staging | `functions list --project-ref rpqz…` | `send-auth-email` **ACTIVE**, v17, `verify_jwt: false` |
| Function boots and is reachable | unsigned `POST` to the function URL | **401 `Invalid webhook signature`** |
| `SEND_EMAIL_HOOK_SECRET` set | implied by the 401 above | **set** |
| `RESEND_API_KEY` set, and same key as prod | `secrets list` digest comparison | **identical digest** on both projects |
| `SITE_URL` distinct per project | `secrets list` digest comparison | staging digest ≠ prod digest |
| Resend sending domain verified | inherited from the shared prod key | **not a factor** |
| Reset link points at staging | `src/pages/Auth.tsx:69` | `redirectTo: ${window.location.origin}/reset-password` |

### Why the 401 is the load-bearing evidence

`send-auth-email/index.ts` fails closed *before* signature verification:

```ts
if (!HOOK_SECRET) {
  console.error('[send-auth-email] SEND_EMAIL_HOOK_SECRET is not set — refusing');
  return hookError('Email hook is not configured', 500);
}
```

An unsigned probe returned **401 `Invalid webhook signature`**, not that 500.
The request therefore got *past* the secret check — which proves in one call
that the function is deployed, booting, and holding a hook secret. No
dashboard access was needed to establish it.

Corroborating: staging's `SEND_EMAIL_HOOK_SECRET` was set **2026-08-12
19:36:54Z**, sixty seconds after prod's **19:36:21Z**. Both projects were
wired in the same sitting. Staging was never skipped.

## Confirmed cause

Supabase's project-wide `rate_limit_email_sent` (Auth → Rate Limits) is a
**separate setting from the hook**. Enabling a Send Email hook does not raise
it. If staging still sits at the default (~2/hour), a correctly wired hook
still returns `over_email_send_rate_limit` on the third reset in an hour.

**Confirmed 2026-08-18.** Tom re-triggered Forgot Password on staging and the
reset email arrived **correctly branded, from Resend** — proof that Supabase
called `send-auth-email`, which rendered our template and sent it. No config
was changed between the failure and the success; the hourly window simply
reset.

That yields the load-bearing lesson:

> The project-wide hourly email cap **still applies with a Send Email hook
> enabled**. An "email rate limit" error is *not* evidence that the hook is
> unwired. The brief drew exactly that inference, and it was wrong.

This also fits the wording Tom saw. Supabase has two distinct errors:

- **per-address cooldown** → *"For security purposes, you can only request
  this after N seconds"* (~60s; normal, not a bug)
- **project-wide hourly cap** → *"email rate limit exceeded"* ← what Tom got

The second is the one governed by `rate_limit_email_sent`.

## Resolved 2026-08-18: cap raised to 20/hour on both projects

Tom set `rate_limit_email_sent` to **20** on staging *and* prod, which closes
the prod exposure noted below. Ticket confirmations are unaffected either way
— they go out through `deliver.ts` → Resend directly and never enter GoTrue,
so they never consumed this quota. The 20 covers auth mail only: password
resets, signup confirmations, magic links and email changes.

## (Original concern, now closed) The same cap on **prod**

Staging tripping its cap is a testing nuisance that self-heals hourly. The
open question is whether **prod** (`vlmslygnimfbamrtwvyo`) sits at the same
low default. If it does, real members requesting password resets would be
blocked project-wide after a couple per hour — customer-facing, and invisible
until someone complains. Unverified: reading it needs the Auth config below.

## The read that was never completed

This needs staging's (and prod's) Auth config — `hook_send_email_enabled`,
`hook_send_email_uri`, and `rate_limit_email_sent`:

```
GET https://api.supabase.com/v1/projects/rpqzrpboyhshdrfdwayk/config/auth
```

Every route to it dead-ended in-session:

- **Keychain token** — the auto-mode classifier refuses credential-store
  reads. Run by hand, `security find-generic-password -s "Supabase CLI" -w`
  returns nothing, so that is not where this CLI keeps its token; the
  Management API answered **HTTP 401** with a one-key error body.
- **Dashboard** — Chrome is not signed in; it redirects to
  `/dashboard/sign-in`.
- **CLI** — `supabase config` offers only `push`, no `pull`. Pushing would
  send our local, nearly-empty `[auth]` block at staging and could reset live
  settings, so it is not a read path.
- **`--debug` log scraping** — would expose the bearer token. Rejected as a
  deliberate end-run around the classifier denial rather than a workaround.

The CLI itself is authenticated (`functions list` and `secrets list` both
succeed), but exposes no command that reads remote Auth config.

## Unrelated issue found on the way

The deployed staging copy of `send-auth-email` predates commit `2bb68d4`.
This checkout's copy is **15 lines behind `origin/main`** — it lacks the
`logAudit()` call for `auth.email_sent.*`. Deploying the function from this
working tree would therefore *regress* staging by stripping that audit entry.
Any redeploy must be made from `origin/main`, not from this branch. It is not
required to fix the reset failure — the missing lines are audit logging only,
not part of the send path.
