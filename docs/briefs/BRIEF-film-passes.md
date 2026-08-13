# Brief: Film Passes — physical, activated-on-handoff, in-person only

**Status:** 🟢 Draft for review — supersedes and merges `BRIEF-hybrid-film-passes.md` + `BRIEF-film-pass-as-ticket.md`
**Date:** August 13, 2026
**Requested by:** Tom — full rework of how film passes are sold, activated, and redeemed.

> **In one line.** A film pass is a **physical paper pass with a stickered QR code**. Kenworthy prints blank QR batches; a pass is **activated by scanning** the sticker at handoff (which attaches it to the buyer's account and loads its balance); it is redeemed **only in person at the door**, admitting the holder to a **standard $8 movie for $6 off the balance** (so a $60 pass = 10 movies). It is **not** usable online and **not** a gift card.

---

## The rules (from Tom — the source of truth for behavior)

1. **Value & redemption:** a $60 pass admits the holder to standard **$8 movies at $6 each** → 10 movies. Each in-person redemption deducts **$6** from the balance.
2. **Eligibility is narrow.** Redeemable **only** on **standard $8 movies**. **Not** on events. **Not** on $12 (premium) movies. Not a gift card, not stored value for anything else.
3. **In person only.** A pass can **never** be used to buy tickets online. Redemption happens at the door via a staff scan.
4. **QR is not assigned at purchase.** Kenworthy generates and prints **batches of blank QR stickers**. Staff **activate** a sticker by scanning it (attaching it to an account and loading the balance), stick it on a paper pass, and hand it over — *that* is the moment it becomes an active pass.
5. **Online purchase = physical fulfillment.** Buying a pass online does not produce a digital pass. The buyer chooses **pick up at the box office** or **have it mailed** (enter a mailing address). The physical pass is activated at pickup, or activated-and-mailed.

---

## Lifecycle (the whole flow)

```
Print run                 Sale                         Activation (scan)            Redemption (scan, in person)
─────────                 ────                         ─────────────────            ────────────────────────────
staff generate N   ─┐     online: pay + choose    ─┐   staff scan blank QR   ─┐     door scan of pass QR
blank QR stickers   │      pickup OR mail+address  │    → attach to account   │      → eligible $8 movie?
(status:unassigned) │     in person: pay at POS    │    → load $60 balance    │      → deduct $6, admit
                    │                              │    → status:active       │      → balance 0 ⇒ depleted
                    └──────────────────────────────┴──────────────────────────┴──────────────────────────────
```

Expiry starts at **activation**, not purchase (a mailed/pickup pass shouldn't burn its clock sitting in a drawer).

---

## Current state (file:line — what we're building on / changing)

- **Schema:** `film_pass_types` (`name, price, initial_balance, expiration_days`) and `user_film_passes` (`id`, **`user_id NOT NULL → profiles`**, `pass_type_id`, `remaining_balance`, `expires_at`) — migration `20260403005941_…sql`. **No `qr_code`, no `status`.**
- **Standard price is already $8:** `showings.ticket_price NUMERIC DEFAULT 8.00` (`20260217193113_…sql:34`); premium screenings use `showing_price_tiers` / a higher `ticket_price`. `enforce_ticket_pricing` derives ticket price server-side (`20260403002353_…sql`). Production type is `'movie' | 'event' | 'concert'` (`Showing.tsx:25`). This is the basis for eligibility.
- **Redemption primitive exists:** `redeem_film_pass(pass_id, ticket_id, amount)` locks the pass `FOR UPDATE` and enforces balance/expiry (`20260403005941_…sql:98-141`) — reuse it, but the amount becomes the fixed **$6**, not a derived showing price.
- **🔴 Online film-pass usage exists and must be removed:** `Showing.tsx` (`useFilmPass` at :92, :304, :309, :313, :367, :454-456, and the checkout UI :807-863), `MyPasses.tsx` redeem (:54-90), and `ticket-checkout/index.ts` `payment_method === 'film_pass'` branch (:100, :109, :141, :169, :237, :284). Passes are in-person only now, so this whole path comes out (or is hard-rejected server-side).
- **Walk-in mis-assignment bug** (`FilmPassPOS.tsx:44-105`): when a profile lookup fails it assigns the pass to the **staff member's own account** (:67-73). The new activation flow replaces this.
- **QR building blocks to reuse:** client `QRCodeSVG` (`MyTickets.tsx:137`, `PublicTicket.tsx:125`) and server `renderQrPng(value)` (`_shared/tickets.ts:191-251`) — both encode an arbitrary string, so neither is ticket-specific.

## Data model changes

**`film_pass_types`** — add:
- `redemption_price NUMERIC(10,2) NOT NULL DEFAULT 6.00` — deducted per in-person admission (makes "$6" explicit config, not a magic number).
- (`initial_balance` already the pass value, e.g. $60; `price` the retail sale price; `expiration_days` the validity window.)

**`user_film_passes`** — extend:
- `user_id` → **nullable** (blank stickers have no owner; walk-ins may stay bearer).
- `qr_code TEXT` with a **UNIQUE** index — the sticker payload, minted `PASS:<uuid>` (prefixed so the scanner branches without a speculative query).
- `status TEXT NOT NULL DEFAULT 'unassigned'` — `unassigned` (printed blank) → `active` (activated at handoff) → `depleted` / `expired` / `void`.
- `batch_id UUID` — groups a print run.
- `activated_at TIMESTAMPTZ`, `activated_by UUID` — audit of who handed it over.
- `remaining_balance` / `expires_at` are **set at activation**, not at insert.

**`showings`** — add `film_pass_eligible BOOLEAN NOT NULL DEFAULT true` — an **explicit** eligibility flag (default true for standard movies; staff turn it off for events and $12 screenings). Preferred over a hardcoded `ticket_price = 8` check so eligibility is data, not a magic number — and the door scan checks this flag rather than re-deriving intent from price.

**`film_pass_orders`** (new) — the online fulfillment record:
`id`, `user_id → profiles`, `pass_type_id`, `quantity`, `fulfillment TEXT ('pickup'|'mail')`, `mailing_address JSONB NULL` (required when `mail`), `payment_id`/`receipt_url` (Square), `status TEXT ('paid'|'fulfilled'|'void')`, `pass_id UUID NULL` (set when the physical pass is activated against this order), timestamps.

## What to build

### 1. Batch QR generation + print (staff)
Staff-only edge function `film-pass-batch` `{ pass_type_id, quantity }` → inserts N rows: `status='unassigned'`, `qr_code='PASS:'+randomUUID()`, `user_id=NULL`, `remaining_balance=NULL`, shared `batch_id`. Reads nothing sensitive from the client. Returns the codes. A print view renders each `qr_code` in a print-CSS grid (reuse `renderQrPng` for a server-rendered sheet, or `QRCodeSVG`), with pass-type name for the sticker sheet. Balance/expiry are deliberately **not** on the sticker — they don't exist until activation.

### 2. Online purchase → fulfillment choice (public)
A "Buy a Film Pass" flow (dedicated page, e.g. `/film-passes`): pick pass type + quantity, choose **Pick up at box office** or **Mail it** (+ mailing address form), pay via **Square** (same Web Payments flow as tickets). On success: create a `profiles` row via the existing `findOrCreateBuyer` pattern, insert a `film_pass_orders` row (`status='paid'`), and email a confirmation — *"your pass will be ready at the box office"* or *"your pass will be mailed to <address>"*. **No QR, no activation, no digital pass.** (Mailing is a manual staff task; the platform records address + status only — no shipping integration unless you want one.)

### 3. Activation by scan (staff, at handoff)
A box-office activation screen (in `StaffPOS`/`FilmPassPOS`): staff pull up the paid order (or start a walk-in sale), then **scan a blank sticker**. An atomic `activate_film_pass(p_qr_code, p_order_id | p_contact)` `SECURITY DEFINER` function:
- requires the pass `status='unassigned'`,
- attaches `user_id` (the order's profile, or a walk-in profile via `findOrCreateBuyer`, or leaves bearer if truly anonymous),
- sets `remaining_balance = pass_type.initial_balance`, `expires_at = now() + expiration_days`, `status='active'`, `activated_at`, `activated_by`,
- marks the linked `film_pass_orders` row `fulfilled` and sets its `pass_id`.
This replaces the `FilmPassPOS` self-assignment bug.

### 4. Redemption at the door (staff scanner)
Teach `TicketScanner` to recognize the `PASS:` prefix and call one atomic `admit_with_film_pass(p_pass_code, p_showing_id)` `SECURITY DEFINER` function:
1. resolve pass by `qr_code`; require `status='active'`.
2. **eligibility gate:** the showing's `film_pass_eligible = true` **and** production is a movie — else return `ineligible` (this is the "no events, no $12 movies" rule, enforced server-side).
3. guard double-admit for `(pass_id, showing_id)`.
4. require not expired and `remaining_balance >= redemption_price`.
5. deduct `redemption_price` ($6); if it hits 0 → `status='depleted'`.
6. mint an **admitted** `tickets` row (`showing_id`, fresh `qr_code`, `payment_method='film_pass'`, `scanned_at = now()`), recording the $6 redemption.
The scanner needs a **current-showing selector** (defaulted to tonight's nearest `start_time` in `VENUE_TIME_ZONE`, staff-confirmed) — the same selector `BRIEF-soldout-and-checkin-tracking` calls for. Result states: `admitted`, `ineligible`, `insufficient`, `expired`, `already_admitted`, `no-showing-selected`.

### 5. Remove online redemption
Strip the `useFilmPass` path from `Showing.tsx` and the redeem flow from `MyPasses.tsx`, and hard-reject `payment_method='film_pass'` in `ticket-checkout` (return 400). A pass can never pay for an online ticket. (Ties into `BRIEF-disable-member-login`: `MyPasses` is auth-only and now dormant anyway, since patrons don't log in.)

## Eligibility & pricing — stated explicitly (resist magic numbers)
- **Eligible** = `showings.film_pass_eligible = true` AND movie. Standard $8 movies default to eligible; events, concerts, and $12 movies are flagged/left ineligible.
- **Redemption cost** = `film_pass_types.redemption_price` (default $6), config not constant.
- **Pass value** = `initial_balance` (e.g. $60) → `initial_balance / redemption_price` admissions (10).
- The door scan enforces all of this server-side; the client never sets price or eligibility.

## Interaction with the login shutdown
Consistent by design: online purchase still creates an (invisible) profile for records and future reactivation; the pass attaches to it at activation; the patron never needs to log in because redemption is a staff scan. Nothing here depends on patron auth.

## Open decisions (for you)
1. **Balance model:** money balance ($60, deduct $6) — recommended, flexible for other pass values and clean reporting — vs. a punch count (10). 
2. **Eligibility encoding:** explicit `film_pass_eligible` flag (recommended) vs. derive from movie + $8 price tier.
3. **Walk-in activation:** always attach to a profile (create from contact), or allow a truly anonymous bearer pass?
4. **Online entry point:** dedicated `/film-passes` page vs. surfacing pass purchase on the calendar/home.
5. **Mail fulfillment:** confirm it's a manual staff process (record address + status only), no shipping/label integration.
6. **Lost/stolen pass:** `status='void'` by staff (recommended) — confirm there's a staff UI for it, and whether any balance is refundable.

## Risks
- **Guessable/duplicate codes** → random UUID + `UNIQUE` index; `PASS:` prefix for scanner branching.
- **Over-redemption / double-admit** for one showing → guard in the RPC or a partial unique index on `(pass_id, showing_id)`; concurrent scans serialized by `redeem_film_pass`'s `FOR UPDATE`.
- **Wrong-showing admit** → prominent, confirmed showing selector; refuse if none selected.
- **RLS:** a bearer/`user_id NULL` or unactivated pass is only staff/admin-readable, so activation and redemption must run through the `SECURITY DEFINER` functions (as `redeem_film_pass` already does).
- **Eligibility drift:** if the `film_pass_eligible` flag isn't set on new screenings, default it sensibly (movies true, events false) so a $12 premiere doesn't accidentally accept passes.
- **Fulfillment gap:** a paid online order with no activated pass is an open obligation — the box office needs a queue view of `film_pass_orders status='paid'` so pickups/mailings don't get lost.

## Test plan
- **Batch/print:** generate a batch → all `status='unassigned'`, unique `PASS:` codes, no balance; scan-decode a printed sticker equals the row's `qr_code`.
- **Online purchase:** buy with pickup and with mail (+address) → Square charged, `film_pass_orders` `paid`, profile created, confirmation email matches fulfillment choice, **no** pass activated.
- **Activation:** scan a blank against a paid order → balance = pass value, expiry set from now, `active`, order `fulfilled`; scanning an already-active or unknown code is refused.
- **Redemption:** scan an active pass at an eligible $8 movie → $6 deducted, admitted ticket minted; repeat until depleted (10th admits, 11th `insufficient`). At an **event** or **$12 movie** → `ineligible`, no deduction. Re-scan same pass/showing → `already_admitted`. Expired → `expired`. Concurrent double-scan → exactly one admit.
- **Online lockout:** confirm no UI offers a pass at online checkout and `ticket-checkout` rejects `payment_method='film_pass'`.

## Sequencing
1. Schema (the `user_film_passes` extension is shared by everything).
2. Batch generation + print.
3. Online purchase + fulfillment record.
4. Activation-by-scan (needs schema + orders).
5. Door redemption (needs activation + the scanner showing-selector).
6. Remove online redemption (can land anytime; do it before launch so passes can't be misused online).
