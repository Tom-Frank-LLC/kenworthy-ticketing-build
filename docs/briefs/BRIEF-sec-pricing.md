---
brief: sec-pricing
title: A tiered showing refuses a ticket with no tier, and a multi-pass order is fulfilled by its last sticker, not its first
status: built
track: security
severity: P1
date: 2026-10-06
verified: false
findings: ../AUDIT-security-2026-10-06.md
---

# Brief: pricing completeness (audit H2 and L2)

**Status:** built on `fix/sec-pricing`, not deployed. Two migrations, no edge
function or Worker change.

| Finding | What it was | Fix |
|---|---|---|
| **H2** (PAY-2), High | `price_ticket_order` priced a ticket with no `tier_id` (and no seat tier) at `showings.ticket_price`, even when the showing had active tiers. That column is the form's "fallback price when no tiers are used". It defaults to 8.00 and can be 0. `tickets: [{},{},{},{}]` on a $55/$40 event cost $0.00, and a $0 order is confirmed without Square being contacted. | `20261006225325_price_ticket_order_requires_tier.sql`: when the showing has any active tier, a ticket that resolves to no tier is refused with `PT400 "Choose a ticket type for each ticket."` A ticket resolves to a tier either by naming it or through its seat's tier mapping. |
| **L2** (PAY-5), Low | `activate_film_pass` marked a film-pass order `fulfilled` on its first sticker. An order for 3 passes left the box-office queue after 1, and the other 2 paid-for passes were never recorded as owed. | `20261006225347_activate_film_pass_by_quantity.sql`: each pass records the order it was activated against (new `user_film_passes.film_pass_order_id`). The order stays `paid`, and so stays in the queue, until its `quantity` of passes has been activated. |

## H2: who sends tier-less tickets, and why the rule breaks none of them

The rule's test for "tiered" is *an active `showing_price_tiers` row exists*. I
checked every caller that builds ticket descriptors to confirm that each one
sends a tier whenever that test is true:

| Caller | Path | What it sends on a tiered showing |
|---|---|---|
| `src/pages/Showing.tsx` `buildTicketDescriptors` (online, also used by `GuestCheckoutForm`) | `ticket-checkout` → `quote_ticket_order` / `create_ticket_order` | `hasTiers` = active tiers read as anon (the RLS policy shows anon `is_active = true` rows, which is the same test). GA sends `{tier_id}` per ticket. Assigned seats send the seat's mapped tier, or else the cheapest tier. |
| `src/pages/staff/StaffPOS.tsx` `ticketDescriptors` (cash / card) | `create_ticket_order` | `hasTiers` = active tiers. Every descriptor carries the chosen `tierId`. |
| `src/lib/quote.ts` `useOrderQuote` (both pages above) | `quote_ticket_order` | The same descriptors as the purchase. |
| `HostDashboard.tsx` `CompTicketIssuer`, and any comp | `create_ticket_order(..., 'comp')` | `[{}]`. **Unaffected:** the comp branch never calls `price_ticket_order`. |
| Film-pass admission | `admit_with_film_pass` | **Unaffected:** writes its own $0 `film_pass` row and does not price. |
| `square-discount-probe/generate_discount_vectors.ts` | `quote_ticket_order` | Always sends `tier_id`. |

No caller legitimately sends a tier-less ticket to a showing with active tiers.
Before this change, the only ways that happened were a forged request, or the
POS selling before its tier list had loaded. In both cases the base price was
the wrong price.

Not changed: a showing whose tiers are all inactive still sells at the base
price, because the page shows no tier picker for it. A seat's tier mapping
still wins over whatever tier was requested. `quote_ticket_order` and
`create_ticket_order` both price through `price_ticket_order`, so both pick up
the rule without being redefined. The function body is the effective one from
`20260922203433`; no later migration redefines it, and `20261002*` changes only
`showing_ends_at`, which this function calls. The one other edit drops the
unused `v_duration` local variable.

`ShowingForm.tsx` is unchanged. Its label ("Fallback price when no tiers are
used") and its comment ("the base is the fallback nobody reaches") are now
accurate.

## L2: details

- The pass count is read under the order's `FOR UPDATE` lock, which was already
  taken. Two staff members scanning against the same order therefore serialise.
- `pass_id` still names the first pass issued, so a single-pass order looks
  exactly as before. `fulfilled_at` and `fulfilled_by` are stamped by the
  **last** pass, which is what the mail queue keys on.
- A sticker scanned against a completed order returns `order_not_payable` /
  `fulfilled`, and the counter shows "That order has already been handed over."
- The verdict gains `quantity`, `passes_activated`, `passes_remaining` and
  `order_fulfilled`. These are NULL for a counter sale. `film-pass-checkout`
  spreads the verdict into its response, so they already reach the POS.
- Backfill: every pass named in an existing order's `pass_id` gets that
  order's id.

### Companion changes in files this cluster does not own

1. **`src/components/admin/accounting/QboExportTab.tsx` — required before or
   with the migration.** It books online orders at the order and skips the
   order's pass using `orderedPassIds = film_pass_orders.pass_id`. With this
   fix, an order's 2nd and later passes are not in `pass_id`, so the export
   would book them a second time as counter sales at `price_paid`. The fix is
   to add `film_pass_order_id` to the `user_film_passes` select and skip
   `p.film_pass_order_id` as well:
   `if (orderedPassIds.has(p.id) || p.film_pass_order_id) continue;`
   (keep `orderedPassIds` for rows the backfill could not link). If QBO export
   is not run between the migration and that UI deploy, there is no harm.
2. **`src/components/pos/FilmPassPOS.tsx` — nice to have.** After an
   activation against an order, it clears the order and reloads the queue. A
   part-fulfilled order reappears there and can be activated again, so this
   works without a change. A toast such as "1 of 3 — scan the next sticker"
   built from `passes_remaining`, and an "n of N issued" line on the queue row,
   would make that obvious to staff.
3. `film-pass-checkout` (`activate`) needs no change.

Pre-existing and not changed here: for an order, `price_paid` is
`amount_paid / quantity`, which includes tax, while a counter sale's
`price_paid` is pre-tax. The QBO export never books an order pass at
`price_paid` once item 1 is in, so this only shows up on the pass's own record.

## How it was proven

- **`sh supabase/tests/pricing_rpc/run.sh`: 144 passed, 0 failed** (106 before
  this change). The new `tier_required_before.sql` captures the old function's
  answer for 24 order shapes, then the migration is applied and §9 asks the
  same questions again:
  - **Unchanged, byte for byte** (every line, tax, discount, fee and grand
    total, or the same refusal), for these 18 shapes: untiered $8 /
    $0 free / $12.50 with a 4+ discount / 6 tickets cash / `tier_id: null` and
    `""`; untiered assigned seats; an untiered rental with the surcharge online
    and in person; a showing with only inactive tiers (bare and naming the dead
    tier); the tiered gala, honest; a tiered film with Adult/Student and a
    tier-scoped discount; an inactive tier; a tier from another showing; seat
    tiers (the seat tier overrides the requested tier, mapped seats sent with no
    tier, an unmapped seat with the page's fallback tier).
  - **Previously priced at the base, now refused `PT400`**, for 6 shapes. Two of
    the "before" values are asserted to be the audit's numbers: `[{},{},{},{}]`
    on the base-0 gala came to **$0.00**, and `[{}]` on base 8 came to
    **$8.48**. The other four are `tier_id: null`, one honest ticket plus one
    bare ticket, a cash sale with `{}` on a tiered film, and an unmapped seat
    with no tier.
  - The paths that write rows: box-office cash with no tier on a tiered showing
    is refused and writes no row; with the tier it sells at $7.42; cash on an
    untiered showing still writes $8 rows; a comp with no tier on the tiered
    gala is still issued; online with no tier is refused; online with the GA
    tier writes $42.40.
  - The audit's own `pay_null_tier.sql`, run against the new function: the
    honest tier totals $42.40, and the tier-less order raises "Choose a ticket
    type for each ticket."
- **`sh supabase/tests/film_pass_activation/run.sh`: 21 passed, 0 failed (new
  harness).** It installs the **old** function verbatim from `20260813000000`
  and shows that one sticker fulfils a 3-pass order. It then applies the
  migration and checks the following:
  - The backfill links that pass to its order.
  - For a 3-pass order, sticker 1 → `paid`, 1 of 3; sticker 2 → `paid`; sticker
    3 → `fulfilled` with `fulfilled_at`/`by`, and `pass_id` is still the first
    pass. All three passes are active, owned by the buyer, linked to the order,
    and carry $63.60 each. A 4th sticker is refused and stays blank.
  - A one-pass order is fulfilled by its one sticker. A walk-in counter sale is
    unchanged and linked to no order.
  - A `paid` order that already holds its quantity issues no more.
  - Only `service_role` can execute the function.
- **Full replay** of all 150 migrations into postgres:15 (the audit's replay
  stub): both new migrations apply with rc=0. The only error is the known
  data-anchor abort in `20260812180000`, which also happens on main. On the
  real schema: `quote_ticket_order` on an untiered showing returns $8.48, an
  honest tier returns $26.50, and `[{}]` on the tiered showing is refused. A
  2-pass order goes `paid` after 1 pass, is fulfilled after 2, and refuses a
  3rd. Grants are unchanged: `price_ticket_order` and `activate_film_pass` are
  `service_role` only, and `quote_ticket_order` is anon-executable.
- `deno test`: a new case in `_shared/pricing_test.ts` pins that the PT400
  becomes a `PricingError` (a 400 from ticket-checkout, before any charge) from
  both `priceTicketOrder` and `createTicketOrder`.

## Measuring H2 exposure on production (read-only, for the lead)

```sql
-- How many upcoming, on-sale, ticketed showings could be bought below their
-- tier prices by leaving tier_id out: the base is below the dearest active tier.
SELECT count(*) AS exposed_showings,
       count(*) FILTER (WHERE s.ticket_price = 0) AS exposed_free_base,
       count(*) FILTER (WHERE s.ticket_price < (SELECT min(t.price) FROM public.showing_price_tiers t
                                                WHERE t.showing_id = s.id AND t.is_active)) AS base_below_every_tier
FROM public.showings s
WHERE s.is_active
  AND NOT s.no_ticket_required
  AND s.start_time > now()
  AND EXISTS (SELECT 1 FROM public.showing_price_tiers t
              WHERE t.showing_id = s.id AND t.is_active AND t.price > s.ticket_price);

-- The list, worst gap first.
SELECT s.id, s.start_time, COALESCE(m.title, e.title, l.title) AS production,
       s.ticket_price AS base, max(t.price) AS dearest_tier, min(t.price) AS cheapest_tier
FROM public.showings s
JOIN public.showing_price_tiers t ON t.showing_id = s.id AND t.is_active
LEFT JOIN public.movies m ON m.id = s.movie_id
LEFT JOIN public.events e ON e.id = s.event_id
LEFT JOIN public.live_performances l ON l.id = s.live_performance_id
WHERE s.is_active AND NOT s.no_ticket_required AND s.start_time > now()
GROUP BY s.id, s.start_time, m.title, e.title, l.title, s.ticket_price
HAVING max(t.price) > s.ticket_price
ORDER BY max(t.price) - s.ticket_price DESC;

-- Past use: sold (not comp, not pass) tickets with no tier at a showing that
-- has active tiers now. Tiers can be added after a sale, so treat a hit as a
-- lead to check, not proof of abuse.
SELECT tk.showing_id, tk.payment_method, count(*) AS tickets, sum(tk.total_price) AS collected,
       min(tk.purchased_at) AS first, max(tk.purchased_at) AS last
FROM public.tickets tk
WHERE tk.tier_id IS NULL
  AND tk.payment_method IN ('online', 'cash', 'card')
  AND tk.status IN ('confirmed', 'pending')
  AND EXISTS (SELECT 1 FROM public.showing_price_tiers t WHERE t.showing_id = tk.showing_id AND t.is_active)
GROUP BY tk.showing_id, tk.payment_method
ORDER BY tickets DESC;
```

L2 history (read-only): orders already closed by a single sticker that paid
for more than one pass. These patrons may be owed passes.

```sql
SELECT o.id, o.created_at, o.buyer_name, o.buyer_email, o.quantity, o.fulfillment,
       o.fulfilled_at, (SELECT count(*) FROM public.user_film_passes p WHERE p.film_pass_order_id = o.id) AS passes_linked
FROM public.film_pass_orders o
WHERE o.status = 'fulfilled' AND o.quantity > 1
ORDER BY o.created_at;
```
(`passes_linked` exists only after the L2 migration. Before it, drop that
column.) The migration does not reopen these orders, because staff may already
have issued the missing passes by hand as counter sales or comps. Settle each
one by hand. Setting `status = 'paid'` returns an order to the queue, owing
`quantity − passes_linked` more passes.

## Deploy steps

Order matters only for the QBO companion change (L2 item 1).

1. Record the rollback points: the current production function bodies.
   ```sql
   SELECT pg_get_functiondef('public.price_ticket_order(uuid,jsonb,text)'::regprocedure);
   SELECT pg_get_functiondef('public.activate_film_pass(text,uuid,uuid,uuid,uuid,text,numeric,text)'::regprocedure);
   ```
   Save both, and run the H2 exposure counts above so there is a "before".
2. Staging: `supabase link --project-ref rpqzrpboyhshdrfdwayk`, then
   `supabase db push`. Confirm both versions are listed:
   `supabase migration list` → `20261006225325`, `20261006225347`.
3. Staging checks (anon, read-only):
   - A tiered showing with no tier is refused:
     `POST /rest/v1/rpc/quote_ticket_order {"p_showing_id":"<tiered showing, e.g. b7caf083…>","p_tickets":[{}],"p_channel":"online"}`
     → 400, `code PT400`, "Choose a ticket type for each ticket." (The audit
     saw `list_price 8.0` here.)
   - The same showing with its tier id → priced as before.
   - An untiered showing with `[{}]` → priced at its base, as before.
   - Optional, on the box office: activate two stickers against a 2-pass
     sandbox order. The order stays in the queue after the first sticker and
     leaves it after the second.
4. Ship the QBO companion change (L2 item 1) in its owning cluster's PR,
   or at least before anyone next runs a QBO export.
5. Production: `supabase link --project-ref vlmslygnimfbamrtwvyo`, then
   `supabase db push`, and verify both versions applied. Then repeat the
   read-only quote check from step 3 against a production tiered showing
   (anon), and an untiered one, which most production showings are.
6. No edge function deploy and no `wrangler deploy` are needed for this
   cluster.

## Rollback

- **H2:** re-run the saved `price_ticket_order` body from step 1, or
  re-apply `20260922203433`'s `CREATE OR REPLACE` block. Nothing depends on the
  refusal, so rolling back is safe, and it reopens the hole.
- **L2:** re-run the saved `activate_film_pass` body. Leave the
  `film_pass_order_id` column in place. It is nullable and harmless, and the
  QBO change reads it. After a rollback, multi-pass orders close on their first
  sticker again.
