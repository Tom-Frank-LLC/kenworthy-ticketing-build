---
brief: pricing-rpc
title: One SQL function prices and writes every paid ticket order, so the arithmetic exists once
status: shipped
track: ops
severity: P2
date: 2026-09-22
shipped_in: ["#316", "#317", "#318", "#320"]
shipped_at: 2026-09-22
verified: true
findings: FINDINGS-square-order-arithmetic.md
---

# Brief: one pricing function, in the database ("option C")

**Requested by:** Tom, after the discounts build. Agreed on 21 Sep 2026 as the right end
state; this brief is the design and the decisions it needs before code.
**Follows:** `DESIGN-order-level-tax-and-ticket-discounts.md` §4 (options A/B/C), §8.

## The problem this closes

The arithmetic that turns "these tickets for this showing" into ticket rows — list price, seat
tier override, the one best discount and its allocation, the order's tax and its apportionment —
exists **three times**: `_shared/order_math.ts` + `_shared/pricing.ts` (Deno), the byte-identical
`src/lib/orderMath.ts` + `src/lib/booking.ts` (browser), and SQL (`order_tax_cents`,
`ticket_discount_cents`, `canonical_tier_name`, the two triggers). The discounts build kept them
in step with a shared vector file, a twin-identity test and a validation trigger, and that
worked — but it is discipline, not structure. The tell is `enforce_ticket_order_totals`: a
trigger that recomputes what the client should have computed and refuses when they differ. With
one implementation there would be nothing to differ.

There is a second problem it closes. **The box office prices in the browser and writes rows
directly**, so a POS bundle that has drifted (or been tampered with) writes wrong rows, and on
the card path it does so *after* the terminal has charged. Today's trigger refuses the rows;
under C the browser never computes a price that reaches the database at all.

## Every writer of a ticket row today

| path | prices where | writes how | money |
|---|---|---|---|
| `ticket-checkout` (online) | `pricing.ts` (Deno) | pending rows via service role → Square → confirm | card |
| `StaffPOS` cash | `booking.ts` (browser) | direct PostgREST insert, confirmed → `square-cash-sale` re-reads rows | cash |
| `StaffPOS` card | `booking.ts` (browser) | `square-terminal` charges a bare amount **first**, then direct insert | card |
| `HostDashboard` comps | none ($0) | direct insert, `payment_method = 'comp'` | none |
| `admit_with_film_pass` (SQL) | none ($0) | INSERT inside the function | pass balance |

INSERT policies in force: `Staff can sell tickets` (any staff, any row) and `Hosts can issue
tickets for assigned showings`. Online inserts already go through the service role only.

## The design

### 1. `quote_ticket_order(showing_id, tickets jsonb, channel)` — prices, writes nothing
Returns the priced rows (seat, tier, list price, discount share, net, tax share, total) and the
order summary (subtotals, discount rule + label, tax, fee, charge). SECURITY DEFINER, STABLE,
callable by **anon** (the showing page previews with it) and by the service role. It carries the
purchasability rules that `pricing.ts` carries now — no-ticket, past, manually sold out, inactive
tier, tier from another showing — as the same sentences, so the page and the server refuse alike.

### 2. `create_ticket_order(showing_id, tickets jsonb, payment_method, buyer…, status)` — quotes, then inserts
Calls the same pricing internally and inserts the rows in one statement, returning them. This is
the only way a **paid** row gets written. SECURITY DEFINER; callable by the service role
(online) and by staff (POS). Comps and pass admissions are $0 and can go through it too, with
`payment_method` deciding; whether they must (Decision 3).

### 3. Direct inserts of paid rows are refused
`Staff can sell tickets` becomes `WITH CHECK (payment_method IN ('comp','film_pass'))` — or is
dropped outright if Decision 3 routes comps through the function. The service role bypasses RLS,
so `ticket-checkout` is held to the function by code review and by the row trigger, which keeps
deriving list price regardless.

### 4. The triggers shrink
`enforce_ticket_pricing` still derives `list_price` from the tier or showing (defence in depth,
costs nothing). `enforce_ticket_order_totals` stays as a tripwire during the transition and is
**removed once every writer is on the function** — its whole job was to catch a client that
computed differently, and there will be no such client.

### 5. What the TypeScript keeps
- `pricing.ts` becomes a thin call to `create_ticket_order` plus the things that are not pricing
  (buyer resolution, idempotency replay, Square, delivery). `order_math.ts` and `booking.ts`
  lose their pricing functions.
- **The browser preview** is the one real trade-off. Today it is instant and offline;
  `quote_ticket_order` is a round trip per change of selection. Decision 1.
- `square-order.ts` (Square line items from rows) is unchanged — it already reads rows.

### 6. POS card sales are fixed as part of this, not after
`StaffPOS` card: `create_ticket_order(..., status = 'pending')` → terminal charge for the amount
the *rows* say → confirm, exactly the online shape. That ends "charged, then refused", and it is
the natural moment to give POS card sales a Square Order with line items (today they are bare
amounts with no attribution). Decision 2.

## Decisions (Tom, 22 Sep 2026)

1a — ask the database for the preview. 2 — fix POS card ordering and add the Square Order, in this brief. 3 — narrow the policy now, comps later. 4 — leave availability and limits where they are. 5 — two ships.

### The questions as they were put

1. **Browser preview.** (a) *Recommended:* call `quote_ticket_order` for the preview, debounced,
   with the last quote shown while the next loads — one arithmetic, and a preview that is by
   construction what will be charged. Cost: ~100–200 ms after each tap, and no preview if the
   network drops (the buy button already needs the network). (b) Keep `orderMath.ts` in the
   browser as a display-only mirror pinned by the vector file — instant, but the third copy stays.
2. **POS card ordering.** Change to pending → charge → confirm and give POS card sales a Square
   Order with line items, in this brief — or keep charge-then-insert and leave the Square Order
   for later. Recommended: in this brief; it is the same code path being rewritten.
3. **Comps and pass admissions.** Route through `create_ticket_order` too (one door, `Staff can
   sell tickets` policy dropped) — or leave their $0 direct inserts and narrow the policy to
   `payment_method IN ('comp','film_pass')`. Recommended: narrow the policy now, migrate comps
   in a later pass; `admit_with_film_pass` is already SQL and is fine as it is.
4. **Availability and limits inside the function?** Capacity is already a trigger; seat
   double-booking is a UNIQUE constraint; the per-buyer online limit and the "already holds N"
   count live in `ticket-checkout`. Moving the limit into the function makes it apply to POS,
   which it deliberately does not today. Recommended: leave them where they are.
5. **Two ships again.** Ship 1: the two functions + `ticket-checkout` on them + POS cash + the
   policy change; the trigger tripwire stays. Ship 2: POS card restructure + Square Order + drop
   the tripwire + delete the browser mirror. Recommended.

## What "done" looks like

- `grep -rn "apportionOrderTax\|applyDiscount\|bestDiscount" src supabase/functions` finds only
  the vector test that pins the SQL, if that.
- `supabase/tests/ticket_discounts` asserts the Square vectors through `quote_ticket_order`
  directly, not through a test-side re-implementation of the allocation.
- A POS bundle that is a month old cannot write a wrong price, because it cannot write a price.
- Staging: the same three sandbox sales as before (full price / discounted / mixed tiers), plus
  a POS cash sale and a POS card sale, each with rows = Square.

## Not in scope
Promo codes; film-pass checkout and concessions (their own per-item tax, own brief); the
`types.ts` regeneration.

## Ship 1 — built (22 Sep 2026)

- Migration `20260922001849_pricing_rpc.sql`: `priced_ticket` type, `processing_fee_cents`,
  `price_ticket_order` (internal), `quote_ticket_order` (anon), `create_ticket_order`
  (staff + service role); `Staff can sell tickets` replaced by `Staff can issue comps`
  (`payment_method IN ('comp','film_pass')`). The tripwire trigger stays for this ship.
- `pricing.ts` is a wrapper: `priceTicketOrder` calls the quote, `createTicketOrder` the create;
  refusals keep the database's sentence and code. Its 47 arithmetic tests are gone — the same
  cases run in SQL — and 12 wrapper tests replace them.
- `ticket-checkout` inserts through `createTicketOrder`; a capacity refusal is a 409 again.
- `StaffPOS.createTickets` sends seats and tiers to `create_ticket_order` and compares the stored
  total with the screen; `buildTicketRows` is no longer used there. Card keeps charge-then-insert
  for this ship.
- Harness `supabase/tests/pricing_rpc/run.sh`: 63 checks — all 43 Square vectors through
  `quote_ticket_order` itself, eligibility, seat-tier override, best-of-three, fee on the discounted
  total, every refusal sentence, grants, and the policy.
- Staging: anon quote of 2 Adult + 2 Student under an Adult-only rule → 29.15; anon create → 401;
  online sale through the deployed checkout → rows 2915, Square payment; a cash sale through
  `create_ticket_order` → 5 rows, 3577. Test data removed.

**Ship 1 in production (22 Sep 2026, PR #316 `ef631da`) — with an incident.** Migration
applied ~16:11 UTC; the first anon quote against a real production showing failed:
`malformed array literal: ""`. `price_ticket_order` appended a single-price ticket's empty tier
name with `v_tiers || ''`, which Postgres resolves as array-concat-array. Every showing WITHOUT
tiers — most of production — could not be quoted, so online checkout on them returned "Could not
price this order". Hotfix `20260922161316` (`''::text`) applied 16:13 UTC. Window ≈ 2 minutes;
the two sales either side (15:35, 16:09) completed under the old checkout; a failed quote writes
no row, so failed attempts in the window are not visible. **Why it was missed:** the harness
built every showing with tiers. It now runs every single-price vector on an untiered showing
too (84 checks), and fails without the fix. Rollback points: Worker `a9216fb5…`,
`ticket-checkout` v53.

**Ship 2 — built (22 Sep 2026):** showing page and POS preview via `quote_ticket_order`; delete
`orderMath.ts` / `booking.ts` arithmetic and the Deno twin; POS card → pending → charge → confirm
with a Square Order; drop `enforce_ticket_order_totals`.

### Ship 2 detail
- `src/lib/quote.ts` — `useOrderQuote`: debounced, stale-safe, last quote shown while the next
  loads; the showing page and the POS use it for every number on screen. The pay/sell buttons hold
  while a quote is in flight and show the database's refusal sentence. **Deleted:** `orderMath.ts`,
  the arithmetic in `booking.ts` (types and the token remain), the Deno twin's pricing (only
  `halfEvenDiv`/`taxOnCents` remain, for `square-order.ts`'s prediction of Square's total).
  `grep apportionOrderTax|applyDiscount|bestDiscount|canonicalTierName src supabase/functions` → 0.
- The discounts editor gets canonical tier names from `canonical_tier_name()` in the database.
- **POS card:** `create_ticket_order(status='pending')` → `square-terminal start_sale` (reads the
  rows, builds a Square Order with line items and the discount, opens a Terminal checkout for the
  rows' amount carrying `order_id`) → poll `confirm_sale` (confirms only on COMPLETED for at least
  the rows' amount). The browser never names an amount. A reader that is never reached releases
  the rows (`failed`); a cancel on the terminal does too. `SQUARE_TERMINAL_DEVICE_ID` (secret) names
  the real reader — **note:** the old path never passed a device id at all, so production card
  checkouts were addressed to `SIMULATED_SANDBOX_DEVICE`; set the secret before relying on POS card.
- Migration `20260922162659`: `enforce_ticket_order_totals` dropped. The `ticket_discounts` harness
  retired; its constraint and RLS checks moved into `pricing_rpc` (94 checks).
- **Measured in the sandbox:** a Terminal checkout accepts `order_id` and returns it. **Not
  observable:** completion — sandbox test devices never complete on their own — so the
  confirm branch and the payment→order link are unverified end to end, as they were before.
- Staging, as a real staff user: direct paid insert → 403; quote 28.62; pending rows 2862;
  `start_sale` → Square Order for 3362 (tickets + $5 gift), checkout PENDING with the order id;
  `confirm_sale` → not confirmed while PENDING; cash sale 2 rows. Test data removed.

## Ship 2 in production (22 Sep 2026, PR #318, `fa1ec83`)

Production compared by content against pre-merge main first (20/20). Migration `20260922162659`
applied; then, before any code depending on it, **all 16 upcoming production showings were quoted
through `quote_ticket_order` with the public key (14 tiered, 2 untiered) — 16/16**. `square-terminal`
v30→31. Worker `d23396ec…` → `2aae61e7-058a-447b-bb25-6dfb256f11c1` (rollback); both origins serve
the new build and its two new-code chunks byte-identically.

**Open, for the theatre:** set `SQUARE_TERMINAL_DEVICE_ID` (`supabase secrets set`, production) to
the reader's id from Square's Devices list before relying on counter card sales — the old path
addressed a fake device, so this was already true. The first real card sale at the counter is the
end-to-end check of `confirm_sale`: rows `pending` → `confirmed`, Square order with line items.

**Follow-ups, in production (22 Sep 2026, PR #320 `28c06b6`; Worker `2aae61e7…` → `4e7a02a2-5de0-41b6-bc3f-f1204f364bf9`; migration then site; all 16 upcoming showings re-quoted fine after the migration):**
- Comps go through `create_ticket_order` (`payment_method = 'comp'`, recipient name required; staff,
  or the host of that showing). Both remaining INSERT policies on `tickets` are dropped — the hosts'
  one had never been narrowed, so a host could have written a paid row directly. No browser can
  insert a ticket row now; `admit_with_film_pass` is SECURITY DEFINER and unaffected. Harness 100.
  Staging as a host who is not staff: direct comp → 403, direct paid → 403, comp through the
  function → 2 rows, cash through the function → 403.
- `types.ts` regenerated from **production's** schema (its migration history equals main). The
  casts this work introduced are gone; ~75 older `(supabase as any)` casts from other work remain.
  **Found:** production has three tables with no migration and absent from staging —
  `poster_restore_plan`, `poster_source_wordpress`, `square_orphan_images` (the poster-restore
  work). They are in the generated types because they are live; someone should either write the
  migration or drop them.

