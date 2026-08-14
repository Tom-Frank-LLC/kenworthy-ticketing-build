# Donations

How a gift reaches the Kenworthy, what happens to it after the money moves, and
what was broken before August 13, 2026.

Companion to `docs/briefs/BRIEF-donations.md` (the request) and `docs/TICKET-DELIVERY.md`
(the same fire-and-forget-delivery discipline, for tickets).

---

## What the verification actually found

The brief assumed the donation pipeline worked and only the emails were
missing. Two of its four Part A checks turned out to be false, and both explain
symptoms nobody had connected to a cause.

### 1. `lgl-sync-donation` was deployed nowhere

```
npx supabase functions list --project-ref rpqzrpboyhshdrfdwayk   # staging
npx supabase functions list --project-ref vlmslygnimfbamrtwvyo   # production
```

Every other function is ACTIVE on both projects. `lgl-sync-donation` appears on
neither. It has never run. `square-donation` fire-and-forgets a POST to it after
every successful gift, so every one of those POSTs has been a 404 — and because
nothing awaits a fire-and-forget call, nothing was ever recorded, logged, or
noticed. No donation has ever reached Little Green Light, and no
`lgl_sync_error` was written to say so, which is why the admin's LGL tab shows
gifts sitting at "pending" rather than "failed".

**This was not a missing API key.** Setting `LGL_API_KEY` (done August 13) was
necessary and would not have been sufficient.

### 2. Even deployed, that call could not have worked

`square-donation` sent the anon key as `apikey` **and** the service-role key as
`Authorization: Bearer`. That is the exact credential pair the Supabase gateway
began rejecting with 401 "Conflicting API keys" when the injected keys moved to
the `sb_publishable_` / `sb_secret_` format — the same failure documented at the
top of `_shared/deliver.ts`, which is why ticket delivery moved in-process. The
donation path had the identical bug and had not been fixed with it.

So the fix is structural, not a redeploy: the sync logic now lives in
`_shared/lgl.ts` and is **called in-process**. `lgl-sync-donation` remains as a
thin HTTP wrapper because the admin backfill button genuinely is an HTTP caller
— and it is now admin-gated, which it was not before.

### 3. The "no email" bug had two separate causes

- **The donor receipt never existed.** `square-donation` sent no email of its
  own. The receipt the thank-you screen promised was Square's own card receipt,
  which the sandbox does not send at all — so in testing the donor got nothing,
  and in production they got a card receipt with no EIN and no
  no-goods-or-services statement, which is not usable as a tax record.
- **The tribute notification was never implemented.** `notify_name` /
  `notify_email` were collected on the form, validated, and stored. Nothing read
  them.

### 4. Things found in passing, not fixed here

Out of scope for this change, worth a decision:

- **The Mailchimp functions are deployed nowhere either.** `mailchimp-subscribe`,
  `mailchimp-ecommerce`, `mailchimp-webhook`, `mailchimp-campaign` and
  `mailchimp-bootstrap` are absent from both projects, and no `MAILCHIMP_*`
  secret is set on either. Every marketing sync in `square-donation`,
  `ticket-checkout` and `film-pass-checkout` is firing into a 404. The
  `mailchimp-ecommerce` calls also use the conflicting-keys header pair above.
- **SMS ticket delivery cannot authenticate.** `deliver.ts` reads
  `TWILIO_API_KEY_SID`; the secret that is actually set on both projects is
  named `TWILIO_API_KEY`, and `TWILIO_AUTH_TOKEN` is not set. `twilioAuth()`
  therefore returns "Configure TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET
  (preferred), or TWILIO_AUTH_TOKEN" for every phone-only order. Renaming the
  secret to `TWILIO_API_KEY_SID` is a one-line fix, on both projects.

---

## The pipeline now

```
                         Donate page          Ticket checkout          Box office
                              |                     |                      |
                     square-donation        ticket-checkout            StaffPOS
                    (create_payment)   (tickets+tax+gift, one charge)      |
                              |                     |          square-donation
                              |                     |         (record_in_person)
                              \                     |                      /
                               \------------- donations row --------------/
                                                    |
                                            settleDonation()
                                          (waitUntil, in-process)
                                    /                              \
                        deliverDonationEmails              syncDonationToLgl
                        receipt -> donor                   constituent + gift
                        tribute -> notify_email            -> lgl_gift_id
```

One settlement path for all three doors — `settleDonation()` in
`_shared/donations.ts`. A gift made at the counter is acknowledged and posted to
the CRM exactly the way one made on the Donate page is.

**Every outcome is written back to the donation row**: `confirmation_sent_at` /
`confirmation_error`, `notify_sent_at` / `notify_error`, `lgl_synced_at` /
`lgl_sync_error`. This is the whole point. A fire-and-forget send that fails
silently is what let this go unnoticed for months, so nothing here is allowed to
fail quietly. The admin LGL tab surfaces all of it and offers a "Resend receipt"
button.

### The two emails

Composed in `_shared/donations.ts`, tested in `donations_test.ts`.

| | Donor receipt | Tribute notice |
|---|---|---|
| To | `donor_email` | `notify_email` |
| Sent when | always, if we have an address | only with a real dedication (`in_honor`/`in_memory` **and** a name) |
| Amount shown | yes — it is a tax document | **never** |
| Carries | amount, date, dedication, EIN 82-0519693, the no-goods-or-services statement, Square receipt link if any | who gave, in whose honour/memory, their message |

The receipt does not depend on Square having sent anything, so it works
identically in sandbox and production. That was the original bug.

---

## Tax treatment (Part C)

**A donation is never taxed, on any path.** The mechanism is structural rather
than a rule someone has to remember:

- `priceTicketOrder()` computes tax per ticket row and knows nothing about
  donations. It cannot tax a gift because it never sees one.
- `readDonationCents()` (also in `_shared/pricing.ts`) validates the gift
  separately, and the caller adds it to the charge **after** pricing:
  `chargeCents = order.amountCents + donationCents`.
- The gift is recorded as a `donations` row, never as ticket revenue. The QBO
  export already books every completed donation to `donation_designation`
  (contribution income) with no sales-tax line — see `QboExportTab.tsx` — so a
  bundled gift lands in the right account with no accounting change needed.

A $5 gift on a $9.00 ticket: tax is `0.06 × 9.00 = 0.54`, exactly as without the
gift; the card is charged `9.00 + 0.54 + 5.00 = 14.54`.

**Refunds.** `square-refund` refunds the sum of the ticket rows, so refunding a
ticket order returns the ticket money and leaves the gift with the theatre —
which is correct. Reversing a donation is a deliberate act, done from Square.

---

## Online checkout (Part D)

`Showing.tsx` shows the prompt (`DonationPrompt`, shared with the POS) below the
order summary: **No thanks / $1 / $5 / $10** plus a custom field, defaulting to
no gift. `donation_cents` goes to `ticket-checkout`, which:

- charges tickets + ticket tax + gift as **one** Square payment;
- writes the `donations` row only after the charge succeeds, with `source =
  'ticket_checkout'`, the order's `order_token` and `showing_id`, and the Square
  payment id — so a day's gifts reconcile against a day's payments;
- calls `settleDonation()` for the receipt and the LGL gift.

The gift gets its **own** email rather than a line in the ticket confirmation: a
contribution receipt is a tax document and has to stand alone. The ticket
confirmation is unchanged, and the success toast thanks the buyer for the gift.

A **free ($0) showing with a gift attached** now takes a card. The
`$0-skips-Square` rule keys off the charged total, not the ticket total.

Limits: `$1` minimum (the `donations` table's own CHECK) and `$1,000` maximum
per checkout (`MAX_BUNDLED_DONATION_CENTS`, mirrored in the client). A larger
gift belongs on `/donate`, which allows up to $100,000.

---

## Box office (Part E)

**Can the Square reader show a donation button during a transaction? No.** A
Square Terminal runs Square's own checkout UI; we hand it an amount and cannot
inject a button into it. The only donation-shaped thing it offers natively is a
tip prompt, and a tip is not a tax-deductible gift.

So the prompt lives in our UI. `StaffPOS` shows the same `DonationPrompt`, adds
the gift to the combined amount sent to the terminal (or to the cash the staffer
collects), and then calls `square-donation` with `action: 'record_in_person'` —
a staff-authenticated server action, because the `donations` table grants INSERT
to `service_role` alone.

Notes:

- A counter gift is filed against the sale's `order_token`, so it reconciles
  against the tickets sold with it.
- A walk-in with no email still gets recorded (`donor_email` is now nullable),
  labelled "Box office donor". No receipt can be sent, and the LGL sync skips it
  with `lgl_sync_error = "No donor email — recorded locally, not synced to LGL."`
  rather than seeding the donor database with an unreachable constituent.
- If recording the gift fails after the sale went through, the staff member is
  told, loudly, to tell a manager. The money has already moved; the sale is not
  rolled back.
- **A donation-only sale (no tickets) is not supported at the POS.** The prompt
  rides on a ticket sale. If the box office wants to take a standalone gift,
  that is a small follow-up.

---

## Deploying this

**Order matters. The migration must land before the functions.** The new code
inserts `source` and `payment_channel`; against an un-migrated database that
insert fails and donations stop working.

```sh
# 1. Migration first, on each project.
#    `db push` takes no --project-ref — it follows the CLI link, so set and
#    verify that first. See PLATFORM.md §4.3.
npx supabase link --project-ref rpqzrpboyhshdrfdwayk
npx supabase db push --linked --dry-run   # read the list before applying
npx supabase db push --linked

# 2. Then the functions
npx supabase functions deploy square-donation lgl-sync-donation ticket-checkout \
  --project-ref rpqzrpboyhshdrfdwayk

# 3. Then the site
npm run build:staging
```

`lgl-sync-donation` has never been deployed — deploying it is part of the fix,
not a redeploy. Curl it after deploy; a local check cannot detect a dead
function (see `docs/PLATFORM.md`).

### Still open: staging safety

`LGL_API_KEY` is the **same key on staging and production** (identical digests in
`supabase secrets list`). Until that changes, a test donation from staging posts
a real gift to the live donor database. Before testing donations on staging,
either:

- set a separate LGL sandbox key on staging, or
- leave `app_config.lgl_sync_paused = true` on staging (the superadmin toggle in
  the admin LGL tab). The sync honours it and records why it skipped.

The second is a one-click answer and is what the LGL tab's pause switch exists
for.

---

## Test plan

1. **Standalone gift with a dedication** (`/donate`, sandbox card
   `4111 1111 1111 1111`): donor receipt **and** tribute notice arrive; the row
   shows `confirmation_sent_at`, `notify_sent_at`, and either `lgl_gift_id` or a
   `lgl_sync_error` that explains itself.
2. **Bundled gift**: buy one $9 ticket with a $5 donation. Tax is $0.54 (tickets
   only), the card is charged $14.54, a `donations` row appears with
   `source = 'ticket_checkout'` and the order's token, and the buyer gets a
   ticket email and a separate receipt.
3. **Free showing + gift**: the card form appears and $5 is charged.
4. **Box office**: a POS sale with a $1 gift — the terminal is handed the
   combined amount, tax covers tickets only, the gift is recorded with
   `source = 'staff_pos'`.
5. **Accounting**: run the QBO export over the range; the gifts appear under the
   donation designation account, separate from ticket revenue, untaxed.

Automated coverage: `deno test --allow-env --node-modules-dir=none
supabase/functions/_shared/` (donation email composition, donation validation)
and `npm test` (the prompt's dollars-to-cents arithmetic and its floor/ceiling).
