# Ticket Delivery — Confirmation Email & SMS

> How a purchased ticket actually reaches the customer. Written while fixing
> the launch blocker in `docs/briefs/BRIEF-ticket-email.md`, August 11 2026.

---

## What was broken

A live production purchase produced a ticket in the database and nothing else.
Three separate defects, all of which had to be fixed for a customer to end up
holding a scannable ticket:

**1. Nothing sent the ticket.** `guest-checkout` created the account, inserted
the ticket rows, fired a Mailchimp sync, and returned success. The Mailchimp
calls are marketing list management — tagging the buyer, recording an
e-commerce order. They do not deliver anything to the customer. There was no
transactional send at all, so "checkout succeeded" and "the customer has their
ticket" were unrelated facts.

**2. The signed-in path had the same hole.** The brief framed this as a guest
checkout problem, but `Showing.tsx`'s `handlePurchase` — the authenticated
path — inserted tickets client-side and navigated to `/my-tickets` with no send
either. Fixing only `guest-checkout` would have left every logged-in buyer
equally undelivered.

**3. The QR code was decorative.** `MyTickets.tsx` rendered an 8×8 grid whose
cells were coloured from `charCodeAt` of the ticket UUID. It looked like a QR
code. It could not be scanned, and it encoded nothing. Meanwhile
`TicketScanner.tsx` scans a real QR and matches the decoded string against
`tickets.qr_code`. So even a customer who found their way to their tickets had
nothing usable at the door.

Only the "forgot password" flow worked, which is why a password reset appeared
to fix things: it let the tester reach `/my-tickets`, where the ticket was
indeed stored — just not in a form anyone could scan.

**Not broken:** account creation, ticket storage, and pricing were all correct
throughout. The gap was entirely in delivery.

---

## How it works now

```
  purchase (guest or signed-in)
        │
        │  one order_token stamped on every ticket row in the purchase
        ▼
  send-ticket-confirmation          ← fire-and-forget, never blocks a purchase
        │
        ├── has email ──►  Resend  ──►  HTML email: a scannable QR per ticket,
        │                                order summary, link to the ticket page,
        │                                link to set a password
        │
        ├── has phone ──►  Twilio  ──►  SMS: title, showtime, seats, and a link
        │                                to the ticket page (an SMS cannot carry
        │                                a scannable QR)
        │
        │   both, when there are both — neither branch suppresses the other
        ▼
  outcome written back to every ticket row
  (confirmation_sent_at / confirmation_channel / confirmation_error)
  channel is 'email', 'sms', or 'email+sms' — what sent, not what was tried
```

### The order token

Tickets have no orders table. A shared random `order_token` per purchase stands
in for one, so a four-ticket purchase is **one** link rather than four. It is
also the bearer credential for the public ticket page: RLS never exposes it to
`anon`, so the only way to hold one is to have been sent it.

This is the same trade every emailed ticket makes — whoever holds the link
holds the ticket. It is deliberate, and it is what makes phone-only delivery
possible at all, since those customers have no session and may never create one.

### Pieces

| Piece | Path | Notes |
|---|---|---|
| Shared order model | `supabase/functions/_shared/tickets.ts` | Loading, showtime formatting, QR PNG rendering, URL building |
| Message composition | `supabase/functions/_shared/notify.ts` | Email HTML/text, SMS body, phone normalization — pure, unit-tested |
| Delivery | `supabase/functions/send-ticket-confirmation/` | Branches email/SMS, records the outcome |
| Public ticket endpoint | `supabase/functions/ticket-access/` | `?token=` → JSON, `?token=&qr=` → PNG. `verify_jwt = false` |
| Mobile ticket page | `src/pages/PublicTicket.tsx` (`/t/:token`) | The SMS link destination |
| Client helpers | `src/lib/tickets.ts` | Order fetch, ticket page path |
| Schema | `supabase/migrations/20260811120000_ticket_delivery.sql` | `order_token`, `confirmation_*` |
| Schema | `supabase/migrations/20260818214726_confirmation_channel_email_and_sms.sql` | Widens the channel CHECK to allow `email+sms` |
| Tests | `supabase/functions/_shared/tickets_test.ts` | 24 tests, incl. a QR decode round-trip |
| Tests | `supabase/functions/_shared/deliver_test.ts` | Which channels fire and what is recorded, incl. the retry guard |

### Design decisions worth knowing

**QR codes are rendered twice, on purpose.** In the app (`MyTickets`,
`PublicTicket`) they are drawn client-side with `qrcode.react` — instant, and
still works if the connection drops in the lobby once the page has loaded. For
**email** there is no JS, so `ticket-access?qr=` serves a real PNG over HTTPS
with a long cache lifetime. It has to be a hosted URL rather than a `data:`
URI, because Gmail and Outlook strip `data:` URIs in `<img>`.

Both paths encode the same thing: the exact `tickets.qr_code` string the door
scanner matches on. `tickets_test.ts` decodes the emailed PNG and asserts it
comes back byte-identical — "it renders" is not the bar, given the previous
implementation rendered something that looked like a QR and scanned as nothing.

The raw ticket code is also printed as text under every QR, so a customer with
images blocked still has something the box office can key in.

**Both channels fire when a customer gives both** (changed 2026-08-18). Email
used to win and stop, with SMS reserved for buyers who had given nothing else.
The text now goes alongside it, so a customer who hands over a number hears
immediately that their tickets are out rather than finding out whenever they
next open their mail. The email is still the one that matters at the door — it
carries the QR inline and works with no signal in the lobby — so the SMS is a
notification, not a substitute, and it costs a Twilio message per order with a
phone number on it.

**One channel getting through is a delivery.** The two sends are attempted
independently and neither can suppress the other, which is the failure this
shape exists to prevent: a working channel going unused because the other one
threw first. If either succeeds, `confirmation_sent_at` is stamped — that is
what stops a retry from texting someone twice — and the channel that failed is
written to `confirmation_error` *beside* it rather than instead of it. An order
with both columns set is one where the customer has their tickets and something
still wants looking at. `status: 'failed'` now means nothing reached them at
all.

Film passes are not on this path. `film-pass-checkout` calls
`sendTransactionalEmail` directly and confirms by email only, so a phone number
given on the pass form is never texted — which is why that form carries no SMS
consent line.

**A number is not consent.** Ticket checkout carries a separate SMS checkbox,
unchecked by default, and the buyer's answer travels with the order as
`sms_consent` — it is not inferred from the phone field being filled in. The
server cannot tell those apart from the number alone, and the distinction is the
whole of A2P 10DLC compliance: consent has to be an affirmative act about a
specific number.

`deliverConfirmation` takes `smsConsent` as three-valued on purpose:

| Value | Meaning | Effect |
|---|---|---|
| `true` | Asked and agreed | SMS sent |
| `false` | Asked and declined | SMS skipped entirely, **including** a number recovered from auth or `profiles` |
| `undefined` | No signal (operator resend, older client) | Previous behaviour, unchanged |

The `false` case is why this lives in the server and not only in the form. A
returning buyer whose number is already on their profile has not consented by
having bought before, and `deliverConfirmation` recovers a phone from `profiles`
when the caller does not supply one — so a client-side check alone would leak.
Declining is also **not** recorded as a `confirmation_error`: nothing went
wrong, and logging it would put every buyer who left the box unticked into the
list of orders that need looking at.

Known gap: consent is per-request, not stored. An operator resend through
`send-ticket-confirmation` carries no consent field and falls into the
`undefined` case, so it can text a stored number. Closing that means a
`sms_consent` column on `tickets`, read back through `loadOrder` — worth doing
before the volume justifies it, and required if resends ever become routine.

**The box office is not on this pipeline at all.** `StaffPOS` requires a patron
email or phone before it will take a sale, which reads as though a confirmation
follows. It does not. The screen inserts ticket rows straight into `tickets`
via `createTickets` and stops there — nothing in `src/` calls
`send-ticket-confirmation`, the POS never calls `ticket-checkout`, and no
database trigger dispatches on insert. The contact it collects reaches only the
donation record. That was true before phone collection was switched off and is
still true now; the counter's own copy was reworded on 2026-08-18 to say the
contact is how the box office reaches the patron, rather than implying a
delivery. Wiring the POS into `deliverConfirmation` is a separate piece of
work — it is the one purchase path where a patron can be charged and receive no
digital record of it at all.

**The password link is generated, not emailed by Supabase.**
`auth.admin.generateLink({ type: 'recovery' })` mints the link without sending
anything; we deliver it ourselves through Resend. That is what closes the
"account created silently with no way to reach it" gap **without** waiting on
the Supabase SMTP setup.

**Sends are fire-and-forget, so failures are recorded, not just logged.** A
provider outage must never fail a purchase that already succeeded. The flip
side is that silence is the default failure mode — which is exactly the bug
this replaces. Every outcome is therefore written to the ticket rows. See
*Monitoring* below.

**The dispatch is handed to `EdgeRuntime.waitUntil`.** A bare `void fetch(...)`
in an edge function can be killed when the isolate is torn down after the
response returns, dropping the send with no trace. `waitUntil` keeps it alive.
(The pre-existing Mailchimp calls in `guest-checkout` still use the bare form
and may be losing syncs for the same reason — worth revisiting, but it is a
marketing sync, not a ticket, so it was left alone here.)

**Never dispatch delivery over a function-to-function HTTP call.** This one
cost a full debugging session and produced exactly the failure this feature
exists to prevent.

`guest-checkout` (and later `ticket-checkout`) used to POST to
`send-ticket-confirmation` with the anon key in `apikey` and the service-role
key as a bearer. On 12 Aug 2026 Supabase rotated the auto-injected keys to the
new format — `SUPABASE_ANON_KEY` became `sb_publishable_…` and
`SUPABASE_SERVICE_ROLE_KEY` became `sb_secret_…` — and the gateway began
refusing that pair outright:

```
401 Conflicting API keys
"Send the intended sb_ key only in the apikey header."
```

The request never reached the sibling function. The dispatch is
fire-and-forget, so nothing ran to record a failure: purchases succeeded, cards
were charged, `confirmation_error` stayed **null**, and no ticket went out.
A null error is not the same as no error — it can mean the code never ran.

The sending logic therefore lives in `_shared/deliver.ts` and checkout calls
`deliverConfirmation()` **in-process**. No gateway, no credential to forward,
no second cold start on the path that matters. `send-ticket-confirmation`
remains only as an HTTP endpoint for operator resends.

Two related traps, both hit while diagnosing this:

- `sb_secret_…` is **not** accepted by the Functions gateway at all, in either
  header. Only the legacy `service_role` JWT and `sb_publishable_` work there.
- Do **not** authorize a function by string-comparing the bearer against
  `SUPABASE_SERVICE_ROLE_KEY`. The gateway does not reliably hand the function
  back the value the caller sent, so genuine service-role calls get refused.
  Read the `role` claim from the JWT instead — safe to trust, because with
  `verify_jwt = true` the gateway has already checked the signature.

**Import Supabase via `https://esm.sh/@supabase/supabase-js@2`.** This cost a
deploy cycle and is worth knowing before writing another edge function.

`npm:` specifiers are **not** broadly broken — `npm:pdf-lib@1.17.1` boots
fine in `sign-contract` today. Two specific things do break, and neither fails
under local Deno, so the failure only appears once deployed (`BOOT_ERROR`):

1. **Mixed versions of `@supabase/supabase-js` under `npm:`.** `sign-contract`
   imported `createClient` from `npm:...@2.45.0` and `corsHeaders` from
   `npm:...@2/cors`. Deno dedupes npm packages by name, so the `@2/cors`
   import resolved against the pinned 2.45.0 — and `./cors` was not added to
   the package's exports until after 2.50.0 (verified: absent in 2.45.0 and
   2.50.0, present in 2.96.0). esm.sh resolves each URL independently, so it
   never hits this. `guest-checkout` has always used the esm.sh form and has
   always booted, which makes it the reference to copy.

2. **npm packages that need node streams or zlib.** `npm:qrcode` pulls in
   pngjs and fails. QR PNGs are therefore generated from `qrcode-generator`
   (pure JS, no dependencies) plus a small PNG encoder in `_shared/tickets.ts`
   written against Web APIs only — `CompressionStream('deflate')` produces
   exactly the zlib-wrapped stream a PNG IDAT expects.

The habit that catches all of this: **local `deno check` and `deno test`
passing proves nothing about whether a function boots.** Always curl the
deployed function. A function with `verify_jwt = true` returns a gateway `401`
*before* it ever boots, so an auth-shaped error does not mean the code is
healthy — pass a valid anon key and look for `BOOT_ERROR`.

**Phone numbers are normalized before sending.** Checkout collects them as
typed — `(208) 892-9752`, `208.892.9752`. Twilio only accepts E.164 and
silently rejects anything else, so `toE164` normalizes and refuses numbers it
cannot make valid, recording a real reason instead of firing a doomed request.

---

## Setup runbook

Nothing below is done yet — this is what turns the code on. **Staging first,
verify, then production**, for every step.

### 1. Resend (transactional email)

1. Create the account and add `kenworthy.org` as a sending domain.
2. Add the DNS records Resend provides (SPF/DKIM, and DMARC if not already
   present). Deliverability will be poor until these verify.
3. Create an API key.

The from address is `tickets@kenworthy.org` (decided). It is separate from the
`events@kenworthy.org` inbox staff read; replies are routed there via
`reply_to`.

> Until the domain verifies, Resend only delivers to the account owner's own
> address. That is enough to test the email path end to end.

### 2. Twilio (SMS)

1. Create the account, buy a number with SMS capability.
2. For US A2P 10DLC, register the brand and campaign — **this takes days to
   approve**, so start it early. Unregistered traffic gets filtered by carriers.
3. Collect the Account SID, Auth Token, and either the number or a Messaging
   Service SID.

### 3. Function secrets

Per project (staging and production separately):

```bash
supabase secrets set \
  RESEND_API_KEY=re_xxx \
  TICKET_FROM_EMAIL='The Kenworthy <tickets@kenworthy.org>' \
  TICKET_REPLY_TO='events@kenworthy.org' \
  TWILIO_ACCOUNT_SID=ACxxx \
  TWILIO_API_KEY_SID=SKxxx \
  TWILIO_API_KEY_SECRET=xxx \
  TWILIO_FROM_NUMBER='+1208XXXXXXX' \
  SITE_URL='https://<this-environment-url>'
```

| Secret | Required for | If missing |
|---|---|---|
| `RESEND_API_KEY` | Email | Email path records `RESEND_API_KEY is not configured`, purchase still succeeds |
| `TICKET_FROM_EMAIL` | Email | Defaults to `The Kenworthy <tickets@kenworthy.org>` |
| `TICKET_REPLY_TO` | Email | Defaults to `events@kenworthy.org` |
| `TWILIO_ACCOUNT_SID` | SMS | Always required — it identifies the account in the request URL, in both auth modes |
| `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` | SMS | **Preferred.** Scoped and revocable, so a leak does not expose the master account. The key SID is the Basic Auth *username* and the secret the password; the account SID stays in the URL |
| `TWILIO_AUTH_TOKEN` | SMS | Fallback when no API key is set. Twilio recommends against it in production |
| `TWILIO_FROM_NUMBER` *or* `TWILIO_MESSAGING_SERVICE_SID` | SMS | As above. Messaging Service is preferred when present |
| `SITE_URL` | Both | **Set this per environment.** Defaults to the production URL, so an unset staging value puts production links in staging emails |
| `VENUE_TIME_ZONE` | Both | Defaults to `America/Los_Angeles` |

### 4. Migration and deploy

```bash
# staging
supabase link --project-ref rpqzrpboyhshdrfdwayk
supabase db push
supabase functions deploy ticket-access send-ticket-confirmation guest-checkout

# production, only after staging is verified
supabase link --project-ref vlmslygnimfbamrtwvyo
supabase db push
supabase functions deploy ticket-access send-ticket-confirmation guest-checkout
```

> **Status 2026-08-11/12:** both projects are done. The migration is applied to
> production and staging, and `ticket-access`, `send-ticket-confirmation` and
> `guest-checkout` are deployed to both. Provider secrets are still unset on
> both, so delivery records `confirmation_error` and purchases still succeed.
>
> Two things learned doing it. `supabase functions deploy` takes
> `--project-ref`, so it never touches the shared `supabase/.temp/project-ref`
> — prefer it. `db push` has no such flag: re-link, push, then re-link back and
> verify. And `db push` applies **every** pending migration, so check
> `supabase migration list` first and temporarily move other people's pending
> files aside if you mean to apply only your own. Staging needed
> `--include-all` because a newer migration had already landed there.

> **SMS activation status, 2026-08-18.** Two flags now, not one, because
> "show the phone field" and "a phone number is a contact we can deliver to"
> stopped being the same question:
>
> - `COLLECT_PHONE` is **`true`** — the field and its consent line are live on
>   ticket checkout, film passes and the box office.
> - `SMS_DELIVERY_LIVE` is **`false`** — email is still required at ticket
>   checkout, so nobody can buy with a contact we cannot reach.
>
> `sendViaTwilio` was complete the whole time and did not change; what did
> change is that `deliverConfirmation` now sends on both channels rather than
> treating SMS as the phone-only fallback, which needs the migration above
> applied before the functions deploy.
>
> **The blocker is an A2P 10DLC campaign, not the code.** Brand approval is not
> campaign approval, and the two were conflated when this was scoped. Without a
> registered campaign attached to the Messaging Service, US carriers reject
> every long-code send outright with error 30034 — no credential fixes that.
> Registration lives at Messaging → Regulatory Compliance → A2P 10DLC, wants a
> use case, a sample message and a description of how buyers opt in, and takes
> days rather than minutes. The consent line on the checkout form is the opt-in
> evidence that submission asks for, which is exactly why the field ships ahead
> of the texts.
>
> **The secrets are done, and both were misnamed before they were.** As of
> 2026-08-18 22:00Z staging and production each hold `TWILIO_ACCOUNT_SID`,
> `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` and
> `TWILIO_MESSAGING_SERVICE_SID`, with matching digests — one live Twilio
> account shared by both, no sandbox. Production still carries a stale, unread
> `TWILIO_API_KEY`.
>
> Getting there took two rounds of the same mistake, which is the part worth
> remembering. The API key SID was first set as `TWILIO_API_KEY`, and the
> Messaging Service SID was first set on staging as
> `TWILIO_MESSAGING_SERVICE`. Both looked present in `secrets list`; neither
> was a name `deliver.ts` reads, so `twilioAuth()` saw no credential and
> `sendViaTwilio()` saw no sender. A digest proves a value is set, never that
> it is set under the right key — diff the names against the `Deno.env.get`
> calls before believing an integration is configured.
>
> **Advanced Opt-Out is enabled** on the Messaging Service (2026-08-18), with
> HELP, STOP and START responses that name the theatre and give its phone and
> email. That is what makes the `/sms` page and the checkout consent line
> truthful about STOP and HELP — nothing in this repo answers an inbound text,
> and there is no webhook here to add one. It is also close to one-way: Twilio
> can only disable it via a support request, so treat it as a standing
> commitment rather than a setting.
>
> Flip `SMS_DELIVERY_LIVE` only once the campaign is approved too, and only
> after a phone-only test purchase has actually arrived. Flipping it early is
> the exact regression the original flag was added for on 2026-08-15: the buyer
> is charged and delivered nothing, silently, because delivery is
> fire-and-forget and the only trace is `orders.confirmation_error`. Test to
> your own mobile — staging carries the same live Twilio credentials as
> production, so that send is real and billed.

`ticket-access` must deploy with `verify_jwt = false`. That is set in
`supabase/config.toml`; confirm it took, because the QR images and the ticket
page are fetched by browsers and mail-client image proxies that cannot present
a JWT. If they 401, this is why.

Then rebuild and deploy the frontend for the new `/t/:token` route
(`npm run build:staging` / `npm run build:production`).

### 5. Auth emails — Send Email Hook, no SMTP

**SMTP is not used anywhere and is not needed.** Auth email goes through
Resend's API via `send-auth-email`, which implements Supabase's Send Email
Hook. With the hook enabled, Supabase stops mailing users itself and calls the
function instead, so password resets, signup confirmations, magic links and
email changes all route through Resend.

Steps, per project (**staging first**):

1. Deploy the function — it must have JWT verification off, which
   `supabase/config.toml` already sets:
   ```bash
   supabase functions deploy send-auth-email --project-ref <ref>
   ```
2. Dashboard → **Authentication → Hooks**
   (direct: `https://supabase.com/dashboard/project/<ref>/auth/hooks`).
3. Add a **Send Email hook**, hook type **HTTPS**, URL:
   `https://<ref>.supabase.co/functions/v1/send-auth-email`
4. Click **Generate Secret**, copy the `v1,whsec_…` value, then **Create**.
5. Store it immediately:
   ```bash
   supabase secrets set SEND_EMAIL_HOOK_SECRET='v1,whsec_…' --project-ref <ref>
   ```
6. Test a real password reset from `/auth` before doing the other project.

> ⚠️ Between step 4 and step 5 **all auth email fails**. The function refuses
> unsigned requests rather than sending them, which is the correct trade — an
> endpoint that sends password-reset links without checking the signature is an
> open relay — but it means the gap is real. Have the secret command ready.

The hook contract this function implements: the payload carries `user` and
`email_data`, and the link is built as
`${SUPABASE_URL}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${redirect_to}`.
An empty 200 means success; anything else surfaces to the user as a failure.

Supabase's built-in mailer is rate-limited and unsuitable for production
volume, which is the whole reason for routing around it.

---

## Testing end to end

Run on staging, then repeat on production with a real purchase you then clean
up.

**Email path**
1. Buy a ticket as a guest with an email address.
2. Confirm the browser lands on `/t/<token>` showing the ticket.
3. Confirm the email arrives with a QR image per ticket.
4. **Scan the QR out of the email with `/admin/scanner`.** This is the real
   test — it verifies the QR encodes the value the scanner matches on. A QR
   that renders but does not scan is precisely the bug that was there before.
5. Click "Set your password", complete it, confirm `/my-tickets` shows the
   ticket.
6. Buy a second time as the same person while signed in; confirm that email
   arrives too (the authenticated path is a separate code path).

**SMS path**
1. Buy a ticket as a guest with **only** a phone number.
2. Confirm the SMS arrives and the link opens `/t/<token>` on the phone.
3. Scan the QR off the phone screen with the scanner.

**Multi-ticket**
Buy 3 tickets in one order. Confirm one email/SMS, one link, three distinct
QRs, and that each scans independently.

**Failure handling**
Temporarily unset `RESEND_API_KEY` on staging and buy a ticket. The purchase
must still succeed, and `confirmation_error` must be populated on the ticket
rows. Silence is the thing being engineered out.

---

## Monitoring

Undelivered tickets are visible in SQL. Worth a look after launch, and a
candidate for an admin panel later:

```sql
SELECT order_token,
       MIN(purchased_at)         AS purchased_at,
       COUNT(*)                  AS tickets,
       MAX(confirmation_error)   AS last_error
  FROM public.tickets
 WHERE confirmation_sent_at IS NULL
   AND purchased_at > now() - interval '30 days'
 GROUP BY order_token
 ORDER BY purchased_at DESC;
```

A row lingering here for more than a minute or two means a customer did not get
their ticket.

**Resending** is a POST to `send-ticket-confirmation` with the order token.
Repeat sends are refused unless forced, so a retry cannot text someone twice:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-ticket-confirmation" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"order_token":"...","force":true}'
```

It also accepts `email`, `phone`, and `name` overrides, which is how a
confirmation can be redirected to someone other than the account holder.

---

## Found while deploying — outside this brief, not fixed

Verified against production on Aug 11 2026 by calling each function with a
valid anon key:

- ~~**`sign-contract` returns `BOOT_ERROR`**~~ — **fixed and deployed
  2026-08-11.** Its two `@supabase/supabase-js` imports now come from esm.sh;
  `pdf-lib` was left on `npm:` and boots fine, which is what isolated the
  cause. It now returns its own `{"error":"Not authenticated"}` for an
  unauthenticated call instead of a 503. **Not functionally re-tested** — a
  real signature run needs an admin session and a live rental request, so the
  signing, PDF-stamping and Ed25519 paths are unverified since the fix. Worth
  one manual contract signature before launch.
- **`mailchimp-subscribe`, `mailchimp-ecommerce`, `qbo-sync` and
  `lgl-sync-donation` are not deployed to production** (`404`). `guest-checkout`
  calls the first two fire-and-forget, so the Mailchimp tagging and e-commerce
  sync have been silently doing nothing on production this whole time. Deploy
  them, or accept that marketing sync is staging-only for now.

## Known gaps

- **Comp tickets** issued from `HostDashboard.tsx` do not send a confirmation.
  They carry `comp_recipient_email`, so they could — wiring is straightforward
  and was left out as beyond this brief's scope.
- **Refunds and cancellations** send nothing. Out of scope here.
- **No admin UI** for undelivered tickets; the SQL above is the current answer.
- **Legacy tickets** each got their own `order_token` in the backfill rather
  than being grouped into their original purchases — there was no reliable
  grouping to recover retroactively. They display and scan correctly; they just
  are not grouped.
- **Supabase SMTP** is still unconfigured, so auth emails (password resets not
  originating from a ticket confirmation) still ride the rate-limited built-in
  mailer.
