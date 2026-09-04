# Runbook: Deploying to Staging & Production (verified)

**Why this exists.** The recurring "my redeploy doesn't show up / free tickets still ask for a card / blank page with `supabaseUrl is required`" problems were **not** a service-worker bug. The PWA service worker is correctly configured (`registerType: 'autoUpdate'`, `skipWaiting`, `clientsClaim`, `cleanupOutdatedCaches`). Two upstream causes were producing broken deploys:

1. **Wrong branch.** The `staging` git branch is *behind* `main`. `main` has the free-ticket fix (PR #35), the timezone fix, and the sold-out/check-in work; `staging` does not. Deploying the staging *worker* from the `staging` *branch* ships code that still forces a card on $0 tickets.
2. **Unverified env at build time.** `VITE_SUPABASE_URL` (and now `VITE_SITE_URL`) are baked into the JS bundle at build time. If `.env.staging` is missing/empty (e.g. a fresh clone or worktree — these files are gitignored), the bundle ships an empty URL and throws `supabaseUrl is required`. The service worker then faithfully caches that broken build.

**The rule:** deploy the worker from **`main`**, build with the **real env file**, and **verify the URLs are baked in before you deploy**.

Project refs: **staging = `rpqzrpboyhshdrfdwayk`**, **production = `vlmslygnimfbamrtwvyo`**. Run everything on your own machine (Wrangler logged in; real `.env.staging`/`.env.production` present).

---

## Env vars each build needs

Frontend (gitignored `.env.staging` / `.env.production`, baked in at build):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SITE_URL` — canonical public origin for SEO/OG tags and absolute links. **New** (see the `chore/site-url-env` PR). If unset, the build falls back to the prod Worker URL, which is wrong for a staging build, so set it:
  - `.env.staging`: `VITE_SITE_URL="https://kenworthy-ticketing-staging.mrtomfrank.workers.dev"`
  - `.env.production`: `VITE_SITE_URL="https://kenworthy-ticketing-build.mrtomfrank.workers.dev"` → change to `https://kenworthy.org` at domain cutover.

Edge functions (Supabase secrets, per project):
- `SITE_URL` — same value, drives ticket links, campaign "buy" links, and contract-signing links. Set once per project:
  - `npx supabase secrets set SITE_URL="https://kenworthy-ticketing-staging.mrtomfrank.workers.dev" --project-ref rpqzrpboyhshdrfdwayk`
  - `npx supabase secrets set SITE_URL="https://kenworthy-ticketing-build.mrtomfrank.workers.dev" --project-ref vlmslygnimfbamrtwvyo` (→ `https://kenworthy.org` at cutover)

Creating a storage bucket — **a public bucket needs two more columns**:
- `INSERT INTO storage.buckets (id, name, public)` is the shape every existing
  bucket used, and it leaves `allowed_mime_types` and `file_size_limit` NULL —
  meaning *anything, any size*. A client-side `accept=""` attribute is a form
  validation, not a control: it is skipped by calling
  `storage.from(...).upload()` directly, and `file.type` is whatever the client
  claims anyway.
- An unconstrained **public** bucket will take an SVG carrying `<script>` and
  serve it from our own Supabase origin. That is a phishing primitive with no
  upside; posters and pass artwork are raster images.
- Add the new bucket to the list in
  `20260820164402_new_public_buckets_accept_only_their_own_media.sql`. The rule
  cannot be a `COMMENT ON TABLE storage.buckets` — Supabase owns that table and
  the migration role is not its owner (`42501`).
- This has already recurred once: `festival-programs` and `pass-images` were
  both created unconstrained the day after the first two were fixed.

Turnstile — **set the pair together or not at all**:
- `VITE_TURNSTILE_SITE_KEY` (frontend, `.env.*`) and `TURNSTILE_SECRET_KEY`
  (Supabase secret) come from one widget created in the Cloudflare dashboard
  (Turnstile → Add widget; add both Worker hostnames).
- They gate the bot check on the public rental form. Both ends treat *unset* as
  "skip the check", so the form keeps working before the widget exists — which
  is why the halfway states are the ones to avoid. A site key with no secret is
  a widget the server ignores; a secret with no site key rejects every
  submission for a missing token.
  - `npx supabase secrets set TURNSTILE_SECRET_KEY="..." --project-ref rpqzrpboyhshdrfdwayk`
  - `npx supabase secrets set TURNSTILE_SECRET_KEY="..." --project-ref vlmslygnimfbamrtwvyo`
- The secret key is a **secret** — it goes in `supabase secrets set`, never in
  `.env.*`, which are committed. The site key is public by design.

---

## Staging deploy

```bash
cd <your kenworthy-ticketing-build clone>

# 0. Get the complete, correct code and confirm the env file exists
git checkout main && git pull origin main
[ -f .env.staging ] && grep -E 'VITE_SUPABASE_URL|VITE_SITE_URL' .env.staging || echo "STOP: .env.staging missing/incomplete"
#   expect VITE_SUPABASE_URL=...rpqzrpboyhshdrfdwayk... and VITE_SITE_URL=...staging...

# 1. Install (PWA added new deps; skip only if node_modules is current) then build
npm install
npm run build:staging

# 2. VERIFY before deploying — this is the step that was missing
grep -rl "rpqzrpboyhshdrfdwayk" dist/assets >/dev/null && echo "OK: staging URL baked in" || echo "FAIL: env not baked — DO NOT DEPLOY"
grep -rl "lovable" dist >/dev/null && echo "BAD: lovable domain present — DO NOT DEPLOY" || echo "OK: no lovable"
grep -rl "lbgkfdqjcvjkteecatas" dist >/dev/null && echo "BAD: retired lbgk URL present — DO NOT DEPLOY" || echo "OK: no lbgk"
grep -o 'assets/index-[^"]*\.js' dist/index.html   # note this hash — the deployed page must load it

# 3. Deploy the frontend to the staging worker
npx wrangler deploy --env staging

# 4. Deploy the edge functions (free-ticket $0 fix + the SITE_URL cleanup)
npx supabase functions deploy ticket-checkout --project-ref rpqzrpboyhshdrfdwayk
```

**After deploy — one-time browser reset (only because your browser is stuck on the old build):**
DevTools → Application → Service Workers → **Unregister** every worker → Application → Storage → **Clear site data** → close the tab → reopen `https://kenworthy-ticketing-staging.mrtomfrank.workers.dev`.
Confirm in the Network tab it now loads the `index-*.js` hash from step 2. Going forward you won't need this — `autoUpdate` + `skipWaiting` make future deploys self-heal.

**Then test:** a $0 showing should reserve tickets with **no card field**, no "minimum" error, land `confirmed` with a QR, increment the sold count, and send a confirmation — with **no** Square payment created. A paid showing still charges.

---

## Production deploy (when staging checks out)

```bash
git checkout main && git pull origin main   # same branch; prod tracks main
npm install
npm run build:production
grep -rl "vlmslygnimfbamrtwvyo" dist/assets >/dev/null && echo "OK: prod URL baked in" || echo "FAIL — DO NOT DEPLOY"
grep -rl "lovable" dist >/dev/null && echo "BAD: lovable present — DO NOT DEPLOY" || echo "OK: no lovable"

npx wrangler deploy                         # default env → kenworthy-ticketing-build (prod worker)
npx supabase functions deploy ticket-checkout --project-ref vlmslygnimfbamrtwvyo
```

---

## The PR checks (Cloudflare Workers Builds)

Both `Workers Builds: …` checks failed on **every** PR for months, which trained
everyone to ignore a red check. Two causes, both now fixed in the repo:

1. **No env at build time.** `.env.staging` / `.env.production` were gitignored,
   so the remote build had no `VITE_SUPABASE_URL`. They are committed now — every
   value in them is `VITE_`-prefixed (baked into the bundle and served to every
   visitor) or the publishable anon key under a second name. Both keys were
   decoded to confirm `role: anon` before committing. **Never put a service-role
   key or a Square token in them**; those belong in `supabase secrets set`.

2. **A stale bun lockfile hijacked the install.** Cloudflare detects the package
   manager from the lockfile and prefers bun, so it ran
   `bun install --frozen-lockfile` and died with *"lockfile had changes, but
   lockfile is frozen"* — before the build command ever ran. `bun.lock` was one
   commit behind `package.json` and `bun.lockb` had not been touched since June,
   while `package-lock.json` moves in the same commit as `package.json`. Nobody
   was maintaining the bun lockfiles, so both were deleted and CI now installs
   with `npm ci`, exactly like this runbook and every developer.

   **Do not commit a `bun.lock` / `bun.lockb` / `pnpm-lock.yaml` / `yarn.lock`.**
   Any of them silently takes CI off npm and onto a lockfile nobody updates.

**Deploy-on-push:** Workers & Pages → the worker → *Settings* → *Build*. Branch
control governs automatic production-branch deployments, and Build configuration
holds the build command, the deploy command (defaults to `npx wrangler deploy`)
and build variables. Deploys are meant to be manual and verified — the whole
point of the checks above — so the deploy command should be neutered on both
workers. Verified 2026-08-17: a green build on a **PR branch** deploys nothing.
Note that only the production worker has been measured on a merge (below); the
staging worker is assumed to match, not confirmed.

**A push to `main` does not deploy production either — measured, 2026-08-18.**
This was the open half of the note above, and it is now closed. PR #91 was
squash-merged to `main` at 23:12:55Z with both Workers Builds checks green. The
production worker (`kenworthy-ticketing-build`) was on version
`71281430-6b0e-4dd5-a7d1-c9220b251f6a`, deployed by hand at 22:40:23Z, **before**
the merge; `npx wrangler deployments list` still showed that same version as
100% of traffic six minutes after it. The build runs on a merge to `main` and
its deploy step is a no-op.

So `main` is not production. Nothing reaches patrons until someone runs the
Production deploy section above by hand — which is the intent, but it means a
merged PR is **not** a shipped PR, and a green check on `main` says nothing
about what the box office is running. Re-measure this the same way if the
Cloudflare build settings are ever touched: capture the version id before the
merge, and compare after.

### What actually decides which environment gets baked in

The **script name**, not the runner. `bun run build:staging` and
`npm run build:staging` both produce a correct staging bundle — verified on a
clean clone, including under `NODE_ENV=production`. Bun auto-loads
`.env.production` into its own environment (you can see it in the build log as
`[0.13ms] ".env.production"`) but that does **not** leak into the build; Vite's
`.env.staging` wins for a `--mode staging` build.

What is dangerous is either of these:

- **A bare `build`.** `bun run build` / `npm run build` default to production
  mode and bake **prod** Supabase credentials — into whichever worker ran them.
- **A `VITE_*` Cloudflare build variable.** An exported env var *overrides* the
  `.env` file. Setting `VITE_SUPABASE_URL` to prod while running `build:staging`
  produced a bundle pointing at the **production database** while still showing
  the staging site URL — a mixed state that looks entirely normal from the
  outside. Keep the build-variables list empty; the committed `.env.*` files are
  the source of truth now.

## Housekeeping (optional, prevents this recurring)
- **Fast-forward the `staging` branch to `main`** so "deploy staging branch" and "deploy staging worker" stop diverging: `git checkout staging && git merge --ff-only main && git push origin staging` (resolve if it won't fast-forward).
- The gitignored `.env.staging` / `.env.production` must exist in **every** clone/worktree you build from — a fresh checkout won't have them, and that silently produces the empty-URL build.
- At **domain cutover to kenworthy.org**: change `VITE_SITE_URL` in `.env.production`, set the prod `SITE_URL` secret to `https://kenworthy.org`, rebuild, redeploy. No code change.

---

## Domain cutover to kenworthy.org

Written before the cutover, when kenworthy.org still resolved to Apache
elsewhere. It cut over on 28 August 2026: the domain is now a zone in this
Cloudflare account and the Worker answers on it, so everything below is live
rather than hypothetical.

### 1. The two settings already noted above
`VITE_SITE_URL` in `.env.production`, and the prod `SITE_URL` secret. Rebuild
and redeploy after both.

### 2. Turnstile needs nothing
The production widget was created with `kenworthy.org` and `www.kenworthy.org`
in its domain list already, so the rental form keeps working across the move
with no change. (Staging's widget covers the staging Worker and `localhost`.)

### 3. Cloudflare rate-limiting rules — the zone is ours now

**Read this before writing the rules, because the obvious expectation is
wrong.** WAF rate-limiting attaches to a zone. Once `kenworthy.org` is one, a
rule can throttle **requests the Worker serves** — page loads, assets. It cannot
touch the endpoints that actually matter, because the browser calls
`*.supabase.co` directly for every checkout, donation, ticket lookup and
password reset. That traffic never enters the zone.

So these rules blunt scraping and crude floods against the site itself. The
protection for the API is `check_rate_limit` in the edge functions
(`20260825143017`), which is deliberately independent of where the site is
hosted.

**Measured 2026-09-03, now that the zone is ours:**

| | |
| --- | --- |
| zone | `kenworthy.org` — `08c627c9b7f7602f6960cc7db88291c7` |
| plan | **Free Website** |

The plan is the constraint that matters. Cloudflare's WAF rate-limiting rules
are available on Free, but the allowance is small — expect **one rule**, and
fewer options on period and action than the docs show for paid plans. The
dashboard is the authority on what your plan permits; the numbers below are
written to fit inside one rule for that reason.

**Deployed 2026-09-03 and verified.** One rule, on `/admin`. Two notes for
whoever touches this next:

* It lives under **Security → Security rules**, not Security → Settings.
* **Hostname is not an available field on the Free plan.** It is also not
  needed: the ruleset is scoped to this zone already, so every request it can
  see is for this hostname. The rule is one condition —
  `URI Path starts with /admin` — and dropping the hostname check costs nothing
  beyond also covering `www`, which 301s to the apex regardless.

Measured against the live rule rather than assumed:

| property | result |
| --- | --- |
| fires | 80 requests in a minute → **68 × `429`** |
| scoped | `/`, `/calendar`, `/rental-request`, `/film-passes` all `200` while `/admin` was throttled |
| releases | `/admin` back to `200` within the minute — no lasting lockout |

The scoping check is the one worth repeating if the rule is ever widened: a
site-wide limit on a Free plan with no path matching would challenge a family
browsing the calendar on shared wifi, and you would never hear about it.

I could not apply it myself. The wrangler OAuth token reads zones fine but
returns `10000 Authentication error` on `/zones/{id}/rulesets` — WAF needs a
scope it does not carry.

### If you get one rule, spend it here

```
Expression:  (http.host eq "kenworthy.org" and starts_with(http.request.uri.path, "/admin"))
Rate:        60 requests per 1 minute, per IP
Action:      Managed Challenge   (fall back to Block if the plan offers no challenge)
```

`/admin` has no anonymous audience at all, so any volume there is worth
questioning, and a false positive costs a staff member one challenge rather than
a customer a ticket. The client-side route guard is not a security boundary —
the server checks are, and those were verified in the audit — but there is no
reason to let anyone probe it at speed.

### If you get a second rule

```
Expression:  (http.host eq "kenworthy.org")
Rate:        600 requests per 1 minute, per IP
Action:      Managed Challenge
```

A crude ceiling. Deliberately far above real use: one poster-heavy page issues
tens of requests, and a family browsing the calendar on shared wifi is one IP.

**Prefer Managed Challenge over Block wherever the plan allows it.** A challenge
a real person passes is recoverable; a block on a shared NAT — a school, a
library, a workplace — is not, and you will never hear about it.

### What these are worth, honestly

Less than the table suggests. They protect **page loads served by the Worker**.
They do not touch checkout, donations, ticket lookups or password reset, because
the browser calls `*.supabase.co` directly and that traffic never enters this
zone. That is what `check_rate_limit` in the edge functions is for
(`20260825143017`), and it is the layer doing the real work.

Cloudflare already absorbs crude floods in front of a Worker without any rule at
all. So treat these as tidying rather than as the thing standing between the box
office and an attacker.

### 4. Putting the API behind the zone — optional, costs money
If you ever want WAF rules to cover the Supabase endpoints too, the supported
route is Supabase's **Custom Domain add-on** (Pro plan): point `api.kenworthy.org`
at the project so its traffic crosses your zone. Checked 2026-08-25 — neither
project has the entitlement (`feature: custom_domain`). Until then the
app-level limiter is the only thing that reaches those endpoints, and it is
sufficient for the abuse actually anticipated.

A Worker proxy on `kenworthy.org/api/*` would achieve the same for free, and is
deliberately **not** recommended: it inserts our own code into the card-payment
path, where a bug costs a sale.

### 5. Verify after the move
```bash
curl -sSI https://kenworthy.org/ | grep -iE 'x-frame-options|strict-transport|content-security'
#   the security headers must survive the move — they come from public/_headers
curl -s https://kenworthy.org/ | grep -o 'assets/index-[^"]*\.js'
#   then fetch that file and confirm content-type is text/javascript, not text/html
#   (a missing asset returns 200 + the app shell — see the SPA-fallback note)
```
Confirm a real rental submission still reaches "Thank you": the Turnstile widget
must solve on the new hostname, and that is the one thing the domain list above
is protecting against.
