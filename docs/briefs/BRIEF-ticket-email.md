---
brief: ticket-email
title: Missing Ticket Confirmation & Account Emails
status: shipped
track: ops
date: 2026-08-11
shipped_in: ["a72aabe", "23d6bd3", "202c6a2", "cb17100", "fc44c33", "6ddfa72", "3de95a8", "#91", "2bb68d4"]
shipped_at: 2026-08-22
verified: true
evidence: 20 email + 1 email+sms confirmations delivered in production (tickets.confirmation_sent_at), Send Email Hook live on both projects
---

# Brief: Missing Ticket Confirmation & Account Emails

**Status:** ✅ **Shipped.** Closed 22 August 2026 after checking the running
system rather than the commit log — see *Outcome* at the end for what was
confirmed, and the four things deliberately left open.
**Date:** August 11, 2026
**Reported by:** Tom (live purchase test on production)

> **Implementation:** see `docs/TICKET-DELIVERY.md` for what was built, the
> setup runbook, and the end-to-end test plan.
>
> **Decisions taken:** Resend for transactional email · from `tickets@kenworthy.org`
> · QR embedded in the email as a hosted PNG *and* on a public mobile ticket
> page · Twilio for SMS.
>
> **Two things this brief did not anticipate**, both found during the build and
> both fixed:
> 1. The **signed-in checkout path** (`Showing.tsx` → `handlePurchase`) had the
>    identical gap. The brief scoped the problem to `guest-checkout`; fixing
>    only that would have left every logged-in buyer undelivered.
> 2. The **QR code was decorative**. `MyTickets.tsx` rendered a grid coloured
>    from `charCodeAt` of the ticket UUID — it looked like a QR and encoded
>    nothing, while `TicketScanner` matches a real QR against `tickets.qr_code`.
>    So "link to view tickets in their profile" would not have produced a
>    scannable ticket either. Real QR generation is now the backbone of both
>    the email and the ticket page.

---

## Symptoms observed

A real purchase test on production revealed:

1. Purchased a ticket with an **email address** → no ticket delivered, no email received.
2. Purchased a ticket with a **phone number** → no ticket delivered, no message received.
3. The email purchase **did** create a `uid` profile in Supabase (account creation worked).
4. **No account/welcome email** was received either.
5. Using **"forgot password"** did send an email successfully → after resetting, the purchased ticket **was** correctly stored on the profile.

So: account creation and ticket storage work. The gap is entirely in **notification/delivery** — nothing emails the customer at purchase time, and the account is created silently.

---

## Root cause

Two independent causes, both confirmed in code and config:

### 1. `guest-checkout` never sends a confirmation email
The `guest-checkout` edge function (which handles ticket purchase) does the following, in order:
- Finds or creates the user account
- Enforces ticket limits
- Inserts ticket rows (pricing set by DB trigger)
- Fires a **Mailchimp** sync (tag as ticket-buyer + e-commerce order) — *fire-and-forget, marketing only*
- Returns success

**There is no step that sends the customer their ticket / confirmation.** The Mailchimp calls are marketing list management, not transactional ticket delivery. So the function working "successfully" still results in the customer receiving nothing.

### 2. No SMTP provider configured in Supabase
The account is created with `email_confirm: true` (auto-confirmed, so no verification email is expected — this is intentional for guest checkout). But separately, **no custom SMTP is configured** on the Supabase projects yet. Supabase's built-in email service is rate-limited and unreliable for production, which is why:
- The "forgot password" email *did* arrive (low volume, squeaked through the built-in service)
- But this won't hold up under real traffic

The SMTP setup was already flagged as pending — we're waiting on Kenworthy's email provider details.

---

## What needs to be built/fixed

### A. Transactional ticket confirmation email (the core gap)
Add an email send to `guest-checkout` (and any authenticated-user checkout path) after tickets are successfully created. The email should include:
- Confirmation of purchase (film/event title, date, time, venue)
- Ticket details (quantity, seats if assigned, total paid)
- The QR code(s) for entry — or a link to view tickets in their profile
- A link to set a password / access their account (for newly created guest accounts)

**Delivery mechanism decision needed:** Two options —
- **Resend** (already anticipated in project planning; clean API, good deliverability, fits the stack). Would be a new transactional email function.
- **Kenworthy's existing email provider** via SMTP — if it supports transactional API sending. Depends what they use.

Recommendation: Resend for *transactional* email (tickets, receipts) even if Supabase *auth* emails route through Kenworthy's SMTP. Transactional and marketing/auth email are different concerns and can use different providers.

### B. Account access for guest-created accounts
When a guest checks out and an account is silently created, they currently have no way to know they have an account or how to access it. Options:
- Include a "set your password" magic link in the confirmation email, OR
- Clearly message at checkout that an account was created and how to access their tickets.

### C. SMS ticket delivery for phone purchases
When a customer purchases with a phone number, deliver the ticket via SMS. Requires:
- An SMS provider (Twilio is the standard choice; needs account + API credentials).
- A `send-ticket-sms` function (or a combined `send-ticket-confirmation` that branches on email vs. phone).
- SMS body: film/event title, date/time, venue, quantity, and a link to a mobile-friendly ticket page showing the scannable QR (SMS can't reliably embed a QR image).
- Called from `guest-checkout` after ticket insert, same fire-and-forget pattern as email.

### D. SMTP for Supabase auth emails
Configure custom SMTP on both Supabase projects (staging + production) once Kenworthy provides their provider details. This covers password resets, magic links, and any auth-related email at production scale.

---

## Open questions / decisions

1. **Transactional provider:** Resend vs. Kenworthy's SMTP for ticket confirmations? (Recommend Resend.)
2. **QR delivery:** Embed QR image in email, or link to profile page where tickets live? (Embedding is more convenient for the customer at the door.)
3. **Phone-only purchases → SMS delivery (DECIDED):** When a customer purchases with a phone number, they must receive their ticket via **SMS**. This is a required delivery channel, not optional. Needs an SMS provider (e.g. Twilio) and a `send-ticket-sms` path parallel to the email path. The SMS should include the essential ticket details and a link to view/display the QR code (SMS can't embed a scannable QR reliably, so link to a mobile-friendly ticket page). Currently phone-only purchasers have no delivery path at all — this is a launch blocker.
4. **Existing failed test purchases:** The test tickets created during this diagnosis exist in production — clean them up before launch.

---

## Suggested sequence

1. Decide transactional email provider (likely Resend) — get API key.
2. Set up SMS provider (Twilio) — get account + API credentials.
3. Write a `send-ticket-confirmation` edge function that branches: email → transactional email with QR; phone → SMS with ticket link.
4. Call it from `guest-checkout` after ticket insert (fire-and-forget so it never blocks the purchase, but log failures).
5. Build a mobile-friendly public ticket page (QR display) for the SMS link to point at.
6. Configure Supabase SMTP for auth emails (pending Kenworthy provider).
7. Test end-to-end on staging (both email and phone paths), then production.
8. Clean up test purchase data from production.

---

## Outcome — closed 22 August 2026

Checked against the running system, not the commit log.

| Brief item | Outcome |
|---|---|
| **A.** Transactional confirmation email with QR | ✅ 20 email confirmations delivered in production |
| **B.** Account access for guest-created accounts | ✅ Shipped, then corrected — the password link is offered only to someone who has never signed in, so returning customers are not told an account was made for them |
| **C.** SMS for phone-only purchases | ✅ Delivered by `BRIEF-reactivate-phone-sms.md`; Twilio via restricted API key + Messaging Service, A2P campaign approved, first production text 20 Aug |
| **D.** SMTP for Supabase auth email | ✅ **Obsoleted, not done.** A Send Email Hook routes every auth email through Resend's API, so no SMTP is configured anywhere and the rate-limited built-in mailer is unused |
| **Q4.** Clean up production test purchases | ❌ Open — see below |

Follow-on briefs also closed three gaps this brief's implementation had left:
an admin undelivered-orders card, per-order SMS consent, and the box-office
send from the POS.

### What the brief did not anticipate

Recorded because each cost real time and none were visible from the brief:

1. **The signed-in checkout path had the same gap.** The brief scoped the
   problem to `guest-checkout`; every logged-in buyer was equally undelivered.
2. **The QR code was decorative** — a grid coloured from `charCodeAt` of the
   ticket UUID, which looked like a QR and encoded nothing, while the scanner
   matched against `tickets.qr_code`. "Link to view tickets in their profile"
   would not have produced a scannable ticket either.
3. **Supabase rotated the injected keys mid-build.** Function-to-function
   dispatch started failing with `Conflicting API keys`, and because the send
   is fire-and-forget it left no trace at all — purchases succeeded, cards were
   charged, nothing was delivered, and `confirmation_error` stayed *null*.
   Delivery moved in-process to remove the whole class of failure.
4. **`sign-contract` was already dead in production** for an unrelated import
   bug, found while deploying this. Fixed separately.

### Open, and deliberately not closed here

- **An unexplained silent failure remains.** On 19 Aug, five orders for one
  showing: the two at 21:26 were never delivered, the three after 21:29
  succeeded. Both failures have `confirmation_error = null`, meaning delivery
  was never *attempted*. The path that produces exactly that signature is
  `deliverConfirmation(...).catch(e => console.error(e))` — every recorded
  outcome is written inside the function, so an exception thrown before those
  writes leaves nothing behind. A `.catch` that records the error would close
  it. **This is the one item worth doing next.**

- **Comp tickets bypass delivery entirely.** `HostDashboard.tsx` inserts
  tickets client-side and never calls `send-ticket-confirmation`. `StaffPOS`
  does. Comps carry `comp_recipient_email`, so the wiring is short.

- **Production test data is still present** — 11 undelivered tickets (4
  film-pass rows with no contact, 5 to `events@kenworthy.org`, 2 originals from
  11 Aug). Owner: Tom. Script ready at
  `supabase/scripts/cleanup_test_purchases.sql`, inspection-first. Until it
  runs, the admin undelivered-orders card shows permanent false alarms.

- **A stale `TWILIO_API_KEY` secret on production**, unread by any code.
  Untidiness rather than risk; also logged by the SMS brief.

### A measurement note for whoever reads this next

`confirmation_channel` is **not** just `email` or `sms`. When a purchase
supplies both and consent is given it records **`email+sms`**. Filtering on
`= 'sms'` reports zero SMS deliveries and looks like a broken feature. That
mistake was made during this very assessment.
