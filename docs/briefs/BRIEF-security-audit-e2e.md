# Brief (for Claude Code): End-to-end security audit (everything beyond RLS)

**Status: ✅ SHIPPED AND CLOSED — 2026-09-04.** Findings in
`FINDINGS-security-audit-e2e.md`.

**Every finding is closed.** 3 High, 4 Medium, 5 Low, plus the rate-limiting
residual — each re-probed on **both** environments, most recently 2026-09-04
with staging and production returning identical results:

```
H1=401  H2=42501  csp=1  report-only=0  headers=4/4  M1=401
turnstile=403  svg=rejected  rate-limit=42501  verify=200  probe=404
```

All three *Decisions for Tom* are answered:

1. **Rate limiting / captcha** — Turnstile on the rental form, an app-level
   limiter on the three public endpoints, and one Cloudflare rule on `/admin`.
   The Cloudflare half of the original recommendation was wrong and is recorded
   as such: WAF rules need a zone, and could never have reached the Supabase
   endpoints anyway.
2. **CSP strictness** — report-only first, which earned its keep by catching
   seven violations that would have broken the card form, then **enforcing since
   2026-09-03** and confirmed by a real card purchase on kenworthy.org.
3. **Third-party pen test** — scoped, not commissioned. See
   `docs/BRIEF-third-party-pentest-scope.md`. This is the one thing this brief
   could not close from inside the project, and it is deliberately left as a
   decision rather than allowed to lapse.

Four things were found *after* the audit closed, by continuing to look:

* Guest checkout had been failing every returning customer past the 50th account
  — an unpaged `listUsers()` — which surfaced only when a real purchase died on
  the last step.
* Sixteen pricing tests silently stopped testing anything on 1 September, when a
  hardcoded fixture date went into the past.
* The verify link printed on every signed contract had been dead for eleven
  weeks, revoked by a blanket sweep rather than a decision.
* The Turnstile button told people to wait while the page was waiting on them.

None were in scope. All are fixed. That is the argument for the pen test in
item 3: the code review held, and the things around it kept not holding.

**Date:** August 14, 2026
**Requested by:** Tom — a full platform security audit for risks not yet considered, sequenced after the RLS/permissions sweep.

## Gating & scope
- **Prerequisite:** the RLS audit is complete **and its corrective migration is applied** (on staging, then prod). Do not start this until table-level permissions are settled.
- **Out of scope here:** table RLS policies and grants (covered by the RLS brief).
- **In scope:** edge-function authz, payments, tokens/IDOR, auth/session, client-side/XSS, CORS & HTTP headers, storage, injection, secrets, rate-limiting/abuse, dependencies, business-logic, and logging.
- **Where:** review + live probes on **staging**; produce a severity-ranked findings report + corrective PR/migration; re-test to prove fixes.

## Method
Three passes, combined: **(1) automated** (`npm audit`, secret scan, HTTP header check), **(2) manual code review** per domain below, **(3) adversarial live probes** — actually try to break it as an attacker (guess tokens, call public functions unauthenticated, pass someone else's IDs, submit $0/negative/oversized inputs, attempt privilege escalation). A finding isn't real until a probe reproduces it; a fix isn't done until the probe fails.

## 1. Public edge-function surface (`verify_jwt = false`) — highest priority
These three are reachable with **no auth**, so they're the front door:
- **`ticket-access`** — token-gated by `order_token`. Verify: token entropy (random UUID — confirm not sequential/guessable); **IDOR** — a valid token cannot render another order's QR/`.ics`/JSON (it scopes `qr` to the order — re-verify for `ics` and JSON too); PII minimization (it strips `user_id`/`confirmation_*` — re-confirm nothing else leaks); enumeration/rate-limiting on repeated bad tokens; `.ics`/response header injection from field values.
- **`mailchimp-webhook`** — must verify the shared-secret signature (`_shared/webhook.ts`) with a **constant-time** comparison, reject unsigned/replayed calls, and never trust body fields to mutate sensitive rows.
- **`send-auth-email`** — an unauthenticated email sender is dangerous. Confirm it **authenticates the caller** (Supabase Auth-hook secret / signature) so an attacker can't trigger arbitrary or spoofed auth emails (phishing, mail-bombing). If it can't verify the caller, that's a critical finding.

## 2. Authenticated edge functions — "valid JWT ≠ authorized"
Every `verify_jwt = true` function must **also do its own role check** and validate inputs. Audit each (`ticket-checkout`, `film-pass-checkout`, `square-donation/refund/terminal/labor/catalog-sync`, `sign-contract`, `qbo-sync`, `mailchimp-*`, `lgl-sync-donation`, `deliver` callers) for: role gating (staff/admin as appropriate), **IDOR** on IDs passed in the body (can a staff user refund/void/act on *arbitrary or another user's* pass/order/payment?), input validation/limits, and that `service_role` bypasses are intentional and self-gated.

## 3. Payments (Square)
- **Tokenization intact (PCI SAQ A-EP):** the server never receives a PAN — only a single-use `sourceId`. Confirm across all card paths (online, terminal, donation).
- **Server-side price authority:** the client cannot set the charged amount. **Re-verify the launch-readiness findings are fixed** — `redeem_film_pass` previously took a **client-supplied `p_amount`** and had **no pass-ownership check** (drain-any-pass / free-ticket); confirm the deduction is now derived server-side (`redemption_price`) and ownership/staff is enforced. Confirm `$0`/negative amounts can't mint value.
- **Idempotency** keys on every charge/refund (no double-charge on retry/replay).
- **Refund authorization:** staff+ only; cannot refund arbitrary/other orders; refunded tickets can't still scan (launch-readiness scanner finding — re-verify).
- No card data or full Square responses logged.

## 4. Tokens & IDOR (bearer credentials)
Inventory every capability-URL token: `tickets.order_token`, pass `qr_code` (`PASS:<uuid>`), `rental_requests.invite_token` (contract), contract `verify` token. For each: sufficient entropy (random UUID, not sequential), single-purpose (holding one can't reach another resource), and rate-limited against guessing. Confirm `/contract/:token` and `/verify/:id` don't leak PII to an unauthenticated guesser beyond what's intended.

## 5. Auth & session
- **Signup is off server-side** (Supabase "allow new signups" disabled), not just hidden in the UI — verify by hitting `auth.signUp` directly.
- **Roles come from `user_roles` server-side**, never from a client-tamperable JWT claim — verify no policy/function trusts a role embedded in the token.
- **Password-reset** (`resetPasswordForEmail`) rate-limited; reset links single-use/expiring.
- **Admin routes are enforced server-side** (RLS + function role checks). The client route guard is **not** a security boundary — confirm an attacker calling the APIs directly (bypassing the SPA) can't reach admin data/actions.
- JWT expiry/refresh sane; no long-lived tokens.

## 6. Client-side / XSS / secrets
- Grep for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, and untrusted HTML rendering. Any user/admin-entered content (rental **marquee text**, **press excerpts**, DVD/notes, display names) must be escaped where rendered. (Server email builders already `esc()` — good; verify the pages do too.)
- Confirm the client bundle exposes **only** intended-public values (`VITE_SITE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) — **no** service-role key or private secret. (Verified none today; re-check after changes.)

## 7. CORS & HTTP security headers
- CORS is `Access-Control-Allow-Origin: *` on all functions. That's acceptable **only because** auth is via bearer token/JWT, not cookies — confirm no function relies on the Origin for security. Consider tightening to the known origins for defense-in-depth.
- The **Cloudflare Worker serving the SPA has no security headers** today. Add: `Content-Security-Policy` (lock script/style/connect/img/frame sources — allow Square's SDK domains, Supabase, fonts), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and frame-ancestors/`X-Frame-Options` (clickjacking — important for the card form). Test the CSP doesn't break the Square Web Payments iframe or the fonts.

## 8. Storage
- The **`posters` bucket is public** (`public: true`), admin-write — fine for posters. **Confirm nothing sensitive lives in a public bucket** — especially signed **contract PDFs**, any uploaded IDs, or PII. If sign-contract output or similar is stored publicly, that's a leak; move to a private bucket served via signed URLs.
- Upload validation: content-type/size limits, no executable/SVG-with-script, no path traversal in keys.

## 9. Injection
- supabase-js parameterizes, but audit any **raw SQL string-building** in edge functions or `SECURITY DEFINER` functions (search for template-literal SQL / `EXECUTE`), and the new pass-search `ILIKE` (the film-pass admin brief) — parameterize the query, don't interpolate the term.

## 10. Secrets & supply chain
- `.env*` gitignored; **no secret committed** (grep the repo *and git history* for tokens/keys — Square, Resend, Twilio, LGL, service-role). Rotate anything found. (Note: this sandbox's local `.env` holds the retired lbgk creds — confirm it was never committed and those creds are dead.)
- `npm audit` (and review the `lovable-core-prod` mirrored deps in `bun.lock` for integrity); Deno imports pin explicit versions (they do — spot-check).

## 11. Abuse / rate-limiting / DoS
- Public write/compute endpoints — `rental_requests` insert, `ticket-access`, `square-donation`, password reset — have **no app-level rate limiting**. Add Cloudflare rate-limiting (and consider Turnstile/captcha on the public rental form + donation) to blunt spam, enumeration, and cost-driving abuse.

## 12. Business logic (re-verify launch-readiness holes)
Confirm each prior blocker is closed: film-pass deduction/ownership (see §3); **scanner** no longer admits **refunded** or **wrong-date** tickets and the **double-scan race** is closed via the DB check-in RPC; free/$0 and comp flows can't be abused to mint admissions; capacity/overbooking races are guarded; negative/huge quantities rejected.

## 13. Logging
- No PII or secrets in function logs / console; error responses to clients are generic (don't leak stack traces, SQL, or internal IDs); sensitive admin actions land in `admin_audit_log`.

## Deliverables
- **Findings report** — each issue with severity (Critical/High/Medium/Low), a reproducing probe, and the fix. Ranked; Criticals block launch.
- **Corrective PR/migration** closing the Criticals/Highs, with the probes re-run to prove closure.
- A short **residual-risk note** for anything accepted/deferred (with rationale).

## Decisions for Tom
1. **Rate-limiting/captcha** on the public rental form + donation — acceptable UX cost for spam protection, or defer?
2. **CSP strictness** — start in report-only mode to catch breakage, then enforce, or go straight to enforce with a tested policy?
3. Consider a **third-party pen test** for the payment + auth surface before/after launch, given real money and PII are involved.
