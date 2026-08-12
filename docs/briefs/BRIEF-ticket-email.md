# Brief: Missing Ticket Confirmation & Account Emails

**Status:** 🔴 Launch blocker — **code complete Aug 11 2026, blocked on provider credentials**
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
