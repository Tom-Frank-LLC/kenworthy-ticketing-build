# Runbook: rotating secrets

Every credential the platform holds: where it lives, how to replace it, how to
tell the replacement worked, and what breaks while you do it. Written for the
2026-10-06 security audit (L8). It lists names only. No value belongs in this
file, in a commit, or in a chat log.

Who rotates: Tom. He owns every vendor account below and is the only person with
`supabase secrets set` on both projects. If someone else ever takes this on, the
vendor-account owner column is the list of logins they need.

## When to rotate

- **At once:** a key appears somewhere it should not (a commit, a screenshot, a
  log, a chat), a laptop holding one is lost, or someone with access leaves.
- **Planned:** once a year for everything below, and after any incident. The
  third-party keys were last set 10–20 Aug 2026. The Supabase platform keys were
  rotated 12 Aug and 2 Oct 2026.

## How secrets reach the code

| place | holds | how to change it |
|---|---|---|
| Supabase function secrets, per project | everything the edge functions read with `Deno.env.get` | `npx supabase secrets set NAME=… --project-ref <ref>`; `npx supabase secrets list --project-ref <ref>` shows names and digests, never values |
| Supabase platform (dashboard → Project Settings → API Keys) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS` | injected into functions automatically; you cannot set them yourself |
| Supabase Vault | QuickBooks OAuth access and refresh tokens (`qbo_connection` holds only their ids) | written by `qbo-sync`; replaced by disconnecting and reconnecting |
| `app_config` table | the Mailchimp webhook secret (`key = 'mailchimp_webhook'`) | SQL, then `mailchimp-bootstrap` (below) |
| `.env.staging`, `.env.production` (committed) | public values only: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SITE_URL`, `VITE_TURNSTILE_SITE_KEY`, flags | edit, rebuild, `wrangler deploy` |
| `wrangler.jsonc` `vars` (committed) | public values only: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL` for the Worker | edit, `wrangler deploy` |

A secret set with `supabase secrets set` reaches **new** function instances. A
warm instance can keep the old value for a few minutes, and a few functions read
their secrets once at module load (`send-auth-email`, `ticket-access`,
`_shared/deliver.ts`). Wait five minutes before concluding a rotation failed.

Nothing secret is in the browser bundle, the Worker, or git history (audit
2026-10-06, "Checked and clean"). Keep it that way: a server-side secret never
goes in `.env.*` or `wrangler.jsonc`.

Project refs: staging `rpqzrpboyhshdrfdwayk`, production `vlmslygnimfbamrtwvyo`.

## Staging holds no live vendor keys (since 2026-10-07)

Mailchimp, Little Green Light and Twilio have no sandbox, and until 7 Oct 2026
staging held **production's** keys for all three. A staging subscribe wrote a
real contact, a staging donation a real donor record and gift, and a staging SMS
was a real text from the theatre's number. Their secrets were **unset on
staging** on 2026-10-07 (`LGL_API_KEY`, `MAILCHIMP_API_KEY`,
`MAILCHIMP_AUDIENCE_ID`, `MAILCHIMP_SERVER_PREFIX`, `TWILIO_ACCOUNT_SID`,
`TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_MESSAGING_SERVICE_SID`).
Each integration on staging now answers "not configured", and its caller treats
that as non-fatal:

| vendor | on staging now |
|---|---|
| Mailchimp | checkout and donations call it fire-and-forget, so nothing waits on it; the Mailchimp admin screens say "Mailchimp not configured" |
| Little Green Light | a donation completes and sends its receipt; the LGL post records "LGL not configured" on the row |
| Twilio | an SMS fails and is logged; email delivery is unaffected, and a phone-only test order shows as undelivered |

So rotating any of the three is now a **production-only** rotation. To test one
of these syncs on staging, give staging its own vendor account (see *Separate
staging keys* at the end). Don't copy production's key back.

Square, Turnstile and the Supabase keys are already separate per environment.
Resend appears on both projects; whether it is one key or two has not been
compared. Treat it as shared until it is checked (`secrets list` digests, never
values).

---

## Supabase

### Service role / secret keys (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`)

- **Where:** platform-injected. The project uses the `sb_secret_` format
  (migration `20260819020000`). Also held by anyone who copied one for scripts
  (`scripts/import-*.mjs` read it from `process.env`).
- **Rotate:** dashboard → Project Settings → API Keys → create a new secret key,
  then delete the old one. Supabase re-injects the current set into functions.
- **What breaks:** anything outside the functions that still holds the old key:
  local scripts, a `PROBE_KEY` export, an operator's curl. Inside the functions
  nothing breaks: `_shared/callers.ts` accepts every key in `SUPABASE_SECRET_KEYS`,
  so old and new overlap until the old one is deleted.
- **Verify:** `curl` a staff-only function with the anon key and expect `401`
  (proves it boots); then an operator resend through `send-ticket-confirmation`
  with the new key returns `200` (staging only).

### Legacy JWT secret, and the anon / publishable key

- **Where:** the anon JWT is public by design, and it is in `.env.*`
  (`VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`), in
  `wrangler.jsonc` (`SUPABASE_ANON_KEY`), and injected as `SUPABASE_ANON_KEY`.
- **Rotate:** only if the legacy JWT secret itself is rotated. That signs every
  session and the anon key, so it **signs every staff member out**, and the old
  anon key stops working everywhere at once.
- **Order:** rotate in the dashboard → update `.env.<env>` and `wrangler.jsonc`
  → `npm run build:<env>` → `npx wrangler deploy` (`--env staging` for staging).
  Between the first step and the last, the live site's bundle carries a dead key
  and **every page that reads data fails**. Do it at a quiet hour, with the build
  ready before you press the button.
- **Verify:** the built bundle carries the new key's ref (`grep` the `dist`
  chunk for the project ref), the home page lists showings, a staff sign-in works.

---

## Square

`SQUARE_ENV` picks the set (`production` only when it says so; anything else is
sandbox, `_shared/square.ts`). Per set:
`SQUARE_{SANDBOX|PRODUCTION}_ACCESS_TOKEN` (secret),
`…_APPLICATION_ID` and `…_LOCATION_ID` (public, returned to the browser by
`get_config`). Unprefixed `SQUARE_ACCESS_TOKEN` etc. are the fallback spelling.
`SQUARE_TERMINAL_DEVICE_ID` is configuration, not a secret.

- **Where:** function secrets. Staging holds the sandbox set only; production
  holds the production set.
- **Rotate:** Square Developer Dashboard → the application → Credentials →
  replace the access token for that environment, then immediately
  `npx supabase secrets set SQUARE_PRODUCTION_ACCESS_TOKEN=… --project-ref vlmslygnimfbamrtwvyo`.
  Read the dashboard's prompt for whether the old token stops at once. Plan as
  if it does.
- **What breaks:** between the two steps, every Square call fails: online
  checkout, the box-office reader, cash-sale recording, refunds, catalog sync.
  Online checkout says payments are unavailable, and nobody is charged. **Rotate
  when the box office is closed.**
- **Verify:** `get_config` on `ticket-checkout` returns `200` (config loads, no
  Square call). Then a read: Admin → Transactions loads (`square-transactions`
  lists payments). On staging, one sandbox purchase end to end.

---

## Cloudflare Turnstile

`TURNSTILE_SECRET_KEY` (function secret) and `VITE_TURNSTILE_SITE_KEY` (public,
`.env.*`). Each environment has its own widget.

- **Rotate the secret:** Cloudflare dashboard → Turnstile → the widget →
  rotate secret key, then `supabase secrets set TURNSTILE_SECRET_KEY=…` on that
  project. Read the dialog for whether the old secret stays valid for a grace
  period. If it does not, the gap is real.
- **What breaks:** `ticket-checkout`, `film-pass-checkout` and `square-donation`
  **fail closed**: while the function holds a secret Cloudflare no longer
  accepts, every purchase and donation is refused with the bot-check message.
  `rental-request` refuses too. An *unset* secret also refuses on the three
  money paths (it fails open only on `rental-request`, by design).
- **Replacing the widget (new site key):** set the pair together: new secret
  first, new site key in `.env.<env>`, rebuild, `wrangler deploy`. The old page
  and the new server disagree until the Worker ships.
- **Verify:** on the public site, the widget renders above Pay. A probe with no
  token gets `403` (expected refusal, see BRIEF-sec-checkout-abuse). One real
  submission of the rental form on staging reaches "Thank you".

---

## Auth email hook (`SEND_EMAIL_HOOK_SECRET`)

- **Where:** function secret on each project, and the same value in the
  dashboard: Authentication → Hooks → Send Email hook (`v1,whsec_…`).
- **Rotate:** regenerate in the hook settings, then immediately `secrets set`.
  `_shared/webhook.ts` accepts `v1,whsec_…`, `whsec_…` or bare base64.
- **What breaks:** in between, `send-auth-email` refuses the signature, so
  **password-reset and invite emails do not send** (Supabase reports a hook
  error to the person requesting). Nothing else is affected.
- **Verify:** request a password reset for your own staff address on that
  project and receive it.

---

## Resend (`RESEND_API_KEY`)

`TICKET_FROM_EMAIL` and `TICKET_REPLY_TO` are configuration.

- **Rotate:** Resend dashboard → API Keys → create a new key (sending access is
  enough), `secrets set` on each project that uses it, then delete the old key.
  Both work in between, so there is **no gap** if you delete last.
- **What breaks if done in the wrong order:** ticket confirmations, receipts,
  tribute notices, staff notifications and auth emails stop. Checkout still
  succeeds; the order records `confirmation_error`, and staff can resend.
- **Verify:** resend a ticket confirmation for a test order to your own address
  from Admin (staging first).

---

## Twilio

`TWILIO_ACCOUNT_SID` (identifier), `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`
(the credential in use), `TWILIO_AUTH_TOKEN` (fallback only, used when no API
key is set), `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.

- **Staging:** none since 2026-10-07; production only.
- **Rotate:** Twilio Console → API keys → create a new standard key, set
  `TWILIO_API_KEY_SID` and `TWILIO_API_KEY_SECRET` together on **both** projects,
  then delete the old key. No gap if you delete last. If `TWILIO_AUTH_TOKEN` is
  set anywhere, rotate it too (Console → secondary token → promote), or better,
  unset it: the API key is the credential, and the auth token is the master key
  to the account.
- **What breaks:** SMS tickets. Email is unaffected, and checkout succeeds.
- **Verify:** on production, a $0 or cash counter sale delivered by SMS to your own number (staging has no Twilio keys since 2026-10-07).
  This is a real text.

---

## Mailchimp

`MAILCHIMP_API_KEY` (secret), `MAILCHIMP_SERVER_PREFIX` and
`MAILCHIMP_AUDIENCE_ID` (identifiers).

- **Staging:** none since 2026-10-07; production only.
- **Rotate:** Mailchimp → Account → Extras → API keys → create a key, set it on
  **both** projects, then disable the old key. No gap if you disable last.
- **What breaks:** newsletter signups, donor tagging and e-commerce sync. All
  are fire-and-forget, so checkout and donations are unaffected; the sync is
  simply missing for the window.
- **Verify:** `curl -s -u any:<new key> https://<prefix>.api.mailchimp.com/3.0/ping`
  from your own machine (proves the key, sends nothing). Then watch the next real
  signup in the `mailchimp-subscribe` logs.

### Mailchimp webhook secret (`app_config.mailchimp_webhook`)

- **Where:** the `?s=` query parameter of the webhook URL registered in
  Mailchimp's audience settings, and `app_config` (`key = 'mailchimp_webhook'`,
  `value.secret`). It is not a function secret.
- **Rotate:** clear it, regenerate it, re-register it.
  1. `update app_config set value = '{}'::jsonb where key = 'mailchimp_webhook';`
  2. Run `mailchimp-bootstrap` as an admin. It is idempotent: it reuses the
     interest groups and store, generates a new secret because none is stored,
     and returns the new `webhook_url`.
  3. Paste that URL into Mailchimp → Audience → Settings → Webhooks, replacing
     the old one.
- **What breaks:** between steps 1 and 3, Mailchimp's unsubscribe and cleaned
  events are refused (`403`) and Mailchimp retries them for a while. A missed
  unsubscribe means `marketing_opt_in` stays true here until the next event.
- **Verify:** Mailchimp's webhook page shows a successful test ping. A request
  with the old `?s=` gets `403`.

---

## Little Green Light (`LGL_API_KEY`)

- **Staging:** none since 2026-10-07; production only.
- **Rotate:** in LGL's settings, under its API / integration keys, generate a
  new key, set it on **both** projects, then revoke the old one.
- **What breaks:** between revoking and setting, every gift (online and box
  office) is recorded here but not posted to LGL. `settleDonation` logs the
  failure and the donation row keeps no `lgl_gift_id`, so those gifts can be
  found and re-posted afterwards (`lgl-sync-donation`).
- **Verify:** check the key by reading something from LGL with it from your own
  machine (no write). Then confirm the next real gift shows an `lgl_gift_id`.

---

## QuickBooks Online (not deployed yet)

`QBO_CLIENT_ID` (identifier), `QBO_CLIENT_SECRET`, `QBO_STATE_SECRET`,
`QBO_ENVIRONMENT`, `QBO_REDIRECT_URI` (config). The OAuth tokens are in Vault.

- **`QBO_STATE_SECRET`:** our own random value, used to sign the OAuth `state`.
  Generate with `openssl rand -base64 48` and `secrets set`. Rotating it only
  invalidates connection attempts in flight (ten minutes). `qbo-sync` refuses to
  start a connection without it.
- **`QBO_CLIENT_SECRET`:** Intuit Developer → the app → Keys & credentials →
  rotate, then `secrets set`. Token refresh fails in between.
- **The tokens:** Admin → Accounting → Disconnect, then Connect. Disconnect
  deletes them from Vault (`qbo_disconnect`); it does not call Intuit's revoke
  endpoint, so to kill a leaked refresh token at Intuit's end, also disconnect
  the app from the QuickBooks company's settings.
- **Verify:** Admin → Accounting shows "connected" with a fresh expiry.

---

## Separate staging keys: what each vendor would take

| vendor | option | cost |
|---|---|---|
| Mailchimp | No sandbox. A second, free Mailchimp account (or a second audience, if the plan allows it) with its own API key. Set `MAILCHIMP_*` on staging, run `mailchimp-bootstrap` there, register its webhook. | Another account to keep alive. Staging signups stop reaching the real list, which is the point. |
| Little Green Light | No sandbox. Either a separate LGL trial account, or simply **unset `LGL_API_KEY` on staging**: gifts are still recorded, the LGL post logs "LGL not configured", and nothing reaches the real donor database. | Unsetting costs nothing, and staging loses only the LGL leg, which can't be tested without writing real donor records anyway. **Recommended first step.** |
| Twilio | Twilio's test credentials (a test Account SID and auth token that never send a real message), used through the `TWILIO_AUTH_TOKEN` mode `_shared/deliver.ts` already supports. Or a subaccount with its own API key. | Test credentials only accept Twilio's magic numbers, so staging SMS becomes simulated. A subaccount still sends real texts, but can be revoked without touching production. |
| Resend | A second API key for staging, restricted to sending. | Free. Removes the open question above. |

Staging's keys for Mailchimp, LGL and Twilio were removed on 2026-10-07 (above),
so these options are only needed to *test* a sync on staging again.
