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
workers. Verified 2026-08-17: a green build on a **PR branch** deploys nothing;
a push to the **production branch** is the case this setting governs.

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
