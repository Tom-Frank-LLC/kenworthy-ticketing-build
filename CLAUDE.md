# CLAUDE.md

Project context for the Kenworthy ticketing platform. Read this before
changing anything.

Every rule here carries its reason. A rule without a rationale gets argued
away by the next plausible-sounding case, so if you find one that no longer
holds, correct it here rather than quietly working around it.

## What this is

A ticketing and operations platform for the Kenworthy Performing Arts Centre,
a 1926 single-screen theatre in Moscow, Idaho. It sells tickets, film passes,
concessions and donations; runs the box office (`/admin/pos`) and door scanner;
and handles theatre rentals, staff scheduling and Square/Mailchimp/LGL sync.

React + Vite + TypeScript + Tailwind on Cloudflare Workers, with Supabase
(Postgres + Auth + 34 edge functions) behind it.

**Patrons are `anon`.** Member login was removed, so `authenticated` now means
staff / admin / superadmin only. Any policy shaped `user_id = auth.uid()` was
written for patrons and is probably dead code.

## Environments

| | staging | production |
|---|---|---|
| Supabase ref | `rpqzrpboyhshdrfdwayk` | `vlmslygnimfbamrtwvyo` |
| Worker | `kenworthy-ticketing-staging` | `kenworthy-ticketing-build` |
| Env file | `.env.staging` | `.env.production` |

`.env.staging` and `.env.production` are deliberately committed — see the note
in `.gitignore` for why. Never put a service-role key or Square token in them;
server-side secrets go in `supabase secrets set`.

**Staging is not a sandbox for everything.** Square has a real sandbox there.
Mailchimp and LGL do **not** — staging shares production's key and audience, so
a test subscribe or test donation writes a real contact and a real donor record,
with no reversal path.

## Build and run

```bash
npm run dev -- --mode staging     # bare `npm run dev` renders a blank page
npm run build:staging
npm run build:production
```

There is no `.env` for development mode, only `.env.staging` and
`.env.production`. Bare `npm run dev` and bare `npm run build` therefore build
with an empty Supabase URL and fail at runtime rather than at build time.
**Always pass the mode.**

## Checks before you ship

```bash
npx tsc -p tsconfig.app.json --noEmit   # NOT bare `tsc --noEmit`
npx vitest run                          # 23 test files
deno check supabase/functions/**/*.ts    # build/vitest never touch these
deno test --allow-env supabase/functions
```

Bare `tsc --noEmit` **checks nothing**: `tsconfig.json` is solution-style with
`"files": []` and only project references, so it type-checks zero files and
exits 0. It looks like a passing check and is not one.

`npm run build` and `vitest` cover `src/` only. Edge functions are never
compiled by either, so a broken function ships green.

## Deploying

**Merging to main does not deploy.** Cloudflare Workers Builds runs on every
PR and reports pass, but it does not ship. Only `npx wrangler deploy` puts code
in front of patrons. A merged PR is not a shipped PR.

Before deploying, in this order:

1. `npx wrangler deployments list --name kenworthy-ticketing-build` — record the
   current Version ID. That is your rollback.
2. Check whether production is *ahead* of main. Other sessions deploy from
   uncommitted trees, and a deploy from main would silently revert their work.
3. A content hash mismatch is often a false alarm — Vite chunk hashes can differ
   with identical code because chunks reference each other's hashes. **Diff the
   content**, don't trust the hash.
4. Build with `build:production`, confirm the change is actually in the output,
   and confirm the bundle carries the production Supabase ref.
5. Deploy, then verify against the live URL — not against the upload log.

A service worker serves the cached app shell, so a browser may show the old
bundle after a correct deploy. Check the origin with `curl` before concluding
the deploy failed.

## Working in this repo

**The main checkout is shared between concurrent sessions.** The branch can
change under you mid-task, and it is routinely far behind `origin/main` — it was
118 commits behind while carrying "modified" files whose content was already on
main.

- Work in your own `git worktree`, branched from `origin/main` after a fetch.
- Never `git add -A`. Stage the files you touched, by name.
- Worktrees do not get the gitignored env files. Copy `.env.staging`,
  `.env.production` and `supabase/.temp/` in, or your build silently loses the
  Supabase URL.
- Never commit a `bun.lock`, `pnpm-lock.yaml` or `yarn.lock`. A stale `bun.lock`
  once took the Cloudflare build off npm and made the PR checks fail on every
  PR, which made a red check stop meaning anything.
- Count check runs on a PR. **Zero checks also reads as `MERGEABLE` / `CLEAN`.**

## Database

- **Blocked writes look like successes.** RLS denials return 204 with no error.
  Any admin write must `.select()` and assert the returned row count.
- **PostgREST silently caps selects at 1000 rows.** No error, no warning. Page
  with `src/lib/fetchAllRows.ts`. This has produced "not linked to X" bugs that
  were really an intact FK the picker never loaded — check the display path
  before auditing data integrity.
- **RLS hides rows from the anon key.** It shows roughly 34 of ~1,789 showings.
  Size any bulk data work from a privileged connection, not from what you can see.
- **Migration filenames collide.** Round-hour timestamps from parallel sessions
  produce the same version prefix, and `db push` then no-ops with no error. Use a
  precise timestamp and verify the migration actually applied.
- `db push` fails when another session's unmerged-but-applied migration is on the
  database. Add the missing file locally; never `migration repair --status reverted`.
- Test a risky migration in a throwaway `postgres:15` container first. Create the
  `anon`, `authenticated` and `service_role` roles before running it.

## Square

**Square writes replace, they do not merge.** A push built from our columns
deletes every field we did not send. This wiped catalog descriptions and images
on 14 Aug 2026, and the damage was invisible in both UIs — timestamps were the
only evidence. Read-modify-write only, and prefer create-only.

A 2xx is not proof of a write. Verify against the Square dashboard or a
re-read, not against the response code.

The catalog has version history: `catalog_version=<epoch ms>` reads it as of any
instant. The Aug 14 damage was recoverable the whole time, four days after a note
recorded it as unrecoverable. See `docs/SQUARE-TRANSACTION-CONVENTIONS.md` and
`docs/INCIDENT-2026-08-14-square-catalog.md`.

## Design constraints

- **Root font size is `112.5%` (18px)**, set once in `src/index.css`. The patron
  base skews older. Tailwind's type *and spacing* scales are both rem-based, so
  this scales the whole UI, not just text.
- **Never size text in `px`.** It blocks browser zoom and OS large-text. There
  are currently zero px font sizes in the app; keep it that way.
- **`text-muted-foreground/60` and below fails WCAG AA** on this background
  (3.61:1). The solid token is fine at 8.12:1. Do not use the faded variants for
  text.
- Brand fonts: Anton for display headings, Fraunces for body.

## Documentation

- `docs/briefs/` — one file per unit of work. Every brief carries frontmatter;
  see `docs/briefs/.frontmatter-schema.md`.
- `docs/TASKS.md` — **generated** by `scripts/generate-tasks.mjs` from that
  frontmatter. Do not hand-edit it; your edit will be overwritten. Hand-maintained
  status lists on this project have drifted every time.
- `FINDINGS-*.md` / `*-OUTCOME.md` — what an investigation established. Write one
  when a session produced understanding that a reader could not reconstruct from
  the diff alone.

When you finish a brief, update its frontmatter `status` and `shipped_by`, then
re-run the generator. A brief that shipped but still reads open is worse than no
brief — it sent a later session to re-implement finished work more than once.
