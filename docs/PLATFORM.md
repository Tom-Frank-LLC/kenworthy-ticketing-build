# Kenworthy Ticketing Platform — Operations & Handoff Guide

> **Purpose:** This document is the single source of truth for everything needed to operate, maintain, and eventually hand off the Kenworthy ticketing platform. It should be updated every time a new credential, service, or configuration is added. A future owner should be able to reconstruct the full picture from this document alone.

---

## 1. Platform Overview

| Item | Detail |
|---|---|
| **Platform name** | Kenworthy Ticketing |
| **Client** | Kenworthy Performing Arts Centre |
| **Primary contact** | Colin Mannex (Executive Director) — see `CONTACTS.md` (private, not in repo) |
| **Built by** | Tom Frank |
| **Tech stack** | React + Vite, Tailwind CSS, Supabase (Postgres + Edge Functions), Cloudflare **Workers** |
| **Repository** | https://github.com/Tom-Frank-LLC/kenworthy-ticketing-build |
| **Production URL** | https://kenworthy-ticketing-build.mrtomfrank.workers.dev |
| **Staging URL** | https://kenworthy-ticketing-staging.mrtomfrank.workers.dev |

> **Not Cloudflare Pages.** The frontend is a Cloudflare **Worker** serving static
> assets, configured by `wrangler.jsonc` at the repo root. This distinction matters:
> Pages-style dashboard environment variables do not exist here, and the deploy
> command is `wrangler deploy`, not a git-triggered Pages build. See §3 and §4.

---

## 2. Services & Accounts

### 2.1 GitHub
- **Account:** Tom-Frank-LLC (Tom Frank)
- **Repo:** `kenworthy-ticketing-build` (public)
- **Purpose:** Version control and source of truth for all code
- **Branches:** `main` (production), `staging` (integration/testing), plus short-lived `feat/*` and `fix/*` branches
- **Access:** Tom Frank LLC owns the repo. To hand off: transfer the repo to a client org, or add collaborators under Settings → Collaborators.

### 2.2 Supabase

There are **two separate Supabase projects** — one per environment. They have
independent databases, auth users, and edge function secrets. Nothing is shared.

| Environment | Project ref | URL |
|---|---|---|
| **Staging** | `rpqzrpboyhshdrfdwayk` | https://rpqzrpboyhshdrfdwayk.supabase.co |
| **Production** | `vlmslygnimfbamrtwvyo` | https://vlmslygnimfbamrtwvyo.supabase.co |

- **Account:** [Email used to create account — to be filled in]
- **Organization:** Kenworthy Performing Arts Centre *(to be created)*
- **Dashboard:** https://supabase.com/dashboard
- **Purpose:** Database, authentication, and backend logic (Edge Functions)
- **To hand off:** Invite client's email as Organization Owner via Settings → Members, then remove Tom Frank.
- **⚠️ Never commit:** The service role key (distinct from the anon/publishable key). The anon key is safe for client-side use; the service role key has full database access and bypasses row-level security.
- **⚠️ Know which project you're pointed at.** `supabase/config.toml` pins
  `project_id = "vlmslygnimfbamrtwvyo"` (**production**), but that is *not* what the
  CLI uses for a database command — the **link** is, and any previous
  `supabase link` moves it. The two disagree routinely: as of August 13 2026 the
  link points at **staging** while `config.toml` still says production.
  **`--project-ref` is not a universal escape hatch** — only some commands accept
  it. Which is which, and how to check before you push, is in §4.3.

- **⚠️ The link is per-checkout, and a fresh clone has none.** It lives in
  `supabase/.temp/`, which is gitignored (`.gitignore:36`). A new clone or a
  `git worktree` starts unlinked, so a `db push` there fails or — worse — is
  linked to something else entirely. Check it, do not assume it carried over.

### 2.3 Cloudflare Workers
- **Account:** A Tom Frank LLC Cloudflare account (the `*.mrtomfrank.workers.dev` subdomain belongs to it)
- **Dashboard:** https://dash.cloudflare.com
- **Config file:** `wrangler.jsonc` (repo root) — serves the built `./dist` directory, with `not_found_handling: "single-page-application"` so client-side routes resolve
- **Purpose:** Hosts and serves the frontend application

| Environment | Worker name | Wrangler target |
|---|---|---|
| **Production** | `kenworthy-ticketing-build` | `npx wrangler deploy` (top-level config) |
| **Staging** | `kenworthy-ticketing-staging` | `npx wrangler deploy --env staging` |

- **To hand off:** Add the client's email as an Account Member with Admin role via Manage Account → Members, then remove Tom Frank. Alternatively, transfer the Worker to a Cloudflare account the client owns. Either way the `workers.dev` hostnames change with the account, so plan the custom domain (§7) before the transfer if the URLs need to stay stable.
- **Custom domain:** Not configured yet. Planned — see §7.

### 2.4 Square (Payments)
- **Account:** [Theater's existing Square account]
- **Developer console:** https://developer.squareup.com
- **Environment:** Currently **sandbox**. Going live is a secret change, not a code change.
- **Purpose:** Payment processing for tickets, film passes, donations, box-office Terminal, and refunds
- **How the switch works:** a single `SQUARE_ENV` edge-function secret selects both the Square API host and which credential set is read. Missing or misspelled falls back to sandbox, deliberately. Full secret list and the go-live procedure are in `SQUARE-PAYMENTS.md`.
- **⚠️ Square credentials are server-side only.** They live as Supabase edge function secrets, never as `VITE_*` build variables — see §3.
- **To hand off:** The Square developer application should live in the theater's own Square account from the start. Tom Frank works with their credentials.

---

## 3. Environment Variables

There are **two distinct kinds**, and they are set in two different places.

### 3.1 Frontend (`VITE_*`) — baked in at **build time**

These are read from a local dotfile by Vite when the bundle is built, and are
compiled into the JavaScript. **The Cloudflare Worker holds none of them**, so
there is no dashboard where you can change one — changing a value means
rebuilding and redeploying.

| File | Used by | Committed? |
|---|---|---|
| `.env.staging` | `npm run build:staging` (`vite build --mode staging`) | No — gitignored |
| `.env.production` | `npm run build:production` (`vite build --mode production`) | No — gitignored |

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase dashboard → Project Settings → API (that environment's project) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard → Project Settings → API (anon/publishable key) |

> These two are the only `VITE_*` variables the application code actually reads
> (`src/integrations/supabase/client.ts`, `src/lib/tickets.ts`,
> `src/components/admin/labor/PayrollExport.tsx`). The env files also carry
> `VITE_SUPABASE_PROJECT_ID` and unprefixed `SUPABASE_*` copies, which are
> inert for the frontend build.

> **⚠️ Never deploy a plain `npm run build`.** With no `--mode`, Vite reads the
> default `.env`, which points at a retired project. Always
> `npm run build:staging` or `npm run build:production`.

> **Restoring these files:** they are gitignored, so a fresh clone has neither.
> Recreate each with the two variables above, taken from the corresponding
> Supabase project's API settings.

### 3.2 Backend — Supabase **edge function secrets**

Everything that must stay private (Square, Resend, Twilio, Mailchimp, QuickBooks,
Little Green Light, the service role key) is a secret on the Supabase project,
set per environment:

```bash
npx supabase secrets set NAME=value --project-ref <staging-or-production-ref>
```

Because staging and production are separate projects, **secrets must be set
twice** — once on each. Setting a secret does not require a redeploy, but a
function that read a missing secret at boot may need one.

| Group | Secrets | Documented in |
|---|---|---|
| Square | `SQUARE_ENV`, `SQUARE_{SANDBOX,PRODUCTION}_{APPLICATION_ID,ACCESS_TOKEN,LOCATION_ID}` (unprefixed names also accepted as a fallback) | `SQUARE-PAYMENTS.md` |
| Ticket delivery | `RESEND_API_KEY`, `SITE_URL`, `TICKET_FROM_EMAIL`, `TICKET_REPLY_TO`, `TWILIO_*` | `TICKET-DELIVERY.md` |
| Auth email | `SEND_EMAIL_HOOK_SECRET` | `TICKET-DELIVERY.md` |
| Marketing / finance | `MAILCHIMP_*`, `QBO_*`, `LGL_API_KEY` | function source in `supabase/functions/` |
| Supabase-provided | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | injected automatically |
| Venue | `VENUE_TIME_ZONE` | function source |

---

## 4. Deployment

Frontend and backend deploy **separately**. A frontend-only change needs nothing
from §4.3.

### 4.1 Branch strategy

| Branch | Corresponds to | Purpose |
|---|---|---|
| `main` | Production Worker + production Supabase | What the public sees. Only merge here when staging is verified. |
| `staging` | Staging Worker + staging Supabase | Testing ground. All development work goes here first. |

### 4.2 Frontend runbook

```bash
# ---- staging ----
git checkout staging && git merge <feature-branch> && git push origin staging
npm run build:staging && npx wrangler deploy --env staging
#   verify: https://kenworthy-ticketing-staging.mrtomfrank.workers.dev

# ---- production (only after staging is verified) ----
git checkout main && git merge staging && git push origin main
npm run build:production && npx wrangler deploy
#   verify: https://kenworthy-ticketing-build.mrtomfrank.workers.dev
```

Before pushing: `npm run lint` and `npm test` should pass, and the build for the
target environment must complete clean.

> **Answered, 2026-08-18: Workers Builds is connected, and it does not deploy.**
> The Worker *is* connected to the repo — that is why two `Workers Builds:` checks
> run on every PR — but the build's deploy step does not ship: neither a PR nor a
> push to `main` deployed the **production** worker. **`wrangler deploy` is the
> only thing that puts code in front of a patron.**
>
> Scope of the measurement, so nobody over-reads it: this was measured on the
> *production* worker only. The staging worker is configured the same way and is
> assumed to behave the same, but that was not tested — staging was being
> deployed by hand throughout, which would have masked an automatic deploy. If it
> matters, measure it the same way on the next merge.
>
> Measured rather than read off a settings page: PR #91 was squash-merged to
> `main` at 23:12:55Z with both checks green, and the production worker stayed on
> version `71281430-6b0e-4dd5-a7d1-c9220b251f6a` — deployed by hand at 22:40:23Z,
> *before* the merge — for at least six minutes afterwards, at 100% of traffic.
>
> The practical consequence, worth saying plainly because it has bitten before: a
> **merged PR is not a shipped PR**, and `main` is not what the box office is
> running. See `RUNBOOK-deploy-staging-prod.md` → "Deploy-on-push" for how to
> re-measure this if the Cloudflare build settings are ever changed.

### 4.3 Backend runbook (Supabase)

Migrations and edge functions are deployed with the Supabase CLI — but **they do
not target a project the same way**, which is the trap in this section.

**Only some commands take `--project-ref`.** Verified against CLI **2.113.0**;
re-check with `--help` if the CLI has moved, because this changes between
versions:

| Command | Targets a project with | Takes `--project-ref`? |
|---|---|---|
| `functions deploy` | `--project-ref <ref>` | ✅ yes |
| `db push` | the **link** (`--linked`), or `--db-url` | ❌ no |
| `migration list` | the **link** (`--linked`), or `--db-url` | ❌ no |
| `link` | `--project-ref <ref>` | ✅ yes — this is what *sets* the link |

An earlier version of this runbook said `db push --project-ref <ref>`. That flag
does not exist on `db push`, and the CLI rejects it outright rather than
defaulting to something — so the command fails loudly rather than pushing to the
wrong database. Small mercy, but do not rely on it.

**So: check the link, then push.**

```bash
# 1. Which project am I actually linked to? (the ref, not config.toml)
cat supabase/.temp/project-ref
#    or, listing every project with the linked one flagged:
npx supabase projects list        # look for "linked": true

# 2. Point it at the right one if needed (this is what --project-ref is for)
npx supabase link --project-ref <ref>

# 3. See what would be applied before applying it — always worth the extra call
npx supabase db push --linked --dry-run

# 4. Apply
npx supabase db push --linked

# 5. Edge functions DO take --project-ref, so they need no link at all
npx supabase functions deploy <name> --project-ref <ref>
```

Staging first, production after. Full procedure, including the post-deploy curl
check that catches a dead function, is in `TICKET-DELIVERY.md`.

> **A migration is not the only way the schema moves.** `db push` applies *every*
> pending migration, not just the one you wrote. Step 3's `--dry-run` prints the
> list — read it. If it names files you did not expect, somebody else's work is
> about to ship with yours.

---

## 5. Database

- **Platform:** Supabase (Postgres), one project per environment (§2.2)
- **Schema migrations:** `/supabase/migrations/` in the repo
- **To apply migrations:** `npx supabase db push --linked` — but confirm what "linked" means first, because `db push` takes no `--project-ref`. Full procedure in §4.3.
- **Backups:** Supabase Pro plan includes daily backups. Confirm plan level on the production project before go-live.

### Key tables

The schema is larger than this list; these are the ones an operator meets first.

| Area | Tables |
|---|---|
| People & access | `profiles`, `user_roles`, `admin_audit_log` |
| Programming | `movies`, `showings`, `events`, `concerts`, `venues`, `historical_screenings` |
| Seating & pricing | `seats`, `venue_seats`, `showing_seat_tiers`, `showing_price_tiers`, `production_seat_tiers`, `production_price_tiers` |
| Sales | `tickets`, `film_pass_types`, `user_film_passes`, `film_pass_redemptions`, `donations` |
| Concessions & rentals | `concession_menus`, `concession_items`, `concession_sales`, `dvds`, `dvd_rentals`, `rental_requests` |
| Staff & finance | `labor_settings`, `shift_requests`, `staff_square_links`, `payroll_exports`, `financial_entries`, `chart_of_accounts`, `qbo_connection` |

### Granting admin access to a new staff member
1. Have them sign up via the app at `/auth`
2. Go to the Supabase dashboard for the right project → Table Editor → `user_roles`
3. Insert a row: `user_id` = their UUID (found in Authentication → Users), `role` = `admin`
4. Have them sign out and back in

---

## 6. Known Issues & Technical Debt

**The live list is `TASKS.md`** — it is maintained as work lands and is the
authoritative record of launch blockers, planned refactors, and backlog. Do not
track status here; this section only orients a new owner.

Standing themes as of August 2026:

| Theme | Where it's tracked |
|---|---|
| Square is still on sandbox credentials — the production flip is a secrets change | `SQUARE-PAYMENTS.md`, `TASKS.md` |
| Ticket email/SMS delivery is built and shipped, but needs `RESEND_API_KEY` set (and Twilio decided) to actually send | `TICKET-DELIVERY.md`, `TASKS.md` |
| No custom SMTP on either Supabase project for auth email at volume | `TASKS.md` |
| History page images are Lovable CDN stubs, not real files | `TASKS.md` |
| Seat-booking race condition; tax jurisdiction confirmation; no `staff` role short of full admin | `TASKS.md` |
| `lovable-tagger` dev dependency and hardcoded `*.lovable.app` origins in four edge functions are Lovable residuals | `TASKS.md` |

---

## 7. Go-Live Checklist

- [ ] Square sandbox testing complete — all purchase flows verified
- [ ] Square production secrets set on the **production** Supabase project and `SQUARE_ENV=production` (see `SQUARE-PAYMENTS.md`)
- [ ] `RESEND_API_KEY` + `SITE_URL` set on both Supabase projects; confirmation email verified end to end
- [ ] SMS provider decided (Twilio vs. Mailchimp) and configured, or phone-only purchase disabled
- [ ] Custom SMTP configured for Supabase auth email
- [ ] Custom domain — decide the hostname (`kenworthy.org` or a subdomain), add the Worker route and DNS record, then document it in §2.3
- [x] Cloudflare Workers Builds status confirmed (2026-08-18): builds run on PRs and on `main`, and **neither deploys production** — it ships only by a manual `npx wrangler deploy`. Measured by comparing the production worker's version id across the #91 merge. Staging is assumed to match but was not measured; see `RUNBOOK-deploy-staging-prod.md`, "Deploy-on-push".
- [ ] Production build deployed from `main` with `npm run build:production` (never a bare `npm run build`)
- [ ] Supabase production project confirmed on a paid plan (backups and scale)
- [ ] Tax rate confirmed with client
- [ ] Test/diagnostic purchase data cleaned out of production
- [ ] Admin accounts created for all staff who need them
- [ ] Client trained on admin panel
- [ ] Handoff doc reviewed with the client's designated owner
- [ ] Ownership transferred: Supabase org, Cloudflare account, GitHub repo, Square app
- [ ] Tom Frank removed from Supabase org (or role reduced to Member)

---

## 8. Support & Contacts

| Role | Name | Contact |
|---|---|---|
| Platform builder | Tom Frank | mrtomfrank@gmail.com *(dev phase)* → support@kenworthy.org *(post-handoff)* |
| Client primary contact | Colin Mannex (Executive Director) | See `CONTACTS.md` (private, not in repo) |
| Client technical owner | Colin Mannex *(to be trained on platform ownership)* | See `CONTACTS.md` (private, not in repo) |

---

## 9. Related Documents

| Document | Covers |
|---|---|
| `TASKS.md` | Live issue list, refactor log, launch blockers |
| `SQUARE-PAYMENTS.md` | How money is taken; Square secrets and the sandbox → production flip |
| `TICKET-DELIVERY.md` | Confirmation email/SMS, the QR ticket page, edge-function deploy runbook |
| `CONTACTS.md` | Client contact details (private, not in repo) |
| `briefs/` | Per-feature work briefs, written before implementation |

---

*Last updated: August 12, 2026*
*Maintained by: Tom Frank*
