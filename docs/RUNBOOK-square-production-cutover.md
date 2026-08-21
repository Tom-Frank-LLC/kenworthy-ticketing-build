# Runbook: Square production cutover

**Written:** August 14, 2026. **Cutover completed the same day** — see status below.
**Companion to:** `docs/briefs/BRIEF-square-production-cutover.md` (the ask).
This file records what was *verified*, not what was assumed.

## STATUS: live on production since 2026-08-14

```
PROD     sq0idp-gimxBVaATLLQetsP7qa_7g   LT3WAR885FA1J   production
STAGING  sandbox-sq0idb-…                LRWDNGD4FX73S   sandbox
```

Verified by calling `get_config` on two independent functions (`ticket-checkout`,
`film-pass-checkout`) on each project. The production **access token** was
separately proven by loading the Admin → Labor roster, a real read against the
live Square host — `get_config` alone cannot prove a token works, because it only
reports which credentials were *resolved*, never calling Square.

The production values were set on the **unprefixed** secrets
(`SQUARE_ACCESS_TOKEN` / `_APPLICATION_ID` / `_LOCATION_ID`) rather than on
`SQUARE_PRODUCTION_*`. That works — the shared config falls back to unprefixed
names — but see the rollback warning, because it has a consequence.

`SQUARE_ENVIRONMENT` has been **deleted** from both projects.

### Two traps hit during the cutover, both worth remembering

1. **Setting the credentials while `SQUARE_ENV` was still `sandbox`** put the
   site in a broken half-state: production token against the sandbox host, every
   payment path 401ing, card form unable to initialise. It is a real outage
   window. Credentials and the flag should be changed back to back, in that
   order, and `get_config` checked immediately after.
2. **`SQUARE_ENVIRONMENT` is not the switch.** It was set to `production` first
   and nothing happened, because no code reads it. The switch is `SQUARE_ENV`.
   This is why it has now been deleted.

### ⚠️ Rollback by flag alone no longer works

Prod holds **no sandbox credentials**. Setting `SQUARE_ENV=sandbox` would point
production credentials at the sandbox host — the broken half-state above, not a
rollback.

To restore a working two-way switch: set `SQUARE_PRODUCTION_*` to the current
production values, then restore the unprefixed three to the sandbox values (they
are still on staging as `SQUARE_SANDBOX_ACCESS_TOKEN` / `_LOCATION_ID` and
`SQUARE_APPLICATION_ID`). Then the flag switches cleanly in both directions.
**Until that is done, rolling back means re-entering credentials by hand.**

## The model

`supabase/functions/_shared/square.ts` is the single source of truth.
`SQUARE_ENV=production` selects `connect.squareup.com` + `SQUARE_PRODUCTION_*`
credentials; **anything else defaults to sandbox**. Each credential falls back to
an unprefixed `SQUARE_*` name. The frontend does not have its own switch — it
loads the sandbox or production Square.js bundle based on the environment an edge
function reports through `get_config`, so it follows the server automatically.

**Going live is a secrets change, not a code change.** That is now true for every
Square touchpoint (it was not, before today).

## Audit — verified August 14, 2026

Verified by `git grep` over `main` and by `supabase functions list` on prod.

| Touchpoint | Env resolution | Status |
|---|---|---|
| `_shared/square.ts` | `SQUARE_ENV` + prefixed creds, unprefixed fallback | ✅ source of truth |
| `square-donation` | shared config | ✅ ready |
| `square-refund` | shared config | ✅ ready |
| `square-terminal` | shared config | ✅ ready |
| `ticket-checkout` | shared config | ✅ ready |
| `film-pass-checkout` | shared config | ✅ ready |
| `square-invoice` | shared config | ✅ ready — see note |
| `square-labor` | shared config | ✅ fixed earlier, deployed |
| `square-catalog-sync` | shared config | ✅ **fixed today** (`53f14c0`) |
| Frontend `src/lib/square.ts` | follows server `get_config` | ✅ no change needed |

Two findings the brief did not have:

- **`square-invoice` was not in the brief's table.** It does contain the string
  `app.squareupsandbox.com`, but as an *environment-conditional dashboard link*
  (`config.environment === 'production' ? app.squareup.com : …`), not an API
  base. It is correct as written. Grepping for "squareupsandbox" alone would
  flag it as a false positive — this is the one legitimate occurrence.
- **No function carries a stale copy of the shared config.** `_shared/*.ts` is
  bundled into each function at deploy time, so a function deployed *before* the
  shared file last changed would silently run old logic. `_shared/square.ts` last
  changed 2026-08-12 12:22 (`394f850`); the two oldest Square deploys
  (`square-terminal` v16, `square-refund` v12) went out 12:24 the same day —
  after it. All current. **Re-check this if `_shared/square.ts` is ever edited
  again: every Square function must be redeployed, not just the edited one.**

**Webhooks:** there is no Square webhook receiver in this project — no such
function exists in `supabase functions list` on either project. So no sandbox
signature key can break at cutover. Nothing to do.

## ⚠️ The unprefixed-fallback trap is the CURRENT live state

This is not hypothetical. `supabase secrets list` returns SHA-256 digests of the
values, which is enough to compare secrets across projects. As of today:

| Secret on **prod** `vlmslygnimfbamrtwvyo` | digest | same value on staging? |
|---|---|---|
| `SQUARE_ACCESS_TOKEN` | `6f7399e2…` | **identical to staging's `SQUARE_SANDBOX_ACCESS_TOKEN`** |
| `SQUARE_LOCATION_ID` | `614106d5…` | **identical to staging's `SQUARE_SANDBOX_LOCATION_ID`** |
| `SQUARE_APPLICATION_ID` | `ee68c569…` | **identical to staging's** |
| `SQUARE_ENV` | `b7ad5674…` | = `sha256("sandbox")`, confirmed by computing it |
| `SQUARE_PRODUCTION_*` | — | **none set** |

So **production currently holds sandbox Square credentials under the unprefixed
names**, and is running in sandbox mode.

**The failure mode:** setting `SQUARE_ENV=production` *without* first setting the
`SQUARE_PRODUCTION_*` secrets makes every Square call use those sandbox
credentials against the live API host. Square rejects them, so it fails loudly
rather than charging the wrong account — but it is a total payment outage
(tickets, donations, terminal, passes) until the secrets are added.

**Therefore: set the credentials FIRST, flip `SQUARE_ENV` LAST.**

Also present on both projects: `SQUARE_ENVIRONMENT` (same value as `SQUARE_ENV`).
**No code reads it** — it is dead cruft from an earlier naming. Leave it or delete
it, but do not mistake it for the live switch. The live switch is `SQUARE_ENV`.

## Go-live sequence

Order matters — credentials before the flag.

```bash
PROD=vlmslygnimfbamrtwvyo

# 1. Production credentials FIRST (from Square dashboard → production app)
npx supabase secrets set --project-ref $PROD \
  SQUARE_PRODUCTION_ACCESS_TOKEN='<prod access token>' \
  SQUARE_PRODUCTION_APPLICATION_ID='<prod application id>' \
  SQUARE_PRODUCTION_LOCATION_ID='<prod location id>'

# 2. Confirm all three landed before flipping anything
npx supabase secrets list --project-ref $PROD | grep SQUARE

# 3. The switch, LAST
npx supabase secrets set --project-ref $PROD SQUARE_ENV=production
```

Functions read secrets at runtime and restart when secrets change, so **no
redeploy is required for the flip**. All Square functions on prod already carry
current code (verified above).

**Leave staging alone.** Staging keeps `SQUARE_ENV=sandbox` so testing never
touches real cards.

### Rollback

`npx supabase secrets set --project-ref $PROD SQUARE_ENV=sandbox` — everything
returns to sandbox within a restart. The `SQUARE_PRODUCTION_*` secrets can stay;
they are inert while `SQUARE_ENV` is not `production`.

## Operational (cannot be done from the repo)

- **Physical Square Terminal:** re-pair to the **production** location with a new
  device code. The sandbox pairing will not work in production.
- **Production catalog & team must be populated.** Sandbox concession items and
  team members do not carry over. A successful "Pull from Square" against an
  empty production catalog returns 0 items and looks like a bug.

## Post-cutover test plan

- **Card form origin:** on a showing, the Network tab loads `web.squarecdn.com`,
  **not** `sandbox.web.squarecdn.com`; `get_config` returns the production
  `applicationId` / `locationId`.
- **Real charge + refund:** buy 1 ticket with a real card, then refund it via the
  POS. Confirm both in the Square dashboard.
- **Donation:** small real donation → charged, receipt sent.
- **Terminal:** card sale on the paired production terminal completes.
- **Concessions "Pull from Square":** returns the production catalog. The success
  toast now names the environment the *server* resolved — it should say
  `(production)`. If it says `(sandbox)`, `SQUARE_ENV` did not take.
- **Labor roster:** shows production team members.

## What changed today (`53f14c0`)

`square-catalog-sync` was the last sandbox-locked function: a hardcoded
`connect.squareupsandbox.com` base, a guard that threw on any other host, and a
read of `SQUARE_SANDBOX_ACCESS_TOKEN` *by name*. Production stores that token
under the unprefixed `SQUARE_ACCESS_TOKEN`, so the function 500'd on every call —
that is why "Pull from Square" errored. It now uses `loadSquareConfig` +
`squareFetch`, and reports `config.environment` rather than the literal string
`"sandbox"`.

Two secondary causes fixed at the same time:

- **The "non-2xx" toast.** `supabase.functions.invoke` turns any non-2xx into a
  `FunctionsHttpError` whose `.message` is always the generic
  "Edge Function returned a non-2xx status code"; the JSON body is left unread on
  `error.context`. `src/lib/functions.ts` (`invokeFunction`) already existed to
  unwrap it — the Concessions tab now uses it, so a misconfigured secret is
  legible instead of anonymous.
- **CORS.** The function carried a hand-rolled `Access-Control-Allow-Headers`
  list that omitted the `x-supabase-client-*` headers supabase-js actually sends,
  so the preflight could fail before the function ran. It uses `_shared/http.ts`
  now.

**Deployed:** `square-catalog-sync` to staging and prod (prod v15). Verified by
curl: prod now answers `401 Unauthorized` (the config loads, then the auth gate
rejects) where the old code answered `500 SQUARE_SANDBOX_ACCESS_TOKEN not
configured` before reaching auth.

## Still NOT verified

**The catalog pull has not been executed end-to-end.** Every action in
`square-catalog-sync` requires an admin JWT, and minting one needs the
service_role key, which was blocked in this session. Booting, config resolution,
and the production access token (via the Labor roster) are all proven; *the
catalog call itself is not*. Click **Pull from Square** in the admin UI — the
toast now names the environment the server resolved, so it should read
`(production)`.

Resolved: the frontend fix is live as of `f6946942` (see below), and the Labor
roster confirmed the production token.

**21 Aug 2026 — the button referenced above no longer exists.** "Pull from
Square" and the "Square catalog categories" panel were removed from Admin →
Concessions; they were recovery instruments built during the 14 Aug damage
window and outlived the emergency. The `square-catalog-sync` function still has
every action they called (`preview`, `repair_categories`, `repair_variations`,
`damage_census`) and is still invoked for `push_item`, so nothing server-side
was withdrawn — the actions are simply no longer one click from the menu
editor. Reach them by invoking the function directly if a catalog repair is
ever needed again.

## Concurrent-deploy collision — RESOLVED, but keep the lesson

The prod Worker was deployed three times within 20 seconds today
(18:35:01, 18:35:19, 18:35:21 UTC) from more than one session. The build
containing the error-message fix went out at 18:35:19
(version `b597e6c7-100f-4c24-918e-6ebd54adc516`, asset `index-DNLuEmVt.js`) and
was **overwritten two seconds later** by version `68015273-…`, built from a
different branch. The live site serves `index-CJi4KOYp.js`, which does **not**
contain the fix.

It was overwritten twice more by other sessions before finally landing as version
`f6946942-6b1a-4292-a66d-5764d5819f4b` (`index-UITk6SR4.js`), confirmed live by
fetching the admin chunk and grepping for the new code.

**A second hazard surfaced while re-landing it.** The worktree built from a local
`main` that was **18 commits behind `origin/main`** — including a security fix
(admin → superadmin escalation, #59). Deploying that build would have silently
reverted all of it on production. Always `git fetch` and check
`git rev-list --left-right --count origin/main...HEAD` before building a deploy;
a green build proves nothing about currency.

Note the related divergence: the edge function was deployed straight to prod
before its commit reached `origin/main`, so for several hours **production ran
code that was not on the trunk**. Anyone redeploying `square-catalog-sync` from
`main` in that window would have silently re-broken the concessions pull. Push
first, then deploy — or at minimum, push immediately after.

Two checks worth keeping permanently:

```bash
git fetch origin && git rev-list --left-right --count origin/main...HEAD  # behind ahead
npm run build:production
grep -rl "vlmslygnimfbamrtwvyo" dist/assets && echo OK                    # env gate
npx wrangler deploy
curl -s https://kenworthy-ticketing-build.mrtomfrank.workers.dev/ \
  | grep -o 'assets/index-[^"]*\.js'    # MUST equal dist/index.html's hash
```

That last line is the one to keep: a deploy *reported success* while serving
someone else's build. **A successful `wrangler deploy` is not evidence that your
build is the one being served — compare the hash.**
