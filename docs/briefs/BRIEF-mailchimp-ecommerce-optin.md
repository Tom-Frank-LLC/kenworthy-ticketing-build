---
brief: mailchimp-ecommerce-optin
title: A ticket purchase or gift no longer subscribes the buyer to the newsletter
status: built
track: bug
severity: P1
date: 2026-10-14
verified: false
---

# Brief: a purchase is not a newsletter sign-up

**Status:** built, not deployed. Edge functions only: `mailchimp-ecommerce`,
`mailchimp-subscribe`.

## The bug

`mailchimp-ecommerce` records each ticket order (from `ticket-checkout`) and each
gift (from `square-donation`) in Mailchimp's e-commerce store. It sent
`opt_in_status: true` for every buyer, regardless of the newsletter box at
checkout.

Mailchimp's reference for *Add or update customer* says of `opt_in_status`: it
"will never overwrite the opt-in status of a pre-existing Mailchimp list member,
but will apply to list members that are added through the e-commerce API", and
"Customers who don't opt in to your Mailchimp list will be added as
Transactional members." So `true` made every *new* buyer a full subscriber,
including the ones who unticked the box.

It has been dormant only because the sync returns early until
`mailchimp-bootstrap` has created a store (`app_config.mailchimp_store`).
Staging has no store and no Mailchimp keys. Production was not checked from this
session (the read was blocked); see *Verify* below.

## Why the one-line fix is not enough

Setting `false` alone would have broken the buyers who *do* tick the box. The
order of events at checkout:

1. `ticket-checkout` charges the card and fires the e-commerce sync, server-side.
   With `false`, Mailchimp creates the buyer as a **transactional** member.
2. The browser gets the response, and only then sends the ticked box to
   `mailchimp-subscribe` (`Showing.tsx`, `Donate.tsx`).
3. A guest is an anonymous caller, so that path is create-only (security audit
   M7): it POSTs, gets `400 Member Exists`, and leaves the member alone.

The sign-up would vanish, and so would a later footer sign-up from anyone who
had once bought a ticket without opting in.

## The fix

- `mailchimp-ecommerce`: `opt_in_status` is always `false` (`OPT_IN`). Existing
  subscribers are unaffected, per the quote above.
- `mailchimp-subscribe`, anonymous path: on `Member Exists`, read the member's
  status. If it is `transactional`, PATCH it to `pending` (Mailchimp's
  confirmation email, the same double opt-in a new sign-up gets) and add the same
  allowlisted tags. Names are not touched. Any other status is left exactly as
  it was, and the response is identical either way, so the form is still not a
  membership oracle.
- `mailchimp-subscribe`, trusted path: `status_if_new` leaves a transactional
  member transactional, so the same step-up goes to the status asked for.

Tests: `supabase/functions/mailchimp-subscribe/handler_test.ts` (12 pass).

## Not verified

- **Whether Mailchimp accepts `transactional` → `pending` by PATCH.** Its
  reference lists both as valid `status` values but documents no transition
  rules. There is no sandbox, and staging deliberately has no Mailchimp keys.
  If Mailchimp refuses it, the PATCH failure is logged as
  `[mailchimp-subscribe] transactional opt-in failed: <status> <title>` and the
  buyer stays transactional. That fails safe: no unwanted email, but the
  sign-up is lost.
- Whether a production store exists:
  `select key, value from app_config where key like 'mailchimp%';` against
  production. No `mailchimp_store` row means none of this has ever fired.

## Verify after deploy (once a store exists)

Buy a ticket with an address you control, box unticked: the contact should
appear in the audience as Transactional. Again with a fresh address, box ticked:
a confirmation email should arrive, and the contact should be Pending, then
Subscribed after you confirm.
