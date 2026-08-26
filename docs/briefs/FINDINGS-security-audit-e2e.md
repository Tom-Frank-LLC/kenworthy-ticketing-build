# End-to-end security audit — everything beyond RLS

**Audited:** 2026-08-19 · **Brief:** `BRIEF-security-audit-e2e.md`
**Prerequisite:** the RLS/grants sweep, closed by `43496e8` and applied to both
projects on 2026-08-14. Confirmed before starting.
**Where:** review against `origin/main` (`feebea9`); live probes against
**staging** (`rpqzrpboyhshdrfdwayk`). Two read-only probes were run against
production; nothing was written there.

**Result: 3 High, 4 Medium, 5 Low. No Criticals.** The Highs and the Mediums
that could be fixed in code are closed and re-probed; what remains is listed
under *Residual risk*.

---

## What was wrong, ranked

### H1 · `mailchimp-ecommerce` had no caller check at all — **fixed**

`verify_jwt = true` does not mean authenticated. Supabase's gateway accepts the
**publishable anon key** as a valid bearer, and that key ships in the client
bundle *and* is committed to a public GitHub repository. Every function that is
not meant to be world-callable therefore has to establish its caller itself.

Twenty-one deployed functions were probed with nothing but that public key.
Twenty refused. `mailchimp-ecommerce` ran.

```
$ curl -X POST .../functions/v1/mailchimp-ecommerce \
       -H "apikey: <public anon key>" -H "Authorization: Bearer <same>" \
       -d '{"email":"probe@example.com","order":{...}}'
HTTP 500 {"error":"Store not bootstrapped"}      <- past the auth boundary
```

There was no `getUser()`, no role test, nothing. Reaching `Store not
bootstrapped` means execution got as far as the database lookup that precedes
the writes.

What it would have bought, on a bootstrapped store: arbitrary email addresses
written into the Kenworthy audience as customers with `opt_in_status: true`,
invented orders and revenue in the reports staff read, and products with
attacker-chosen titles that Mailchimp's automations put in front of real
subscribers. Mailchimp has **no sandbox here** — staging and production share
one API key and one audience — so all of it lands on the live list. The
unbounded `order.lines` loop also turned one request into arbitrarily many
outbound Mailchimp calls.

It never fired, for one reason: **neither project has a bootstrapped store**, so
the branch above returned first on both. That is a latch, not a lock — running
`mailchimp-bootstrap` once, an ordinary admin action, would have opened it
silently. Rated High rather than Critical on that basis, and not lower, because
nothing about the arming step looks dangerous.

**Fix.** A caller gate ahead of everything else: service-role (the real callers,
`ticket-checkout` and `square-donation`) or an admin. New shared helper
`_shared/callers.ts` so the next function does not re-invent it, with
constant-time key comparison. `order.lines` capped at 50.

**Re-probe:** `HTTP 401 {"error":"Unauthorized"}`.

---

### H2 · The door admitted a ticket for any screening, and consumed it — **fixed**

`check_in_ticket` took a QR code and nothing else. Confirmed live on staging
before the fix: the deployed function accepted exactly one parameter, so no
showing-scoping existed to have been misread. It checked `confirmed` and
unscanned, stamped `scanned_at`, and answered `valid`. Which screening the
ticket was *for* never entered into it, and `TicketScanner.tsx` rendered that as
"Ticket validated — enjoy the show!"

Two consequences, the second worse than the first:

1. **Admission control cost the price of the cheapest seat on the calendar.**
   Buy an $8 matinee ticket for any date, present it at a sold-out event, scan
   green.
2. **A patron on the wrong night had their ticket destroyed.** It came back
   `scanned_at`-stamped, so on the right night it read `already_scanned` and
   they were turned away from a show they had paid for — with the audit trail
   agreeing they had already come in.

The second is why this was fixed at the door and not in the UI: a client-side
comparison stops the operator being misled, but the row is already written by
the time the client sees an answer.

**Fix.** `check_in_ticket(p_qr_code, p_showing_id DEFAULT NULL)`. A mismatch
returns a new `wrong_showing` verdict **without claiming the ticket**, carrying
the title and showtime so staff can say which night it is for. NULL keeps the
old unscoped behaviour, so an un-updated caller is not broken. The scanner
passes the screening it already tracks.

**Verified against a real Postgres** (throwaway container, stub schema, the
pre-migration function installed first so it ran as an upgrade). Seven
behaviours, all as intended:

| probe | verdict | ticket |
| --- | --- | --- |
| right showing | `valid` | stamped |
| **wrong showing** | **`wrong_showing`** | **survived, unstamped** |
| wrong showing | names "The Third Man" | — |
| patron returns on the right night | `valid` | admitted |
| refunded, right showing | `not_confirmed` | not stamped |
| rescan | `already_scanned` | — |
| no staff role | `forbidden` | — |
| `p_showing_id` omitted | `valid` | old behaviour intact |

Also verified live on staging after `db push`, and covered by two new tests in
`TicketScanner.test.tsx` (24/24 pass).

---

### H3 · The site served no security headers — **fixed**

Both deployments answered with `content-type`, `cache-control` and `server`, and
nothing else. No CSP, no HSTS, no `nosniff`, no framing rule. The checkout page
renders Square's card iframe and was framable by anyone.

**Fix.** `public/_headers`, enforcing immediately: `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin` (ticket links carry the order token in the
query string), `Strict-Transport-Security` for a year, and a `Permissions-Policy`.
Plus a **report-only** CSP, per the decision recorded below.

Two things only a real deploy would have caught, both caught:

* **A split `Permissions-Policy` silently broke the door scanner.** The first
  version set `camera=()` globally and `camera=(self)` under `/admin/*`. That
  reads correctly and does not work — Cloudflare *appends* matching rules rather
  than replacing them, so `/admin/scanner` came back with two headers and the
  browser does not resolve those in favour of the permissive one. One sitewide
  `camera=(self)` instead.
* **Report-only immediately justified itself.** Driving a real checkout with the
  first policy reported seven violations the card form would have suffered under
  enforcement — `card-wrapper.css` blocked by `style-src-elem`, and six typefaces
  from three hosts blocked by `font-src`, including
  `d1g145x70srn7h.cloudfront.net`, which is discoverable only by watching the SDK
  ask for it. Enforcing first would have shipped an unstyled card form in
  fallback fonts on the page where somebody types a card number.

**Re-verified:** all headers live on staging; a full checkout render with the
Square card iframe reports **zero** violations; Google Fonts load; the YouTube
trailer frame loads. The policy is now a candidate for enforcement.

---

### M1 · The public rental form took unlimited unauthenticated writes — **fixed**

Twelve inserts in a row, all `201`, no throttle and nothing to solve. Each row
is a person staff believe is waiting, on a surface they cannot safely ignore.

The RLS policy was good and is kept — it correctly forbids a submitter forging
`signed_at`, `admin_notes` and the Square invoice columns. What a policy cannot
do is count, and there was nowhere to check anything because there was nothing
between the browser and PostgREST.

**Fix.** A new `rental-request` edge function: Turnstile verification, an
**allowlist** of columns rather than a denylist of them, length caps on free
text (`event_description` previously had none), and the write as `service_role`.
The `anon`/`authenticated` INSERT grant is revoked, so the check cannot be
walked around by skipping the page that renders it. The policy is deliberately
left in place — inert without the grant, but it means an accidentally restored
grant brings the column protections back with it, which has happened here before
(`20260810165116`).

**Re-probed:** direct anon insert `201 → 401` (3/3). Forged columns proven
dropped — a submission carrying `admin_notes`, `signed_by_name`,
`signature_serial`, `square_invoice_url` and `status: "approved"` stored all of
them as `null` with `status: "pending"`, while the legitimate fields came
through. The real form, filled in a real browser, still reaches "Thank you".

**Turnstile is staged and not yet armed.** The widget must be created in the
Cloudflare dashboard first — wrangler's OAuth token has no Turnstile scope, so
that is a human step. Until `TURNSTILE_SECRET_KEY` and
`VITE_TURNSTILE_SITE_KEY` are set, both ends skip the check and log loudly. This
is deliberate: refusing every submission until a key exists would take the
rental form offline to close a spam hole. See *Left for you* below.

### M2 · Production runs eleven functions that are not in this repository

Production has 28 deployed functions. Eleven do not exist on `main`:
`invite-staff`, `poster-restore`, `poster-identify`, `square-cash-sale`,
`square-catalog-guard`, `square-catalog-restore`, `square-event-probe`,
`square-event-create-probe`, `square-event-write`, `square-showing-variations`,
`square-variation-restore`. Four that *are* in the repo — `mailchimp-webhook`,
`mailchimp-bootstrap`, `qbo-sync`, `match-historical-screenings` — are deployed
nowhere. `ticket-checkout`, `film-pass-checkout` and `square-donation` are
deployed on production from a **different checkout** (`kw-square-lineitems`, on
an unmerged branch), so the code taking card payments in production is not the
code on `main`.

This is not itself a vulnerability — I read all eleven, and every one does
`getUser()` plus a role check; `invite-staff` in particular is properly gated to
superadmin. It is an **auditability** finding, and it bounds this report: an
audit of a repository is only an audit of production if the two agree, and here
they do not. Three of the eleven are debug probes (`*-probe`) live on the
production project.

Not fixed here — merging and redeploying other sessions' branches is not this
audit's call to make. See *Left for you*.

> **Closed 2026-08-26.** Re-measured against production: **zero** deployed
> functions are absent from the repo. All eleven arrived on `main` as their
> branches merged over the following week, and `ticket-checkout`,
> `film-pass-checkout` and `square-donation` now deploy from `main` like
> everything else.
>
> The gap that remains runs the other way — five functions in the repo are
> deployed nowhere (`mailchimp-bootstrap`, `poster-identify`, `qbo-sync`,
> `square-event-create-probe`, `square-order-probe`) — which is the harmless
> direction: code that is not running cannot be exploited. Two of the five are
> debug probes that arguably should never be deployed. Of the three probes the
> original finding flagged, two are now gone from production; `square-event-probe`
> is still deployed there.
>
> This mattered more than its severity suggested, because it **bounded the whole
> report**: an audit of a repository is only an audit of production if the two
> agree. They now agree. Every finding above can be read as a statement about
> production, which on 2026-08-19 it could not.

### M3 · `mailchimp-webhook` trusted the request body to rewrite account identity — **fixed**

Not deployed on either project, so never exploitable; fixed before it ships.

Authentication is a shared secret in the query string, which is the strongest
thing available (Mailchimp will not sign a body) and weaker than a signature: it
lands in proxy logs and referrers, and with no timestamp a captured request
replays forever. So the credential is treated as one that may leak and the blast
radius is cut to match.

On `type=upemail` it took two addresses out of the body and rewrote
`profiles.email`. That column is not decorative — `invite-staff` resolves an
invitation to an existing account by looking it up there *first*, and
`_shared/buyers.ts` matches a guest buyer to an account the same way — so a
rewrite desynchronises the profile from `auth.users` and leaves both lookups
pointing at the wrong person. Removed; `upemail` now only stops marketing to the
old address. The secret comparison is also now constant-time.

### M4 · The public `posters` bucket accepts any file type

Created public with admin-only writes, which is right, but with no
`allowed_mime_types` and no `file_size_limit`. The only thing between an upload
and the public internet is `file.type.startsWith('image/')` in
`PosterUpload.tsx` — a form validation, skippable by calling
`storage.from('posters').upload()` from the console, and `file.type` is whatever
the client claims anyway.

The specific thing worth refusing is SVG: a document that can carry `<script>`,
in a public bucket, served from the theatre's own Supabase project. It does not
reach the app's origin — tokens live in localStorage on the Worker domain — but
a plausible kenworthy-looking asset URL running the uploader's JavaScript is a
phishing primitive with no upside.

**Fix.** Bucket-level mime allowlist (raster only, no SVG) and a 10 MiB cap;
`concession-menus` restricted to PDF. Applied to staging.

**It recurred within a day, which is the more useful finding.** Between writing
that migration and deploying it, two more public buckets were created —
`festival-programs` (`20260819151204`) and `pass-images` (`20260820094512`) —
both with no `allowed_mime_types` and no `file_size_limit`, both guarded only by
a client-side `accept=""` attribute. Neither author did anything wrong:
`INSERT INTO storage.buckets (id, name, public)` is the shape every previous
bucket used, and the missing columns are the ones nobody knows to add.

Fixing two instances did not fix the pattern. `20260820164402` restates it as a
list of every public bucket with its permitted media, so adding the next one is
a one-line edit in an obvious place, and puts the rule in a
`COMMENT ON TABLE storage.buckets` — which is the row somebody is looking at
when they copy the statement above it.

*Evidence caveat, now closed.* When first written this finding was derived from
the migrations rather than from the live buckets, because reading bucket config
needs credentials this session does not hold. That gap is closed, by a route
that needs no credentials at all: **Supabase Storage checks the mime type before
it checks RLS**, so the two refusals are distinguishable with nothing but the
anon key.

```
POST /storage/v1/object/posters/…        Content-Type: image/svg+xml
  415 invalid_mime_type  "mime type image/svg+xml is not supported"   <- the bucket
POST /storage/v1/object/posters/…        Content-Type: image/png
  403 Unauthorized       "new row violates row-level security policy" <- past the bucket
```

Verified on staging after the migration, across all four:

| bucket | `image/svg+xml` | `image/png` |
| --- | --- | --- |
| `posters` | rejected at bucket | mime accepted → RLS refuses |
| `pass-images` | rejected at bucket | mime accepted → RLS refuses |
| `festival-programs` | rejected at bucket | mime accepted → RLS refuses |
| `concession-menus` | rejected at bucket | rejected at bucket (PDF only) |

Every finding in this report is now reproduced by a probe, with no exceptions.

---

## Low

| # | Finding | Note |
| --- | --- | --- |
| L1 | `/verify/:id` (public contract verification) is **dead**. `get_contract_signature` was revoked from `anon` in `20260617053243`; confirmed live — anon gets `42501 permission denied`. | A functional break with a security-positive side effect. Decide whether the page should work; if so, re-grant deliberately and check what it discloses. |
| L2 | `get_rental_request_by_token` returns `SELECT *`. The caller holds the token, so today it leaks nothing it should not — but any column added later is disclosed automatically. | Name the columns. |
| L3 | `admin_audit_log` triggers cover 9 tables, not including `donations`, `user_film_passes`, `film_pass_redemptions` or `rental_requests`. | Money and admissions are only partly audited. |
| L4 | `npm audit`: 13 high, 4 moderate, 1 low. The one on a production path is `react-router`'s XSS-via-open-redirect; `xlsx` has no fix and is already tracked in `TASKS.md`. The rest are dev-only. | Not fixed here — a router bump is its own change with its own testing. |
| L5 | `authenticatedUser`'s `authHeader.includes(anonKey)` guard misses the legacy anon-key format now that Supabase injects `sb_publishable_`. | Fails safe (falls through to `getUser()`, which returns no user); costs a wasted round trip. |

---

## Verified sound — the parts that were already right

Recorded because "we checked and it holds" is worth as much as a finding, and
because several of these were the brief's explicit re-verifications.

* **`send-auth-email`** — Standard Webhooks signature, constant-time compare,
  5-minute replay window, fails closed on an unset secret. An unsigned POST
  returns `401 Invalid webhook signature`. Not an open relay.
* **`ticket-access`** — the `order_token` is a random UUID; `qr`, `ics` and JSON
  are all scoped to the order the token names; `user_id` and
  `confirmation_sent_at` are stripped; unknown and malformed tokens both return
  the same 404. ICS values are escaped per RFC 5545 including newlines, so no
  calendar-field injection. `.ics` filename is a constant, so no header
  injection.
* **Signups are off server-side on both projects** — `auth.signUp` returns
  `422 signup_disabled`; `/settings` reports `disable_signup: true`,
  `anonymous_users: false`.
* **Payments** — the server never sees a PAN, only a single-use `sourceId`
  (PCI SAQ A-EP holds). Pricing is recomputed from the database in
  `priceTicketOrder`; the client cannot set an amount. Donations are validated
  and kept out of the tax base. Idempotency keys on charges; refund keys derived
  deterministically from payment + ticket ids, so a replay cannot double-refund.
* **Film passes** — the launch-readiness holes are closed. `redeem_film_pass` is
  `service_role`-only; `admit_with_film_pass` derives the deduction from
  `redemption_price` server-side, holds `FOR UPDATE`, and mints the seat before
  deducting so a full house rolls both back.
* **Refunds** — staff-gated, only `confirmed` tickets, sets `refunded`; a
  refunded ticket returns `not_confirmed` at the door.
* **The double-scan race** is closed by the conditional `UPDATE ... WHERE
  scanned_at IS NULL`.
* **No secrets anywhere they should not be.** Git history carries no keys. The
  committed `.env.production` / `.env.staging` hold only URLs and **anon** keys
  — decoded, both are `"role":"anon"`. The built bundle exposes only
  `VITE_SITE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_SQUARE_ENV`, `VITE_MEMBER_ACCOUNTS`.
* **XSS** — the only `dangerouslySetInnerHTML` sites are shadcn's chart styles
  and an Instagram embed fed from a hardcoded empty constant. No user or
  admin-entered content reaches an HTML sink; `marquee_text` renders through
  React escaping.
* **Injection** — no raw SQL string-building in any edge function, and no
  `EXECUTE` on user input in any `SECURITY DEFINER` function. (The pass-search
  `ILIKE` the brief asks about does not exist in the codebase.)
* **Storage** — no PII in a public bucket. Signed contract PDFs are returned as
  base64 and never stored; `concession-menus` is private and staff-gated.
* **Logging** — no PII or secrets in function logs; `send-auth-email` masks the
  recipient. Client-facing errors are generic.
* **`guest-checkout`**, the retired free-ticket printer, is deployed and
  answering `410` on both projects.
* **Twenty of twenty-one authenticated functions** correctly refuse the public
  anon key. `lgl-sync-donation` and `square-invoice` validate the body before
  authorising, which discloses parameter names and nothing else; both return
  `401` once given one.

---

## Residual risk — accepted or deferred

1. ~~**No rate limiting anywhere.**~~ **Closed 2026-08-25, and the original
   recommendation was wrong twice over.** Recorded in full because the reasoning
   is the useful part.

   The finding was right: `ticket-access` took 40 bad tokens with no throttle,
   and `mailchimp-subscribe` could make Mailchimp send a confirmation email to
   any address, repeatedly. The **fix** was wrong.

   *Wrong the first way — there is no zone.* Cloudflare WAF rate limiting
   attaches to a domain you have added to Cloudflare. The Worker is served from
   `*.workers.dev`, which is Cloudflare's zone, not ours; `kenworthy.org`
   resolves to Apache on `64.126.133.214` and is not in the account at all.
   There was nothing to attach a rule to, and the move to kenworthy.org would
   not have changed the part that matters.

   *Wrong the second way — the rules pointed at the wrong hosts.* Three of the
   four proposed rules named Supabase URLs or SPA page routes. `/rental-request`
   and `/donate` are **pages**; throttling them limits people loading HTML while
   the actual write goes to `*.supabase.co` and never enters any zone of ours.
   Those Supabase endpoints do answer with `server: cloudflare` — but that is
   *Supabase's* Cloudflare. I read that header as reassurance; it is not.

   *And one of the endpoints was never unlimited.* `/auth/v1/recover` is capped
   by Supabase's own `rate_limit_email_sent` (~2/hour at the default — see
   `FINDINGS-staging-auth-email-rate-limit.md`). The 14 consecutive `200`s that
   suggested otherwise were nonexistent addresses, which Supabase answers
   without generating a send. It is excluded from the fix rather than
   double-limited.

   **What actually shipped:** `check_rate_limit` plus a `rate_limits` table
   (`20260825143017`), wired into `square-donation`, `ticket-access` and
   `mailchimp-subscribe`. It lives where the request lands, so it is independent
   of where the site is hosted. A per-IP fixed window is a speed bump — it does
   nothing about a distributed attempt — and Turnstile remains the stronger
   control. Cloudflare rules for the *page* layer are in the runbook's cutover
   section, correctly scoped this time.

   Measured, on the real databases: 150 requests at `ticket-access` (limit 120)
   allowed **exactly 120**; 20 at `square-donation` (limit 15) allowed
   **exactly 15**, on production, without reaching Square. Under 20-way
   concurrency in Postgres, 40 claims against a limit of 10 allowed **exactly
   10** — the property a read-then-write would have lost, since PostgREST gives
   every RPC its own transaction.

   `mailchimp-subscribe` was the one I declined to fire myself: its limiter sits
   after body validation, so exercising it writes to the shared production
   Mailchimp audience — one key, one audience, no sandbox. **Tom confirmed it
   live on 2026-08-26.** Recorded because the earlier note said unproven, and an
   unverified claim left standing in a security report is worse than one that
   was never made.
2. **Any staff user can refund any order.** By design: that is a box office.
   Refunds are captured in `admin_audit_log` via the `tickets` trigger.
3. **CORS is `*` on every function.** Acceptable because authorisation is by
   bearer token and never by cookie or Origin — verified: no function reads
   `Origin`. Tightening it is defence in depth, not a fix.
4. **The repository is public.** Every migration, policy and function is
   readable by an attacker. That is a legitimate posture — nothing here relies
   on the code being secret — but it raises the value of everything above.
5. **The audit covers `main`, and production does not run only `main`.** See M2.
6. **Turnstile is staged, not armed.** See M1.

---

## Left for you

1. **Create the Turnstile widget** in the Cloudflare dashboard, then set
   `TURNSTILE_SECRET_KEY` (Supabase function secret) and
   `VITE_TURNSTILE_SITE_KEY` (build env) **together** — one without the other is
   the bad state. Both ends skip the check until they are set.

2. ~~**Add the Cloudflare rate-limiting rules.**~~ **Superseded — the table that
   stood here named the wrong hosts and assumed a zone that does not exist. See
   residual-risk item 1.** App-level limiting shipped instead
   (`20260825143017`); the correctly-scoped page-layer rules are in
   `RUNBOOK-deploy-staging-prod.md` under *Domain cutover to kenworthy.org*, to
   apply once the domain is on Cloudflare.

3. **Graduate the CSP.** Watch staging's console through a checkout, a trailer
   and the scanner. It is already clean for all three; when you are satisfied,
   rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in
   `public/_headers`.

4. ~~**Reconcile production's deployed functions with `main`** (M2).~~ **Mostly
   done, by ordinary merges rather than by anything this audit did.**
   Re-measured 2026-08-26: zero deployed functions are absent from the repo.
   Two of the three debug probes are gone from production —
   **`square-event-probe` is still deployed there.** It is admin-gated like the
   rest, so this is housekeeping rather than exposure, but a debug endpoint on
   the production project is still worth a deliberate decision to keep or
   remove.

5. **Decide whether `/verify/:id` should work** (L1).

---

## Method

Three passes, as the brief specifies.

* **Automated** — `npm audit`; a secret scan across all of git history and the
  built bundle; HTTP header inspection of both deployments.
* **Manual review** — every edge function in the repo plus the eleven only in
  the sibling checkout; every `SECURITY DEFINER` function; the storage buckets;
  every `dangerouslySetInnerHTML` and raw-SQL site.
* **Adversarial probes** — 21 functions called with only the public anon key;
  40 forged ticket tokens; 12 unauthenticated rental inserts; 6 password resets;
  `auth.signUp` against both projects; forged privileged columns on a real
  submission; unsigned webhook posts; live function-signature enumeration
  through PostgREST. The `check_in_ticket` migration was additionally exercised
  in a throwaway Postgres against the pre-migration function.

Nothing was written to production. Every row the probes created on staging —
15 `rental_requests` — was deleted afterwards; verified zero remaining.

A finding is listed only where a probe reproduced it. M4 was the one exception
when this was written; it is no longer — see the mime-before-RLS check under M4.
