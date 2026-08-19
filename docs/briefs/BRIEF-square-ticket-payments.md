---
brief: square-ticket-payments
title: Online Ticket & Film-Pass Purchases Take No Payment
status: shipped
track: ops
date: 2026-08-12
shipped_in: ["#103", "9d5876a"]
evidence: superseded by order-then-pay across every sale
verified: true
---

# Brief: Online Ticket & Film-Pass Purchases Take No Payment

**Status:** 🟡 Implemented, not yet deployed — see [`docs/SQUARE-PAYMENTS.md`](../SQUARE-PAYMENTS.md)
**Date:** August 12, 2026
**Reported by:** Launch-readiness audit (traced against `main`, commit `aa5f05f`)

> **Resolution of the open questions:** one new `ticket-checkout` function with
> `guest-checkout` retired to a 410 shim (Q1); **the buyer never pays the Square
> processing fee on a standard ticket — the theatre absorbs it**, and the
> per-production toggle survives only as the case-by-case rental exception,
> reset to off everywhere (Q2); refunds are in scope and implemented (Q3); film
> passes stay tax-inclusive, with only the deduction amount moved server-side
> (Q4). Q5 (production Square account) is a go-live confirmation, not code.

> **The finding in one line:** online ticket checkout and online film-pass
> purchase create confirmed tickets/passes for free — they contain no Square
> integration at all, so there is no credential to "flip to live." The fix is to
> add the same PCI-safe Square Web Payments flow the **donation** page already
> uses, and to charge *before* the ticket/pass is created.
>
> **What is NOT the problem:** collecting card data. We do not and will not.
> Square's SDK renders a Square-hosted iframe; the card number goes straight to
> Square and we receive only a one-time token. The whole charge flows through the
> Square API, exactly as intended.
>
> **Working reference in this repo:** `src/pages/Donate.tsx` (frontend) +
> `supabase/functions/square-donation/index.ts` (server charge). The box-office
> card path (`StaffPOS.tsx` → `square-terminal`) is a second working reference —
> and notably it already does the right sequencing: it awaits Square `COMPLETED`
> before creating tickets (`StaffPOS.tsx:389-396`).

---

## Current state (what the audit confirmed in code)

| Path | Charges? | Evidence |
|---|---|---|
| Donations | ✅ Real Square charge | `Donate.tsx:62-148`, `square-donation` |
| Box-office **card** | ✅ Real Square Terminal charge, awaited | `StaffPOS.tsx:389` |
| **Online ticket — guest** | ❌ No charge | `guest-checkout/index.ts:162` inserts directly; `GuestCheckoutForm.tsx` has **no card input**; banner "Simulated checkout — no real charge" (`:98`) |
| **Online ticket — signed-in** | ❌ No charge | `Showing.tsx:405` inserts client-side; banner at `Showing.tsx:826` |
| **Online film-pass purchase** | ❌ No charge | `MyPasses.tsx:59-83` inserts balance; banner `:120` |

A whole-frontend grep for `window.Square` / `tokenize` / a card container returns
**only `Donate.tsx`** — no Square code exists on any ticket or pass path.

Two consequences beyond "no money":
- The **amount is never authoritative on the server** for the online ticket
  insert (client builds the rows), and for film-pass redemption the deduction
  amount is client-supplied (`Showing.tsx:415`). Wiring payment is the right
  moment to move amount authority server-side and close that hole too.
- The **sandbox→live switch is not built even for donations.** `Donate.tsx` and
  `square-donation` are hardcoded to sandbox (SDK URL `sandbox.web.squarecdn.com`;
  API base `connect.squareupsandbox.com`; secrets named `SQUARE_SANDBOX_*`). Going
  live requires making the SDK URL, API base, and credential set
  environment-driven — do this once, shared by donations and tickets.

---

## How Square Web Payments works (why we stay out of PCI scope)

1. Browser loads Square's SDK and calls `payments(appId, locationId).card()`, then
   `card.attach('#container')`. This renders **Square's** iframe. The customer's
   PAN is entered into Square's origin, never ours.
2. On submit, `card.tokenize()` returns a single-use `token` (the `sourceId`).
3. We send only that token to our edge function, which calls Square
   `POST /v2/payments` with `source_id`, `amount_money`, an `idempotency_key`, and
   `location_id`. Square charges and returns a payment record + receipt URL.
4. We store the `square_payment_id` / receipt, never card data.

This is PCI SAQ A-EP: our servers never see, transmit, or store card numbers.

---

## Proposed design

### Principle: charge first, then create

Today the ticket row is the source of truth and payment is absent. Invert it: a
**server-side function owns the transaction** — it computes the price, charges
Square, and only on success creates the confirmed ticket/pass and fires delivery.
No client path may insert a confirmed ticket directly. This mirrors the terminal
path and makes double-charging and free-ticket tampering structurally impossible.

### 1. Server: a single ticket-checkout charge function

Extend `guest-checkout` (or add `ticket-checkout`) so a purchase does, in order:

1. **Validate & price server-side.** Recompute subtotal + tax + any processing fee
   from the showing / `showing_price_tiers` — never trust a client amount. (The
   `enforce_ticket_pricing` DB trigger already re-derives per-ticket price; extend
   the same authority to the order total that gets charged.)
2. **Insert a `pending` order/tickets** (or a pending marker) so there is always a
   record even if Square errors — the donation function's pattern
   (`square-donation` pending-insert) is the model.
3. **Charge Square** with the `sourceId`, an `idempotency_key`, and the
   server-computed `amount_money`.
4. **On success:** flip tickets to `confirmed`, stamp `square_payment_id` /
   `order_token`, and invoke `send-ticket-confirmation` (already built).
5. **On failure/decline:** mark failed, create nothing scannable, return the
   Square error message. The purchase must not "succeed" without a payment.

Route **both** the guest and the signed-in path through this one function so
neither inserts tickets client-side. This also fixes the audit's finding that the
signed-in path (`Showing.tsx:405`) inserts directly.

### 2. Frontend: mount Square card on ticket checkout

Reuse the `Donate.tsx` init exactly: load the SDK, `get_config` for
`applicationId`/`locationId`, `payments().card()`, `card.attach()`. Add it to:
- the guest checkout (`GuestCheckoutForm.tsx` — add the card container + tokenize
  on submit; today it only collects name/email/phone),
- the signed-in checkout drawer (`Showing.tsx`),
- reuse a shared `<SquareCardForm>` component so there is one implementation, not
  three copies of the Donate logic.

On submit: `tokenize()` → send token to the checkout function → handle
decline/success. Remove the "Simulated checkout" banners.

### 3. Film-pass purchase

Same charge-first pattern: a server function charges Square, then creates the
`user_film_passes` row with `remaining_balance = initial_balance`. Applies to both
`MyPasses.tsx` (self-serve) and `FilmPassPOS.tsx` (staff). While here, fix the POS
mis-assignment the audit found (pass created under the staff user id) and the
`display_name == email` lookup. Redemption of an existing pass stays free (it's
prepaid) but must take its deduction amount server-side (separate security fix,
tracked in `LAUNCH-READINESS.md` blocker 3).

### 4. Environment switch (sandbox → live), built once

Make three things environment-driven and shared across donations + tickets:
- SDK script URL: `sandbox.web.squarecdn.com` vs `web.squarecdn.com`.
- API base: `connect.squareupsandbox.com/v2` vs `connect.squareup.com/v2`.
- Credentials: read `SQUARE_ENV` and pick the sandbox vs production
  application id / access token / location id.

Then "go live" is a config change on the edge-function secrets + `VITE_SQUARE_ENV`,
with no code edit — which is the model you expected.

### 5. Refunds must issue real Square refunds (flag)

Once real money is taken, the existing refund action (`StaffPOS.tsx:465` sets
`status:'refunded'` only) must call Square's Refunds API against the stored
`square_payment_id`, or the theater refunds in the app while the customer's card is
never credited. Scope decision needed (this brief, or a follow-up).

---

## Secrets

Already present (donations): `SQUARE_SANDBOX_APPLICATION_ID`,
`SQUARE_SANDBOX_ACCESS_TOKEN`, `SQUARE_SANDBOX_LOCATION_ID`. For go-live add the
production trio and a `SQUARE_ENV` selector, on both Supabase projects.

---

## Testing plan

**Sandbox first, both paths, then flip to production and run one real card you refund.**

1. **Config load:** ticket checkout mounts the Square card iframe (no console SDK error).
2. **Happy path (guest):** enter test card `4111 1111 1111 1111`, any future exp/any CVV → charge succeeds → ticket appears `confirmed` with `square_payment_id` set → confirmation email arrives with a scannable QR → the payment shows in the Square sandbox dashboard for the right amount.
3. **Charge gates creation:** use a **decline** test card (`4000 0000 0000 0002`) → no ticket row is created/confirmed, user sees the decline message, no email sent.
4. **Amount authority:** tamper the client to send a lower amount → server charges the recomputed correct amount (or rejects), never the client's.
5. **Idempotency:** double-submit / retry → exactly one charge, one order.
6. **Signed-in path:** repeat 2–3 while logged in; ticket lands in `/my-tickets`.
7. **Film pass:** buy a pass with a test card → charge succeeds → `user_film_passes` balance created only on success.
8. **Production flip:** switch `SQUARE_ENV` + secrets, buy one real ticket with a real card, confirm the charge in the live Square dashboard, then refund it (also exercises the refund path if in scope).

---

## Open questions

1. **One unified checkout function** (extend `guest-checkout`) vs a new
   `ticket-checkout` — preference?
2. **Processing fee:** the UI shows a Square processing fee (`Showing.tsx:251`).
   Is the customer charged that fee (pass-through), or is it display-only and the
   theater absorbs Square's cut? The charged amount must match what's shown.
3. **Refunds in scope here**, or a follow-up brief?
4. **Film-pass tax:** redemptions currently deduct pre-tax subtotal and collect no
   tax — intended (tax-inclusive pass) or a gap to fix alongside?
5. **Square account:** confirm the production Square application/location lives in
   the theater's own Square account (per `PLATFORM.md §2.4`) before go-live.
