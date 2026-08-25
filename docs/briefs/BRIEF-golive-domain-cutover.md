---
brief: golive-domain-cutover
title: Cut the live domain over to kenworthy.org
status: in-progress
track: ops
severity: P0
date: 2026-08-18
verified: true
findings: ../RUNBOOK-golive-kenworthy-org.md
---

# Brief (for Claude Code): Go live — cut the domain over to kenworthy.org

**Status:** 🟡 In progress — readiness verified, code prepared, blocked on Cloudflare account access.
**Execution runbook (authoritative from here on): `docs/RUNBOOK-golive-kenworthy-org.md`.** It supersedes the
step order below, which flipped DNS last and would have pointed live ticket links at a WordPress 404.

As of 25 Aug 2026:
- **Decision 1 is moot.** Square line items shipped (`9d5876a`, PR #103) and are **deployed to production** —
  the deployed `ticket-checkout` bundle was downloaded and contains `POST /orders`. No blank-item risk.
- **Decisions 2–4 answered:** old site parked 30 days; apex canonical with `www` 301'd to it; legacy 404s
  accepted at launch and revisited from Search Console after a week.
- **New blocker the brief did not anticipate:** kenworthy.org is not in our Cloudflare account (registrar
  eNom, nameservers at First Step Internet), and a Worker Custom Domain requires it to be. The wrangler
  token cannot create zones. That zone also carries the theatre's Google Workspace MX and three DKIM
  records — see the runbook's zone inventory before anyone touches it.
**Date:** August 18, 2026
**Requested by:** Tom — switch the live domain to **kenworthy.org** today. Accepts that links to the current dev/Worker domain may temporarily break.
**Project refs:** production Supabase = `vlmslygnimfbamrtwvyo`; prod Worker = `kenworthy-ticketing-build` (`…workers.dev`). kenworthy.org currently points at the **old WordPress + Square** site — this cutover repoints it to the new build.

## Read first — the launch-critical dependency
kenworthy.org today is the theatre's live ticketing (old WordPress→Square). After this cutover, **the new build becomes the live ticketing.** So before flipping DNS, confirm:

> **Does `ticket-checkout` register catalogued Square line items yet (`BRIEF-square-line-items.md`)?**
> - **If NO:** the build still posts a **bare `/payments`**, so every online sale on kenworthy.org will show in Square as a **blank/unnamed item** — the exact problem that forced the portal down on Aug 14. Going live without this **re-creates that fire on the real domain.** Either ship the line-items work (or at least the ad-hoc named-line-item minimal fix) **before** cutover, or make an explicit, eyes-open decision to launch with blank-item sales and fix immediately after (**Decision 1** — not recommended).

Everything else below is mechanical; this is the one that decides whether launch is safe.

## Pre-cutover readiness (verify, don't assume)
- **Money paths tested on prod:** a real card ticket purchase, a film-pass purchase, and a donation each complete and land correctly in Square (dashboard-verified, not just a 2xx).
- **Auth email works on prod:** the Send Email hook → `send-auth-email` → Resend is live (a prod password reset arrives). (Staging fix was `BRIEF-staging-auth-email-hook.md`; confirm prod has it.)
- **Backups:** fresh Square catalog export + a DB snapshot taken immediately before cutover (rollback point).
- **Lower DNS TTL** on kenworthy.org to 5 min a few hours ahead, so a rollback propagates fast.

## Cutover steps
1. **Frontend build with the real domain.** `.env.production`: `VITE_SITE_URL="https://kenworthy.org"` (today it's the Worker URL; `src/lib/site.ts` bakes this into SEO/OG/canonical, robots, sitemap, `%SITE_URL%` in `index.html`). `npm run build:production` → verify `kenworthy.org` is baked into `dist` and the prod Supabase ref is present → `npx wrangler deploy` (per `RUNBOOK-deploy-staging-prod.md`).
2. **Edge-function `SITE_URL` secret.** `npx supabase secrets set SITE_URL="https://kenworthy.org" --project-ref vlmslygnimfbamrtwvyo`, then redeploy the functions that build links (ticket confirmations, auth emails, campaign/contract links) so emails/SMS point at kenworthy.org.
3. **Supabase Auth config (or password reset/magic links break).** Set **Site URL = https://kenworthy.org**, and add to the **Redirect URLs allowlist**: `https://kenworthy.org/*`, `https://www.kenworthy.org/*`, **and keep the `…workers.dev/*` entry** so old links still resolve.
4. **DNS — the actual switch.** Add **kenworthy.org** (and **www**) as a **Custom Domain on the prod Worker** in Cloudflare (TLS auto-provisions), and repoint the apex/www records from the old WordPress host to it. Decide apex-vs-www canonical and 301 one to the other (**Decision 3**). **Keep the `…workers.dev` domain live** — do not retire it.
5. **Resend sending domain.** Confirm kenworthy.org is a **verified** Resend domain (SPF/DKIM) so transactional mail keeps sending (it already sends from `tickets@kenworthy.org`, so likely fine — verify, don't assume).
6. **Integrations that are NOT origin-tied (confirm, no action expected):** QBO OAuth redirect uses the **Supabase functions host**, not the site domain (`qbo-sync` builds `…supabase.co/functions/v1/qbo-sync?action=oauth_callback`); Mailchimp/Square webhooks are function URLs. These survive the domain switch untouched — just confirm.

## About the "temporarily broken" links (expected, mostly benign)
- **Already-emailed QR tickets and `/t/:token` links** point at the `…workers.dev` domain. **They keep working** because the Worker (and its domain) stay live — cutover is *additive*, not a move. This is why step 4 says keep the workers.dev domain.
- What genuinely goes away is the **old WordPress site** and its internal links/bookmarks once DNS moves. Anything the theatre published pointing at old WordPress URLs will 404 unless mapped. Optionally add 301s for the handful of high-traffic old paths (**Decision 4**).
- New links, SEO/canonical, and outgoing emails switch to kenworthy.org immediately (steps 1–2).

## Post-cutover verification (within minutes of the flip)
- `https://kenworthy.org` serves the new build over valid HTTPS; `www` resolves/redirects per Decision 3.
- A **real ticket purchase on kenworthy.org completes and shows correctly in Square** (named line item if line-items shipped; watch Item Sales for blank items either way).
- A password reset requested from kenworthy.org arrives with a **kenworthy.org** link that completes.
- An existing `…workers.dev` ticket link still resolves (additive cutover confirmed).
- PWA updates cleanly (autoUpdate); no stale cache serving the old origin.
- SEO: canonical/OG show kenworthy.org; submit the sitemap to Search Console.

## Rollback
DNS TTL is low (pre-step), the **old WordPress site is left intact**, and the pre-cutover backups exist. If the new build misbehaves, repoint kenworthy.org back to the old host; it propagates within the TTL. **Don't decommission the old site or the workers.dev domain until launch is confirmed stable** (Decision 2: how long to keep the old site as fallback).

## Decisions for Tom
1. **Square line items before launch** (strongly recommended) vs launch accepting blank-item sales and fixing immediately after.
2. **Old-site fallback window:** keep the old WordPress site parked how long after cutover?
3. **Canonical host:** apex `kenworthy.org` (recommended) vs `www`, and 301 the other.
4. **Old-URL 301s:** map the top old WordPress paths, or accept 404s on legacy links?

## Test plan (acceptance)
- kenworthy.org live over HTTPS on the new build; www handled; workers.dev still serving.
- Ticket / film-pass / donation each purchasable on kenworthy.org and correct in Square.
- Auth emails + ticket confirmations arrive with kenworthy.org links.
- Existing workers.dev ticket links still resolve; QBO/webhooks unaffected.
- Rollback rehearsed mentally: TTL low, old site parked, backups in hand.
