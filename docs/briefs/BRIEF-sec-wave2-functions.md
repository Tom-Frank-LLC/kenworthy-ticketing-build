---
brief: sec-wave2-functions
title: qbo-sync is safe to deploy, debug probes cannot be deployed, counter gifts need a Square payment, and every function import is pinned
status: shipped
track: security
date: 2026-10-06
verified: true
findings: ../AUDIT-security-2026-10-06.md
shipped_in: ["#366", "29c8ebc"]
shipped_at: 2026-10-07
evidence: "migration 20261006233349 on both; all 28 deployed functions redeployed on both in four probed groups (Docker bundler), pinned imports; anon surface 0 on production; Worker prod 72decd4e for InviteStaffDialog/MarqueeBookingForm; qbo-sync still not deployed (needs QBO_STATE_SECRET + SITE_URL)"
---

# Security wave two: edge functions (L4, L11, L1 remainder, L6, L8, leftovers)

The second wave of fixes from the 2026-10-06 audit. Everything here is in
`supabase/functions/` or follows from it, plus the small leftovers wave one
handed on. Branch `fix/sec-wave2`.

## What each finding was, and what changed

### L4 · qbo-sync, hardened before its first deploy

`qbo-sync` is deployed nowhere. These had to be fixed before it ever is:

| was | now |
|---|---|
| OAuth `state` HMAC'd with `SUPABASE_SERVICE_ROLE_KEY` (key reuse) | its own secret, `QBO_STATE_SECRET`. Unset means `oauth_start` and `oauth_callback` **refuse** (503). There is no fallback key. |
| the nonce was never checked, so a state replayed for its 10 minutes | **single use.** `oauth_start` records the nonce in a new table, `qbo_oauth_states`. The callback consumes it with one `DELETE … RETURNING` *before* anything acts on the state. Of two racing callbacks, one gets the row; a replay finds nothing. |
| signature compared with `!==` | `timingSafeEqual` from `_shared/callers.ts` |
| redirect origin taken from `Referer` | `SITE_URL` only (`_shared/brand.ts`), never request-derived |
| `return_to` unvalidated (`"@evil.tld"` went off-site) | a path on this site only: `safeReturnPath`, the same rule as `src/lib/safeUrl.ts` `safeRedirectPath`. It is checked at `oauth_start` and again inside `verifyState`. |
| `status` ungated: realm id and token expiry to anyone | admin only |
| callback unreachable under `verify_jwt = true` | `[functions.qbo-sync] verify_jwt = false` in `config.toml`. Intuit's redirect is a plain browser GET with no JWT, so this is needed. **Every other action**, including unknown ones, goes through `requireAdmin` in code. |
| exact `role === 'admin'`, so a superadmin was refused | `has_role(_, 'admin')` (hierarchical), with a failed lookup a retryable 503 |

Also fixed along the way:

- The callback appended `&qbo=error` whether or not the path had a `?`. Query
  strings are now built with `URL`.
- A starter who lost admin within the 10 minutes is not connected.
- `payroll_export` and the nonce writes carry `actorHeaders`.
- `status` reports `configured: false` until all three of `QBO_CLIENT_ID`,
  `QBO_CLIENT_SECRET` and `QBO_STATE_SECRET` are set.

**Same `has_role` fix in `mailchimp-bootstrap` and `mailchimp-campaign`**,
which matched `user_roles.role = 'admin'` exactly. No other function in
`supabase/functions/` does a literal role match (checked by grep).

Code: `qbo-sync/index.ts`, `qbo-sync/oauth_state.ts` (new), migration
`20261006233349_qbo_oauth_states.sql` (new). The table is service-role only:
RLS on, no policies, and nothing granted to anon or authenticated.

### L11 · debug probes moved out of `supabase/functions/`

`square-event-create-probe`, `square-event-probe`, `square-order-probe` and
`square-discount-probe` (with its `cases/` and `generate_discount_vectors.ts`)
now live in **`supabase/probes/`**. `supabase functions deploy` only looks under
`supabase/functions/`, so neither a bulk deploy nor `--prune` can see them.

- They are kept because docs cite them as evidence. Imports were changed to
  `../../functions/_shared/…`, and `deno check` passes on all of them.
- `generate_discount_vectors.ts` writes `pricing_vectors.json` by the new
  relative path.
- References updated:
  - `FINDINGS-square-order-arithmetic.md`
  - `venue-date-square-mechanism.md`
  - `briefs/FINDINGS-analytics-square.md`
  - `pricing_vectors.json`'s `_comment`
  - the generator's own header

  Bare mentions of a probe's name were left alone.
- **`square-event-create-probe`'s production override is gone.** It used to
  write to the live catalog on `confirm:"PRODUCTION-CREATE"`. It now refuses
  production outright, like the order and discount probes.
- `supabase/probes/README.md` explains why they are there and how to run one
  again (copy in, deploy to staging, delete).

### L1 (remainder) · `square-donation` `record_in_person`

The box-office action filed a completed, receipted gift and posted it to LGL
for any amount, on a staff member's word. Now (`square-donation/in_person.ts`):

- **The gift names its sale.** `orderToken` is required (a UUID). The order's
  ticket rows are read, and must be:
  - the right channel (`cash` → cash rows, `terminal` → card rows)
  - all `confirmed`
  - the caller's own sale, unless the caller is an admin (POS rows carry the
    staff member as `user_id`, the same rule as `release_pending_card_sale`)
- **The sale's Square payment is the evidence.** Only server code writes
  `tickets.square_payment_id`:
  - square-terminal `confirm_sale`, after binding the checkout to the order
  - square-cash-sale, after posting the CASH tender

  A session cannot write it (wave one). So:
  - **Terminal:** the `squarePaymentId` the POS sends must equal the payment on
    the order's rows.
  - **Cash:** the POS sends none, and the stamp on the rows is read.
  - **Sandbox only:** a simulated reader has no payment, and is accepted with
    none. Production refuses.
- **Square must hold money for it.** The payment is read with
  `GET /v2/payments/{id}` and checked with `counterPaymentProblem`, the same
  test a walk-in pass sale passes. It must be:
  - COMPLETED, at our location, not refunded
  - at least the ticket rows plus the gift (`start_sale` and `square-cash-sale`
    both put the gift into what Square took)
  - not already on another order's tickets, a pass, a pass order, or another gift

  `counterPaymentProblem` moved to `_shared/counter_payment.ts` and gained a
  `purpose` for its wording. film-pass-checkout imports it from there, with no
  behaviour change.
- **One gift per order.** A retry answers `already_recorded` with the existing
  gift, instead of a second receipt and a second LGL record.
- **Capped** at `MAX_BUNDLED_DONATION_CENTS` ($1,000), the ceiling the POS box,
  `start_sale` and `square-cash-sale` already enforce. The minimum stays $1.
- `actorHeaders(user.id)` is on the service client that inserts, so the audit
  trigger names the staff member.
- The stored `square_payment_id` is the verified one, never the browser's value.

**Staff-visible.** The POS already sends the `orderToken` and, for a terminal
sale, the payment id. It also awaits `square-cash-sale` before recording the
gift. So the normal flow is unchanged, and **no POS change is needed**. One case
changes:

- If `square-cash-sale` failed for a cash sale, the counter already shows "not
  recorded in Square. Tell a manager."
- The gift is now refused too: "That cash sale was not recorded in Square, so
  its gift cannot be receipted here. Tell a manager."
- That is deliberate. Square, the till and LGL now agree, instead of LGL
  holding a receipted gift Square never saw.

### L6 · every edge-function import is pinned

| was | now |
|---|---|
| `https://esm.sh/@supabase/supabase-js@2` (15), `…@2/cors` (4) | `npm:@supabase/supabase-js@2.117.2` and `…@2.117.2/cors` |
| `npm:@supabase/supabase-js@2` (6), `…@2/cors` (1) | same |
| `https://esm.sh/@supabase/supabase-js@2.45.0` (8, the square catalog functions) | `npm:@supabase/supabase-js@2.45.0`: same version, from the npm registry instead of a CDN |
| `https://esm.sh/qrcode-generator@1.4.4` | `npm:qrcode-generator@1.4.4` |

- **2.117.2** is what `@2` resolves to today, on both esm.sh
  (`x-esm-path: /@supabase/supabase-js@2.117.2/…`) and npm (`latest`). Any
  redeploy today would already get it.
- The 2.45.0 functions keep 2.45.0, so their behaviour does not move.
- Already-exact imports (`zod@3.23.8`, `pdf-lib@1.17.1`, the test-only
  `std@0.224.0` / `pngjs` / `jsqr`) are unchanged.
- No floating specifier remains under `supabase/functions/`.
- `sign-contract`'s header comment said "npm: fails to boot". The real failure
  was *mixed* versions: `npm:…@2.45.0` beside `npm:…@2/cors`. The comment now
  says so.

**How it was proven to deploy, without deploying.**
`supabase/tests/boot/run.sh` (new) runs, for every function, in the same
`edge-runtime` image the CLI bundles with (v1.74.3):

1. `edge-runtime bundle`, the step `supabase functions deploy` runs before
   upload.
2. `edge-runtime start --main-service`, followed by an OPTIONS preflight. That
   evaluates the module, which is where BOOT_ERROR happens.

The CLI has no `--dry-run`. This is the closest thing, and it is stronger than
`deno check`.

- **All 31 functions bundle and boot**, before the change and after it.
- **It catches the documented failure.** A throwaway function with the old
  `npm:…@2.45.0` plus `npm:…@2/cors` mix fails it with exactly the BOOT_ERROR
  in `TICKET-DELIVERY.md`.

**The deno.json + lockfile part: measured, not shipped. Needs a decision.**
I read the CLI's deploy code (supabase/cli `functions/deploy.ts`).

- The CLI itself never passes a parent `supabase/functions/deno.json`. It only
  uses a per-function `deno.json`, a `config.toml` `import_map`, or
  `supabase/functions/import_map.json`.
- But the **Docker bundler** (the default whenever Docker is running) mounts all
  of `supabase/functions/`. `edge-runtime bundle` then discovers a `deno.json`
  walking up from the entrypoint, and **does enforce `deno.lock`**. Tested: a
  lockfile with a corrupted integrity hash fails the bundle.
- **The catch, also measured:** every function's bundle then embeds **every**
  npm package in the lock:
  - ticket-checkout: 8.8 MB → 37.8 MB raw, 0.75 → 2.8 MB brotli
  - pdf-lib rides along in all of them

  That is a large memory and cold-start change on the payment path, which I
  could not measure on the platform. So it is not shipped.
- `--use-api` deploys (and the CLI's silent fallback when Docker is not
  running) would ignore the lock in any case.
- Options for Tom:
  - **(a)** Per-function `deno.json` + `deno.lock`: 31 lockfiles, each only
    that function's graph. Integrity at deploy, no bloat, more upkeep.
  - **(b)** Accept the global lock's bloat.
  - **(c)** Stop at exact pins (this PR).

  The residual risk with (c): supabase-js pins its `@supabase/*` packages
  exactly, but its transitive `ws`, `tslib`, `iceberg-js` and `@types/*` still
  resolve within their semver ranges at deploy time, from the npm registry,
  which deno checks against the registry's published integrity.

**Size note.** npm bundles are larger than esm.sh's:
- ticket-checkout: 0.75 MB vs 0.17 MB brotli
- sign-contract, the largest: 1.8 MB, far under the platform's limit

The `mailchimp-*` functions have shipped this way all along. Local boot and
request latency were the same to within about 10 ms.

### L8 · secret-rotation runbook

`docs/RUNBOOK-secret-rotation.md` (new). It covers every secret the functions
read, the platform keys, the committed public values, the Turnstile pair, the
auth-hook secret, the Mailchimp webhook secret in `app_config`, Square, Resend,
Twilio, LGL and QBO. For each it says:

- where the secret lives
- how to rotate it and in what order
- what breaks in the gap
- a safe verification

Names only.

It records that staging holds production's Mailchimp, LGL and Twilio
credentials, and what separate staging keys would take per vendor. Unsetting
`LGL_API_KEY` on staging is the cheap first step it recommends.

### Leftovers from wave one

- **InviteStaffDialog** shows invite-staff's `notice` when an existing account
  was reused, as the toast description, held for 20 s. Pinned by
  `InviteStaffDialog.test.tsx`.
- **MarqueeBookingForm** uses `useTurnstileGate` (#361):
  - "Tick the box above to continue" when Turnstile shows a checkbox, and
    "Checking your browser…" only while it solves silently.
  - After a failed send, `gate.refresh()` remounts only the widget, so the
    retry carries a fresh token and the form keeps what was typed.
  - It keeps the rental team's fallback text rather than the checkout's box
    office one.
  - Pinned by `MarqueeBookingForm.test.tsx`.
- **`docs/TICKET-DELIVERY.md`** no longer says to trust the JWT `role` claim. It
  describes `verifyServiceRoleCaller`.
- **`docs/BRIEF-third-party-pentest-scope.md` §6** now has a table of the
  public write endpoints and their current controls. It says plainly that
  `rental-request` has Turnstile but no per-IP limit, and `mailchimp-subscribe`
  has a limit but no Turnstile.
- **`anon_surface/surface.sql`** allowlists `rls_auto_enable()`. It is the
  `ensure_rls` event-trigger function, created on the projects rather than by a
  migration. Anon's EXECUTE on it is inert: calling an `event_trigger` function
  directly raises "trigger functions can only be called as triggers", verified
  in postgres:15.

## How it was proven

| check | result |
|---|---|
| `deno test --node-modules-dir=none --allow-env supabase/functions` | **600 passed**, 0 failed, 3 ignored |
| `deno check --node-modules-dir=none supabase/functions/*/index.ts` | 3 errors, the same 3 pre-existing crypto `Uint8Array` errors as main |
| `deno check` on `supabase/probes/*` | clean |
| `sh supabase/tests/boot/run.sh` | **all 31 bundle and boot** |
| `sh supabase/tests/qbo_oauth_states/run.sh` (full migration replay) | **10/10** |
| `sh supabase/tests/anon_surface/run.sh` (both privilege models) | surface.sql: no violations; behaviour 61/61; ALL PASS |
| `npx vitest run` | 86 files, 1061 passed, 2 skipped |
| `npx tsc -p tsconfig.app.json --noEmit` | 9 errors, all in `NotificationsTab.test.tsx`, pre-existing on main |
| `npm run check:worker` | fails with "Types at worker-configuration.d.ts are out of date". Also fails on main; this PR does not touch `worker/` or `wrangler.jsonc`. |

New tests:

- `qbo-sync/oauth_state_test.ts` (10). Covers the secret, tamper, expiry,
  off-site return path, and `returnUrl`.
- `qbo-sync/handler_test.ts` (33), the real handler with every call stubbed:
  - every non-callback action, unknown ones included, refuses anon (401), no
    Authorization (401) and staff (403) before reading anything
  - an admin, via `has_role`, gets status
  - a failed role lookup is a 503
  - `oauth_start` records the nonce, with the actor header
  - four hostile `return_to` values become the default
  - with no secret, both halves fail closed
  - the callback consumes the nonce before the code exchange
  - a replay is refused before Intuit is called
  - a state signed with the service-role key is refused
  - an expired state, or a starter who has been demoted, is refused
  - `Referer` is ignored
- `square-donation/record_in_person_test.ts` (17). Covers the cash, terminal
  and sandbox paths, plus every refusal: no order, over the cap, short payment,
  no Square record, a different payment, a payment already used, someone
  else's sale, a second gift, the wrong channel, and not staff. It also checks
  that the stored payment and actor header are the verified ones.
- `_shared/counter_payment_test.ts`, moved with its module.
- `supabase/tests/qbo_oauth_states/`: grants, single-use, expiry, wrong user,
  housekeeping, RLS.

Nothing reached Square, Intuit, Mailchimp, LGL, Twilio or Resend. Every test
stubs `fetch`. The boot harness points `SUPABASE_URL` at a closed port.

## DEPLOY STEPS

**Read first.**

- This branch is based on `origin/main` with all of wave one (#358–#363).
  Deploying a function from it also ships any wave-one change to that function
  that is not deployed yet. **Finish wave one's deploys first**, in their
  briefs' order: Worker before the Turnstile functions, migrations before
  functions.
- L6 changed the bundle of **every function except `guest-checkout`**.
- Docker should be running when you deploy, so the CLI bundles with the same
  edge-runtime the boot harness used.

### 0. Before anything

```sh
sh supabase/tests/boot/run.sh          # all 31 must print ok
npx supabase functions list --project-ref rpqzrpboyhshdrfdwayk
npx supabase functions list --project-ref vlmslygnimfbamrtwvyo
```

Deploy only functions that are **already** listed on that project.

- On production (2026-10-06 download) that is these 28:

  square-terminal square-donation square-catalog-sync square-labor
  sign-contract ticket-access send-ticket-confirmation ticket-checkout
  film-pass-checkout square-refund send-auth-email film-pass-batch
  lgl-sync-donation square-invoice invite-staff mailchimp-subscribe
  mailchimp-ecommerce mailchimp-campaign square-event-write
  square-catalog-restore square-variation-restore square-catalog-guard
  square-showing-variations square-cash-sale rental-request mailchimp-webhook
  square-analytics square-transactions

  `guest-checkout` is listed there too but unchanged; skip it.
- **Do not deploy:**
  - `qbo-sync`: deployed nowhere, see below
  - `mailchimp-bootstrap`: not deployed; it carries the `has_role` fix whenever
    it is
  - anything in `supabase/probes/`
- **Never use `--prune`.** That would delete whatever exists on the project but
  not locally, and does not tidy anything in this PR.

### 1. Migration (both projects; harmless before qbo-sync exists)

`20261006233349_qbo_oauth_states.sql`: a new service-only table, with no change
to existing objects.

```sh
npx supabase db push --project-ref rpqzrpboyhshdrfdwayk   # then verify:
npx supabase db query --linked -f supabase/tests/anon_surface/surface.sql   # expect zero rows
```

Then the same for production. Check the version applied (CLAUDE.md: colliding
timestamps no-op silently).

### 2. Functions: staging first, in this order

Quiet admin functions first, money paths last. For a change, deploy one group,
then probe it.

```sh
REF=rpqzrpboyhshdrfdwayk
# a. admin and back-office
npx supabase functions deploy square-analytics square-transactions square-catalog-sync \
  square-catalog-guard square-catalog-restore square-variation-restore square-event-write \
  square-showing-variations square-labor square-invoice film-pass-batch invite-staff \
  mailchimp-campaign --project-ref $REF
# b. integrations and email
npx supabase functions deploy mailchimp-subscribe mailchimp-ecommerce mailchimp-webhook \
  lgl-sync-donation send-auth-email send-ticket-confirmation sign-contract --project-ref $REF
# c. patron-facing reads and forms
npx supabase functions deploy ticket-access rental-request --project-ref $REF
# d. money paths
npx supabase functions deploy square-refund square-cash-sale square-terminal \
  film-pass-checkout square-donation ticket-checkout --project-ref $REF
```

**After each group**, prove every function booted. Expect a function-level
refusal or answer (`400`, `401` or `403` with JSON, or `200` for `get_config`).
**Not** a `5xx` carrying `BOOT_ERROR` or `WORKER_ERROR`. These use the anon key
and write nothing beyond a rate-limit counter:

```sh
ANON=<publishable key from .env.staging>
for f in <the group's functions>; do
  printf '%s ' $f
  curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    "https://$REF.supabase.co/functions/v1/$f" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{}'
done
```

Specific expected refusals on staging:

- `square-donation` `{"action":"record_in_person","amountCents":500,"paymentChannel":"cash","orderToken":"00000000-0000-4000-8000-000000000000"}`
  → **401** "Sign in required".
- `ticket-checkout` `{"action":"get_config"}` → 200 with publishable ids (proves
  supabase-js 2.117.2 booted on the main money path).
- In a browser, logged in as staff on staging: one **sandbox** box-office sale
  with a $1 gift, cash and then card (the simulated reader):
  - "donation recorded" both times
  - the `donations` rows carry the order token and, for cash, the CASH
    payment id
  - this proves the L1 change against the real POS
  - nothing reaches LGL from staging unless `LGL_API_KEY` is set there; it is,
    and it is production's (see the runbook). If that is not acceptable, unset
    it on staging first.

### 3. Worker (both environments)

Needed for InviteStaffDialog and MarqueeBookingForm. The order relative to the
functions does not matter: neither change depends on a function change.

```sh
npx wrangler deployments list --env staging    # record rollback (tail, newest last)
npm run build:staging && npx wrangler deploy --env staging
```

Then production, per CLAUDE.md:

- record the rollback version
- check production is not ahead of main
- `npm run build:production`, confirming the production ref is in the bundle
- `npx wrangler deploy`

Check the marquee form on the home page: the button label, then a send.

### 4. Production functions

Repeat steps 2a–2d with `REF=vlmslygnimfbamrtwvyo` and the production
publishable key. The probes are the same, and the same rules apply: refusals
only, no purchases.

### qbo-sync: not deployed by this change

Before its first deploy, on the target project:

```sh
npx supabase secrets set QBO_STATE_SECRET="$(openssl rand -base64 48)" --project-ref <ref>
npx supabase secrets set SITE_URL=<that environment's site> --project-ref <ref>
# plus QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_ENVIRONMENT / QBO_REDIRECT_URI
```

- Without `QBO_STATE_SECRET` it refuses to connect.
- Without `SITE_URL` it would send the admin back to the default origin in
  `_shared/brand.ts`.
- The migration must be applied first.
- `config.toml` already makes it `verify_jwt = false`. Deploy with plain
  `supabase functions deploy qbo-sync`, without `--no-verify-jwt`.
- Then the expected refusals:
  - `?action=status` with the anon key → **401**
  - with a staff session → **403**
  - `?action=oauth_callback&code=x&realmId=y&state=a.b` → **400** "Invalid state"
- `FINDINGS-quickbooks-integration-state.md` says to deploy it to staging only
  until its step 4.

## Rollback

- **Functions.** Redeploy the affected functions from the previous main
  (`git worktree add … de88e39`, then `supabase functions deploy` from there).
  Note that the previous source has floating `@2` imports, which today resolve
  to the same 2.117.2. Rolling back undoes the pin, not the version.
- **square-donation.** Rolling it back alone restores the unverified
  `record_in_person`.
- **Migration.** `qbo_oauth_states` is unused until qbo-sync deploys. Leave it.
  `DROP TABLE public.qbo_oauth_states` if it must go.
- **Worker.** `npx wrangler rollback <recorded version>`.

## Left open / needs a decision

- **Lockfile (L6):** options (a), (b) or (c) above. This PR is (c).
- **CLAUDE.md** check commands are unchanged. Consider adding
  `sh supabase/tests/boot/run.sh` to "Checks before you ship" (needs Docker,
  about a minute), because it is the only local check that catches BOOT_ERROR.
  This PR does not edit CLAUDE.md.
- **Separate staging vendor keys (L8):** see the runbook's last table. Unsetting
  `LGL_API_KEY` on staging is the cheap first step.
- **One gift per order** is an application check, not a unique index. Two
  simultaneous `record_in_person` calls for one order could both pass. The POS
  makes one call per sale. A partial unique index on `donations(order_token)`
  for `source = 'staff_pos'` would close it. That needs a production data check
  for existing duplicates first, so it is not done here.
- `check:worker` fails on main ("worker-configuration.d.ts out of date"). It is
  outside this cluster. `npx wrangler types` regenerates it.
