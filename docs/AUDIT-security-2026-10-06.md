# Security audit — end to end, 2026-10-06

**Audited:** 2026-10-06 against `origin/main` @ `66e4a70`.
**Requested by:** Tom. Run an end-to-end security audit of the platform.
**Prior audits this builds on:** `docs/briefs/FINDINGS-security-audit-e2e.md`
(2026-08-19, all closed), `FINDINGS-rls-security-audit.md` (2026-08-14),
`FINDINGS-staff-rls-audit.md`. About 65 commits have landed since: the pricing
RPC, discounts, ticket limits, the POS, terminal and cash sale, film-pass batch
and pickup-only, the team roster and Square labor, RSVP and info-only events,
and runtime. This pass re-tested every earlier "fixed" or "verified sound"
claim, because those are claims rather than facts. It then reviewed the new
code in depth.

**Scope and rules (per Tom's decisions in the brief):**
- Static review of code, policies and configuration.
- Dynamic checks against **staging only**, using only the public anon key.
  Every check was read-only or was expected to be refused.
- A migration replay in a throwaway `postgres:15`.
- **No production writes and no production probes.** The one production
  touch was a read-only download of the deployed edge-function source, to
  confirm that production runs `main` (see *Coverage*).
- Nothing was sent to Mailchimp, LGL, Twilio, Resend or QBO.
- No secrets or patron PII are reproduced here.

**Status labels:**
- **Confirmed:** the code path was traced end to end, or a probe or replay
  reproduced it.
- **Plausible:** strong evidence, with one named link unverified.

---

## Executive summary

**Overall posture:** most of the system is sound.

- The structural controls from August still hold, re-tested:
  - Server-side pricing.
  - Staff gates on every staff function.
  - Strict CSP and security headers.
  - Strong order and QR tokens.
  - A limiter that can't be spoofed.
  - No secrets in the bundle or in git history.
  - Clean RLS on PII tables.
  - Production running exactly `main`.
- Two breaks and two pricing/RLS gaps matter:
  - **C1:** a payment-method shortcut that let anyone get tickets free. **Fixed in PR #356, deployed to staging and production on 2026-10-06.**
  - **H1:** an identity assumption ("`authenticated` means staff") that stopped being true.
  - A pricing gap (H2).
  - An RLS regression the August fix missed (M3).

| Severity | Count |
| --- | --- |
| Critical | 1 (fixed and deployed, #356) |
| High | 2 |
| Medium | 11 |
| Low | 19 |

**What matters most:**

1. **C1 — anyone could buy anything for nothing by sending `source_id: "CASH"`.**
   - Live in production from 19 Aug until the fix deploys.
   - It covers tickets, film passes and donations. A donation also triggers a
     real tax receipt and an LGL gift.
   - Fixed in **PR #356**, deployed to both projects on 2026-10-06.
   - Then check production Square for CASH payments that carry an online
     order reference, to learn whether it was ever used.
2. **H1 — any ticket buyer can hold a signed-in session and rewrite their own
   `profiles.email`, which checkout and `invite-staff` trust as identity.**
   - The result is privilege escalation to **admin** through an invite.
   - It also lets an attacker silently capture another patron's future
     tickets and QR codes.
   - Several smaller findings (M1) exist only because "`authenticated` =
     staff", which CLAUDE.md asserts, is false.
3. **H2 — omitting `tier_id` prices a tiered showing at its fallback base
   price,** which the admin form defaults to $8 and allows to be $0.
4. **M2 — the two checkouts have no rate limit or bot check.** They can be
   used for card testing and to book out free showings. Each attempt also
   creates an auth account, which feeds H1.
5. **M3 — film distributor terms (`movies.terms_percent`, `distributor`) are
   anon-readable.** This is the same blanket-grant regression class the
   August RLS fix corrected for one table and missed for this one.

---

## Remediation status (updated 2026-10-06, same day)

Every fix below shipped to **staging and production** the same day. Each one
was verified live after deploy; the cluster briefs (`docs/briefs/BRIEF-sec-*.md`)
hold the evidence and rollback ids.

| Finding | Status | Where |
| --- | --- | --- |
| C1 `source_id: "CASH"` | **Fixed** | #356 |
| H1 `profiles.email` as identity | **Fixed.** Production showed no sign it was ever used. | #360 |
| H2 tier-less ticket at base price | **Fixed.** 3 exposed showings on production, now refused. | #358 |
| M1 "authenticated" treated as staff | **Fixed** for the four named sites. Patron sign-in is blocked at the email hook; the access-token hook is installed but not enabled. A full sweep of every `authenticated` grant has not been done. | #360 |
| M2 checkout bot/rate controls | **Fixed** (Turnstile + limits) | #361 |
| M3 movie terms anon-readable | **Fixed** (plus 3 more column grants found in the sweep) | #362 |
| M4 broad host policies | **Fixed** | #362 |
| M5 sign-in open redirect | **Fixed** (guard, plus react-router 7.18.4) | #359, #365 |
| M6 payroll to staff | **Fixed** | #363 |
| M7 Mailchimp overwrite | **Fixed** | #360 |
| M8 unescaped staff email | **Fixed** | #359 |
| M9 no MFA | **Deferred** to its own brief (Tom, 2026-10-06) | — |
| M10 `audit_bulk_*` grants | **Fixed.** It was not live on either project. | #362 |
| M11 unattributed staff actions | **Fixed** | #363 |
| L1 unverified staff payments | **Fixed** | #363, #366 |
| L2 multi-pass fulfilment | **Fixed** | #358 |
| L3 refund races | **Fixed** | #363 |
| L4 qbo-sync | **Fixed** in code; still not deployed. Set `QBO_STATE_SECRET` and `SITE_URL` before its first deploy. | #366 |
| L5 vulnerable npm deps | **Fixed** (`npm audit --omit=dev` 47 → 0) | #365 |
| L6 floating Deno imports | **Fixed** (exact pins; no lockfile, by choice) | #366 |
| L7 secret scanning off | **Fixed** (GitHub settings; 0 alerts) | — |
| L8 rotation runbook | **Fixed.** Staging's Mailchimp, LGL and Twilio keys were also removed on 2026-10-07. | #366, #367 |
| L9 unverified service-role claim | **Fixed** | #360 |
| L10 internal error text | **Fixed** | #361, #360 |
| L11 debug probes in repo | **Fixed** (moved to `supabase/probes/`) | #366 |
| L12 sign-out fallback | **Fixed** | #359 |
| L13 unchecked stored URLs | **Fixed** (plus DB constraints) | #359 |
| L14 audit-log integrity | **Fixed** | #363 |
| L15 PII in logs | **Fixed** for logs. **Open** for full-row audit snapshots, which need a retention decision. | #363, #360 |
| L16 tribute email text | **Fixed** | #361 |
| L17 rental token `SELECT *` | **Fixed** | #362 |
| L18 listable buckets | **Fixed** | #362 |
| L19 anon reconnaissance | **Fixed.** `has_role` stays anon-executable on purpose, because 17 anon policies need it. | #362 |

**New standing check:** `supabase/tests/anon_surface/`. Run `surface.sql`
read-only against a live project with `supabase db query --linked -f`. It
returns 0 rows on production.

---

## Findings

### C1 · Critical · Confirmed · `source_id: "CASH"` stands in for payment on every public money path — **fixed, #356, deployed 2026-10-06**

**Location:**
- `supabase/functions/_shared/square.ts:194-213`: the `createPayment` cash branch.
- Client value passed through at:
  - `ticket-checkout/index.ts:117,234,483`
  - `film-pass-checkout/index.ts:821,926` (`order` action)
  - `square-donation/index.ts:79,90,223`

**Description:**
- `createPayment` recorded a Square **cash tender** (`cash_details`,
  `autocomplete: true`) whenever `sourceId === 'CASH'`.
- The three public paths took `source_id` from the request body and checked
  only that it was non-empty.
- Square completes a CASH payment on the merchant's word.
  `square-cash-sale` makes this exact call in production, which shows the
  application's credentials are allowed to do it.
- Nothing afterwards checked `payment.source_type`.
- Introduced by `9d5876a` (#103, 19 Aug), when the counter's cash path was
  routed through the shared helper.
- The deployed `_shared/square.ts` on production is byte-identical to `main`.

**Exploit scenario:** an anonymous visitor posts to `/functions/v1/ticket-checkout`
with `{"showing_id":…, "tickets":[…], "source_id":"CASH", "email":…}` and gets:
- **Tickets:** confirmed, scannable and delivered. Rotating the email gets
  past the per-buyer limit, so one script can take a whole house.
- **Film passes:** the same body to `film-pass-checkout` produces a `paid`
  order in the staff pickup or mail queue.
- **Donations:** sent to `square-donation`, it produces a `completed` gift
  with a contribution receipt, an LGL gift record, and a tribute email with
  attacker text to any address.

**Remediation:** done in PR #356.
- `isChargeableSource()` refuses empty, `CASH` and `EXTERNAL` before any write.
- `createPayment` refuses a money-less source itself.
- Cash moves to `createCashPayment`, imported only by staff-gated
  `square-cash-sale`.
- Six new tests.
- **Deployed 2026-10-06** to staging, then production. Production versions
  went ticket-checkout 54→55, film-pass-checkout 41→42, square-donation 38→39,
  square-cash-sale 7→8. Verified live: `CASH` and `EXTERNAL` return
  `400 Invalid payment source`, a card token passes on to normal validation,
  and the deployed `square.ts` is byte-identical to `main`. Every shared file
  the old bundles carried traced to `main`'s own history, so production was
  behind `main`, not ahead, and the deploy reverted nobody's work.
- **Not exercised:** a real card purchase or a counter cash sale after the
  deploy. The card path changed only by the added guard. Do one of each at
  the next opportunity.
- **Still to do:**
  - Read-only, search production Square for `source_type = CASH` payments
    from 19 Aug on whose `reference_id` is an online order token, pass order
    id or donation id. That answers whether this was used. Cross-check
    `tickets.square_payment_id` on online orders against the Square tender
    type.

**Effort:** S (done). The exploitation check is S.

---

### H1 · High · Confirmed (code and replay; the session step is standard Supabase behaviour, not exercised) · Self-editable `profiles.email`/`phone` is trusted as identity, and any ticket buyer can hold a session

**Location:**
- `supabase/functions/_shared/buyers.ts`:
  - `:81-91`: `findUserIdByEmail` reads `profiles.email` first, with
    `.limit(1)` and no order.
  - `:107-127`: the phone match, also via `profiles`.
  - `:148-178`: every guest buyer gets an `email_confirm: true` auth user.
- `supabase/migrations/20260814214233_rls_permissions_hardening.sql:212`:
  `GRANT UPDATE ON public.profiles TO authenticated`, the whole row. The
  own-row policy is "Users can update own profile". No column grant or
  trigger protects `email`/`phone`.
- `idx_profiles_email` is not unique (`20260410155703…:6`).
- `invite-staff/index.ts:118-172`: reuses the looked-up account and upserts
  the role onto it.
- Buyer resolution: `ticket-checkout/index.ts:197`;
  `film-pass-checkout/index.ts:368,466,811`.
- `send-auth-email` sends recovery links to any user, with no role filter.
- `src/pages/Auth.tsx:68-72`: forgot-password is live.

**Description:**
- Signups are off, but both checkouts create a confirmed account for any
  guest email. They do it **before** pricing or payment, so even a 400
  leaves the account behind (see M2).
- "Forgot password" then hands that account a real session.
- `MEMBER_ACCOUNTS=false` only hides UI.
- With a session, the user can `PATCH` their own `profiles.email`/`phone` to
  anyone's.
- Two server paths trust that column as identity.

**Exploit scenario:**
- **Privilege escalation:**
  1. An attacker buys any ticket (or posts a junk checkout), resets the
     password and signs in.
  2. They `PATCH /rest/v1/profiles?id=eq.<self>` with
     `{"email":"newmanager@kenworthy.org"}`.
  3. When an admin or superadmin later invites that address,
     `findUserIdByEmail` returns the attacker.
  4. `inviteRefusal` passes, because the attacker holds no protected role.
  5. The requested role (admin, if a superadmin invites) is upserted onto the
     attacker's account. No invite email is sent, so the real invitee hears
     nothing.
  - A host (an outside renter) can do the same from their existing session.
- **Ticket theft:**
  1. With `email`/`phone` set to a known patron's, that patron's next online
     ticket or pass purchase attaches to the attacker's `user_id`.
  2. The own-row SELECT policies then expose `qr_code` and `order_token`, and
     the first scan at the door wins.
  3. Owner resends from `send-ticket-confirmation` go to the attacker
     (`deliver.ts:302-311`).
- **Renter data:** the `rental_invoice_lines` "Renter reads own invoice lines"
  policy matches on `profiles.email`, so the same trick reads a renter's
  invoice lines.

**Evidence:** In the migration replay, as a `regular_user`, `UPDATE profiles
SET email=…, phone=… WHERE id=auth.uid()` succeeded. Three independent review
passes (database, edge functions, auth) reached the same chain.

**Remediation:**
1. Resolve identity from `auth.users` only, for example a service-role-only
   lookup. Drop the phone-based account match, or require a verified phone.
2. Revoke table UPDATE on `profiles` from `authenticated`. Grant UPDATE only
   on the columns a client legitimately writes (`display_name`,
   `marketing_opt_in`, the `mailchimp_*` cache columns). No client code writes
   `email`, and `Profile.tsx` writes `phone`, which should go too. Sync
   `profiles.email` from `auth.users` with a trigger.
3. In `invite-staff`, assert that the resolved account's `auth.users.email`
   equals the invited address before granting, and flag account reuse loudly
   in the response.
4. Decide whether a patron account may sign in at all. If not, refuse
   recovery and magic links in `send-auth-email` for users with no staff,
   host or admin role.
5. Correct CLAUDE.md. *Done in this PR.*

**Effort:** M.

---

### H2 · High · Confirmed (harness and a read-only staging quote) · Omitting `tier_id` prices a tiered showing at its fallback base price, which can be $0

**Location:**
- `supabase/migrations/20260922203433_movies_external_ticketing.sql:148-161`,
  the effective `price_ticket_order`. No later migration redefines the tier
  branch.
- `src/pages/admin/ShowingForm.tsx:154,533-541,1361-1370`.

**Description:**
- In the per-ticket loop, a descriptor with no `tier_id` (and no seat tier)
  falls through to `showings.ticket_price`, even when the showing has active
  priced tiers.
- The admin form labels that field "Fallback price when no tiers are used",
  defaults it to 8.00, and treats a base of 0 with priced tiers as normal.
- Nothing ties the base price to the tiers.

**Exploit scenario:**
- On a $55/$40 live event, posting `tickets: [{},{},{},{}]` pays $8.48 per
  ticket.
- If the base is 0, `chargeCents` is 0, no card is needed, and the tickets are
  confirmed without Square being contacted.

**Evidence:**
- Harness, showing with base 0 and $55/$40 tiers: the honest order totals
  $42.40; four tier-less tickets total $0.00.
- Harness, base 8 and a $40 tier: $8.48.
- Staging `quote_ticket_order` (anon, read-only) on a tiered showing with
  `[{}]` returned `tier_id: null, list_price 8.0`.
- Production exposure depends on how many showings have tiers priced above
  their base. Measure that with a read-only count before and after the fix.

**Remediation:**
- In `price_ticket_order`, raise PT400 when the showing has any active tier
  and a descriptor resolves no tier.
- Add a harness vector for that case. Per CLAUDE.md's harness rule, also run
  the untiered shape, which is most production showings.

**Effort:** S.

---

### M1 · Medium · Confirmed · Several gates treat "authenticated" as "staff"

These follow from H1's root (any buyer can hold a session). Each was written
under the CLAUDE.md premise that `authenticated` means staff.

| Where | What a buyer or host session can do |
| --- | --- |
| `mailchimp-subscribe/index.ts:67-85` | Any valid JWT is "trusted". It skips double opt-in, the rate limit and the tag allowlist, sets merge fields, and can `unsubscribe: true` **any** address on the shared production audience. An unsubscribed contact can't be re-subscribed by API without their own confirmation. |
| `apply_production_template_to_showing` (`20260617060311:88-142`) | SECURITY DEFINER, EXECUTE granted to `authenticated`, no role check. Seeds template tiers and prices onto a showing. |
| `send-ticket-confirmation/index.ts:150-158` | An order owner may pass `force` and `account_created`. That gives unlimited email resends, and SMS resends at Twilio cost if the stored consent is true. |
| `dvd_rentals`, `shift_requests` policies | A buyer session can insert DVD reservations and file a `shift_requests` row with `status='approved'` (replay). |

**Remediation:**
- Gate each of these on `has_role(…, 'staff')` (or admin), not on the
  presence of a user.
- Sweep every function and RPC granted to `authenticated` for an explicit
  role check.

**Effort:** S each.

### M2 · Medium · Confirmed (code; limiter coverage probed) · No rate limit or bot check on `ticket-checkout` / `film-pass-checkout`; accounts created before validation

**Location:**
- `ticket-checkout/index.ts:177-205`: `findOrCreateBuyer` runs before
  `priceTicketOrder` at `:216`.
- `film-pass-checkout/index.ts:811`: buyer created before the `source_id`
  check at `:821`.
- `_shared/deliver.ts:296-372`: email and SMS go to whatever contact the
  request supplies.
- `square-donation:62-88` is limited (15 per 10 minutes per IP, $1 minimum)
  but has no Turnstile.

**Description and exploit scenario:**
- **Card testing.** The Square application and location ids are public
  (`get_config`), so anyone can mint card tokens with Square's SDK and test
  stolen cards against the theatre's merchant account through either checkout,
  without limit. The consequences are dispute fees, risk review, or an account
  freeze. Card testing at $1 also works on `/donate` within its per-IP limit
  from rotating proxies, and each success writes an LGL donor record.
- **Free-showing drain.** A $0 showing needs no card
  (`ticket-checkout:395`), so a script can confirm seats in a loop under fresh
  emails. That empties the house and sends email and SMS to whatever third
  parties it names. The per-buyer limit is read-then-write and is described
  in code as a courtesy.
- **Junk accounts.** Every attempt, even one returning 400, creates an
  `email_confirm: true` auth user. Those accounts feed H1. Each new address
  can also cost up to 50 `listUsers` pages.

**Remediation:**
- Add `checkRateLimit` to both checkouts.
- Turnstile that fails closed when the secret is unset, on both checkouts and
  donations.
- Resolve the buyer only after pricing, and for paid orders after the charge.
- Return generic errors in place of GoTrue text (see L10).
- Consider Square-side velocity rules.

**Effort:** M.

### M3 · Medium · Confirmed live on staging · Anon can read film distributor terms (`movies.terms_percent`, `distributor`, `circuit`)

**Location:**
- `20260810165116_grant_public_read_access.sql:8`: the blanket `GRANT SELECT`
  loop undid the column restriction in `20260617053243:17` and
  `20260701020754:2-4`.
- `src/lib/movieColumns.ts:4-8` wrongly states that `select('*')` fails for
  anon.
- Later migrations (`20260922203433:31`, `20261002195410:49`) still add column
  grants as if `movies` were restricted.

**Description:**
- The August RLS audit (its Finding 5) caught this exact loop wiping
  `sponsorship_opportunities`' column restriction and fixed that table only.
- `movies` was never restored. Anon `movies?select=*` returns 22 columns.

**Exploit scenario:** anyone reads `/rest/v1/movies?select=title,distributor,terms_percent`
and gets the theatre's film-rental percentage per title, which distributors
treat as confidential. On staging `terms_percent` is null everywhere; the
production values are unknown and should be assumed populated.

**Remediation:**
- `REVOKE SELECT ON public.movies FROM anon`, then grant only
  `MOVIE_PUBLIC_COLUMNS`.
- Add a probe test asserting anon `select=*` on `movies` is refused.
- Re-check every table the blanket loop touched for an earlier column grant
  it overrode.

**Effort:** S.

### M4 · Medium · Confirmed (replay) · Host policies are far broader than any host feature

**Location:**
- `20260623175019…sql:82`: host UPDATE on tickets.
- `20260623175019…sql:73`: host DELETE on showings.
- The `ON DELETE CASCADE` foreign keys `tickets_showing_id_fkey` and
  `film_pass_redemptions_showing_id_fkey`.

**Description:**
- A host is an outside renter. A host can update any ticket for their
  production: flip a refunded ticket back to `confirmed`, or change its
  `user_id` or price (replay: `confirmed|<host>|0.00`).
- A host can delete a sold showing, which cascade-deletes every ticket and
  pass redemption for it (replay: 0 tickets left).
- No client path updates tickets as a host; check-in moved to the
  `check_in_ticket` RPC. The original rationale for the policy no longer
  applies.

**Remediation:**
- Drop the host ticket UPDATE policy.
- Refuse showing DELETE while tickets exist, or make the foreign keys
  `RESTRICT`.

**Effort:** S.

### M5 · Medium · Confirmed (installed router run under jsdom) · Open redirect after staff sign-in — `/auth?redirect=//evil.example`

**Location:**
- `src/pages/Auth.tsx:38,59,104`.
- `@remix-run/router` 1.23.0 (react-router-dom 6.30.1), `router.js:368-388`.

**Description:**
- `redirect` goes to `navigate()` unchecked.
- `//host` or `/\host` is cross-origin. `pushState` throws on it, and the
  router's catch block calls `window.location.assign(url)`.
- Advisories GHSA-9jcx-v3wj-wh4m and GHSA-wrjc-x8rr-h8h6; the second is a
  bypass of the first fix. Dependabot alert #7 has been open since 30 May.
- This is the concrete form of the August L4 item, which pointed at the
  wrong react-router advisory: the XSS one excludes `BrowserRouter`.

**Exploit scenario:** a staff member gets an emailed link
`https://kenworthy.org/auth?redirect=//evil.example/admin`. They sign in on the
real site and land on a look-alike "session expired" page that collects the
admin password. With no MFA (M9), that password is the whole account.

**Remediation:**
- Accept only `^/(?![/\\])` relative paths, else redirect to `/`.
- Also merge the react-router Dependabot PR. Do both, because the library fix
  has been bypassed once.

**Effort:** S.

### M6 · Medium · Confirmed (code) · `square-labor` gives every staff member the payroll; shift actions accept anyone's shift

**Location:**
- `square-labor/index.ts:167-177`: a staff gate.
- `team.ts:10-16`: `ADMIN_ACTIONS` covers writes only.
- `listTeam :225-267`: every member's email and `hourly_rate_cents`.
- `listShifts :449`: wages.
- `laborSummary :665`.
- Shift mutations at `:384-447` accept any `shift_id`, which is also not
  URL-encoded.
- The UI shows these screens to admins only (`AdminDashboard.tsx:793,1521`).

**Exploit scenario:**
- A staffer calls `functions.invoke('square-labor',{body:{action:'list_team'}})`
  and gets every coworker's email and hourly rate.
- `labor_summary` gives revenue against labor cost.
- `clock_out` on a coworker's open shift does at staff level what the
  admin-only `force_close_shift` does.

**Remediation:**
- Add the read actions to `ADMIN_ACTIONS`, and give staff a `my_*` variant
  with wages stripped.
- For non-admins, require that the shift's `team_member_id` matches the
  caller's `staff_square_links` row.
- `encodeURIComponent` the id.

**Effort:** S.

### M7 · Medium · Confirmed (code; not exercised, because it writes to the live audience) · `mailchimp-subscribe` lets anonymous callers overwrite existing subscribers' names and tags

**Location:** `mailchimp-subscribe/index.ts:101-124` (anon branch), `:150-164`
(PUT upsert), `:170-180` (tags).

**Description:**
- Mailchimp's member PUT is "add or update".
- For an existing member the forced `status_if_new: pending` is ignored, so
  80 characters of free-text FNAME and LNAME overwrite theirs.
- A free-form `source:<text>` tag and allowlisted tags such as `donor` are
  also applied.
- Staging shares production's audience.

**Exploit scenario:** a script works through local addresses at 10 per IP per
10 minutes (the limiter is real), setting first names to offensive or phishing
text. The next campaign greets real patrons with it, and `donor` pulls
strangers into donor segments.

**Remediation:**
- For anon callers, create only: POST, or GET first and skip if the member
  exists.
- Drop free-form `source:`.

**Effort:** S.

### M8 · Medium · Confirmed (rendered against the real template) · Public rental-form name injected unescaped into the staff notification email

**Location:** `_shared/staff_notifications.ts:317-319,371`;
`_shared/email-layout.ts:141-142`.

**Description:**
- `who` is `applicant_name` + `organization_name`, up to 200 characters each,
  from the unauthenticated form.
- It goes into `preheader` unescaped, and the shell inserts the preheader
  raw. Every other template escapes it.

**Exploit scenario:** anyone who solves Turnstile once plants an
`<a href="https://evil.example/login">` at the top of an email that staff
receive from Kenworthy's own domain, passing DKIM. A probe rendered exactly
that.

**Remediation:**
- `esc()` both values.
- Make `emailLayout` escape `preheader` itself, so the next template can't
  repeat the mistake.

**Effort:** S.

### M9 · Medium · Plausible (MFA absence confirmed; dashboard auth settings unreadable with the anon key) · Privileged accounts are password-only; auth policy isn't in code

**Location:** `supabase/config.toml` has no `[auth]` section. There is no
MFA or `aal2` anywhere. `ResetPassword.tsx:46` enforces a 6-character minimum,
client-side only.

**Description:**
- Admin and superadmin access rests on one password.
- Password length, JWT expiry and the redirect allow-list live only in the
  dashboard, unreviewable and undiffed between projects. A wildcard redirect
  entry would leak recovery tokens.

**Remediation:**
- TOTP MFA, with `aal2` required server-side for admin and above (in
  `has_role` or the edge gates).
- Codify `[auth]` (minimum length 12 or more, exact redirect URLs) and diff it
  against both projects.

**Effort:** M.

### M10 · Medium (High if production confirms) · Plausible · `audit_bulk_begin` / `audit_bulk_end` revoked only from PUBLIC

**Location:** `20260815015037_audit_log_coverage_and_guardrails.sql:240-335`,
revokes at `:329-330`.

**Description:**
- Both are SECURITY DEFINER and check nothing about the caller.
- `audit_bulk_begin` suppresses audit logging on any tables for any number of
  minutes.
- Both accept a spoofed `p_actor_id`; `audit_bulk_end` inserts arbitrary
  audit rows.
- On a project with Supabase's legacy default privileges, anon and
  authenticated keep direct EXECUTE grants that `REVOKE … FROM PUBLIC`
  doesn't remove. The replay (which uses those defaults) reproduced it: as
  anon, auditing of `tickets` and `user_roles` was suppressed for a year
  under a superadmin's name.
- **Staging refuses anon (42501).**
- Production may differ. The August audit found anon holding direct table
  grants there, which is the legacy-defaults signature.

**To settle it (read-only, production):** `select has_function_privilege('anon','public.audit_bulk_begin(text[],text,jsonb,integer,uuid)','execute');`
and the same for `authenticated`.

**Remediation:**
- `REVOKE … FROM PUBLIC, anon, authenticated` (also on `is_protected_user`).
- Inside both functions, require the service role, cap `p_minutes`, and
  ignore `p_actor_id` from any other caller.
- Then sweep production for SECURITY DEFINER functions that anon can execute.

**Effort:** S.

### M11 · Medium · Confirmed (code) · Staff actions through service-role functions are unattributed in the audit log, refunds included

**Location:**
- `square-refund/index.ts:47,155-220`.
- Also `square-showing-variations`, `square-event-write`,
  `square-variation-restore`, `square-catalog-restore`, `square-invoice`,
  `sign-contract`, `film-pass-batch`, and the `square-cash-sale` and
  `square-terminal` stamp and confirm writes.

**Description:**
- Each writes as service_role, so the audit trigger records the change with
  `actor = NULL`, and none calls `logAudit`.
- The August audit said refunds were "captured by the tickets trigger".
  They are captured, but not attributed.
- Money refunded and Square catalog writes can't be tied to a person.

**Remediation:** call `logAudit` with the verified caller id, as `invite-staff`
and `square-catalog-sync` already do.

**Effort:** M.

---

### Low

| ID | Status | Finding | Location | Remediation |
| --- | --- | --- | --- | --- |
| L1 | Confirmed | **Staff can record sales Square never received.** Insider fraud: a cash sale recorded as card means the till expects nothing. | `create_ticket_order` takes any `square_payment_id` on `card`/`online` rows. `square-terminal` `confirm_sale` doesn't bind `checkout_id` to the order (`reference_id` unchecked) or refuse a reused payment id, so one swipe confirms many orders. Pass `activate` accepts any payment id. `record_in_person` makes receipted LGL gifts with no payment evidence. `square-cash-sale` `donation_cents` is unbounded. Legacy `get_checkout` answers COMPLETED for `SIM_` ids in production (staff, client-side only). | Bind terminal checkout to order via `reference_id`. Make payment ids unique per order. Verify payment ids against Square. Cap cash donations. |
| L2 | Confirmed | **A film-pass order for N passes is fulfilled by one sticker.** | `activate_film_pass` marks the whole order fulfilled after the first. | Count activations against `quantity`. |
| L3 | Confirmed (race not executed) | **Refund edge cases.** Two concurrent refunds for overlapping ticket subsets can refund a ticket twice: the status update isn't conditional and the idempotency key covers only the requested subset. Counter-cash tickets now carry a CASH payment id, so they take the Square refund branch and lose the "refund from the till" warning. The pass-balance credit is an unlocked read-modify-write and credits voided or expired passes. | `square-refund/index.ts` | `UPDATE … WHERE status='confirmed' RETURNING` before refunding. Branch on tender type. Lock and check pass status. |
| L4 | Confirmed (not deployed on either project) | **`qbo-sync` hardening.** The OAuth `state` is HMAC'd with `SUPABASE_SERVICE_ROLE_KEY`, which is key reuse (not a disclosure). The nonce is never consumed, so the state replays for 10 minutes. The signature compare is `!==`. The redirect origin comes from `Referer`. `return_to` is unvalidated (`"@evil.tld"` goes off-site). `status` is ungated and returns realm id and token expiry to anon. The callback is unreachable under the default `verify_jwt=true`. The role check is exact `'admin'`, so superadmin-only is refused. | `qbo-sync/index.ts:30-56,70-104,131-133,153-233` | Before first deploy: a dedicated `QBO_STATE_SECRET`, single-use nonce, `timingSafeEqual`, origin from `SITE_URL`, path-only `return_to`, gate `status`, explicit `verify_jwt=false` with per-action gates, `has_role`. |
| L5 | Confirmed (versions); paste XSS Plausible | **Vulnerable browser libraries; Dependabot backlog.** `prosemirror-view` 1.42.2 (GHSA-c8x8-7fp4-3x9w, paste-HTML XSS in the TipTap editor on 12 admin and host screens). `xlsx` 0.18.5 (no npm fix; admin upload only). 45 open Dependabot alerts (24 high) and 13 unmerged Dependabot PRs, the oldest from 8 June. `npm audit --omit=dev`: 17 high, 29 moderate, 1 low, mostly build tooling filed under `dependencies`. `dompurify` advisories need `IN_PLACE`, which isn't used, so they don't apply. | `package.json`, `rich-text-editor.tsx`, `parseFinancialXlsx.ts:126` | Bump TipTap or override `prosemirror-view` ≥ 1.42.3. Triage the Dependabot PRs. Move build tooling to `devDependencies`. Replace `xlsx` (already tracked). |
| L6 | Confirmed | **Edge-function imports float on major versions with no Deno lockfile.** 26 imports (`esm.sh/@supabase/supabase-js@2`, `@2/cors`, `npm:…@2`) resolve to the newest 2.x at deploy time from a third-party CDN, with no integrity check, inside functions that hold the service-role key and the live Square token. | 22 functions; no `deno.json`/`deno.lock` under `supabase/` | Pin exact versions, prefer `npm:`, commit `supabase/functions/deno.json` + `deno.lock`. |
| L7 | Confirmed (GitHub API) | **Secret scanning and push protection are off on a public repo that commits env files on purpose.** | Repository settings | Turn on secret scanning, push protection and validity checks. A 2-minute quick win. |
| L8 | Plausible | **No secret-rotation runbook; staging holds production's Mailchimp, LGL and Twilio keys.** Third-party secrets were last set 10–20 Aug. | `docs/` (absent) | Separate staging vendor keys where vendors allow it, plus a one-page rotation runbook covering each secret, where it lives, who rotates it, and how to verify. |
| L9 | Confirmed (latent; gateway probed) | **Service-role identity is read from an unverified JWT claim.** This is safe only while `verify_jwt=true`. A single `--no-verify-jwt` deploy would let a forged `{"role":"service_role"}` token email any order's QR codes. Staging rejects forged and `alg:none` tokens today. | `_shared/callers.ts:27-37,55`; a duplicate decoder in `send-ticket-confirmation/index.ts:31-41,88-92` (non-constant-time compare) | Compare the bearer to the service key or verify against JWKS. Delete the duplicate. Add a CI check that the `verify_jwt=false` list stays exactly the three intended. |
| L10 | Confirmed | **Internal error text reaches anonymous callers.** GoTrue `createUser` errors, a raw exception, and Mailchimp error JSON. No secrets or stacks. | `ticket-checkout:203`, `film-pass-checkout:814`, `square-donation:312`, `mailchimp-subscribe:140,168` | Generic text on public paths; log the detail. |
| L11 | Confirmed | **Debug probes are still in the repo**, one with a production catalog write switch (`confirm:"PRODUCTION-CREATE"`, admin-gated). Not deployed on either project; one `functions deploy` restores them. | `square-event-create-probe/index.ts:69-71`; `square-order-probe`, `square-event-probe`, `square-discount-probe` | Move outside `supabase/functions/`, keeping the files the docs cite. At minimum, drop the production override. |
| L12 | Confirmed (auth-js trace) | **Sign-out on a flaky connection leaves the session in localStorage.** On a shared box-office or scanner device, the next person inherits it. | `src/lib/auth.tsx:115-121`; `GoTrueClient.js:1589-1604` | On error, fall back to `signOut({ scope: 'local' })`. |
| L13 | Confirmed (CSP blocks execution today) | **DB URLs reach `href`/iframe `src` with no scheme check.** Hosts can write `rsvp_url` and `trailer_url`. The trailer iframe falls back to the raw URL on page load. CSP is the only control. | `Showing.tsx:188`, `ProductionDetailDrawer.tsx:109`, `ProductionMedia.tsx:58-59`, `TrailerModal.tsx:118-119`, `Press.tsx:102` | An https-only CHECK and a render guard; drop the raw iframe fallback. |
| L14 | Confirmed | **Audit-log integrity and coverage gaps.** Staff can insert audit rows with any action, details or `actor_email` (only `actor_id` is pinned). Anon can create `auth.login_failed` rows for staff addresses (1 per minute per account). No trigger on `host_event_assignments`, `staff_square_links`, `production_*_tiers`, `showing_seat_tiers`, `pass_type_showings`, the finance and QBO tables, `signing_keys`, `payroll_exports`. The August L3 tables are now covered. | audit migrations | A BEFORE INSERT trigger that sets `actor_email` from `auth.users` and limits client inserts to `auth.%`; add the missing triggers. |
| L15 | Confirmed | **PII in full-row audit snapshots with no retention; bearer tokens in logs.** Profiles email and phone, donations, rentals; no erasure path. `square-terminal:283,369` logs `order_token`. `mailchimp-subscribe` and `square-invoice` log provider error bodies that can echo emails. | audit trigger; listed lines | Retention or redaction for contact columns; truncate tokens; summarise provider errors. |
| L16 | Confirmed | **A $1 donation sends a Kenworthy-branded tribute email with attacker text to any address.** The text is escaped, but URLs auto-link. No length caps on message or names. | `square-donation:79-88`; `_shared/donations.ts:320-361` | Length caps, strip URLs from `message`, optional staff review. |
| L17 | Confirmed | **`get_rental_request_by_token` returns `SELECT *`.** Strong 128-bit token, but the holder gets `admin_notes`, the invoice fields, `contract_data`, and any future column. Still open since August L2. | `20260608223811:7-17` | Return only what `RentalContract.tsx` renders. |
| L18 | Confirmed (staging) | **Every public bucket is listable by anon**, including uploads whose row isn't published yet. Nothing sensitive is there today. | read policies in `20260402052026`, `20260819151204`, `20260820094512`, `20260820203112`, `20260820234512`, `20260828030114` | Drop the anon read policies; public URLs keep working. |
| L19 | Confirmed | **Anon reconnaissance.** `ticket_discounts.code` is anon-readable (latent until promo codes ship). `staff_bios.user_id` and `created_by`/`uploaded_by` columns are anon-readable. `has_role` and `is_host_of*` are anon-executable, so anyone can test any uuid for admin. The June revoke of `resolve_account_id` is ineffective because PUBLIC keeps EXECUTE. | `20260921203017:66,95-99,117`; listed columns | Column grants without ids or `code`. Revoke anon EXECUTE where policies don't need it (`REVOKE … FROM PUBLIC` too). |

---

## Quick wins (high value, under an hour each)

1. **Deploy PR #356** (C1), then run the read-only Square check for prior use.
2. **H2:** one `RAISE` in `price_ticket_order` plus a harness vector.
3. **M3:** `REVOKE SELECT ON movies FROM anon` and grant the public columns.
4. **M5:** a regex guard on `?redirect=` in `Auth.tsx`.
5. **M8:** two `esc()` calls, and escape `preheader` in `emailLayout`.
6. **M6:** four action names added to `ADMIN_ACTIONS`.
7. **M4:** drop one policy (host ticket UPDATE); `RESTRICT` the cascade.
8. **M1:** a `has_role` check in `mailchimp-subscribe`'s trusted branch and in
   `apply_production_template_to_showing`.
9. **L7:** turn on GitHub secret scanning and push protection. Settings only.
10. **M10:** one read-only production query to settle it, then a two-line
    revoke.

## Remediation roadmap (each cluster is one follow-up brief)

1. **Ship C1 now.** PR #356 deploy, plus the exploitation check.
2. **Identity is `auth.users`, and a session is not a role** (H1, M1, parts
   of M2):
   - Column-scoped `profiles` UPDATE.
   - Buyer and invitee resolution against `auth.users`.
   - `invite-staff` email assertion.
   - A decision on patron sign-in.
   - `has_role` gates on every `authenticated`-granted function and RPC.
   - The CLAUDE.md correction (done).

   This is the highest-leverage brief after C1.
3. **Pricing completeness** (H2, L2): the tier-required rule with harness
   vectors run against production's shapes, and pass fulfilment by quantity.
4. **Public checkout abuse controls** (M2, M7, L10, L16): rate limits and
   Turnstile on both checkouts, buyer creation after pricing and payment,
   Mailchimp create-only for anon, generic errors, donation field caps.
5. **RLS and grant regressions** (M3, M4, M10, L17, L18, L19): the `movies`
   column grant, host policy reduction, the PUBLIC-vs-direct EXECUTE sweep on
   production, and the rental token columns. Add a standing probe test that
   asserts anon's view of every table, so the next blanket grant fails a
   check instead of a later audit.
6. **Staff boundaries and insider integrity** (M6, L1, L3, M11, L14): payroll
   reads to admin, terminal and order binding, refund conditional update,
   `logAudit` with actor on every service-role staff action.
7. **Account security** (M5, M9, L12): redirect guard, MFA for admin and above,
   `[auth]` in code, local sign-out fallback.
8. **Supply chain and secrets hygiene** (L5, L6, L7, L8, L9, L11): Dependabot
   triage, the TipTap bump, Deno pins and lockfile, secret scanning, a rotation
   runbook, service-key verification, and moving the probes out.
9. **Before QBO ever deploys** (L4).
10. **Email and URL hygiene** (M8, L13, L15).

---

## What was checked and found clean

Recorded as evidence of coverage, and because "checked and it holds" is worth
as much as a finding.

**Production runs `main`.** All 29 functions deployed on production exist on
`main`. They were downloaded read-only and diffed:
- Every `index.ts` is identical except a one-line comment in `invite-staff`.
- The `_shared` differences are older display-only copies (receipt discount
  line, refund footer, runtime), none on an auth, pricing-input or refund path.
- Not deployed on production: `qbo-sync`, `mailchimp-bootstrap` and all four
  probes.
- `verify_jwt=false` on production is exactly `ticket-access`,
  `send-auth-email`, `mailchimp-webhook`, matching `config.toml`.
- August M2 has not regressed, so this audit of the repo is an audit of
  production's edge functions.

**Edge-function authorization** (full matrix in *Appendix A*):
- **Counts:** 35 function directories (34 live, plus the `guest-checkout`
  410 shim). 32 use the service-role key.
- **Gates:** every staff or admin function runs `getUser` and a role check
  before its first side effect.
- **Gateway (probed):** it verifies signatures. A forged HS256 service-role
  token, `alg:none` and `apikey`-only are all refused.
- **Anon key (probed):** 19 anon-key probes across 16 functions were refused
  or stopped at validation.
- **Catalog writes:** every one that replaces rather than merges is
  admin-only.
- **Role management:** `role_management.ts` matches the SQL policy exactly,
  and host does not satisfy staff.
- **CORS `*`:** acceptable. There is no `Allow-Credentials` and no cookie
  reads, and `Origin` is never used for auth.

**Database:**
- RLS is on for all 62 public tables, and there are no views.
- Anon holds no INSERT, UPDATE or DELETE grant (10 of 10 inserts refused on
  staging).
- 76 anon table reads were probed: every PII, transaction, finance, audit and
  role table refuses.
- There is no tickets INSERT policy. `create_ticket_order` refuses
  non-staff; hosts get comps only.
- Donations, passes and redemptions are written by the service role only.
- Every SECURITY DEFINER function pins `search_path`, and none uses dynamic
  SQL.
- The internal checks in these functions hold: `check_in_ticket` (still
  scoped to the showing, August H2), `showing_attendees`,
  `search_film_passes`, `set_showing_price_tiers`,
  `configure_square_catalog_guard`, and the QBO token RPCs.
- Admin-scoped role management refuses all of these: self-promotion, granting
  admin, editing a staff row into admin, touching a protected user, and
  deleting admin or superadmin rows.
- `admin_audit_log` can't be updated or deleted by clients, and only admins
  can read it.
- The sponsorship contact columns are still hidden.

**Payments** (apart from C1 and H2):
- **Price authority:** the price comes from the database and is re-summed
  from the stored rows before charging. On a three-way mismatch the fallback
  still charges our own computed amount.
- **Unsellable showings:** past, inactive, no-ticket, RSVP or info-only,
  sold-out, a tier from another showing, and an inactive tier are all refused
  in SQL. Pickup-only passes are refused for mail.
- **Discounts:** no client-supplied codes, no stacking, scoped to ticket
  lines.
- **Donations:** bounded and untaxed.
- **Capacity:** serialized by `FOR UPDATE` and the unique seat constraint.
- **Ordering:** rows go pending, then the charge, then confirm. Every failure
  path marks the rows failed.
- **Terminal:** the amount comes from the rows, and SIM checkouts are refused
  in production on the new path.
- **Idempotency:** replay is scoped to key and buyer.
- **Environment:**
  - `SQUARE_ENV` and `location_id` are server-only and fail closed to sandbox.
  - Staging reports sandbox on all three public functions.
- **Webhooks:** there is no Square webhook endpoint. `mailchimp-webhook` uses
  a constant-time secret compare and can change only `marketing_opt_in`.
- **Tests:**
  - Pricing harness: 106 of 106 pass.
  - Shared money modules (`deno test`): 149 pass.

**Public surface:**
- **Rate limiter:** it can't be spoofed. 125 requests gave 120 then 5×429.
  Client-set `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip` and
  `true-client-ip` changed nothing.
- **Turnstile:** armed on staging, failing closed if Cloudflare is
  unreachable.
- **Tokens:** order tokens, QR codes, pass codes, rental tokens and `/verify`
  ids are all random UUIDs or 128-bit. `pass_number` is never a credential.
- **`ticket-access`:** scoped to the order. It strips `user_id`, gives the
  same 404 for unknown and malformed tokens, and hides pending and failed
  orders.
- **Anon RPCs:** all 42 anon-reachable RPCs were reviewed, and every money,
  admission and PII function refuses anon.
- **Storage:** SVG is rejected at all six buckets; `concession-menus` accepts
  PDF only (August M4 holds).
- **`guest-checkout`:** still returns 410.
- **Signups:** off.

**Auth, client and infrastructure:**
- **`send-auth-email`:** Standard Webhooks HMAC with a ±300 s window and a
  constant-time compare. It fails closed when unset and is neither an open
  relay nor an enumeration oracle. The one nit: no webhook-id de-dup inside
  the 5-minute window.
- **RichText and DOMPurify:** a tight allowlist, with URIs limited to
  `https?:|mailto:|tel:|/|#` and `rel=noopener noreferrer` forced.
- **`dangerouslySetInnerHTML`:** the only other sites are `chart.tsx` (unused)
  and `InstagramFeed` (a hardcoded empty constant).
- **Emails:** ticket, donation, pass and auth emails escape every value. M8 is
  the one exception.
- **Worker:**
  - Head attributes are escaped.
  - JSON-LD escapes `<`, U+2028 and U+2029, so `</script>` can't break out.
  - Route ids are UUID-checked before PostgREST.
  - Redirects are fixed and same-origin.
  - The sitemap is escaped.
- **Headers (staging curl):** the CSP is now **enforced** (it was
  report-only in August), with no `unsafe-inline` or `unsafe-eval` in
  `script-src` and `frame-ancestors 'none'`. HSTS, `nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy` are on
  every Worker-served document. One defence-in-depth note:
  `connect-src https://*.supabase.co` would let an injected script post to
  any Supabase project.
- **Token storage:** `localStorage` is acceptable given the enforced CSP.

**Secrets:**
- **Bundles:** the staging and production bundles hold only the matching anon
  key and public ids, with no source maps.
- **Git history:** all 1,504 commits were scanned. There are 3 JWTs, all
  anon, and the one Square hit is a public Application ID.
- **Env and config files:** the committed `.env.*` files and `wrangler.jsonc`
  hold anon keys only.
- **Root SQL dumps:** the `kenworthy_*.sql` dumps contain public catalogue
  data, with organiser contacts from published events and no patron PII.
- **npm:** every package comes from the registry with integrity hashes, with
  no install scripts and no stray lockfiles.
- **CI:** there are no GitHub Actions to abuse.

## Prior-audit regressions and corrections

| Prior claim | Now |
| --- | --- |
| "The client cannot set an amount" | Still true, and incomplete. C1 and H2 both let a client pay less without touching the amount. C1 dates from the same day as that audit. |
| Signups off ⇒ only staff hold sessions | Signups are off, but the conclusion is false (H1). |
| H1 `mailchimp-ecommerce` gate | Holds. |
| H2 door scoping | Holds. |
| H3 headers | Holds and improved: the CSP is now enforced. |
| M1 rental form | Holds; Turnstile is armed on staging. |
| M2 prod ≠ main | Holds: production runs `main`. |
| M3 webhook email rewrite | The fix holds, but users can now write `profiles.email` directly (H1). |
| M4 bucket mime | Holds. |
| L1 `/verify` | Deliberately re-granted on 4 Sep; it exposes only the public key. |
| L2 rental token `SELECT *` | Still open (L17). |
| L3 audit triggers | Fixed for the four named tables. Remaining gaps are in L14. |
| L4 react-router | Still unpatched, and the earlier write-up named the wrong advisory. Now a concrete open redirect (M5). |
| L5 anon-key `includes` | Still present, still fail-safe. |
| "Client-facing errors are generic" | Partly regressed (L10). |
| "No PII in logs" | Mostly holds (L15). |
| RLS Finding 5 (blanket grant) | The fix missed `movies` (M3). |
| CLAUDE.md "Patrons are anon … `authenticated` = staff only" | **False.** Corrected in this PR. |
| CLAUDE.md "the database holds every order's rows (`enforce_ticket_order_tax`, PT422)" | **Stale.** The trigger was replaced (`20260921203017`) and its replacement dropped (`20260922162659`). Totals are now enforced by `price_ticket_order` / `create_ticket_order`, plus the `enforce_ticket_pricing` row trigger. Corrected in this PR. |

## Non-security defects found along the way

- **POS cancel does nothing.** `StaffPOS.tsx:674,707` marks failed or cancelled
  card sales `failed`, but staff have no tickets UPDATE policy, so it updates 0
  rows silently (replay). Seats stay held for 15 minutes and the rows stay
  pending. This is the CLAUDE.md "blocked writes look like successes" pattern.
- **Buyer newsletter sync probably never runs** (Plausible). The checkouts and
  `square-donation` call `mailchimp-subscribe` with only `apikey` and no
  Authorization header. The staging gateway returns 401 for that shape. Even
  if it ran, every buyer would share one rate-limit bucket.
- CLAUDE.md said there were 34 edge functions; there are 35 directories.
  Corrected in this PR.

## Method

Six parallel review passes, each a separate subagent with the same guardrails:
1. RLS, grants and SQL functions.
2. The edge-function auth matrix.
3. Payments integrity.
4. Secrets, configuration and supply chain.
5. The public surface, PII and storage.
6. Auth, XSS, headers and logging.

Each candidate was traced to its code path and adversarially self-checked.
Unsubstantiated candidates were dropped, and those with one unverified link
are marked Plausible. The four most consequential (C1, H1, H2, the PT422
claim) were re-verified by hand before writing.

- **Migration replay:**
  - All 148 migrations into `postgres:15` with a Supabase stub.
  - Fixture users at each role, under `SET ROLE`, in rolled-back transactions.
  - One data-only migration failed (`20260812180000`; its anchor row is
    absent).
  - The stub uses Supabase's *legacy* default privileges, which over-grant
    EXECUTE compared with staging. That is why M10 is Plausible rather than
    Confirmed.
- **Staging probes:** anon key only.
  - Table reads with `limit=1` and column names or counts only.
  - Inserts expected to be refused.
  - RPC calls with refused or read-only arguments.
  - Gateway JWT forgeries.
  - Limiter header spoofing.
  - Header curls.
  - One malformed `audit_bulk_end` call never resolved to a function, so no
    state changed.
- **Production:** a read-only `functions list` and source download, nothing
  else.
- **Tooling:**
  - `npm audit` (full and `--omit=dev`) and the GitHub Dependabot and security
    settings API.
  - A git-history secret scan and a scan of both built bundles.
  - `deno test` on the shared modules, and the Docker pricing harness.

Nothing was written to production, and nothing was written to staging. No
call reached Mailchimp, LGL, Twilio, Resend or QBO. The only code change made
during the audit is PR #356 (C1), split out at Tom's direction after it was
confirmed.

---

## Appendix A — edge-function auth matrix

`vj` = `verify_jwt` (config.toml; staging and production agree).
`SR` = uses the service-role key.

| function | vj | SR | intended caller | check (line in `<fn>/index.ts`) | verdict |
| --- | --- | --- | --- | --- | --- |
| film-pass-batch | T | Y | staff | authenticatedUser + has_role(staff) 51-58, before reads and insert | OK; probe 401 |
| film-pass-checkout | T | Y | public `order`/`get_config`; staff queue/activate/admit; admin void/delete | requireStaff 125-133 per branch; admin 566-571, 625-630 | OK; C1 (fixed), M2 |
| guest-checkout | T | N | none (retired) | static 410 | OK |
| invite-staff | T | Y | admin (staff/host, unprotected targets) / superadmin | getUser 76; tier 82-87; refusal 103, 135 | gate OK; **H1** identity lookup |
| lgl-sync-donation | T | Y | admin | body validation, then getUser 50 + admin 52 | OK |
| mailchimp-bootstrap | T | Y | admin | getUser + exact `'admin'` | OK (not deployed) |
| mailchimp-campaign | T | Y | admin | getUser + exact `'admin'` 55-60 | OK |
| mailchimp-ecommerce | T | Y | SR or admin | isServiceRoleCaller 79 / admin 80-86; lines ≤ 50 | OK; L9 latent |
| mailchimp-subscribe | T | Y | anon newsletter / "staff" | any JWT trusted 67-85; anon rate limit 101-112 | **M1, M7** |
| mailchimp-webhook | F | Y | Mailchimp | query secret, constant-time, fails closed 97-101 | OK |
| qbo-sync | T | Y | admin; Intuit callback | status ungated; others getUser + exact admin; callback HMAC state | **L4** (not deployed) |
| rental-request | T | Y | public | Turnstile 171; column allowlist; caps | OK; M8 in its email |
| send-auth-email | F | Y (audit) | Auth hook | Standard Webhooks HMAC, fail-closed 52-71 | OK |
| send-ticket-confirmation | T | Y | SR; staff; order owner | role claim / key 84-92; getUser + staff 102-120; owner 132-137 | gate OK; M1 (`force`), L9 |
| sign-contract | T | Y | admin | getUser 141 + admin 150 | OK |
| square-analytics | T | Y | admin | getUser 60 + admin 62 | OK |
| square-cash-sale | T | Y | staff | getUser 47 + staff 52-57 | OK; L1 |
| square-catalog-guard | T | Y | admin; scheduler (SR, read-only) | SR compare 131; getUser + admin 140-144 | OK |
| square-catalog-restore | T | Y | admin | getUser + admin 125-130 | OK (not on staging) |
| square-catalog-sync | T | Y | admin | getUser + admin 157-166 | OK |
| square-discount-probe | T | N | SR-key holder | listUsers proof 24-28; sandbox only | L11 (not deployed) |
| square-donation | T | Y | public; staff `record_in_person` | rate limit 64-76; staff 347-351 | C1 (fixed); M2, L16 |
| square-event-create-probe | T | Y | admin | getUser + admin 51-55 | **L11** prod switch (not deployed) |
| square-event-probe | T | Y | admin | getUser + admin; read-only | L11 (not deployed) |
| square-event-write | T | Y | admin | getUser + admin 107-112 | OK (prod only) |
| square-invoice | T | Y | staff/admin | validation 130-138, then getUser 147 + role 150-154 | OK |
| square-labor | T | N (caller JWT) | staff clock; admin team/payroll | getUser 167; staff 170-172; ADMIN_ACTIONS writes only | **M6** |
| square-order-probe | T | Y | admin | getUser + admin; sandbox | L11 (not deployed) |
| square-refund | T | Y | staff | getUser 53 + staff 56-57 | OK; L3, M11 |
| square-showing-variations | T | Y | admin | getUser + admin 134-139; confirm WRITE | OK |
| square-terminal | T | Y | staff | getUser 38 + staff 60-66 | OK; L1, L15 |
| square-transactions | T | Y | admin | getUser 179 + admin 182-183 | OK |
| square-variation-restore | T | Y | admin | getUser + admin 91-95 | OK (prod only) |
| ticket-access | F | Y | order-token holder | token; rate limit 64-82; order-scoped | OK |
| ticket-checkout | T | Y | public | optional authenticatedUser 168 | C1 (fixed); **H2, M2** |
