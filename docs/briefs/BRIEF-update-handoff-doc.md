# Brief: Update the Handoff Doc (`PLATFORM.md`) to Match Reality

**Status:** ✅ Applied to the repo 2026-08-12 — two items deferred, tracked below
**Date:** August 12, 2026 · **Updated:** August 12, 2026
**Reported by:** Deploy-process review (traced against `main`, commit `aa5f05f`)

> **Why this existed.** Asked "what's my process to push through staging and prod,"
> the handoff doc gave the wrong answer: it described **Cloudflare Pages with
> branch-triggered auto-deploys**, but the repo runs **Cloudflare Workers via
> `wrangler.jsonc`** with **build-time env selection**. The `README` still said
> "open Lovable and click Publish."

> **Correction to the earlier revision of this brief.** A previous version marked
> §1–§7 as already applied. They were not applied to the repo — `docs/PLATFORM.md`
> had only two commits, neither of them these fixes. (The edits presumably landed
> in a copy outside the repo.) All of it has now been written to the repo copy.

---

## ✅ Applied to the repo (2026-08-12)

### `docs/PLATFORM.md` — rewritten

- **§1** — hosting corrected to Cloudflare **Workers**; staging URL filled in;
  repo URL corrected from `mrtomfrank/` to the real remote, `Tom-Frank-LLC/`.
  Added an explicit "not Pages" callout, since that was the drift that misled.
- **§2.2 Supabase** — the stale single Project ID replaced with the two real
  refs: staging `rpqzrpboyhshdrfdwayk`, production `vlmslygnimfbamrtwvyo`. The
  retired Lovable project `lbgkfdqjcvjkteecatas` removed from the doc entirely.
  Added the warning that `config.toml` pins **production** and that the CLI link
  moves, so `--project-ref` should always be explicit.
- **§2.3** — "Cloudflare Pages" → **Workers** (production `kenworthy-ticketing-build`,
  staging `kenworthy-ticketing-staging`, `wrangler.jsonc`, serves `./dist`).
  Owner recorded as a **Tom Frank LLC** Cloudflare account, with the note that
  `workers.dev` hostnames change on account transfer.
- **§3 Environment Variables** — rewritten and split in two, because the original
  conflated them: **§3.1** build-time `VITE_*` from gitignored `.env.staging` /
  `.env.production` (not a dashboard), **§3.2** Supabase edge function secrets,
  set per project. Includes the "never deploy a plain `npm run build`" warning.
- **§4 Deployment** — branch-auto-deploy table replaced with the real Wrangler
  runbook, plus a separate §4.3 for the Supabase side.
- **§5 Database** — `--project-ref` on `db push`; the seven-row table list
  replaced with the actual schema grouped by area (44 tables, 62 migrations).
- **§6 Known Issues** — the stale status table (which still called payments and
  ticket email "not started" months after both shipped) replaced with a pointer
  to `TASKS.md` as the live list.
- **§7 Go-Live Checklist** — refreshed against current reality.
- **§9** — new index of the related docs.

### Also applied

- **`README.md`** — Lovable boilerplate replaced with a real project README:
  environment URLs, `npm run dev -- --mode staging`, the deploy commands, the
  bare-`npm run build` warning, and a doc index pointing at `PLATFORM.md §4`.
- **`.env` untracked** — `git rm --cached .env`. The retired lbgk project's URL
  and anon key are no longer in the working tree of a public repo. The file
  stays on disk (already gitignored). Old history still contains it; since the
  project is retired, a rewrite is optional.

### Corrections found while applying

The brief's §3 plan listed `VITE_SQUARE_APP_ID`, `VITE_SQUARE_ENV`, and
`VITE_SQUARE_LOCATION_ID` as build variables. **They do not exist.** The
frontend reads exactly two `VITE_*` values — `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` — and all Square credentials are server-side
edge function secrets selected by `SQUARE_ENV`. Documenting the Square vars as
build-time would have reproduced the same class of error this brief set out to
fix, so §3 documents what the code actually reads.

The brief also pointed §6/§7 at `LAUNCH-READINESS.md`, which does not exist in
the repo. Those sections point at `TASKS.md` only.

## ⬜ Still open

1. **Workers Builds connected?** Unresolved — `PLATFORM.md §4.2` carries an
   explicit `TODO — unverified` note rather than a silent hedge. The stale
   `cloudflare/workers-autoconfig` remote branch (one commit, "Add Cloudflare
   Workers configuration") shows the connect flow was started at some point, but
   there are no GitHub Actions workflows and that branch is no proof it is still
   live. Confirm in the Cloudflare dashboard → the Worker → **Builds** tab, then
   replace the TODO with a plain statement.
2. **Custom domain** — planned, not configured. Tracked as a §7 checklist item;
   document the route and DNS in §2.3 when it lands.
3. **Local `.env`** — still points at the retired lbgk project. Either repoint it
   at staging or delete it; `npm run dev -- --mode staging` (now the documented
   command) reads `.env.staging` and ignores it either way.
4. **Lovable residuals in code** — four edge functions still hardcode
   `https://kenworthy-ticketing.lovable.app` as an origin/fallback
   (`mailchimp-campaign`, `mailchimp-bootstrap`, `qbo-sync`, `sign-contract`).
   Out of scope for a docs brief; noted in `PLATFORM.md §6` and belongs in
   `TASKS.md`.

---

## Reference: the corrected deploy runbook (now in `PLATFORM.md §4`)

```bash
# staging
git checkout staging && git merge <feature> && git push origin staging
npm run build:staging && npx wrangler deploy --env staging
#   verify: https://kenworthy-ticketing-staging.mrtomfrank.workers.dev

# production (after staging verified)
git checkout main && git merge staging && git push origin main
npm run build:production && npx wrangler deploy
#   verify: https://kenworthy-ticketing-build.mrtomfrank.workers.dev
```

> If **Workers Builds** is connected, the `git push` steps deploy on their own
> and the `wrangler deploy` lines are a confirm/fallback — see open item 1.
> **`VITE_*` are baked at build time** from `.env.staging` / `.env.production`
> — the Worker holds none. Never deploy a plain `npm run build` (it reads the
> stale default `.env`).

**Backend (Supabase) deploys** — separate from the frontend; see
`TICKET-DELIVERY.md` for the edge-function / migration runbook. Frontend-only
changes need none of it.

---

## Correction — 2026-08-13

One thing this update got wrong, recorded here because the bullets above still
describe it as a fix.

**`--project-ref` on `db push` does not exist.** §2.2 and §5 were changed to say
"always pass `--project-ref` explicitly rather than trusting the current link",
and §4.3 gave `npx supabase db push --project-ref <ref>` as the command. The flag
is real on `functions deploy` and on `link`, but `db push` and `migration list`
have never accepted it — they follow the CLI link (`--linked`), or take a
`--db-url`. Verified against CLI 2.113.0 by reading `--help` for each.

The advice was right in spirit and wrong in mechanism, which is the more
dangerous combination: it reads as a safety measure, so nobody checks the link
it was supposed to make unnecessary. The CLI rejects the unknown flag outright
rather than silently defaulting, so no migration ever went to the wrong project
because of this — but only by luck of the CLI's argument parsing.

`TICKET-DELIVERY.md` and `TASKS.md` already described the real behaviour
correctly at the time this brief was written; the handoff doc simply disagreed
with them, and nothing reconciled the two.

**Fixed 2026-08-13:** PLATFORM.md §2.2, §4.3 and §5 now carry a per-command
table of what accepts what, a check-the-link-first procedure, and a note that
the link lives in gitignored `supabase/.temp/` and so is absent from fresh
clones and worktrees. `DONATIONS.md` had inherited the same bad command and was
corrected too.
