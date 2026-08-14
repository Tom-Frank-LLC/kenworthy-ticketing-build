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

## Housekeeping (optional, prevents this recurring)
- **Fast-forward the `staging` branch to `main`** so "deploy staging branch" and "deploy staging worker" stop diverging: `git checkout staging && git merge --ff-only main && git push origin staging` (resolve if it won't fast-forward).
- The gitignored `.env.staging` / `.env.production` must exist in **every** clone/worktree you build from — a fresh checkout won't have them, and that silently produces the empty-URL build.
- At **domain cutover to kenworthy.org**: change `VITE_SITE_URL` in `.env.production`, set the prod `SITE_URL` secret to `https://kenworthy.org`, rebuild, redeploy. No code change.
