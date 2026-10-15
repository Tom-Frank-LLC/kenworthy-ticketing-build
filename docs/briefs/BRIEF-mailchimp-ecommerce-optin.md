---
brief: mailchimp-ecommerce-optin
title: A ticket purchase or gift no longer subscribes the buyer to the newsletter
status: shipped
track: bug
date: 2026-10-14
shipped_in: ["#382"]
shipped_at: 2026-10-14
verified: true
evidence: both functions deployed from 77d31cb to staging and production (prod mailchimp-subscribe v10, mailchimp-ecommerce v11)
---

# Brief: a purchase is not a newsletter sign-up

**Status:** shipped 2026-10-14 (#382), deployed to staging and production.
Edge functions only: `mailchimp-ecommerce`, `mailchimp-subscribe`. Rollback:
redeploy both from `2c4fc64`.

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
**It never reached a buyer.** Production `app_config` was read on 2026-10-15:
8 keys, `mfa_required` among them (proof that the query can see the table), and
none starting with `mailchimp`. No store has ever been bootstrapped there, so the
sync has always returned at `Store not bootstrapped`. Staging has no store and
no Mailchimp keys.

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
- Production has no store yet (above), so neither path has run against real
  Mailchimp. **Before running `mailchimp-bootstrap` in production, test the
  step-up** with the two purchases below.

## Verify after deploy (once a store exists)

Buy a ticket with an address you control, box unticked: the contact should
appear in the audience as Transactional. Again with a fresh address, box ticked:
a confirmation email should arrive, and the contact should be Pending, then
Subscribed after you confirm.
