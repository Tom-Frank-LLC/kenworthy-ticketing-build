---
brief: donation-requires-email
title: An online gift requires an email, and a stuck gift can be given one
status: shipped
track: bug
date: 2026-08-28
shipped_in: ["#245"]
shipped_at: 2026-08-29
verified: true
evidence: "Worker version 5560c657-a3a3-4a3e-96ee-2c96bf4ab794; ticket-checkout v48 and lgl-sync-donation v20 on vlmslygnimfbamrtwvyo. Live probe of ticket-checkout returns the new rule for a phone-only gift and the pre-existing rule for a contactless ticket order. Add email -> Sync now walked in the production admin by Tom."
---

# An online gift requires an email, and a stuck gift can be given one

A donation was collected online from a buyer who gave a phone number and no
email address. The money reached Square. The gift never reached Little Green
Light, and never could have.

## Why it happened

Three correct decisions that were wrong together.

1. **Checkout accepts email *or* phone**
   (`supabase/functions/ticket-checkout/index.ts`). SMS-only ticketing is a
   real feature: a buyer may give a number, tick the consent box, and have
   their tickets texted. The order completes and the donation row saves
   `donor_phone` with `donor_email` null.

2. **LGL sync requires an email, by design** (`_shared/lgl.ts`). LGL keys
   constituents on an email address — the search is
   `/constituents/search?q=email_address=…` — so a gift with no address is
   un-keyable. The sync marks `No donor email — recorded locally, not synced
   to LGL` and stops rather than seeding the donor database with a record
   nobody can reach. That is the right call, and it is not a sync bug.

3. **`donations.donor_email` is nullable on purpose.** The `NOT NULL` was
   dropped for the walk-in counter case: a cash drop-in at the box office, no
   address, correctly recorded locally and never pushed.

Each rule is defensible. Their intersection is a gift that is charged, banked,
and permanently un-syncable — with no way to fix it from any screen, because
`LglTab` displayed `donor_email` and offered only Sync and Resend.

## What changed

**Prevent (online only).** Tickets keep email-or-phone. The moment a gift is
attached to an order, an email becomes required, because what the gift is worth
to the theatre beyond the money is the LGL constituent record it becomes.

- `_shared/pricing.ts` — `bundledDonationEmailError()`, the rule, next to
  `readDonationCents()` where the other bundled-gift rules live.
- `ticket-checkout` — the authoritative gate, on both the signed-in and guest
  branches. On the guest branch it runs *before* `findOrCreateBuyer`, so a
  refused order leaves no stray account behind.
- `GuestCheckoutForm` — a new `donationCents` prop makes the email field
  required and labelled `*` when a gift is attached, so the buyer is asked
  before the pay button rather than rejected after it.
- `DonationPrompt` — says why, at the point the gift is chosen. Customer
  variant only.

The standalone Donate page already required an email on both sides
(`square-donation` returns 400 on a missing or malformed address), so it needed
no change — verified, not assumed.

**The counter is deliberately untouched.** `StaffPOS` renders
`DonationPrompt variant="staff"` and pays through `square-cash-sale` /
`square-terminal`, never `ticket-checkout`. An emailless walk-in gift still
completes, is still recorded locally, and still does not sync. That is the case
the nullable column exists for.

**Recover.** `lgl-sync-donation` gains a `set_donor_email` action:
admin-gated like its siblings, validated, audit-logged with the old and new
address, and writing through `.select()` with a row-count assertion because an
RLS denial returns 204 with no error. It clears `lgl_constituent_id` on the way
through — a cached constituent was resolved from the old address, or created
from a typo of it, so the next sync should search LGL by the address we now
have.

An **already-synced gift is refused.** Its constituent exists in LGL keyed on
the old address and nothing here can rename it; a re-sync after an edit would
at best be a no-op and at worst attach the gift to a second constituent for one
human. That correction belongs in LGL. The refusal is enforced twice — in the
rule, and as `.is('lgl_gift_id', null)` on the update itself, so two admins
racing cannot slip an edit past a sync that landed in between.

`LglTab` grows an inline **Add email** / **Fix email** control on any unsynced
gift, and its **Sync now** button is now disabled without an address — a button
that always fails reads as a broken integration rather than as the missing
field it actually is.

## Decisions taken

1. Email required for **online** gifts only; the counter stays optional.
2. Recovery through an **audited `set_donor_email` function action**, not a
   direct table update.
3. Editing the email on an already-synced gift is **blocked**.

## What is not fixed by this

The gift that prompted the brief. Nothing here can invent an address for a
donor who gave only a phone number — someone has to ask them. Once there is an
address, **Add email** then **Sync now** will land the constituent, the gift,
and the receipt that had nowhere to go. If no address is ever obtained, the gift
stays correctly recorded locally. **The money was captured by Square either
way**; this was never a financial risk, only a stewardship one.

## Checks

`tsc -p tsconfig.app.json --noEmit` clean · `vitest` 725 passed ·
`deno test --allow-env supabase/functions` 329 passed ·
`deno check` clean on every touched function · `build:production` succeeds.

New tests cover the `donationCents > 0 ⇒ email required` server branch
(`pricing_test.ts`), the `set_donor_email` rule including the synced-gift
refusal (`lgl_test.ts`, new), and the client rule on both sides of
`SMS_DELIVERY_LIVE` plus a regression guard that a ticket-only order is
unchanged (`GuestCheckoutForm.test.tsx`).

## Shipped

Merged as `1885269` (#245) and deployed to production on 2026-08-29 — all three
artifacts, because the rule and the recovery path live in different ones:

| | |
|---|---|
| Worker | version `5560c657-a3a3-4a3e-96ee-2c96bf4ab794` (rollback: `1cb6fb0a-f1eb-448e-8f3c-19e9293aa8ce`) |
| `ticket-checkout` | v48 |
| `lgl-sync-donation` | v20 |

Verified against production rather than the deploy logs. A live probe carrying a
gift and a phone number but no email returns the new rule; the control — no
gift, no contact — still returns `Email or phone is required so we can send your
tickets`, so SMS-only ticketing is intact. Both probes are refused before
`findOrCreateBuyer` and before pricing, so neither wrote a row. `set_donor_email`
answers `401 Sign in required` to an unauthenticated call, which is what proves
it booted rather than returning a `BOOT_ERROR`.

Tom walked **Add email → Sync now** in the production admin and confirmed it
works. That was the one path unit tests could not cover, and the one where a
mistake reaches Little Green Light, which has no sandbox and no reversal.

Two false alarms worth remembering from the deploy: `wrangler` printed *"No
updated asset files to upload"* while shipping a real change (Workers Builds had
already uploaded the assets on the PR), and the pre-deploy check that production
was not *ahead* of main mattered — it wasn't, but only building `835516b` and
matching the live bundle established that.
