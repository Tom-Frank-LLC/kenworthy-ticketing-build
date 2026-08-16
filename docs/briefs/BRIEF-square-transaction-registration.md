# Brief (for Claude Code): Register platform transactions in Square correctly — cash tenders + ticket/pass attribution

**Status:** 🔴 Launch-critical — the cash gap is a live accounting hole (books short by the in-person cash take). Money / reconciliation.
**Date:** August 15, 2026
**Source:** `docs/INCIDENT-2026-08-14-square-catalog.md` and `docs/REPORT-square-second-pass.md` (Findings A, B, C). Verified against `main`.
**Requested by:** Tom — resolve how platform transactions register in Square. Policy is: **no money is collected that doesn't go through Square** (cash included), so the books stay accurate.

## Guardrails carried from the 14 Aug incident (must hold in every change here)
1. **Never reconstruct a vendor object from our columns** — read‑modify‑write only; prefer create‑only. We store a handful of fields; Square stores dozens.
2. **No catalog coupling** unless explicitly chosen (Part 2). The incident was caused by our code writing Square catalog objects; nothing here should read or write `/catalog`.
3. **"It ran without erroring" is not acceptance.** Every change is verified against the Square **dashboard / Item Sales report**, not just a 2xx.

## The gap (verified in code)
- **Cash never registers (Finding B) — the real hole.** In‑person cash ticket and film‑pass sales write DB rows and **never create a Square payment**. `StaffPOS.handleCashSale` (`src/pages/admin/StaffPOS.tsx:335–340`) calls `createTickets('cash')` with `squarePaymentId = null` and never contacts Square; `FilmPassPOS` (`src/components/pos/FilmPassPOS.tsx:212`) leaves `squarePaymentId` null on the cash branch. `_shared/square.ts createPayment` (L172) has **no cash‑tender support**. So the books are short by exactly the in‑person cash take.
- **Card ticket revenue has no Square attribution (Finding A).** `createPayment` posts a **bare** `/v2/payments` — `source_id, amount_money, reference_id, note` — with **no order, no line items, no catalog reference** (`ticket-checkout/index.ts:315`; note carries the film title as free text only, L320). Per‑film revenue is invisible to Square's Item Sales, and a film created in our admin has **no Square counterpart at all** (nothing outside `square-catalog-sync` touches `/catalog`). Totals still tie out (see hooks below); **attribution** is what's missing.
- **Redemptions lose their Square record (Finding C).** Pass redemptions decrement balance + issue a ticket without ringing Square's `6 Redeem` $0 line, so redemption counts stop accruing there. Reporting continuity, not money.

### What already works (don't break it)
Card reconciliation is **two‑way** and tested on all 7 real production payments: `square_payment_id` stored on paid rows, and `reference_id` on the Square payment = our `order_token`. Every change below must preserve these hooks so cash and card both tie out.

## Part 1 — Cash tenders (do this; launch‑critical, no decision needed)
Square's Payments API supports cash tenders; we simply never use them. The **terminal card path is the working model** to mirror.

1. **Extend the shared helper** — in `_shared/square.ts`, add cash support (either a `tender: 'cash'` option on `createPayment` or a sibling `createCashPayment`) that posts `/payments` with `source_id: 'CASH'` and `cash_details: { buyer_supplied_money: { amount, currency: 'USD' } }` (Square returns change due). Keep `idempotency_key`, `reference_id` (the order token), `note`, and `location_id`.
2. **Route cash through the server, not the client.** Today cash is recorded entirely client‑side. Money must be recorded authoritatively where the card payment already is: send cash ticket sales through `ticket-checkout` and cash film‑pass sales through `film-pass-checkout` with `payment_method: 'cash'`, and have the edge function create the Square cash payment and store `square_payment_id` on the rows — exactly as the card path does. (This is a small refactor of `StaffPOS.handleCashSale` / `FilmPassPOS` to call the server instead of writing rows directly.)
3. **Idempotency:** a retried cash sale must not double‑post to Square — reuse the same idempotency key per attempt (the card path's pattern).
4. **Reconciliation parity:** store `square_payment_id` + `reference_id` on cash rows so cash ties out two‑way just like card.

## Part 2 — Ticket & film‑pass attribution in Square (Finding A) — **spike first, then decide**
Do the cheap experiment before writing the implementation (per the report's open question, and guardrail #3):

- **Step 0 — sandbox spike (cheap, do first):** create a Square **Order** with a single **ad‑hoc line item** (name = film title, qty = ticket count, `base_price_money`), attach a payment with that `order_id`, then read the **Item Sales** report. Settle the unverified question: *does Square attribute ad‑hoc (non‑catalog) line items in Item Sales, or only catalogued ones?* Report the result before implementing.
- **Recommended (pending spike) — Option 1: ad‑hoc Order line items.** Create a Square Order with a line item named for the film, then create the payment with `order_id`. **No `catalog_object_id`** → no catalog coupling → the 14 Aug failure mode cannot recur, and it works for new films (which have no Square item). Apply to both `ticket-checkout` and `film-pass-checkout`, card **and** the new cash path.
- **Option 2 (only if the spike shows ad‑hoc doesn't roll up and Tom wants historical continuity under `6 Film Tickets`):** catalog‑linked line items. Best fidelity, but **reintroduces the catalog coupling that caused the incident** — must be **create‑only, read‑modify‑write, never a rewrite**, and gated. Heavier decision; flag it.
- **Option 3: DB‑only attribution (deliberate).** Accept that Square holds the total and our system holds per‑film detail (they tie out via `reference_id`), and move per‑film reporting off Square on purpose. Legitimate — but a decision, not a side effect.
- Whatever's chosen, **preserve** `square_payment_id` / `reference_id`.

## Part 3 — Redemption reporting (Finding C) — decision, not an automatic fix
Options: (a) ring a **$0 Square line** (an Order using the matching `…Redeemed` item) to keep Square's redemption counts accruing — but that's catalog coupling for a $0 line; or (b) keep redemption counts in **our DB** and make sure whoever reads Square's reports knows they've stopped there. **Recommend (b)** unless Square must remain the redemption source of truth.

## Scope — what's NOT in this brief (separate follow‑ups I can write)
- `square-labor` `updateScheduledShift` / `deleteScheduledShift` — same vendor‑object‑reconstruction bug class as the incident, but it's labour data, not transaction registration (report §3 / open #6).
- `order_token` type mismatch — `uuid` on `tickets` vs `text` on `donations` (open #8).
- Category repair re‑run and catalog hygiene (open #7, #9).
- These are real and tracked; they just aren't "how transactions register in Square."

## Decisions for Tom
1. **Finding A approach** (after the spike): ad‑hoc line items (recommended), catalog‑linked (reintroduces coupling), or DB‑only attribution.
2. **Cash routing:** move cash sales through the server edge functions (recommended — one authoritative money path) — acknowledge it's a small refactor of the two POS cash handlers.
3. **Redemptions:** $0 Square line vs DB‑only (recommended).

## Test plan
- **Cash:** an in‑person **cash** ticket sale and a **cash** film‑pass sale each create a Square **cash payment** visible in the dashboard; `square_payment_id` is stored; the amount ties out; a retried sale does **not** double‑post; the card/terminal paths are unaffected.
- **Attribution (sandbox first):** an Order with an ad‑hoc line item shows the film name in the **Item Sales** report — or the spike disproves it and informs Decision 1.
- **Reconciliation:** all paths (online card, in‑person card, in‑person cash, online/in‑person film pass) tie out via `reference_id` / `square_payment_id`.
- **No coupling reintroduced:** grep confirms nothing outside `square-catalog-sync` touches `/catalog`, and (if Option 1) the ticket/pass paths reference no `catalog_object_id`.
- **Acceptance is dashboard‑verified**, not just a 2xx (guardrail #3).
- `npm run build` and existing checkout tests pass.
