---
brief: comp-ticket-delivery
title: Comp tickets are issued but never delivered to the person receiving them
status: queued
track: bug
severity: P2
date: 2026-08-22
---

# Brief: Comp tickets are issued but never delivered

**Status:** 🟡 Open. Found while closing `BRIEF-ticket-email.md` on 22 Aug 2026.

A staff member issues a comp from the Host dashboard, sees *"Issued 2 comp
tickets"*, and the recipient receives **nothing**. There is no email, no link,
and no error — the tickets exist and scan correctly at the door, but the guest
has no way to know that and nothing to present.

Comps go to press, sponsors and invited guests, so the people most likely to
hit this are the ones a theatre least wants to leave standing at the door
explaining themselves.

## Why it happens

`src/pages/admin/HostDashboard.tsx` → `issue()` inserts ticket rows straight
from the browser and stops there. Nothing calls `send-ticket-confirmation`, and
`deliverConfirmation` only ever runs from `ticket-checkout` or that endpoint.

Every other path was fixed during the ticket-email work. This one was listed as
a known gap at the time and never picked up.

## Three things to get right

The fix is small, but a naive version makes things worse rather than better.

**1. The ticket rows are owned by the staff member, not the guest.**

```ts
user_id: user.id,                     // whoever is signed in — NOT the recipient
comp_recipient_name: name,
comp_recipient_email: email || null,  // the actual guest
```

`deliverConfirmation` resolves the recipient from the account behind the order.
Dispatching without an override would therefore email the guest's ticket **to
the staff member who issued it**. `send-ticket-confirmation` must be called with
`email: comp_recipient_email`.

This is not hypothetical — it is the same trap the POS hit, and the reason
signed-in staff count as operators whose overrides are honoured. The comments in
`supabase/functions/send-ticket-confirmation/index.ts` spell it out.

**2. No `order_token` is set, so a comp for one guest is not one order.**

The insert omits `order_token`, so every row takes its own value from the column
default. Issuing 3 comps for one guest produces **3 unrelated orders** — three
emails, three links, three separate tickets to juggle. The whole point of the
token is that a party arrives with one link.

Set one token per issuance and put it on every row.

This matters more for comps than for a normal sale, because the recipient has no
account: `/my-tickets` is not available to them, so the public `/t/:token` page
is the only place they can see the ticket at all.

**3. The email field is optional, and issuance must not start depending on it.**

The form allows a comp with no email (`email || null`) — a name on a list for
someone collecting at the door. That is legitimate and must keep working. Follow
what `deliverPos` does: complete the action, then say plainly that nothing could
be sent and offer a resend.

## The working reference

`deliverPos` in `src/pages/admin/StaffPOS.tsx` already solves this exact shape —
tickets owned by the staff member, recipient typed at the counter, delivery by
override, failure reported without rolling back the sale. Copy it rather than
inventing a second pattern.

## Proposed shape

- `issue()` generates one `order_token` and stamps it on every row.
- After a successful insert, call `send-ticket-confirmation` with the token and
  `email: comp_recipient_email`.
- No email → issue the tickets, warn that nothing was sent, leave a resend.
- Add a resend control to the comp list, which already renders
  `comp_recipient_email` (`HostDashboard.tsx` ~line 574). Mirrors the POS
  transaction-row resend, and covers the common case of a mistyped address.
- **SMS is out of scope.** Comps have no phone field and no A2P opt-in, so
  there is no consent to assert. Email only, as at the counter.

### The alternative, and why it is not the recommendation

The cleaner architecture is a server-side `comp-checkout` edge function, which
would end client-side ticket inserts and let delivery happen in-process the way
`ticket-checkout` does. It is the better end state and worth doing if comps grow
features (pricing tiers, seat assignment, an audit trail).

It is not proposed here because the client-side path already exists and works,
the delivery infrastructure it would call is identical either way, and the small
fix is a handful of lines against a proven pattern. Worth revisiting if this
area is touched again.

## Test plan

- Issue **1** comp with an email → one email arrives, addressed to the guest and
  **not** to the staff member who issued it; the QR in it scans at
  `/admin/scanner`.
- Issue **3** comps in one go for one guest → **one** email, **one** `/t/:token`
  link, showing all three tickets.
- Issue a comp with **no** email → tickets are created, the UI says plainly that
  nothing was sent, and the sale is not blocked.
- Resend to a corrected address → arrives, and `confirmation_sent_at` updates.
- Check `confirmation_error` is written on failure, so a comp that fails to send
  appears in the admin undelivered-orders card rather than vanishing.

## Notes

- Comps already scan correctly (`qr_code` is `COMP-<uuid>`, which
  `TicketScanner` matches like any other). This is purely a delivery gap.
- Severity P2 rather than P1: volume is low and paid sales are unaffected. Bump
  it if comps are going out for a press night, because today there is no
  practical way to get a comp to its recipient at all.
