# Working Setup & Conventions (read me first)

Operating context for anyone (human or Claude) picking up KPAC work, so settled
facts don't get re-litigated each session. Correct anything wrong — this is the
source of truth for *how we work*, alongside PLATFORM.md (what the platform is).

## Tom's environment — assume these, don't re-ask
- **Terminal-first.** Tom does git/deploys from the terminal on macOS. Do **not**
  suggest browser-based auth flows or GUI steps. He's been here a long time.
- **git is already authenticated** to GitHub over HTTPS (macOS keychain). Pushes
  and pulls work. Never walk him through `git`/`gh` login unless a command
  actually errors with an auth failure and he asks. Default: give the command,
  trust it works, fix only the specific error if one appears.
- **Primary clone** is his main local checkout of `kenworthy-ticketing-build`
  (has the gitignored env files and an authenticated `wrangler`). Deploy and
  build from there — not from throwaway worktrees.
- **wrangler is authenticated on his machine** (not in any cloud sandbox).

## What the cloud (Cowork) session can and cannot do
- **Can:** read/clone the repo, edit, build, run tests, commit locally, produce
  patches and docs.
- **Cannot push:** the git proxy only signs pushes for a repo authorized as the
  session's *source*; this repo isn't, so `git push` → 403. Deliver code as a
  **patch** (`git format-patch`) for Tom to `git am` + push, or as a branch he
  applies. (To enable direct push+PRs in future: start the task *connected to
  the GitHub repo* rather than a synced folder.)
- **Cannot deploy:** `wrangler` isn't authed in the sandbox, and the sandbox's
  local `.env` points at the **retired** lbgk project. So builds/deploys are
  Tom's to run on his machine, from the runbook.

## Repo / deploy facts
- **Branch model:** feature branch off `origin/main` → PR → Tom reviews/merges.
  Never push to `main` directly. The `staging` *branch* is currently **behind
  `main`** — deploy the staging *worker* from `main`, not the staging branch.
- **Hosting:** Cloudflare Workers via `wrangler` (serves `./dist`). Staging
  worker `kenworthy-ticketing-staging` (`wrangler deploy --env staging`); prod
  worker `kenworthy-ticketing-build` (`wrangler deploy`).
- **Supabase projects:** staging `rpqzrpboyhshdrfdwayk`, production
  `vlmslygnimfbamrtwvyo`. Edge functions via `supabase functions deploy <fn>
  --project-ref <ref>`.
- **Build-time env (gitignored, per clone):** `.env.staging` / `.env.production`
  hold `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SITE_URL`.
  A fresh clone/worktree lacks them → empty URL baked in → `supabaseUrl is
  required` blank page. Always verify the URL is baked into `dist` before
  deploying (see RUNBOOK-deploy-staging-prod.md).
- **PWA service worker** is correctly configured (`autoUpdate`, `skipWaiting`,
  `clientsClaim`). A stale page is almost always a stale/broken *build* being
  served, not an SW misconfig.

## Retired / cleaned up — don't reintroduce
- **lbgk** (`lbgkfdqjcvjkteecatas`) — the old Lovable Supabase project. Removed
  from source; do not reference.
- **Lovable preview domain** (`kenworthy-ticketing.lovable.app`) — being purged
  (PR `chore/site-url-env`). The site origin is now env-driven via `SITE_URL` /
  `VITE_SITE_URL`; **cutover target is `https://kenworthy.org`** once testing is
  done and the domain is pointed at the new site.

## Collaboration hygiene
- **Multiple Claude sessions may edit this repo in parallel.** Isolate work on a
  branch; don't clobber others' in-progress files. When in doubt, ask which
  files are owned elsewhere.
