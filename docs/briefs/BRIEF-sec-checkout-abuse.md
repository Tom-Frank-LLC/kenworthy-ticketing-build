---
brief: sec-checkout-abuse
title: Public checkouts and the donation form are rate limited and behind Turnstile, create no account for a refused request, and say nothing internal
status: built
track: security
severity: P1
date: 2026-10-06
verified: false
findings: ../AUDIT-security-2026-10-06.md
---

# Public checkout abuse controls (M2, L10 public paths, L16)

From the 2026-10-06 audit, cluster 4 of the remediation roadmap. Tom's call: a
per-IP rate limit **and** Cloudflare Turnstile on both checkouts and the donation
form. M7 (`mailchimp-subscribe`) is in the same roadmap cluster but not in this
brief. It is a different function with a different owner.

## What was wrong

**M2.** `ticket-checkout` and `film-pass-checkout` had no rate limit and no bot
check. That left three holes:

- **Card testing.** Anyone could test stolen cards against the theatre's
  merchant account, without limit.
- **Free showings.** A script could book out a free ($0) showing, which has no
  card step. Each booking also sent email or SMS to an address the script chose.
- **Junk accounts.** Both checkouts created an `email_confirm: true` auth
  account *before* pricing or validation, so even a request that got a 400 left
  an account behind. Those accounts feed H1.

`square-donation` was rate limited but had no Turnstile.

**L10.** Public paths sent back internal text:

- GoTrue's `createUser` errors (`ticket-checkout`, `film-pass-checkout`)
- a raw exception message (`square-donation`)
- `get_config`'s list of missing environment variable names
- Square's developer-facing decline detail, e.g. `Authorization error: 'CVV_FAILURE'`

**L16.** For $1, anyone could send a Kenworthy-branded tribute email to any
address, carrying their own text. That text was HTML-escaped, but mail clients
turn plain-text URLs into links. No donation field had a length cap, and
`notify_email` was never checked to be an email address.

## What changed

### Server

- **`_shared/turnstile.ts`** (new) is the one siteverify implementation.
  - `rental-request` now uses it. Its behaviour is **unchanged**: it still fails
    open when the secret is unset (`whenUnset: 'allow'`). It only writes a row
    that staff read by hand, and refusing it outright for a missing secret would
    take the form offline. That reasoning still holds.
  - The three money paths use `whenUnset: 'refuse'`: they **fail closed**.
    `TURNSTILE_SECRET_KEY` is set on staging and production, so an unset secret
    on a checkout means a deploy lost it. Failing open there would silently
    re-open card testing.
  - A check that could not be performed counts as a failure in both postures:
    Cloudflare unreachable, an answer that isn't JSON, a token that isn't a
    string, or a token over 2048 characters.
- **`_shared/rate_limit.ts`** adds two limits:
  - `ticketCheckout`: 60 per 10 minutes per IP
  - `filmPassOrder`: 20 per 10 minutes per IP

  It also adds one shared 429 sentence. No migration was needed:
  `check_rate_limit` takes any bucket name.

  *Why these numbers.* The limiter counts attempts, so a decline and its retry
  are two. A family uses two or three. The limit is set by a crowd behind one
  NAT: lobby Wi-Fi before a show, the campus network, a carrier's CGNAT. 60 per
  10 minutes is one attempt every 10 seconds, sustained, which is well past any
  of those. A single-address card tester gets a few hundred an hour instead of
  thousands. The box office never uses these endpoints (the counter uses
  `square-terminal` / `square-cash-sale`), so a busy night at the till cannot
  trip them. Passes are bought once a season, with up to 10 per order, so 20 is
  plenty. Donations stay at 15 per 10 minutes.
- **The order of checks in `ticket-checkout`** is now:
  1. shape checks (no network)
  2. **rate limit**
  3. read-only caller and contact checks
  4. **replay**
  5. **Turnstile**
  6. pricing
  7. availability
  8. per-buyer limit (checked against the contact's *existing* account, if any)
  9. **account created only now**
  10. pending rows
  11. charge
  12. confirm

  `film-pass-checkout`'s `order` follows the same order: shape (including the
  `source_id` check, which used to run *after* account creation), contact, rate
  limit, replay, Turnstile, pass read and pricing, fulfilment, account, pending
  order, charge.
  - *Why the account is not created after the charge.* `tickets.user_id` is
    nullable, so the pending rows *could* be ownerless and claimed afterwards.
    But then a paid order whose account creation fails is a paid order with no
    owner. The replay lookup could not find it, and delivery reads the owner to
    address the email. Those failures would land on someone who has already
    paid.
  - Creating the account later would only spare one case: a declined card.
    By then the request has passed the rate limit, Turnstile and every pricing
    and availability check. That is the same bar a successful free reservation
    clears, and a free reservation creates an account legitimately.
  - So the invariant "rows exist before money moves" is kept. **No request that
    fails a check creates an account.**
  - A new buyer whose lookup misses gets a second lookup inside
    `findOrCreateBuyer`. That is the same function, so the cost is extra calls,
    not new behaviour. If that second lookup finds an account made by a
    parallel request, the per-buyer limit is checked again for that account.
- **Replay** looks up the idempotency key first. That is an indexed read that
  finds nothing for an ordinary request. Only when a completed order with that
  key exists does it match the caller: by session, or a guest by contact lookup.
  A replay **skips Turnstile**. Its token was spent by the first attempt, and a
  replay writes nothing. A key that belongs to someone else's order is not a
  replay, and that caller goes through the bot check.
- **Free ($0) showings** take exactly the same path: rate limit, Turnstile, no
  account before validation. This is pinned by a test.
- **`square-donation`**:
  - order: rate limit → field validation → **Turnstile** → pending row → charge
  - validation stays ahead of Turnstile on purpose, so a typo the donor can fix
    does not spend their token
  - `notify_email` must now be an email address
  - the staff `record_in_person` action is untouched and not behind Turnstile
    (a test pins this)
- **L16 (`_shared/donations.ts`)**:
  - **Caps:** names 200, message 1000, emails 320, phone 40.
  - **Links are refused at the form, not stripped or defanged.** This applies to
    every field that reaches an email as prose: the donor's name, the name the
    gift honours, the name to notify, and the message. The refusal quotes the
    offending text.
  - *Why refuse rather than strip:* stripping silently edits a tribute, possibly
    one about a person who has died, and sends it in the donor's name. The donor
    is at the form and can be asked instead.
  - *Why refuse rather than defang:* defanging (`evil[.]example`) keeps the
    attack, because the lure is the text itself.
  - **At render**, `donationSummaryFromRow` replaces any link already in a stored
    row with `[link removed]`. This covers both emails and every donor-typed
    field, because the receipt also goes to an address the requester chose.
  - The link matcher covers schemes, `www.` and bare `name.tld`, for ccTLDs, the
    punycode form, and a list of common or abused generic TLDs. Using a list
    keeps names like `J.Smith` and `St.Louis` from being refused.
  - *Not covered:* a spelled-out lure ("evil dot example"). The caps bound it.
  - *Not done:* the audit's optional idea of staff review before the tribute is
    sent. It is a product decision, and is listed below.
- **L10.** `_shared/public_errors.ts` (new) holds the public wording:
  - Square declines are mapped by code. Security code, postcode, expiry and a
    spent card token each get a fixable sentence. Every other decline gets one
    generic sentence: saying *why* a bank refused tells a card tester which
    numbers are live.
  - A non-card Square failure says "not charged" and does not send the patron to
    their bank.
  - Account-creation failures, `get_config` with Square unconfigured, and
    `square-donation`'s catch-all now return generic text. The detail goes to
    the logs, and Square's detail is still written to the failed rows for staff.
  - Guest name, email and phone on both checkouts are capped at 200 / 320 / 40.

### Browser

- **`useTurnstileGate`** (new hook) and **`CheckoutTurnstile`** (new component)
  wrap the existing `Turnstile` widget. This reuses the rental form's code; it is
  not a second copy.
  - The button has the four states from #278: *Checking your browser…* while the
    check solves silently, *Tick the box above to continue* when Turnstile shows
    a checkbox, then the normal *Pay* label, then *Processing*. The
    "Checking your browser" label is never shown while the widget is waiting on
    the person.
- **Single-use tokens.** After any attempt that reached the server and failed,
  the page calls `refresh()`. That remounts only the widget, which gets a fresh
  token. The buyer's details and the card form stay as they were, so a declined
  card is "fix it, press Pay again".
  - A card that fails to tokenize in the browser never reached the server, so
    its token is kept.
  - The free-showing donation panel refreshes after a success too, so a second
    gift works.
- **Wired into:**
  - `GuestCheckoutForm` (the gate is a required prop owned by `Showing`)
  - the signed-in branch on `Showing.tsx`
  - the free-admission donation panel on `Showing.tsx`
  - `FilmPassPurchase`
  - `Donate`

  The `rsvp_url` line in `Showing.tsx` is untouched.
- **`Turnstile.tsx`** takes an optional `fallback`. It is needed because the
  "check could not run" message named the rental team's email address. Checkouts
  now point to the box office phone instead. The rental forms are unchanged.
- **`Donate`**: `maxLength` on every field, matching the server caps, plus a hint
  under the message field: "Sent by email with the notice. Please leave out web
  and email addresses."

### Changes patrons will see

- A Turnstile widget above every Pay, Reserve and Donate button. On
  kenworthy.org it may show a checkbox.
- New decline wording, and new 429 / 403 wording.
- A donation message containing a link, or any over-long field, is refused with
  a sentence that quotes the offending text.
- **A tab opened before the deploy** has no widget, so its checkout is refused
  once. The refusal tells the patron to reload.
- **Staff testing a purchase on the public page** go through the widget too.

## How it was proven

- **Handler harness** (`_shared/testing/handler_harness.ts`, test-only). It
  captures each function's real `Deno.serve` handler and answers every outbound
  call from a route table that records it, so nothing leaves the process: no
  email, no SMS, no Square. No real Square charge was made at any point.
  - `ticket-checkout/abuse_controls_test.ts` (11 tests): rate limit < Turnstile
    < pricing < account < rows on a free order; a pricing refusal creates no
    account; a failed bot check means no pricing, no lookup, no account and no
    rows; a missing token is refused without a siteverify call; an unset secret
    fails closed; a 429 comes before the bot check; a malformed request makes
    **zero** outbound calls; a replay skips Turnstile and does not echo
    `user_id`; another buyer's key is not a replay; GoTrue text is not
    returned; `get_config` names no environment variables.
  - `film-pass-checkout/abuse_controls_test.ts` (6) and
    `square-donation/abuse_controls_test.ts` (8) cover the same points for
    those paths, plus link, cap and `notify_email` refusals before the bot check
    and before any row, and staff actions not being behind Turnstile.
  - **Mutation check:** with `whenUnset: 'allow'` swapped in and the account
    creation moved back before pricing, 5 of the 11 ticket-checkout tests fail.
    Restoring the code makes all 11 pass.
- **Unit tests:**
  - `turnstile_test.ts` (6): both postures, token shapes, what is sent to
    Cloudflare, `timeout-or-duplicate`, unreachable
  - `public_errors_test.ts` (5)
  - `donations_test.ts`: 7 new (link detection, names that are not links, caps,
    links removed from both emails at render)
  - vitest: `useTurnstileGate.test.tsx` (3), and 3 new in
    `GuestCheckoutForm.test.tsx` (button held and labelled, the #278 label,
    free reservations gated)

## Deploy steps

No migrations. Four functions and the Worker. **Deploy the Worker first, then
the functions.** The old server ignores the new `turnstile_token` field. The new
server refuses requests that do not carry one. So functions-first would refuse
every checkout until the Worker ships.

1. **Preconditions, for each environment:**
   - `supabase secrets list --project-ref <ref> | grep TURNSTILE_SECRET_KEY` must
     list the secret. Checkout fails closed without it.
   - `.env.staging` and `.env.production` carry `VITE_TURNSTILE_SITE_KEY`
     (already true). This is the same widget the rental form uses, so its
     hostname list already covers the live domains.
2. **Staging:**
   - `npx wrangler deployments list --name kenworthy-ticketing-staging`, and
     record the rollback version.
   - `npm run build:staging && npx wrangler deploy --env staging`
   - Check the bundle carries the staging site key.
   - `supabase functions deploy ticket-checkout film-pass-checkout square-donation rental-request --project-ref rpqzrpboyhshdrfdwayk`
3. **Staging checks.** These use the anon key only. Each expected refusal writes
   nothing except a rate-limit counter row.
   - `ticket-checkout` `{"action":"create_purchase","showing_id":"x","tickets":[{}],"email":"probe@example.com","idempotency_key":"probe-key-0001"}`
     → **403** with the bot-check sentence.
   - `film-pass-checkout` `{"action":"order","pass_type_id":"x","source_id":"cnon:x","name":"Probe","email":"probe@example.com"}`
     → **403**.
   - `square-donation` `{"action":"create_payment","sourceId":"cnon:x","amountCents":100,"donorName":"Probe","donorEmail":"probe@example.com","message":"see evil.example.com"}`
     → **400** quoting `evil.example.com`.
   - The same body without `message` → **403**.
   - `{"action":"get_config"}` on each of the three → 200 with publishable ids.
   - `rental-request` `{}` → 403, unchanged.
   - **In a browser:** the widget appears above Pay on a showing page, a film
     pass page, /donate, and the free-showing gift panel.
   - **For the lead** (I was not allowed to do this): one Square-sandbox purchase
     with a decline test card, then a good card, *without reloading*. This proves
     the fresh-token retry end to end. Ticket and receipt mail go to the typed
     address, so use your own.
4. **Production:** the same sequence.
   - `npx wrangler deployments list --name kenworthy-ticketing-build` and record
     the rollback version.
   - Check whether production is ahead of main.
   - `npm run build:production`, confirm the production ref and site key are in
     the bundle, then `npx wrangler deploy`.
   - `supabase functions deploy ticket-checkout film-pass-checkout square-donation rental-request --project-ref vlmslygnimfbamrtwvyo`
   - Repeat the expected-refusal probes against production, with the anon key
     only.

## Rollback

**Roll back the functions first** (redeploy the four from the previous main),
then the Worker (`wrangler rollback <version>`). The reverse order leaves the old
page sending no token to a server that requires one.

`rental-request`'s behaviour did not change, so it can stay on the new code
either way.

## Left for others / decisions

- **`_shared/buyers.ts` (identity cluster).**
  - Export a create-only helper, so a new buyer is not looked up twice
    (`findUserByContact`, then again inside `findOrCreateBuyer`).
  - The replay ownership check uses `findUserByContact`. When identity moves to
    `auth.users`, it changes with it automatically.
- **`mailchimp-subscribe`** still returns Mailchimp's error JSON (L10's fourth
  location). That function is outside this cluster.
- **`MarqueeBookingForm`** (the rentals form) still shows "Checking your
  browser…" without `onInteractive`: the #278 mistake, still live there. It also
  never refreshes a spent token after a failed send. Neither is in this cluster.
- **`BRIEF-third-party-pentest-scope.md` §6** still lists `square-donation` as
  "rate limited only".
- **Optional staff review** of tribute notices before they are sent (audit L16):
  a product decision for Tom.
- **Square-side velocity rules**, suggested by the audit: a dashboard setting,
  not code.
