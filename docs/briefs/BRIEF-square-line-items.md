---
brief: square-line-items
title: Make ticket / event / MET / film-pass sales write catalogued line items in Square
status: shipped
track: data
date: 2026-08-18
shipped_in: ["#103", "9d5876a"]
verified: true
---

# Brief (for Claude Code): Make ticket / event / MET / film-pass sales write catalogued line items in Square

**Status:** ✅ Shipped — `9d5876a` (PR #103), "order-then-pay across every sale, and a front door for the catalog mapping".
**Date:** August 18, 2026
**Spec (authoritative, measured from the live account):** `docs/SQUARE-TRANSACTION-CONVENTIONS.md`. This brief implements it. Read it and `docs/INCIDENT-2026-08-14-square-catalog.md` first.
**Supersedes:** the "Part 2 — attribution" section of `BRIEF-square-transaction-registration.md`. That brief guessed a catalog-linked/ad-hoc *hybrid*; the measured conventions now give the definitive answer — **catalog-linked, one variation per tier × showtime** — and name the prerequisite that hybrid was avoiding.

## Goal
Every online (and in-person) ticket, MET Live, event, and film-pass sale should register in Square as an **Order with catalog-linked line items** — the same shape POS and Square Online already use — so item-sales, category, and tax reporting all work and our ledger reconciles with theirs.

## Current state (verified in `main`, PR #83 / 220324e)
- `ticket-checkout`, `film-pass-checkout`, `square-donation` all call `createPayment` → bare `POST /payments` (`_shared/square.ts:172`): amount + text `note`, **no order, no line_items, no `catalog_object_id`**.
- **`square-invoice` already does it right** (`index.ts:218`): builds `POST /orders` with `line_items` + `reference_id`, then attaches payment via `order_id`. This is the pattern to generalise.
- `createPayment` has **no `orderId` param** yet — adding one (`order_id` passthrough) is the entire plumbing change.
- **`square_variation_id` exists only on `concession_items`** (migration `20260701…`). Showings (movie / event / live-performance) have **no** stored Square variation, which is exactly why checkout can only send an amount.
- `square-catalog-sync` already has **safe read-modify-write** catalog plumbing to extend; it also documents the category write caveat and the 429 catalog-lock behaviour.

## The two pieces of work

### A. Plumbing — order-then-pay (small, mirrors `square-invoice`)
1. In checkout, before charging: `POST /orders` with
   ```
   order: {
     location_id,
     reference_id: <our order id>.slice(0,40),     // reconciliation key — preserve
     source: { name: 'Kenworthy Website' },        // already the established source name
     line_items: [ { catalog_object_id: <variationId>, quantity: '<n>' }, … ],
     fulfillments: [ { type: 'DIGITAL', state: 'COMPLETED', … } ],  // matches Square Online web sales
   }
   ```
2. Add optional `orderId` to `createPayment` → pass through as `order_id`. Charge the order's `total_money.amount` (let Square total it, so its tax lands on the sale). **Keep `square_payment_id` + `reference_id` on our rows** — the reconciliation hooks stay.
3. Apply to **card and cash** paths for `ticket-checkout` and `film-pass-checkout` (and the in-person `StaffPOS` cash path, which today writes rows with `square_payment_id = null`). Cash = order-then-pay with a `CASH` tender (`source_id:'CASH'`, `cash_details.buyer_supplied_money`).

### B. Prerequisite — every sellable showing must have a Square variation to point at (the real work)
Line items need a `catalog_object_id`. Today no showing has one. So:

1. **Store the mapping.** Add `square_variation_id text` (and `square_item_id text`) to the **showings** unit we sell (per-showing, since a variation is per tier × showtime). Nullable; unique on variation id.
2. **Ensure the variation exists** at publish time (preferred) or lazily at first sale:
   - Resolve the film/event/performance's Square **`EVENT` item** (screenings are `EVENT` product-type; `product_type` is immutable, so never try to convert a `REGULAR` item — report it instead).
   - **Read-modify-write the item** (`square-catalog-sync` plumbing): `RetrieveCatalogObject` → **append** a variation named to the grammar below with a `#temp` id → `UpsertCatalogObject` with the returned `version`, asserting nothing else changed. **Never reconstruct the item** (that is the Aug 14 wipe).
   - Store the returned real variation id on the showing.
3. **Checkout sends that id.** If a showing still has no variation (creation failed), **fall back to an ad-hoc line item** (name + price, no `catalog_object_id`) so a sale never fails — but log it; ad-hoc means no rollup/category, so it's a degraded path, not the target.

## Conventions to honour (from `SQUARE-TRANSACTION-CONVENTIONS.md` — copy exactly)
- **Grammar:** `<Tier> - <Weekday, Month D at TIME>` when tiered (Adult/Student/Child/GA/Preferred Seating/VIP…), or bare `<Weekday, Month D at TIME>` for a single price. **Separator `-`** (recent hand-entered work uses it; `~` is the legacy form — match on both, write `-`).
- **One variation per (tier × showtime).** A 2-Adult + 1-Student purchase = two line items (Adult qty 2, Student qty 1), not one lump.
- **Categories** (numbered taxonomy): tickets → `6 Film Tickets`, MET → `6 METLive Tickets`, events → `6 Live Event Tickets`, NT Live → `6 NT Live Tickets`, rentals → `6 Rental Tickets`, passes → `9 Film Passes`, redemptions → `6 Redeem`. Set `reporting_category` (what revenue reports group by) **and** `category_id`; heed the writable-shape caveat at `square-catalog-sync/index.ts:1083` (`item_data.categories` is derived/non-writable at `SQUARE_API_VERSION` 2024-01-18 — setting it is a silent no-op).
- **Tax:** lives on the catalog item (`tax_ids`, gated by `is_taxable`); Square applies it when the line item references the item. Don't compute tax in our arithmetic — reference the catalogued item and let Square total. (822/823 EVENT items are `is_taxable` — see Decision 4.)
- **Fulfillment:** `DIGITAL` for web sales; tips (if ever added) on the tender, never a line item.

## Film passes
- **Sale:** the pass is a `9 Film Passes` item — order-then-pay against its variation, same as a ticket.
- **Redemption:** admitting with a pass rings a `6 Redeem` line (the `…Redeemed` $0 items) so Square's redemption counts accrue, *or* keep counts in our DB only — **Decision 5**. Either way, don't send a redemption as a paid ticket line.

## Donations (keep separate)
Do **not** send a donation as a ticket line. Use the `DONATION` product-type item's variations (`$10 / $20 / $50 / $100 / Custom Amount`, `is_taxable:false`); `Custom Amount` is `VARIABLE_PRICING` with an explicit `base_price_money`. `square-donation` moves to order-then-pay against that item.

## Guardrails (non-negotiable — from the incident)
1. **Read-modify-write for any catalog write; never reconstruct an item from our columns.** Retrieve, append/edit only the target, upsert with `version`, diff-assert nothing else changed.
2. **A 2xx is not acceptance.** Verify variations and sales by **reading back from Square** / the dashboard Item Sales, not response codes (`item_data.categories` and undocumented fields can accept-and-ignore).
3. **Square locks the catalog during upsert** → `429 RATE_LIMITED`; write variations **serially** or with a retry-after-pause; keep a repair sweep. Idempotent by design.
4. Orders/Payments are **create-only and safe**; the danger is only on the catalog writes in Part B.

## Dependency / risk: the CSV-import bleed
Keep the two damage triggers straight, because they share one root cause but are different actions:
- **14 Aug (original):** the concessions **"Pull from Square"** button over-pulled the whole catalog into `concession_items` (flooding the home page); toggling those items **off** in the admin UI then fired `pushItem`, which rebuilt each item from our four columns and **overwrote 906 live objects**. Trigger = pull button + toggle-off pushes — *not* a CSV import.
- **15–17 Aug (subsequent):** **dashboard CSV import** round-trips (restore attempts) **re-flattened variations and stripped event blocks** — a Library CSV has no columns for per-showtime variations or the event/venue block, so a round-trip drops them.

Both are the same root cause: **Square's `UpsertCatalogObject` replaces the whole object, so anything not sent back is deleted.** For this brief that means: the per-showtime variations Part B creates will be destroyed again on the next catalog **CSV import round-trip**. **Freezing / replacing the dashboard CSV-import workflow is a prerequisite for this to hold** — flag it; don't build on sand.

## Decisions for Tom
1. **Create variations on publish** (clean, needs the showing-publish path to call Square) vs **lazily at first sale** (simpler, first buyer pays the latency). Recommend on-publish.
2. **Separator:** standardise on `-` (recommended) — confirm.
3. **Tier vocabulary:** collapse the near-duplicates (`GA`/`General Admission`, `Student`/`Students`/`Student/Senior`) before generating variations programmatically — pick the canonical set.
4. **Tax on admissions:** 822/823 EVENT items are `is_taxable` — confirm Idaho admissions tax is intended before relying on Square to compute it.
5. **Redemptions:** `6 Redeem` $0 line in Square vs DB-only counts.
6. **Per-showtime accumulation:** long-running titles grow one variation per screening (established practice, but it's what made the flatten so costly) — accept, or cap/retire old showtime variations.

## Test plan (acceptance = dashboard, not 2xx)
- A card ticket sale creates an **Order with a catalog-linked line item** that appears in **Item Sales** under the right category and showtime; tax computed by Square; `square_payment_id`/`reference_id` stored.
- A multi-tier sale shows **separate Adult/Student line items** with correct quantities.
- MET, event, NT Live, and a film-pass sale each land in their correct `6 …`/`9 Film Passes` category.
- Cash ticket + cash pass each create a Square **cash** payment (dashboard-visible), no double-post on retry.
- A showing with no pre-existing variation gets one created (read-back confirms name/price/category; description/images/other variations untouched); a creation failure falls back to a **named ad-hoc** line, never a blank sale, and is logged.
- Donation rings against the `DONATION` item, not a ticket line.
- `grep` confirms nothing outside the catalog-sync/variation-ensure path writes `/catalog`, and checkout only ever *reads* a `catalog_object_id` at sale time.
- `npm run build` + checkout tests pass.
