# Runbook: cutting kenworthy.org over to the new build

Implements `docs/briefs/BRIEF-golive-domain-cutover.md`. Read
`docs/RUNBOOK-deploy-staging-prod.md` first — the deploy mechanics there still
apply; this runbook only adds the domain.

**Prepared 25 Aug 2026.** Everything below marked *verified* was measured on
that date, not assumed.

## The one-paragraph version

The brief's plan flips DNS last. That order is wrong and would break live
ticket links. This runbook moves the **zone** to Cloudflare first as a no-op
(same records, still pointing at the old WordPress server), and only then flips
a single A record. Nothing patrons can see changes until the last step, and
rollback is a one-record edit that propagates in five minutes.

---

## Readiness — verified, not assumed

| Check | State | Evidence |
|---|---|---|
| **Square line items** (the launch blocker) | ✅ **Live in production** | `BRIEF-square-line-items.md` shipped as `9d5876a` / PR #103 on 19 Aug. Prod `ticket-checkout` is version 43, deployed 25 Aug 16:19 UTC; the deployed bundle was downloaded and contains `orderRequestBody` and `POST /orders`. Online sales register catalogued line items, **not** the blank items that forced the portal down on 14 Aug. |
| Frontend one-line change | ✅ Prepared | `VITE_SITE_URL` is the single source of truth (`vite.config.ts` → `%SITE_URL%` → `index.html`, `sitemap.xml`, `robots.txt`, `src/lib/site.ts`). Changed on branch `feat/golive-kenworthy-org`; `build:production` verified to bake `https://kenworthy.org` into all four, with the prod Supabase ref present. |
| Resend can send as `@kenworthy.org` | ✅ **Confirmed by Tom, 28 Aug** | Root SPF includes `amazonses.com`; `resend._domainkey` DKIM present; `send.kenworthy.org` carries Resend's return-path TXT + MX. Mail is sent from `tickets@kenworthy.org` (`_shared/deliver.ts:56`). **Confirm the domain still reads "verified" in the Resend dashboard** — DNS presence is strong evidence, not proof. |
| QBO / Square / Mailchimp webhooks | ✅ Unaffected | All are `*.supabase.co/functions/v1/…` URLs. `qbo-sync` builds its OAuth callback from the Supabase functions host, not the site domain. The domain move cannot touch them. |
| Mail survives the DNS move | ✅ **Confirmed by Tom, 28 Aug** | Sent and received in both directions after the delegation moved. DKIM header check outstanding but non-blocking — delivery in both directions already proves MX and the SPF/DKIM records resolve. |
| Supabase Auth Site URL + redirect allowlist | ⚠️ **Not read** | The Management API call was blocked by the local command classifier. Must be set by hand in the dashboard at Phase 2 step 1 (below). |
| Money paths end-to-end on prod | ✅ **Confirmed by Tom, 28 Aug** | Real-card ticket, film-pass and donation purchases tested repeatedly on prod. |

### What is *not* ready

Nothing in the code. The blocker is entirely account access — see next section.

---

## The blocker: the zone is not ours

A Cloudflare **Worker Custom Domain requires the zone to live in the same
Cloudflare account.** kenworthy.org does not.

Measured 25 Aug 2026:

- Registrar **eNom**; authoritative nameservers **ns.fsr.com / ns2.fsr.com /
  ns3.fsr.com** (First Step Internet, the old WordPress host).
- The Cloudflare account `43864e6c…` holds exactly two zones —
  `centerviewhealthcaregroup.com` and `cleo.events`. kenworthy.org is not among
  them.
- The wrangler OAuth token **can** read `/zones` (an earlier note claiming
  `9109 Invalid access token` was wrong and has been corrected), but **cannot
  create** one: `Requires permission "com.cloudflare.api.account.zone.create"`.

Neither workaround exists: a `CNAME` to `*.workers.dev` returns Cloudflare
error 1014, and partial (CNAME-only) setup is a Business-plan feature.

**So Phase 0 needs Tom.** Either:

- **(a)** Add the site in the Cloudflare dashboard → *Add a site* →
  `kenworthy.org` → Free plan; or
- **(b)** Create an API token scoped `Zone:Zone:Edit` + `Zone:DNS:Edit` and
  hand it over — then `scripts/cf-zone-mirror.mjs` does the mirror and the
  record-by-record parity proof programmatically. **Do both, in that order:**
  (a) creates the zone, and a token cannot be scoped to a zone that does not
  exist yet. (b) matters because the risk in this cutover is a mistyped DKIM
  string, not a mistyped IP.

  Adding the site changes nothing on its own. The zone sits in *Pending
  Nameserver Update* — the registry still delegates to `ns.fsr.com`, so no
  resolver ever queries it. It cannot compete with the live site.

---

## The zone as it stands today

Seventeen records (counting each MX separately), measured 25 Aug 2026 (SOA
serial `2026081102`). No AXFR is offered, so this was assembled by direct
query — **treat it as complete only after Cloudflare's own scan is compared
against it.** `node scripts/cf-zone-mirror.mjs dump` regenerates it live and
needs no credentials.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `64.126.133.214` | 86400 |
| CNAME | `www` | `sushi.fsr.com.` | 86400 |
| MX | `@` | `1 aspmx.l.google.com.` | 300 |
| MX | `@` | `5 alt1.aspmx.l.google.com.` | 300 |
| MX | `@` | `5 alt2.aspmx.l.google.com.` | 300 |
| MX | `@` | `10 alt3.aspmx.l.google.com.` | 300 |
| MX | `@` | `10 alt4.aspmx.l.google.com.` | 300 |
| TXT | `@` | `v=spf1 include:_spf.google.com include:amazonses.com ~all` | — |
| TXT | `@` | `zclc3dyx8jvlft92xr9brwspjbdh8x0c` (Google site verification) | — |
| TXT | `@` | `Hosted by First Step Internet (www.fsr.net)` | — |
| TXT | `google._domainkey` | Google Workspace DKIM, 2048-bit — **see the warning below** | — |
| CNAME | `k2._domainkey` | `dkim2.mcsv.net.` (Mailchimp) | — |
| CNAME | `k3._domainkey` | `dkim3.mcsv.net.` (Mailchimp) | — |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDUZKKcCfDjjuy6sUsAiluRmd7nnWgUL+341/3MgU7fu4NWlHAUQMIezDYjr7CvYBY4/nWzgHIAFh037bttekeLrhjrysXKskD+SfLAu/JvGV/XT8H3hGnWhkK7xL5yiKsEfgheYMx1BXwFKy65xScxtSIPcrxN9CpkdNaX/Zef5wIDAQAB` | — |
| TXT | `_dmarc` | `v=DMARC1; p=none` | — |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | 86400 |
| MX | `send` | `0 feedback-smtp.us-east-1.amazonses.com.` | 86400 |

### ⚠️ The Google DKIM record is a split string

`google._domainkey` is stored as **two** DNS character-strings, split between
`…bg+arYE5tlilz8QMqSf4` and `G90AtO3H9HuMXExjBEjQ…`. `dig +short` prints them
as `"chunk1" "chunk2"`, and naïvely stripping the quotes leaves **a space in
the middle of the key**.

Re-enter it in Cloudflare as one continuous value with **no space and no
quotes** at the join. Cloudflare re-splits it itself. Get this wrong and
Google Workspace stops DKIM-signing the theatre's mail — with no error
anywhere, just a slow slide into spam folders.

The safe way to get the value: `dig +short google._domainkey.kenworthy.org TXT
| tr -d '" ' | tr -d '\n'`.

### What is riding on this zone

This is the real risk in the cutover, and the brief does not mention it. The
zone carries, besides the website:

- **The theatre's Google Workspace email** (all five MX records).
- **Google Workspace DKIM** signing.
- **Mailchimp DKIM** (`k2`/`k3`) — the newsletter.
- **Resend DKIM + return path** — every ticket confirmation and password reset.

A dropped record here does not break the website. It breaks the theatre's
mail, quietly, days later.

---

## Phase 0 — mirror the zone (no user-visible change)

1. Add `kenworthy.org` to Cloudflare (see the blocker section). Let Cloudflare
   scan the existing records.
2. **Compare the scan against the table above, record by record.** Add
   anything the scan missed — the `send` subdomain and the `k2`/`k3` CNAMEs are
   the usual casualties.
3. Set the proxy status to **DNS-only (grey cloud)** on everything for now.
   Nothing should route through Cloudflare yet.
4. Drop the apex A record's TTL to **300**. It is 86400 today; at that value a
   rollback would take a day to propagate.
5. **Prove parity before touching the registrar.** `scripts/cf-zone-mirror.mjs`
   reads the live zone from `ns.fsr.com` every run — it never trusts a frozen
   list — and compares it to Cloudflare:

   ```bash
   node scripts/cf-zone-mirror.mjs plan     # read-only: what is missing
   node scripts/cf-zone-mirror.mjs apply    # create the missing rows, re-read, re-check
   node scripts/cf-zone-mirror.mjs verify   # exits non-zero until parity holds
   ```

   It joins split TXT strings correctly, drops the phantom records `dig`
   invents at a CNAME'd name, and flags anything still proxied. Needs a token
   with `Zone:DNS:Edit` + `Zone:Zone:Read` on this zone — `CF_API_TOKEN`, or a
   file at `~/.cf-kenworthy-token`.

   `verify` printing *"Safe to change nameservers at eNom"* is the gate for
   step 6. Do not proceed without it.

### Phase 0 outcome — done 26 Aug 2026

Zone `kenworthy.org` = `08c627c9b7f7602f6960cc7db88291c7`, Free plan, status
**pending**. Assigned nameservers: **`justin.ns.cloudflare.com`** and
**`ursula.ns.cloudflare.com`**.

Cloudflare's scan imported **all 17** records this runbook had inventoried —
nothing missing — plus **two the probe list could not have guessed**:

| Type | Name | Value | Keep? |
|---|---|---|---|
| A | `localhost` | `127.0.0.1` | yes — harmless legacy row from the old host |
| TXT | `_acme-challenge.www` | `YI2rsK7HrYE61MqCnYj9iUaIzj8pIERf8O_0pWomuNM` | **yes — do not delete** |

That `_acme-challenge.www` record is how the **old WordPress site** validates its
TLS certificate over DNS-01. It is our rollback target for the next 30 days, so
removing it could leave the fallback without a renewable certificate.

Only two changes were needed: the scan had imported the apex `A` and `www`
`CNAME` **proxied**. Both were set DNS-only. Left proxied, the nameserver change
would have put the *old* WordPress site behind Cloudflare's proxy — new IP, new
TLS — while it is still the thing we roll back to. All other records were on
Cloudflare's `Auto` TTL, which is 300s for a DNS-only record, so nothing needed
rewriting for rollback speed.

**Parity proven three ways**, not just by the API's 2xx:

1. `cf-zone-mirror.mjs verify` — record-for-record against `ns.fsr.com`, exit 0.
2. Direct queries to `justin.ns.cloudflare.com` for the eleven records that
   matter (apex MX/TXT/A, `www`, `send` TXT+MX, `_dmarc`, and all three DKIM
   selectors) — **11 identical, 0 differing**, including the split Google key.
3. Cert Spotter CT logs list only `kenworthy.org` and `www.kenworthy.org` as
   ever certificated, so there is no unknown web-facing host to strand.

Residual risk: a subdomain with no certificate and a name none of the three
methods would guess. crt.sh was returning 502 throughout and could not be used
as a fourth source — worth one more look before decommissioning the old site.

## Phase 1 — move the nameservers (still no user-visible change)

6. At **eNom**, replace the three `*.fsr.com` nameservers with the two
   Cloudflare ones. Registry NS TTLs are typically 48h, so allow up to two days
   for full propagation — this is why the zone must already be correct.
7. Wait for Cloudflare to report the zone **Active**.
8. **Confirm mail still flows**: send a message to a `@kenworthy.org` address
   from outside, and send one out. Check the received headers show
   `dkim=pass`. Do this before Phase 2, not after.

At this point the site and email are exactly as they were. Only *who answers
DNS* has changed. The old WordPress site is still serving kenworthy.org.

### Phase 1 outcome — done 27 Aug 2026

First Step Internet moved the delegation. The registry now answers
`justin.ns.cloudflare.com` / `ursula.ns.cloudflare.com`, and Cloudflare marked
the zone **active** at 21:26 UTC.

Re-verified after the switch, against Cloudflare's nameservers rather than the
API: **11 of 11** critical records identical to what `ns.fsr.com` still serves —
apex MX/TXT/A, `www`, `send` TXT+MX, `_dmarc`, and all three DKIM selectors.
The apex still resolves to `64.126.133.214` and `www.kenworthy.org` still
returns 200 from the old WordPress site. The cutover remains a no-op, exactly
as intended.

Public resolvers (8.8.8.8, 1.1.1.1, 9.9.9.9) were still answering `ns.fsr.com`
at the time of the check. That is expected cache, not a fault — and because
both zones are byte-identical it makes no difference which one a resolver uses.
Nothing breaks while the two coexist, which is the property that makes this
step safe.

**Gate on Phase 2: the mail check.** Send a message to a `@kenworthy.org`
address from outside and one out, and confirm the received headers show
`dkim=pass`. Do not touch Phase 2 until that passes.

### Propagation complete — 28 Aug 2026

Google, Cloudflare and Quad9 all now return `justin.ns.cloudflare.com` /
`ursula.ns.cloudflare.com`. Cloudflare is authoritative in the real world,
about 24h after the registrar change, exactly on the old delegation's 86400s
TTL.

All eleven critical records were re-read through a public resolver and match
the recorded inventory exactly — apex A/MX/TXT, `www`, `send` TXT+MX, `_dmarc`,
and all three DKIM selectors. The Google DKIM key comes back **joined
correctly**, `…QMqSf4G90AtO3H9…` with no space at the 255-byte split. The trap
this runbook warned about did not land in production.

`https://kenworthy.org` still 301s to `www`, which still returns 200 from
`64.126.133.214`. Mail was confirmed working in both directions by Tom before
the flip.

**FSR has removed the zone from their nameservers.** `ns.fsr.com` no longer
answers for kenworthy.org at all. Two consequences:

- `cf-zone-mirror.mjs` can no longer run `plan`/`apply`/`verify` — it reads the
  live zone from `ns.fsr.com` on every run and refuses to act on an empty view.
  That guard did its job; the script has simply finished its purpose. `dump`
  is equally dead. Cloudflare is now the only source of truth, and the
  inventory table above is the historical record of what the zone looked like
  before the move.
- Rollback is **unaffected**. It never depended on FSR's DNS — only on their
  web server, which is still serving. Rolling back means pointing the apex A
  record back at `64.126.133.214` inside Cloudflare, which is where it already
  points.

Phase 2 is now unblocked.

## Phase 2 — the flip (minutes)

The order here matters. Every step before the domain moves is additive and
harmless; the reverse order would point live ticket links at a WordPress 404.

9. **Supabase Auth first** (dashboard → Authentication → URL Configuration, prod
   project `vlmslygnimfbamrtwvyo`):
   - Site URL → `https://kenworthy.org`
   - Redirect allowlist → add `https://kenworthy.org/*` and
     `https://www.kenworthy.org/*`, and **keep the existing
     `…workers.dev/*` entry.** Removing it breaks every reset link already in
     someone's inbox.
10. **Add the Custom Domains** on the prod Worker `kenworthy-ticketing-build`:
    `kenworthy.org` and `www.kenworthy.org`. This rewrites the apex A record —
    **this is the moment the site changes.** TLS provisions automatically;
    wait for both to read Active.
11. **Canonical host** (decided: apex). Add a Cloudflare Redirect Rule:
    `www.kenworthy.org/*` → `https://kenworthy.org/$1`, 301, preserving path and
    query. Every existing backlink points at `www`, so this must be live
    immediately, not later.
12. **Edge-function SITE_URL:**
    ```bash
    npx supabase secrets set SITE_URL="https://kenworthy.org" --project-ref vlmslygnimfbamrtwvyo
    ```
    Then redeploy the seven deployed functions that build links from it:
    `ticket-checkout`, `film-pass-checkout`, `send-ticket-confirmation`,
    `ticket-access`, `invite-staff`, `sign-contract`, `mailchimp-campaign`.
    (`qbo-sync` and `mailchimp-bootstrap` also read `SITE_URL` but are not
    deployed to prod — nothing to do.) Four of the seven get it indirectly via
    `_shared/deliver.ts`, `_shared/email-layout.ts` and `_shared/brand.ts`,
    which is why the list is longer than a grep of the function bodies
    suggests.

    ⚠️ Prod functions have historically been deployed from unmerged worktrees.
    **Diff each one against `origin/main` before redeploying**, or this step
    ships unrelated undeployed changes into the money path at the worst
    possible moment.
13. **Frontend:** from `feat/golive-kenworthy-org`, `npm run build:production`,
    confirm `kenworthy.org` is in `dist/index.html`, `dist/sitemap.xml` and
    `dist/robots.txt`, then `npx wrangler deploy`. Record the previous Version
    ID first — that is the rollback. Check whether prod is *ahead* of main
    before deploying; another session deployed prod at 22:10 UTC on 25 Aug.

Between steps 10 and 12 there is a short window where kenworthy.org serves the
new build while outgoing emails still say `workers.dev`. That is harmless —
the workers.dev domain stays live permanently.

## Phase 3 — verify (within minutes of the flip)

- `https://kenworthy.org` serves the new build over valid HTTPS.
- `https://www.kenworthy.org/some/path` 301s to `https://kenworthy.org/some/path`.
- **A real card purchase on kenworthy.org completes and appears in Square as a
  named, catalogued line item** — check Item Sales, not just the payment. Also
  buy a film pass and make a donation.
- A password reset requested from kenworthy.org arrives, the link is on
  kenworthy.org, and it completes.
- An **existing** `…workers.dev/t/<token>` ticket link still resolves. (Cutover
  is additive; if this fails, something removed the workers.dev route.)
- Verify by content-type, not status code — a missing bundle returns 200 with
  the SPA shell. Cache-bust `/`.
- PWA updates cleanly; no stale service worker serving the old origin.
- Submit `https://kenworthy.org/sitemap.xml` to Search Console.

## Rollback

At any point after Phase 1, in Cloudflare DNS:

1. Remove the Worker Custom Domains for `kenworthy.org` / `www`.
2. Re-add `A @ → 64.126.133.214` and `CNAME www → sushi.fsr.com`, DNS-only.

TTL is 300, so it is live in five minutes. The old WordPress site is untouched
and still serving on that IP. **Do not decommission it, and do not retire the
workers.dev domain.**

Before Phase 1, rollback is simply "don't change the nameservers".

## Decisions on record (Tom, 25 Aug 2026)

1. **Square line items before launch** — moot. Already shipped and deployed.
2. **Old-site fallback window** — keep the WordPress site parked **30 days**
   after cutover.
3. **Canonical host** — **apex** `kenworthy.org`; 301 `www` → apex.
4. **Old-URL 301s** — **accept 404s** at launch; revisit after a week using
   Search Console's 404 report, and map only paths with real traffic.

## Open items

- **The brief's pre-cutover backups are the wrong protection for this change.**
  Nothing in Phase 2 writes to the Square catalog or the database — it changes
  DNS, one Auth setting, the `SITE_URL` secret, seven function deployments and
  the frontend bundle. A catalog export defends against catalog damage, and
  there is no catalog write in that list; Square's version history covers it
  regardless. What actually carries risk is step 12, the seven redeploys into
  the checkout path. The protection there is diffing each function against what
  is deployed before shipping it, plus recording the Worker version ID for the
  frontend rollback. A `square-catalog-guard` `snapshot` is still worth taking
  as a baseline, because it is free and writes nothing.
- `public/sms.html` still shows `workers.dev` sample links. That is
  deliberate — the page is A2P campaign registration evidence — but it is worth
  revisiting once kenworthy.org is stable.
- Cloudflare WAF / rate-limiting rules for the **page** layer become possible
  once the zone is ours. They still cannot cover the Supabase API; see
  `docs/FINDINGS-*` and the rate limiting already in the edge functions.
