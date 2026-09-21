---
brief: ticket-discounts
title: Staff can add ticket discounts (percent, $ per ticket, $ per order) that reconcile with Square to the cent
status: in-progress
track: feature
severity: P1
date: 2026-09-21
verified: false
findings: FINDINGS-square-order-arithmetic.md
---

> **Read this first — the design below was revised by measurement (21 Sep 2026).**
> Square taxes the ORDER once and rounds half-to-even, so Decision 4 ("per-ticket
> proportional reduction preserves reconciliation") does not hold: 4 x $6.75 is
> $28.64 per ticket and $28.62 at Square. Tom's decisions, replacing the list at
> the bottom:
>
> 1. Adopt Square's order-level tax model, rather than rounding discounted prices
>    to 50 cents. Staff must be able to set any price.
> 2. Three discount types: `percent`, `fixed_per_ticket`, `fixed_per_order`.
> 3. Database enforcement by VALIDATION (a statement-level trigger holds each
>    order's rows to the order's totals). A single SQL pricing function that every
>    sale goes through is the intended follow-up, not part of this brief.
> 4. Two ships. **Ship 1 — order-level tax — is built** (branch
>    `feat/ticket-discounts`; verified on staging with a real sandbox sale of
>    2 x $8.25 = $17.49, Square order kept). **Ship 2 — discounts — not started.**
> 5. Open: what a partial refund of a quantity-discounted order should do.
>
> The working design is `docs/DESIGN-order-level-tax-and-ticket-discounts.md`.

# Brief (for Claude Code): Ticket discounts (e.g. 25% off 4+ tickets)

**Status:** 🟡 New capability across pricing, checkout, Square reconciliation, and admin. The care item is correctness: a discount that makes our total and Square's total disagree by a cent **silently abandons the order** (loses attribution). Server-authoritative, reconciled to the cent.
**Date:** September 21, 2026
**Requested by:** Tom — a way for the team to add ticket discounts. Example: the **Oct 3 event** — **25% off when buying 4+ tickets**. No mechanism exists today.

## Architecture the design must fit (verified, build `931e141`)
- **Pricing is server-authoritative.** `priceTicketOrder()` (`_shared/pricing.ts`) reads the tiers and computes the order: per-ticket totals, and **tax = SUM(per-ticket totals)** (deliberately, to match the DB trigger — see its header). `ticket-checkout` calls it (`index.ts:213`).
- **Client preview is shared, not authoritative.** `src/lib/booking.ts` (`computeOrderTotals`, `computeLineItemTotals`, `computeSeatTotals`) renders the running summary on **both** the showing page (`Showing.tsx`) and the **box-office POS** (`StaffPOS.tsx`).
- **Square gets an Order, and totals must agree three ways.** `buildTicketOrder`/`orderRequestBody` (`_shared/square-order.ts`) build the line items; there is **no `discounts` field today**. `ticket-checkout` then enforces: `built.expectedTotalCents === chargeCents` (L400) **and** Square's returned `total_money.amount === chargeCents` (L425–434) — otherwise it **abandons the order and falls back to a bare payment**. Any discount must flow into all three identically.

## The cleanest design
### Part A — Store the discount as a rule (data)
New table `public.ticket_discounts`, sibling to `showing_price_tiers`:
- `id`, **scope** — attaches to a **showing** or a **production** (movie/event/live_performance) so a whole event like Oct 3 is one rule (Decision 5); `type` (`percent` | `fixed`), `value`, `min_quantity` (the "4+" trigger), `starts_at`/`ends_at` (optional window), `label` ("25% off 4+ tickets"), `is_active`, and a **nullable `code`** (null = automatic; reserved for future promo codes).
- **RLS:** public can read **active** rules (for display + client preview); **admin** write. (Mirror the tier/showing policies.)
- The Oct 3 offer is one row: `type=percent, value=25, min_quantity=4`, scoped to that event.

### Part B — Apply it server-side in `priceTicketOrder` (authority)
After summing tickets, resolve the **best single qualifying** active rule for the showing/production (quantity ≥ `min_quantity`, within window) and reduce the total. This is the source of truth; the client only previews it. Feed the discounted number into `chargeCents` so it matches the built order.
- **Apply the discount per-ticket, proportionally** (reduce each ticket's `total_price`) rather than as a lump sum, so the existing **`tax = SUM(tickets.total_price)`** invariant and the capacity/price DB trigger stay intact — **Decision 4**. This is the subtle correctness point: a naive order-level subtraction can round differently from per-ticket tax and trip the reconciliation guard.
- **Processing fee** (buyer-paid, grossed-up) must be computed on the **discounted** ticket total, not the pre-discount total.

### Part C — Mirror it on the Square order (reconciliation — do not skip)
Add a `discounts` entry to the Square order body so **Square computes the same reduced total** and the three-way guard holds (`expectedTotalCents === chargeCents === squareTotal`). Use Square's native order `discounts` (percentage or fixed), applied **before tax** as Square expects; verify Square's proportional allocation + tax rounding matches Part B's per-ticket math **to the cent** (this is where it will break if it breaks — cover it with tests at the awkward quantities the pricing header already warns about). The discount then also appears in Square's receipt and reporting, consistent with the line-items architecture.

### Part D — Client preview (display, shared)
Extend the `booking.ts` helpers to apply the same rule for the running order summary on `Showing.tsx` and `StaffPOS.tsx` — show the discount line and the new total once the threshold is met. Server stays authoritative; the preview must never be the thing that sets the charge.

### Part E — Admin UI (the "way to add discounts")
A discount-rule editor on the showing/production form (or a small "Discounts" section), admin-gated: type, value, min quantity, optional window, label, active toggle. Writes `ticket_discounts`. Show existing rules with their labels.

### Part F — Customer-facing display
An offer badge/line on the showing page ("Buy 4+ and save 25%"), the discount reflected in the order summary when it applies, and a **discount line on the confirmation/receipt** (email) so the buyer sees what they saved.

### Part G — Box office (POS)
The POS charge path must honor the **same rule** (shared logic), so an in-person 4+ purchase gets the discount too — don't let online and POS pricing diverge. Apply via the same server pricing/Square-discount path the POS charge uses.

## Guardrails
- **Server-authoritative, never client-only** — a forged client total must be rejected (the guard already does this; the discount must live in `priceTicketOrder` + the Square order).
- **Reconciliation must hold** — add tests proving a discounted order's three totals agree at tricky quantities (4, 5, 7 tickets at odd prices), so a discount never silently abandons the order.
- **No discount on free / no-ticket / comp** showings; one discount at a time (best value, **no stacking** — Decision 3).

## Decisions for Tom
1. **Trigger type now:** automatic quantity-threshold (the Oct 3 case) — recommended first; keep `code` nullable so **promo codes** are a later add, not a redesign.
2. **Discount type:** support both **percent** and **fixed amount** (recommended) vs percent-only.
3. **Stacking:** single best-qualifying discount, no stacking (recommended).
4. **Application/tax model:** per-ticket proportional reduction (recommended, preserves the tax invariant + reconciliation) vs order-level discount (must then reconcile tax rounding against Square).
5. **Scope:** rule attaches to a **showing** and/or a **production/event** (recommended — Oct 3 is event-wide) — confirm both scopes are wanted.

## Test plan
- The team can add a "25% off 4+" rule to the Oct 3 event in admin; it's active only within its window.
- Buying **3** tickets online charges full price; buying **4+** applies 25%, shown in the summary, the confirmation/receipt, and Square's reporting.
- **Reconciliation:** for several quantities/prices, `priceTicketOrder` total, `built.expectedTotalCents`, and Square's returned total all agree to the cent — the order is created (not abandoned to a bare payment); processing fee is computed on the discounted total; tax matches `SUM(tickets.total_price)`.
- The **POS** applies the same discount for an in-person 4+ sale.
- Free/no-ticket/comp showings are unaffected; a forged client-side discount is rejected server-side.
- Fixed-amount and percent rules both work; only one applies at a time; `npm run build` + tests pass (including the reconciliation cases and RLS: public reads active rules, admin writes).
