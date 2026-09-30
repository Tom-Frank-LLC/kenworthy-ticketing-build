---
brief: film-pass-pickup-only
title: A film pass type can be marked pickup only, so buyers cannot have it posted
status: shipped
track: feature
date: 2026-09-29
shipped_in: ["#353"]
shipped_at: 2026-09-29
verified: true
evidence: migration 20260929183412 applied on staging and production; film-pass-checkout deployed to both
---

# Brief (for Claude Code): Per-pass "pickup only" option (no shipping)

**Status:** 🟢 Small, well-scoped. The purchase flow already offers **pickup vs. mail** per order; this adds a per-pass-type **"pickup only"** setting that removes the mail option for passes that shouldn't be shipped (e.g. French Film Festival passes for renters), with matching front-end copy and a server refusal so a pickup-only pass can never be ordered for mail.
**Date:** September 29, 2026
**Requested by:** Team — "an option to update passes so I can choose whether they can be shipped or not. We have French Film Festival passes but we don't want to ship them (they're for renters) and don't want to spend on shipping." So a pass type needs to be markable **pickup only**.

## Current state (verified, build `6d5d73c`)
- **Fulfillment is already a per-order choice.** `src/components/FilmPassPurchase.tsx`: `type Fulfillment = 'pickup' | 'mail'` (L39), default `'pickup'` (L64); the buyer picks **"Collect at the box office"** or **"Ship it to me"** (L201–203). Choosing mail reveals + requires a mailing address (L69, L91–95) and sends `fulfillment` + `mailing_address` in the order (L119–131).
- **The server records and queues by fulfillment.** `supabase/functions/film-pass-checkout/index.ts` create path loads the pass type (`from('film_pass_types')`, ~L735), reads `fulfillment` (~L759: `body.fulfillment === 'mail' ? 'mail' : 'pickup'`) and parses the address when mail (~L761–762). Mail orders drive the staff **mail queue / mark-posted** flow (L165, L246).
- **There is no per-type shipping switch today.** `film_pass_types` has name, price, redemption_price, is_active, image_path, fine_print, etc. (`FilmPassesTab.tsx` form + payload L418–445) — nothing that says a type can't be mailed. So every pass currently offers "Ship it to me."
- **The box office POS is already pickup-by-nature.** `FilmPassPOS` hands the pass over at the counter (and separately works the mail queue for online mail orders); it doesn't offer a mail option on a counter sale, so it needs no change beyond honoring the flag if it ever reads fulfillment.

## The change
### 1. Data — a per-type flag
Add `pickup_only boolean NOT NULL DEFAULT false` to `public.film_pass_types` (Decision 1). Default **false** so every existing pass keeps offering mail exactly as now; the team flips the French Film Festival pass types to pickup-only. Add it to the anon/read select the public pages use so the purchase page can read it. Regenerate `types.ts`.

### 2. Admin — the toggle
In `FilmPassesTab`, add a **"Pickup only (no shipping)"** checkbox to the pass-type form, load it into the edit form, and include it in the insert/update payload (alongside the fields at L418–445). Show a small badge on the pass-type list so staff can see at a glance which types are pickup-only.

### 3. Buyer UI — hide mail for pickup-only passes
In `FilmPassPurchase.tsx`, when `pass.pickup_only` is true:
- **Don't render the "Ship it to me" option** (L201–203) — show pickup only, and force `fulfillment = 'pickup'` (so the address block and its validation at L69/L91–95 never apply).
- Show a short line where the choice used to be — e.g. **"Pickup only — collect at the box office."** When false, the current pickup/mail chooser is unchanged.

### 4. Server boundary — refuse mail for a pickup-only pass (don't skip)
In `film-pass-checkout`'s create path, the pass type is already loaded (~L735). After reading `fulfillment` (~L759), if the pass type is `pickup_only` and the request asked for `'mail'`, **reject with a clear message** (e.g. "This pass is pickup only and can't be shipped") rather than accepting it. Same "browser hides, server refuses" discipline used elsewhere — a stale tab or a direct API call must not create a mail order for a pickup-only pass. (Coercing silently to pickup is worse: the buyer thinks they typed an address for nothing; a clear refusal is honest.)

### 5. Front-end copy — say it before checkout
- **Pass detail** (`FilmPassDetail.tsx`): show a "Pickup only — collect at the box office" note near the buy area for a pickup-only pass, so it's clear before they start (it already varies post-purchase copy by fulfillment at L155–169; this is the pre-purchase counterpart).
- **Pass listing** (`FilmPasses.tsx`) — Decision 3: optionally surface a small "pickup only" tag on the card too, so buyers know before opening the detail.

## Decisions for Tom
1. **Flag + default:** `pickup_only` defaulting to **false** (recommended — every existing pass keeps mail; you opt specific types in) vs. a `shippable` flag defaulting true (same effect, inverse name).
2. **Copy wording:** "Pickup only — collect at the box office" (recommended) — confirm or reword.
3. **Listing tag:** also show a "pickup only" tag on the pass listing cards (recommended, minor) vs. only on the detail/purchase page.
4. **Existing mail orders:** this gates **new** purchases only; any French Film Festival mail orders already placed are untouched — confirm that's fine (they should be, since the team is setting this going forward).

## Test plan
- A pass type can be set **Pickup only** in admin (with a visible badge); existing pass types default to **shippable** and behave exactly as before.
- On a **pickup-only** pass, the purchase page shows **no "Ship it to me"** option, collects no address, and says "pickup only"; a **shippable** pass still offers both with address validation intact.
- **Server refuses** a `mail` order for a pickup-only pass (stale tab / direct call) with a clear message; a pickup order for it succeeds; shippable passes still accept mail.
- Pass **detail** (and listing, per Decision 3) show the pickup-only note before checkout; post-purchase confirmation copy is correct for both fulfillments.
- The box office POS and the mail/pickup queues still work; existing mail orders are unaffected.
- `npm run build` + tests pass (add: the buyer UI hides mail when pickup-only; the checkout function rejects mail for a pickup-only type; the migration/default keeps existing passes shippable).

## As built (2026-09-29) — shipped to staging and production the same day

Decisions taken as recommended: `pickup_only` default **false**; copy "Pickup only — collect at the box office"; a **Pickup only** tag on the listing cards; new orders only.

- Migration `20260929183412_film_pass_pickup_only.sql` adds the column. It is in `PASS_TYPE_COLUMNS` (`src/lib/filmPass.ts`), so the listing, the detail page and the purchase panel all read it.
- **Admin:** checkbox "Pickup only (no shipping)" in the pass-type form, plus a "Pickup only" badge on the pass-type list.
- **Buyer:** `FilmPassPurchase` swaps the radio group for a single "Pickup only — collect at the box office" card. The purchase panel sits inside `FilmPassDetail`, so this is also the detail page's pre-purchase note. `fulfillment` is derived from `pass.pickup_only`, so the address block, its validation and the request body can never say mail.
- **Server:** `readFulfillment()` in `_shared/pass_orders.ts` returns 400 with "This pass is pickup only and can't be shipped", before any Square call. Walk-in POS sales never read fulfillment, so they are unchanged.
- **Tests:** `pass_orders_test.ts` (refusal; shippable passes unchanged) and `FilmPassPurchase.test.tsx` (no mail option or address, request sends pickup; mutation-checked).
