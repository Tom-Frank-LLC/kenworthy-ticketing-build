---
brief: promo-codes
title: A buyer can enter a promo code at checkout and get that code's ticket discount, priced by the same SQL function as every other discount
status: queued
track: feature
severity: P2
date: 2026-11-13
verified: false
---

# Brief: promo codes on ticket purchases

**Requested by:** Tom, 13 Nov 2026 ("do we have any infrastructure for promo code discounts?").
**Builds on:** `BRIEF-ticket-discounts` (shipped #311/#312/#314), `BRIEF-pricing-rpc` (shipped
#316–#324), `BRIEF-sec-rls-regressions` (audit L19, migration `20261006225937`).
**Design record for the discount model:** `docs/DESIGN-order-level-tax-and-ticket-discounts.md`.

## Where things stand (verified against `origin/main` at f0e0105, 13 Nov 2026)

The discount model was built with promo codes in mind, but no promo code can be used yet.

| piece | state | where |
|---|---|---|
| Rule table: type, value, minimum quantity, window, label, eligible tiers, scope | **built** | `ticket_discounts`, `20260921203017_ticket_discounts.sql` |
| `code` column | **exists, nullable, unused**: "Reserved for promo codes. NULL means the rule applies automatically" | same migration, line 64 |
| Coded rules hidden from the public | **built**: anon sees only rules with `code IS NULL`; staff and admins see all | `20261006225937_ticket_discount_codes_hidden.sql` |
| Pricing ignores coded rules | **built, on purpose**: `WHERE d.is_active AND d.code IS NULL` | `price_ticket_order`, latest body in `20261006225325_price_ticket_order_requires_tier.sql:168` |
| Browser preview drops coded rules | **built, on purpose**: `usableRules` filters `!r.code` | `src/lib/discounts.ts` |
| Ticket rows record which rule applied | **built**: `discount_id`, `discount_label`, `discount_amount`, `list_price` | `tickets` |
| Square gets one discount line per discounted ticket line, scoped to tickets only | **built** | `_shared/square-order.ts` |
| A way to pass a code into pricing | **missing**: `price_ticket_order(showing, tickets, channel)` takes no code; nor do `quote_ticket_order` or `create_ticket_order` | |
| Admin can set a code on a rule | **missing**: `DiscountRulesEditor.tsx` neither selects nor writes `code` | |
| Code box on the showing page | **missing** | `src/pages/Showing.tsx` |
| Code box at the box office | **missing** | `src/pages/staff/StaffPOS.tsx` |
| Uniqueness, usage cap, redemption count | **missing**: no unique index on `code`, no cap column | |

Staging has 0 discount rules (0 coded). **Production has not been checked.** Before building,
run `select count(*), count(code) from ticket_discounts` against production. A rule someone
already saved with a code would start applying the day pricing reads codes.

## What the build needs

### 1. Schema (one migration)

- Normalise codes: store them trimmed and case-folded, with a CHECK
  (`code IS NULL OR code = upper(btrim(code))`) and a sensible charset/length. Buyers type
  codes in every case.
- Site-wide unique index on `code` where `code IS NOT NULL` (Decision 3).
- **Site-wide scope (Decision 2).** Replace `ticket_discounts_one_scope` ("exactly one of
  showing / movie / event / live_performance") with "at most one". **All four NULL is allowed
  only when `code IS NOT NULL`.** An unscoped *automatic* rule would discount every ticket on the
  site the moment it was saved, so the database must refuse it, not just the form. In
  `price_ticket_order`, the scope test gains `OR (d.showing_id IS NULL AND d.movie_id IS NULL AND
  d.event_id IS NULL AND d.live_performance_id IS NULL)`. That branch is only reachable through a
  matching code, because automatic selection still requires `code IS NULL`.
- **Limits are rows, not columns (Decision 5).** New table `ticket_discount_limits`:

  | column | values |
  |---|---|
  | `discount_id` | FK → `ticket_discounts`, `ON DELETE CASCADE` |
  | `counts` | `'orders'` · `'tickets'`: what is counted |
  | `per` | `'total'` · `'buyer'` · `'showing'` · `'day'` · `'buyer_showing'`: what the count is measured within |
  | `max` | integer ≥ 1 |
  | unique | `(discount_id, counts, per)` |

  A rule has zero or more limits, and an order must pass **every** limit on its rule. That answers
  "orders or tickets?" by offering both. Examples:

  - "100 orders in total": a launch promo.
  - "2 tickets per buyer": a member code.
  - "20 tickets per showing": the first 20 seats at the promo price.
  - "1 order per buyer per showing" (`buyer_showing`): the nearest thing to "per visit" for
    tickets.

  `orders` counts distinct `order_token`s carrying this `discount_id`. `tickets` counts the
  **discounted** ticket rows (`discount_amount > 0`), not every ticket in those orders. A full-price
  ticket bought alongside isn't a use. `day` is the showing's local date in
  `America/Los_Angeles`, the zone most of the codebase uses (Moscow, Idaho is on Pacific time).
  A few files say `America/Boise` or `America/Denver`, which are Mountain time and an hour off.
  Don't copy those. A `tickets` limit refuses an order
  that would cross it. It doesn't trim the order, which keeps the pricing arithmetic untouched (see
  "Not in this build" for the trimming variant).

  Adding a new kind of limit later is a new `per` value plus one branch in the counting function,
  not a schema redesign. Same RLS as `ticket_discounts`: admin writes, staff read, anon nothing.

  The admin form should suggest, not force: on a production- or showing-scoped rule, put
  "orders in total" first; on a site-wide rule, put "per buyer" and "per showing" first.
- **`channels text[] NULL`** on `ticket_discounts` (NULL = everywhere; otherwise a subset of
  `{'online','in_person'}`). `price_ticket_order` already receives `p_channel`, so this is one more
  `WHERE` clause. Cash at the box office is `'none'` in pricing terms; map it to `in_person` for
  this test.
- **`applies_to text NOT NULL DEFAULT 'tickets'`**, `CHECK (applies_to = 'tickets')` for now. This
  build only discounts tickets. The column is there so passes or concessions can join the table
  later by widening a CHECK instead of redesigning it (see "Concessions and passes").
- Redemptions are **counted, not stored as a counter**, from `tickets`, held by the same status
  rule seats use (below). Nothing can drift. If that proves slow, add a counter later.
- **Who the buyer is.** Online, `tickets.user_id` is the buyer: guest checkout creates or reuses
  an account per email. At the box office it is **not**: `StaffPOS.tsx` passes
  `p_user_id: user.id`, the *staff member*. So `max_per_buyer` counts **online orders only**
  (`payment_method = 'online'`). Otherwise every POS sale would count against whoever was on the
  till. At the POS, a per-buyer limit can't be checked automatically. The POS shows the limit
  beside the applied code ("Limit 2 per patron. Check before selling.") and staff police it, as
  Tom accepted. Limits measured `total`, `showing` or `day` count every channel. Buyers who
  change email can get around per-buyer limits; Tom accepted that too.
- Optional: a `tickets.discount_code` text snapshot, because an admin can later edit or delete the
  rule (`discount_id` is `ON DELETE SET NULL`). The label snapshot already exists, so this is
  cheap.

### 2. Pricing: `price_ticket_order` takes `p_code text DEFAULT NULL`

- The candidate set becomes: automatic rules (as now) **plus**, when `p_code` is given, the one
  active, in-window, in-scope rule whose code matches `upper(btrim(p_code))`.
- How the coded rule competes with automatic rules is Decision 1.
- An unknown, expired, out-of-scope or used-up code is a **refusal** with its own error code
  (e.g. `PT422 'That code isn't valid for this showing.'`), not a silent full price. A buyer
  who typed a code and was charged full price without being told is the failure to design
  against.
- A valid code that doesn't change this order (below its minimum, or no eligible tiers in the
  basket) returns prices normally. The caller can tell that `discount_id` isn't the coded rule
  and show "Add 2 more tickets to use this code", or similar.
- The signature changes, so the migration must `DROP FUNCTION` the old one and re-`GRANT`/`REVOKE`
  on the new signature for all three functions (`price_`, `quote_`, `create_ticket_order`). The
  old signatures linger otherwise. `create_ticket_order` has already been redefined with new
  arguments once (`20260922170258`); copy its grant pattern.
- **Limits.** `price_ticket_order` checks every limit row when it picks candidates, so the quote
  already says "used up". `p_user_id` is not a pricing input today. Either pass the buyer in (for
  the per-buyer count) or check the per-buyer limit only in `create_ticket_order`. Prefer passing
  it, so the quote and the charge give the same answer. The anon quote stays code-free anyway
  (§3).
- **Limit enforcement under concurrency:** in `create_ticket_order`, when a coded rule applied,
  `SELECT … FOR UPDATE` the rule row, recount every limit, and refuse if any would be crossed.
  Pricing itself is `STABLE` and must stay so; the lock belongs in the writer.
- **Each kind of limit gets its own refusal sentence:** "This code has been used up", "You've
  already used this code the maximum number of times", "This code has been used up for this
  showing", "This code allows 2 tickets per buyer; you have 1 left". The buyer gets told which
  limit stopped them and, for a ticket limit, how many they can still buy.
- The card path inserts `pending` rows before the charge. Pending rows count toward the cap, so
  two buyers can't both take the last use. A declined charge sets them to `failed`
  (`ticket-checkout` ~line 473), which the count excludes. A pending row whose isolate died
  before the charge is treated as abandoned after a hold window (`HELD_STATUSES` and the
  pending-hold constant in `ticket-checkout`). Count redemptions by **the same rule seats use**,
  so an abandoned checkout doesn't hold a code's last use forever.

### 3. The quote path is the brute-force door

`quote_ticket_order` is granted to **anon** and called directly from the browser
(`src/lib/quote.ts`) with no rate limit and no Turnstile. If it accepts a code, anyone can test
codes against it as fast as PostgREST answers, and every distinct reply ("not valid" vs. "add 2
more tickets") confirms a hit.

Recommended: **leave the anon `quote_ticket_order` without a code argument.** Route code quotes
through an edge function that applies `checkRateLimit` (new bucket in
`_shared/rate_limit.ts` `LIMITS`, e.g. 10 per 10 min per IP) and calls the coded quote with the
service role. `ticket-checkout` already has rate limiting and Turnstile in front of
`priceTicketOrder`, so it only needs to pass the code through.

### 4. Edge functions

- `_shared/pricing.ts`: `priceTicketOrder` / `createTicketOrder` take an optional `code` and map
  the new refusal to a `PricingError` with the buyer-facing sentence.
- `ticket-checkout`: accept `promo_code` in the body, validate its shape, pass it through. The
  discount line Square receives is unchanged in shape. Name it with the rule's label, which an
  admin can write as "FALLFEST: 20% off".
- New (or folded into an existing function): the rate-limited code quote from §3.
- Film-pass checkout and concessions don't go through `price_ticket_order` and are **out of
  scope**.

### 5. Admin (`DiscountRulesEditor.tsx`)

- Optional "Promo code" field on the add form. Empty means automatic, as now. Add "Limits"
  ("Add a limit: [N] [orders|tickets] [in total|per buyer|per showing|per day|per buyer per
  showing]") and "Sold: Online / Box office" (§1). Limits and channels also apply to automatic
  rules. Nothing in the schema restricts them to coded ones.
- List view shows the code and "N of M used" (or "N used"). For per-showing limits it shows
  the busiest showing.
- **Site-wide codes need their own home.** The editor is mounted per production (and per
  showing) and filters by a scope column, so an unscoped rule would appear nowhere. Add a
  "Promo codes" admin section, under the existing admin sections in `src/lib/adminSections.ts`,
  admin-only like the table's write policies. It lists **every** coded rule (site-wide and
  scoped), with its scope, limits and use counts, and can create site-wide ones. Production
  editors keep creating scoped codes inline.
- The editor writes through RLS, so keep its existing `.select()` + row-count assertion on every
  write. A duplicate code arrives as a unique-violation; show it as "That code is already in
  use".
- The help text must say that a coded rule is **invisible on the public page** and applies only
  when typed.

### 6. Patron page (`Showing.tsx`)

- A "Have a promo code?" disclosure near the order total. Apply → coded quote (§3) → the total
  updates and the discount line reads the rule's label. Errors appear inline, in the database's
  own words.
- The applied code travels with the checkout request. If the code stopped working between quote
  and buy (window closed, cap reached), checkout refuses with that sentence, the same way an
  expired automatic discount is handled today (`ticket-checkout` `/^That discount/`).
- Design constraints apply: no `px` font sizes, solid `muted-foreground`, error text on the
  light `--destructive` fill, and `prefers-reduced-motion` for any reveal. Re-run
  `scripts/a11y-flows.mjs` on the showing page afterwards. Public pages stay at zero.

### 7. Box office (`StaffPOS.tsx`), see Decision 4

The same input, passed as `p_code` to `create_ticket_order`. Staff are already authenticated and
the RPC is staff-gated, so no rate limit is needed there. The running total uses the
staff-callable coded quote.

## Decisions (Tom, 19 Nov 2026)

1. **No stacking.** One discount per order; a code competes with automatic rules and the best
   one wins, as today. Every downstream piece (one `discount_id` per ticket, one Square discount
   per line, the allocation arithmetic, the pricing vectors) assumes one rule. When a better
   automatic discount beats the code, the page says so ("A better discount already applies").
2. **Both scopes.** A code can be scoped to a showing or production, **or** be site-wide. The
   database enforces that a site-wide rule always has a code (§1), and site-wide codes get their
   own admin section (§5).
3. **Codes are unique site-wide.**
4. **Online and the box office.**
5. **Limits are flexible, not fixed:** any number per rule, each counting orders *or* tickets,
   in total, per buyer, per showing, per day, or per buyer per showing (§1). Tom asked for
   options rather than one answer to "is a use an order or a ticket?". The limit table gives
   both. None of the limits is tied to a scope. Per-buyer is enforced online only and policed
   by staff at the box office. Varying an email gets around it. Tom accepted both.
6. **A refund doesn't give a use back.** The count is purely "sold with it", so the refund path
   needs no bookkeeping. Revisit if a limited code is ever oversubscribed by refunds.
7. **Built now: limit rows, channel restriction, `applies_to`.** A per-order cap on discounted
   tickets is a follow-up (below). Concessions use Square's register (below).

## Concessions and passes (found 13–19 Nov 2026)

Tom raised a concessions-only promo, "per item or per visit". Two findings decide where that
goes:

- **This app doesn't sell concessions.** They're rung up on the theatre's own Square register.
  The box office has a Concessions tab (`ConcessionPOS.tsx`), but it's **hidden on purpose**
  behind `CONCESSION_POS_ENABLED` (`src/lib/flags.ts`): it prices in the browser at
  `subtotal × 0.06`, writes `concession_sales` directly, and **never contacts Square**, so a
  "card" sale toasts success without charging. `concession_sales` has zero rows. A concessions
  rule in `ticket_discounts` would have no checkout to apply to.
- **So, for now, concessions promos belong in Square:** a catalog discount on the register,
  restricted to the relevant items or categories, or Square's automatic discounts. Staff choose
  a named discount rather than typing a code. The register has no buyer identity, so "per
  visit" there means per transaction, policed by staff. (Square's current discount options
  weren't checked in detail for this brief. Confirm in the Square dashboard before promising a
  specific behaviour.)
- **If concessions or passes ever sell through this app,** they first need to be priced by the
  database the way tickets are (`BRIEF-pricing-rpc` lists film-pass checkout and concessions as
  still taxing per item). Then widen `applies_to`, and add `'items'` to `ticket_discount_limits.counts`
  for "per item". The table is built so that's an extension, not a redesign.

## Not in this build

- **A per-order cap on discounted tickets** ("20% off, up to 2 tickets per order"). Today a rule
  discounts every eligible ticket in the order. A cap means choosing *which* tickets get it
  (the most expensive? the first?) and changes the allocation in `price_ticket_order`, so the
  Square sandbox vectors have to be regenerated (`pricing_vectors.json`). Medium-sized; its own
  brief.
- **Buy-X-get-Y and free-item rules.** Each is new pricing logic in the same function.

## Testing

- **Pricing harness** (`supabase/tests/pricing_rpc`): add vectors for coded rules: a code
  alone, a code beside a better automatic rule, a code beside a worse one, below minimum,
  eligible-tiers-only, expired, wrong production, wrong case and padded whitespace, and a
  site-wide code on a film, an event and a live performance. Plus every `per` value, for
  both `orders` and `tickets`: per buyer (including that POS sales by a staff member don't count
  against them), per showing (used up at one showing, still valid at another), and per day
  (across midnight in the theatre's zone). Test a ticket limit that the order would cross
  partway, and two limits on one rule where only the second refuses. Check channels (an
  online-only code refused at the POS, and box office cash counted as in-person). Also check
  that an unscoped rule without a code is refused by the table.
  Per CLAUDE.md ("a harness only proves the branches it takes"), include **untiered**
  showings. Most of production is untiered, and the 22 Sep outage came from testing only tiered
  ones.
- One coded order through the Square sandbox, to confirm the discount line reconciles to the
  cent the way automatic discounts do (`pricing_vectors.json`).
- **Concurrency:** two `create_ticket_order` calls racing for the last use of a capped code.
  Exactly one wins.
- `supabase/tests/anon_surface/surface.sql` and `behaviour.sql`: anon still can't read coded
  rules, and the anon `quote_ticket_order` signature still has no code argument.
- Before deploying: call the new `price_ticket_order` once, read-only, against production data
  for an untiered and a tiered showing with `p_code => NULL`, and confirm it matches the old
  signature's output.
- Staging checkout: use the safe recipe in the ticket-discounts notes (phone-only buyer,
  `sms_consent: false`, sandbox nonce).

## Out of scope

Film passes and concessions (see above), donations, and memberships. Auto-generated single-use codes (a
code per recipient) are a later add-on to this table: many rows, `max_redemptions = 1`.
Mailchimp's e-commerce promo-code fields. Showing a coded discount on the public offer badge,
which by definition it never appears on.
