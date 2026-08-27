---
brief: manual-sold-out
title: An admin can mark a showing sold out by hand, which closes online sales without hiding the showing
status: built
track: feature
severity: P2
date: 2026-08-25
shipped_in: []
shipped_at:
verified: false
---

> **Decisions taken (2026-08-27).** All four went to the recommended option.
> **1 — boolean `manually_sold_out`**, not a `sales_status` enum: it matches the
> flags already on the table, and a "closed" enum value would duplicate
> `is_active` with nothing stopping the two disagreeing.
> **2 — the flag reaches the listings**, so a card reads "Sold Out" instead of
> "Get Tickets" before the click. Only the *manual* flag; reflecting capacity
> there would cost a ticket count per card and stays out of scope.
> **3 — an optional `sold_out_message`**, shown in place of the standard notice
> and returned as the checkout's refusal, so the page and the server say the
> same words. Kept when the showing is reopened.
> **4 — online only.** The gate lives in `_shared/pricing.ts`, the single point
> every online sale passes. StaffPOS and comps insert straight through
> PostgREST and are deliberately untouched: the counter stays open while the
> website is closed. There is no trigger on `tickets` behind this flag, and
> that asymmetry is the feature rather than an omission.

# Brief (for Claude Code): Let admins manually mark a showing "Sold Out"

**Status:** 🟢 New per-showing override + display + a server gate. Small, but it touches the "browser hides / server refuses" purchase boundary — the online checkout must enforce it, not just the UI.
**Date:** August 25, 2026
**Requested by:** Tom — admins need to **manually "sell out" a showing** so online ticket purchasing closes and the page shows **"Sold Out"** messaging, regardless of how many seats are actually left (e.g. the house was filled through another channel).

## Current state (verified)
- **"Sold out" today is capacity-derived only.** `Showing.tsx` computes `soldOut` from `ticketsSold` vs `total_seats` (GA) or unclaimed seats (assigned), renders a **`SoldOutNotice`** component, and hides the buy controls.
- Capacity is enforced server-side by `enforce_showing_capacity()` (trigger) + `showing_availability()` (SECURITY DEFINER) + a pre-check in `ticket-checkout` (lines ~242–248, 409 on the race). There is **no manual/override sold-out** — if seats remain, the page sells.
- **The purchase boundary is explicit** (`src/lib/purchasable.ts` + `supabase/functions/_shared/purchasable.ts`): "the browser hides the button; this refuses the sale." Note it **deliberately excludes capacity** ("sold-out is a different state with its own notice") — so a manual sold-out is a **new state to add**, cleanly, alongside past/inactive.
- Listing CTAs ("Get Tickets") in `ShowingPreview`/`BoothNote`/`UpcomingList`/`TrailerFeed` do **not** reflect sold-out today (sold-out only shows on the showing page).
- `is_active=false` **hides** a showing entirely — that is *not* what's wanted here (a sold-out showing stays visible, just closed to sales).

## The change
### 1. Data
- Add `manually_sold_out boolean NOT NULL DEFAULT false` to `showings` (a clear, single-purpose flag; **Decision 1:** this vs a broader `sales_status` enum — recommend the boolean, matching `requires_seat_selection`/`is_active` style).
- Optional `sold_out_message text` for a custom notice (**Decision 3**).

### 2. Admin control (reversible)
- A **quick toggle** on each showing in the **admin showings list** (`AdminDashboard.tsx`) — "Mark sold out" / "Reopen sales" — because this is an operational, do-it-now action, not something to bury in the edit form. Also expose it as a checkbox in `ShowingForm.tsx` for completeness.
- Reversible: reopening clears the flag (sales resume if capacity and timing allow). Keep it visually distinct from **Deactivate** (which hides the showing) — different action, different meaning.

### 3. Customer display
- In `Showing.tsx`, make `soldOut` also true when `manually_sold_out` (i.e. `soldOut = manually_sold_out || capacitySoldOut`). Reuse **`SoldOutNotice`**; if `sold_out_message` is set, show it. Hide the quantity steppers, seat picker, card, and buy button exactly as capacity sold-out already does.
- **Listings (Decision 2, recommended):** carry `manually_sold_out` into `FeedItem` (extend the `Index.tsx`/`useFeed.ts` mapping + type) and render a **"Sold Out"** label in place of "Get Tickets" on the home/calendar cards, so a sold-out showing reads correctly before the click. (Reflecting *capacity* sold-out in listings is a larger lift — out of scope; this only wires the manual flag.)

### 4. Server enforcement (the boundary — do not skip)
- **`ticket-checkout` must refuse** an order for a `manually_sold_out` showing, with a clear "This showing is sold out." message — alongside the existing past-showing and capacity refusals. The browser hiding the button is not enough; a stale tab or direct call must be refused too (same discipline as `purchasable.ts`).
- **Scope of the block (Decision 4 — important):** a manual sold-out should close **online** sales but **not** necessarily block **staff** paths — the box office may still need to comp or sell a held seat in person even when the public line is "sold out." Recommend the gate lives in **`ticket-checkout`** (the web's single sell point, by its own comment) so **StaffPOS/comps remain able to issue tickets**; do **not** add a blanket `tickets` INSERT trigger that would also block staff. Confirm this is the intent (recommended) vs a hard block on all ticket creation.
- Keep the flag out of the capacity math itself — it's an independent gate, so an oversold/edge case can't accidentally un-sell-out a showing.

## Interactions to get right
- **Past vs sold-out:** a past showing still shows the passed notice (past logic unchanged); manual sold-out only matters while the showing is otherwise purchasable.
- **Assigned seating:** manual sold-out hides the seat picker too (it flows through the same `soldOut`).
- **Free / no-ticket showings** (if `BRIEF-free-no-ticket-showings.md` ships): a no-ticket showing has nothing to sell out — manual sold-out is irrelevant there; don't offer it, or make it a no-op.
- **Comps already sold:** reopening after a manual close doesn't disturb existing tickets; it only re-enables new online sales.

## Decisions for Tom
1. Boolean `manually_sold_out` (recommended) vs a `sales_status` enum (open/sold_out/closed).
2. Reflect the flag in listings as a "Sold Out" label (recommended) vs showing-page only.
3. Custom `sold_out_message` (optional) vs the standard "Sold Out" notice.
4. Block **online only**, leaving StaffPOS/comps able to sell in person (recommended) vs a hard block on all ticket creation.

## Test plan
- An admin can mark a showing sold out from the admin list (and the form) and reopen it; the toggle is clearly distinct from Deactivate.
- A manually sold-out showing shows **"Sold Out"** on its page (custom message if set), with all buy controls hidden — even when seats remain; listings (per Decision 2) show "Sold Out" instead of "Get Tickets."
- **`ticket-checkout` refuses** an order for a sold-out showing (stale tab / direct call) with the sold-out message; per Decision 4, StaffPOS/comps can still issue a ticket in person.
- Reopening restores normal sales (capacity and timing permitting); existing tickets are untouched.
- Capacity-based sold-out still works independently; past/inactive behavior unchanged; assigned-seating shows sold-out correctly.
- `npm run build` + tests pass; add tests for the online-checkout refusal and the `soldOut = manual || capacity` render branch.
