# Kenworthy Ticketing

Ticketing, film passes, concessions, and box-office tooling for the
[Kenworthy Performing Arts Centre](https://kenworthy.org) in Moscow, Idaho.

React + Vite frontend on Cloudflare Workers, Supabase (Postgres + Edge
Functions) for data and backend logic, Square for payments.

| Environment | URL |
|---|---|
| Production | https://kenworthy-ticketing-build.mrtomfrank.workers.dev |
| Staging | https://kenworthy-ticketing-staging.mrtomfrank.workers.dev |

## Local development

Requires npm and Node.js `^20.19` or `>=22.12` (Vite 8's floor) —
[install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone https://github.com/Tom-Frank-LLC/kenworthy-ticketing-build.git
cd kenworthy-ticketing-build
npm install
npm run dev -- --mode staging
```

The `--mode staging` matters: it loads `.env.staging` so you develop against the
staging Supabase project. These env files are gitignored and are not in a fresh
clone — see [`docs/PLATFORM.md` §3](docs/PLATFORM.md) for what they contain and
where the values come from.

```sh
npm run lint     # eslint
npm test         # vitest
```

## Deploying

**Read [`docs/PLATFORM.md` §4](docs/PLATFORM.md) before deploying.** The short
version:

```sh
# staging
npm run build:staging && npx wrangler deploy --env staging

# production
npm run build:production && npx wrangler deploy
```

> Never deploy a bare `npm run build` — with no `--mode` it reads the default
> `.env` and bakes in the wrong Supabase project. The `VITE_*` variables are
> compiled into the bundle at build time; the Worker holds none of them.

## Documentation

| Document | Covers |
|---|---|
| [`docs/PLATFORM.md`](docs/PLATFORM.md) | Operations & handoff guide — accounts, env vars, deploys, database |
| [`docs/TASKS.md`](docs/TASKS.md) | Live issue list, launch blockers, refactor log |
| [`docs/SQUARE-PAYMENTS.md`](docs/SQUARE-PAYMENTS.md) | Payment flows, Square secrets, sandbox → production |
| [`docs/TICKET-DELIVERY.md`](docs/TICKET-DELIVERY.md) | Confirmation email/SMS, QR ticket page, edge-function runbook |
| [`docs/briefs/`](docs/briefs) | Per-feature work briefs |

## Tech stack

Vite · TypeScript · React · shadcn/ui · Tailwind CSS · Supabase · Cloudflare
Workers · Square
