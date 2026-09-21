# DESIGN: adopting Square's order arithmetic, and ticket discounts on top of it

**Status:** decisions taken (§8); **Ship 1 is in production** (§9, PR #311); **Ship 2 is built and verified on staging** (§10), not yet in production.
**Date:** 21 Sep 2026 · **Brief:** `BRIEF-ticket-discounts.md` · **Evidence:** `FINDINGS-square-order-arithmetic.md`
**Deadline that shapes this:** the Oct 3 event, 12 days out. The offer has to be live for presales.

## 1. Position: I agree with option 2, for a reason I under-weighted

I recommended rounding discounted prices to 50¢. I now think Tom is right, for two reasons.

1. **The 50¢ rule protects a coincidence, not an invariant.** Today's sales reconcile only
   because every price happens to be a multiple of 50¢. Nothing enforces that. The first $8.25
   student tier abandons its Square order on every multi-ticket sale, discount or no discount,
   and the code that was supposed to handle that case (`square-order.ts` line splitting) is
   measured not to work. Option 1 would have shipped discounts *and left that in place*.
2. **"All three discount models" already forces order-level logic into the database.** A
   `$10 off the order` rule cannot be derived or checked by a trigger that sees one row. Once the
   database has to reason about an order anyway, order-level tax is a small step further, not the
   rewrite I priced it as.

My one pushback is about **sequencing, not direction**: do it in two ships (§7). The tax-model
change touches every sale and is a provable no-op at today's prices; discounts are new surface.
They should not land in one deploy.

## 2. The arithmetic, stated once

All integer cents. `half_even(n, d)` = n/d rounded half-to-even.

```
list_i        each ticket's tier/showing price            (unchanged; seat's tier still wins)
D             the order's discount, from the one best rule (§3); 0 if none
disc_i        D allocated to eligible tickets, proportional to list_i   Σ disc_i = D
net_i         list_i − disc_i                              → tickets.price
T             half_even(6 × Σ net_i, 100)                  the ORDER's tax — Square's formula
tax_i         T apportioned to tickets, proportional to net_i           Σ tax_i = T
total_i       net_i + tax_i                                → tickets.total_price
fee           grossed-up on (Σ net_i + T)                  discounted total, as the brief requires
charge        Σ total_i + fee + donation
```

**The invariant that must survive is `charge = Σ tickets.total_price (+fee +gift)`** — refunds,
cash-sale recording and the Square-vs-site reconciliation all re-read rows. It does survive: only
*how each row's tax is arrived at* changes. `tax = SUM(per-ticket tax)` stays true; it just stops
being `SUM(round(per-ticket 6%))`.

**Apportionment is cumulative, in row order** (`tax_i = T(first i tickets) − Σ earlier shares`),
which sums exactly by construction and keeps every share within a cent of its own 6%. An
earlier draft proposed an `order_seq` column so SQL and TypeScript would apportion identically;
it turned out to be unnecessary, because under enforcement model B the database never
apportions — it checks the sum and bounds each row — so only the inserter's order matters.

**No-op proof at current prices:** if every `net_i` is a multiple of 50¢ then `6·net_i/100` is an
integer, no rounding occurs anywhere, and `tax_i` equals today's value exactly. So for every
undiscounted sale at every price that exists, old and new code produce identical rows. This is
what makes the two halves deployable independently, and in either order.

## 3. Discount rules — "build for all three models"

`ticket_discounts.type`: `percent` · `fixed_per_ticket` · `fixed_per_order`.

| type | D for the order |
|---|---|
| `percent` | `half_even(value × Σ list_eligible, 100)` — order-wide, the way Square rounds a percentage (H1/H2) |
| `fixed_per_ticket` | `Σ min(value, list_i)` over eligible tickets |
| `fixed_per_order` | `min(value, Σ list_eligible)` |

- **Eligible tickets** = priced tickets (`list_i > 0`) in the order. `min_quantity` counts those.
  Free, comp, film-pass and no-ticket showings can never carry a discount because there is
  nothing eligible.
- **Best single rule, no stacking:** the qualifying rule with the largest `D`; ties broken by
  `created_at`, then `id`, so server, client and database all pick the same one.
- **Scope:** `showing_id` XOR one of `movie_id` / `event_id` / `live_performance_id`
  (CHECK: exactly one set). Both scopes compete in the same best-rule selection.
- `code` nullable, reserved. Rules with a code are ignored by automatic selection.
- Guard rails in the table itself: `percent` in (0, 100]; amounts > 0; `min_quantity ≥ 1`;
  `ends_at > starts_at`.

## 4. Where the database enforces it — three options

All four writers were checked: `ticket-checkout` and `StaffPOS` each insert a whole order in
**one statement** with a shared `order_token`; comps (`HostDashboard`) and `admit_with_film_pass`
write $0 rows. So an `AFTER INSERT … FOR EACH STATEMENT` trigger with a transition table sees
complete orders.

| | how | for | against |
|---|---|---|---|
| **A. Derive** | row trigger sets list price; statement trigger computes D/tax and `UPDATE`s the rows | DB is sole authority; inserters stay dumb | `INSERT … RETURNING` is evaluated *before* the statement trigger, so `ticket-checkout`'s `.insert().select()` would get stale prices (it feeds Mailchimp from them). Also fires the `tickets` audit trigger once per row on every discounted order. |
| **B. Validate** *(chosen)* | inserter sends `discount_id`, `discount_amount`, `tax_amount`; row trigger derives list price, bounds-checks the rest; statement trigger recomputes D and T for each `order_token` and **raises** unless the rows sum to them | `RETURNING` is truthful; no UPDATE, no audit noise; old clients that send nothing still work (row trigger defaults to today's per-ticket tax, which passes whenever prices are 50¢ multiples) | a drifted client fails at insert instead of being silently corrected — see POS card note below |
| **C. RPC** | `create_ticket_order()` prices and inserts; direct inserts refused | one implementation of the maths, in SQL; a `quote` RPC could replace the client mirror too | rewrites the insert path of every sale, 12 days before the event. Right long-term direction; wrong month. |

**The POS-card wrinkle, which is pre-existing:** `StaffPOS` charges the terminal *first* and
inserts rows *after* (`:590`, `:627`), and `square-terminal` takes a bare `amount_cents` from the
browser with no re-pricing and **no Square Order at all**. So under B, a POS bundle whose maths
has drifted would charge, then fail the insert. Today the same shape already exists (capacity
`PT409` or the past-showing trigger can refuse after a charge). Mitigation within scope: POS and
server import the same pure pricing module, and shared test vectors pin it (§6). Out of scope but
worth a brief of its own: POS card sales should insert pending → charge → confirm, like online.

## 5. Implications, area by area

**Database**
- `enforce_ticket_pricing`: `price` becomes **net**; new columns `list_price`, `discount_amount`,
  `discount_id` (Ship 2). `price` stays "what was charged before tax" so every existing reader
  is right without modification (see Reporting).
- New statement trigger; name it to sort after `zz_enforce_showing_capacity_on_insert` is *not*
  required (it is AFTER, the others are BEFORE) but say so in the migration.
- Postgres `ROUND(numeric)` is half-away-from-zero. Half-even needs its own small SQL function,
  integer-only. Same in TS — `Math.round` is half-up.
- New table needs a **policy and a grant** (`20260818201900` notes a policy without a grant is
  dead), an audit trigger entry, and an `AuditLog.tsx` label.
- Rule validity is judged at insert time (`now()`), so a window that closes mid-checkout refuses
  the order before any charge online. Acceptable; say so in the error copy.

**`_shared/pricing.ts`** — order-level T; discount resolution; returns `discount` (id, label,
cents) for callers. Header comment rewritten: it currently states the per-ticket rule as the
design. Roughly 6 of its 35 tests encode the old model at $8.25 and get rewritten, not deleted.

**`_shared/square-order.ts`** — `aggregationChangesTax` and line splitting are **removed**
(measured useless). `expectedTotalCents` is computed with Square's formula, so the pre-flight
guard becomes a real model of Square rather than a restatement of our own sum. Discounts go out
as `scope: LINE_ITEM`, **fixed amounts we computed**, applied to ticket lines only — H3 shows an
`ORDER` discount takes 25% off the donation. Named with the rule's label, so Square's receipt and
reporting show it. `TransactionsTab` already renders Square's `discountCents`.

**`ticket-checkout`** — add a fourth agreement check that costs nothing: it already gets the
inserted pending rows back, so assert `Σ total_price + fee = order.amountCents` **before**
charging. That turns any TS/DB drift into a clean pre-charge refusal instead of a mis-charge.

**`square-cash-sale`** — rebuilds ticket groups inline from rows (duplicating
`loadTicketGroups`) and knows nothing of discounts. Needs `list_price`/`discount_amount` from the
rows; better, both callers share one grouping function.

**`square-terminal`** — unchanged, and that is a gap: POS **card** discounts will be charged
correctly and recorded correctly on our rows, but will not appear in Square as a discount,
because POS card sales are bare amounts with no Order today. Pre-existing; out of scope; flagged.

**Refunds** — `square-refund` refunds `Σ total_price` of the chosen rows. Still correct.
**Policy hole:** refund 1 of 4 discounted tickets and the buyer keeps 3 at the 4+ price. Tickets
are non-refundable (#309) so this is a staff exception, but it needs a stated answer (§8).

**Reporting**
- `QboExportTab` sums `price` as income and `tax_amount` as tax → correct with `price` = net, and
  its tax total now equals Square's to the cent, which it did not strictly before.
- `BoxOfficeReceiptsTab` buckets by `tier|price` → a discounted Adult becomes its own line at its
  own net. That is arguably right for a distributor settlement on receipts actually taken, but
  the line should say "(discounted)". Whether distributor terms permit discounting is Tom's call,
  not the software's.
- `BoxOfficeToday`, `square-transactions`, `square-labor`, Mailchimp LTV: all `total_price`,
  all still correct.

**Receipts** — `_shared/tickets.ts` `loadOrder` reads `total_price` only, so email, SMS page and
`/t/:token` have nowhere to show a saving. Add order-level `discount {label, cents}`. Note that
identical tickets can now differ by a cent (`$7.15`, `$7.16`) — show the unit price and an
order-level tax line rather than four slightly different totals.

**Client** — `src/lib/booking.ts` gets the same pure functions; `Showing.tsx` and `StaffPOS.tsx`
show offer badge, discount line, new total. `buildTicketRows` sends the new columns.

**Things this does *not* fix** — film-pass checkout and concessions compute 6% themselves and
have the same half-even exposure at odd prices. Separate brief.

**Sales-tax rounding** — I have not verified what Idaho prescribes, so treat this as a question
for the bookkeeper rather than a finding. What can be said: taxing the sale total is the normal
basis (per-ticket rounding over-collects 2¢ on 4 × $6.75), and half-even differs from
conventional rounding only when an order's tax lands on exactly half a cent, by one cent. Every
in-person Square sale at the theatre already works this way, so matching Square makes the
website consistent with the rest of the books.

## 6. How drift is prevented

Three implementations of one formula (SQL, Deno, browser) is the standing risk here — the file
headers already warn "the two must not drift", and they did, against Square. One
`pricing-vectors.json` of awkward orders (4/5/7 tickets at $9, $8.25, $10.75, $19.99; each rule
type; mixed tiers; with fee; with gift) is asserted by Deno tests, vitest, and a SQL test run in
the throwaway `postgres:15` container. The expected totals in that file come from **Square's
sandbox**, not from our own arithmetic, so the tests pin us to the thing we must agree with.

## 7. Sequencing

1. **Ship 1 — order-level tax.** Migration (half-even fn, statement validation),
   `pricing.ts`, `square-order.ts` without splitting, fourth check in `ticket-checkout`, vectors.
   A no-op for every price that exists; fixes the latent $8.25 abandonment. Verify on staging with
   a real sandbox order at $8.25 × 2 (expect 1749 and an order that is *kept*).
2. **Ship 2 — discounts.** Table + RLS, resolution, Square discount lines, cash-sale, receipts,
   client preview, admin editor, POS. Verify on staging: 3 tickets full price; 4 and 5 and 7 at
   25% off $9, order kept, discount visible in Square.
3. Create the Oct 3 rule in production only after both are live and verified.

Deploy order inside each ship does not matter for existing sales (the no-op proof), which is the
point of proving it.

## 8. Decisions (Tom, 21 Sep 2026)

1. **Enforcement:** B now; C (one SQL pricing function every sale goes through) afterwards as
   its own brief. B's half-even function, order-level check and vectors are what C would reuse.
2. **Two ships.**
3. **Partial refund of a quantity-discounted order: allow it, and warn.** A full refund returns
   exactly what was paid (10 tickets at $6 = $60 + tax) and needs no change. Refunding 7 of those
   10 leaves 3 tickets held at a price only offered for 4+; that is permitted — tickets are
   non-refundable, so any refund is already a staff judgement — but the staff refund screen says
   so before they confirm. No claw-back, no block.
4. **Production read: done.** 919 ticket rows, 453 paid orders: no ticket at a non-50¢ price,
   and no historical order whose tax differs under the new model. One showing is priced $8.02,
   with no sales. Ship 1 changes no existing record.
5. **Any price must work.** No constraint on the admin form; awkward prices are test vectors.

## 9. Ship 1 — what was built and how it was verified

| piece | where |
|---|---|
| the arithmetic, once | `supabase/functions/_shared/order_math.ts`, byte-identical twin `src/lib/orderMath.ts` (a vitest asserts identity) |
| Square's answers as fixtures | `_shared/pricing_vectors.json` — 25 orders totalled by the sandbox, asserted by Deno, vitest **and** SQL |
| database | `20260921200433_order_level_tax.sql` — `round_half_even_div`, `order_tax_cents`, bounded row tax, `enforce_ticket_order_tax` (PT422) |
| server pricing | `_shared/pricing.ts` — order-level tax, apportioned rows |
| Square order | `_shared/square-order.ts` — line splitting removed; `expectedTotalCents` uses Square's formula |
| checkout | `ticket-checkout` — refuses to charge unless the stored rows sum to the priced order; PT422 mapped |
| box office | `src/lib/booking.ts` — `buildTicketRows` apportions; on-screen totals are order-level |
| SQL harness | `sh supabase/tests/order_tax/run.sh` — 41 checks in a throwaway `postgres:15`, including that all 200 prices from $0.50 to $100 store **exactly** what the old trigger stored |

**End to end, staging, 21 Sep 2026:** 2 × $8.25 through the deployed `ticket-checkout` with
Square's sandbox test card, phone-only (so Mailchimp, which staging shares with production, was
never called). Rows stored `8.75` + `8.74`; card charged **1749**; Square payment `COMPLETED` and
attached to Order `wkL18vFZoUpHI8KZPaf77BIsZB6YY` — `COMPLETED`, `reference_id` = our
`order_token`, one line `qty 2`, tax 99, total **1749**. Before this change that order would have
been built at 1750, refused by Square's 1749, and abandoned to a bare payment.

Staging carries a test showing for this, `8ae7a446-2cfb-49ec-b771-4e5f046c48de` ($8.25,
5 Oct 7 PM). Ship 2 will reuse it; delete it afterwards.

**Production, 21 Sep 2026 (PR #311, `fdbf347`).** Before deploying, both live sites were compared
by content with a build of the pre-merge commit: 20 of 20 entry bundles identical, so neither was
ahead of main. Migration applied and confirmed (`order_tax_cents(675)` = 40, `(1650)` = 99 over
PostgREST). Functions: `ticket-checkout` v50→v51, `square-cash-sale` v4→v5, `film-pass-checkout`
v39→v40, `square-donation` v37→v38. Worker `06288528…` → `233ae153-f6ee-4eb9-9045-16a3201712e3`
(the former is the rollback). Verified at the origin, not the upload log: `kenworthy.org` serves
the new index and the chunk carrying the half-even code, byte-identical to the build. No purchase
was made in production — that would be a real charge — so the first real multi-ticket sale is
the remaining confirmation, and at today's prices it is arithmetically identical to before.

**Known stale-client behaviour:** a browser still running the old POS bundle sends per-ticket
tax. At any 50¢ price that is identical and accepted. At an odd price the insert is refused
(PT422) — and at the POS *card* path that refusal comes after the terminal has charged. No odd
price exists in production, the service worker updates the bundle on reload, and the exposure
ends with option C; but do not set an odd price on a live showing in the same hour as a deploy.

## 10. Ship 2 — discounts: what was built and how it was verified

| piece | where |
|---|---|
| rule maths (three types, best single rule, usable-now filter) | `_shared/order_math.ts` = `src/lib/orderMath.ts` (`applyDiscount`, `bestDiscount`, `usableRules`) |
| Square's answers | `pricing_vectors.json` → `discounted`: 18 orders, regenerated by `square-discount-probe/generate_discount_vectors.ts`. For all 11 percent rules Square's **own native percentage** returned the identical discount and total, so our order-wide rounding of D is Square's, not merely self-consistent |
| database | `20260921203017_ticket_discounts.sql` — `ticket_discounts` (RLS + grants + audit), `tickets.list_price / discount_amount / discount_id / discount_label`, `ticket_discount_cents()`, row trigger (price is NET), `enforce_ticket_order_totals` replacing Ship 1's tax-only trigger |
| server | `pricing.ts` loads the showing's and the production's rules and applies the largest; fee is on the discounted total |
| Square | `square-order.ts` — list price on the line, one fixed `LINE_ITEM` discount per ticket line, never `ORDER` scope |
| checkout | writes the discount fields; a closed offer reaches the buyer as the database's own sentence (409) |
| cash sales | `square-cash-sale` now uses `loadTicketGroups` instead of its own copy, which knew nothing of discounts |
| receipts | `_shared/tickets.ts` `Order.discount`; email HTML + text and `/t/:token` say "You saved $X"; order total summed in cents |
| refunds | `square-refund` warns when it partly refunds a discounted order (decision 3). The only refund screen today refunds whole sales, so this is for whatever partial-refund UI comes later |
| site | offer badge + discount line on `Showing.tsx`; same on `StaffPOS.tsx`, whose rows now carry the discount |
| admin | `DiscountRulesEditor` on the showing, event and film forms; writes immediately, and treats a write that returns no rows as a failure |

**Found on the way**
- Online checkout caps a buyer at **4 tickets per showing**. A "4+" offer is therefore exactly 4 online;
  5 or more only happens at the box office. The editor says so.
- `StaffPOS.createTickets` is a `useCallback`; without `discountRules` in its dependency list it would
  have written rows from a stale rule set while the screen showed the discounted total.
- `src/integrations/supabase/types.ts` was **not** regenerated: staging carries other sessions'
  unmerged schema, so a regenerate would drag that in. `ticket_discounts` is read through
  `(supabase as any)` until someone regenerates from a clean database.

**Verified**
- `sh supabase/tests/ticket_discounts/run.sh` — 84 checks on `postgres:15`: the whole Ship 1 suite
  replayed under the new triggers, all 18 discounted Square vectors through the real triggers, and
  refusals for: below minimum, free tickets padding the minimum, forged larger and smaller amounts,
  wrong showing, other production, NULL-scope, inactive, not yet open, expired, promo-coded; plus
  the table's constraints and RLS (public reads active only; staff read all; only admins write).
- Deno 471 · vitest 918 (the same 9 `MonthCalendar` failures as before this work) · `tsc` clean apart from `NotificationsTab.test.tsx`.
- **Staging, real sandbox sales** on the $8.25 test showing with a "25% off 4+" rule: 3 tickets →
  full price, 2623; 4 tickets → list 3300, off 825, tax 148, **2623**, Square order kept at 2623
  (the vector's figure). Receipt endpoint returns `discount: {label, amount: 8.25}`.
- **Staging database, box-office-shaped rows** posted through PostgREST: a valid 5-ticket
  discounted order accepted (3280); a forged 3-ticket claim refused, `HTTP 422 PT422 — That discount
  needs at least 4 tickets.`
- **Not verified:** the pages by eye. The browser automation would not hold the tab, and the one
  render it did catch showed "We couldn't find that showing" for the test showing — while the
  page's own two reads both return 200 for the anonymous key. Most likely a stale session in that
  browser profile, but it is unconfirmed. Someone should open the staging showing and the POS.

