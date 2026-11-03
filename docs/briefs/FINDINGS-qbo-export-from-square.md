# Why the QBO Export came out far below Square

**3 November 2026.** The accountant downloaded a month's Journal CSV and found
much less income than Square, and less than the Reporting Overview. Established
by reading the code; no data was pulled.

## The cause: the wrong source

`QboExportTab.tsx` summed this build's own tables: `tickets`,
`concession_sales`, `donations`, `user_film_passes` / `film_pass_orders` and
`rental_invoice_lines`. The Overview reads Square's Reporting API. Most of the
theatre's revenue is only in Square — the concession stand, Square Online,
Square invoices, and items keyed in at the till (rentals, fundraiser tickets).
The export could not see any of it. This is the same mistake the Overview made
before August (see `AnalyticsTab.tsx`'s header and
FINDINGS-square-reporting-api.md), repeated in a second screen.

Every sale the build makes is also a Square order (card checkout, cash via
`square-cash-sale`, donations via `square-donation`, rentals via
`square-invoice`), so Square alone is complete. Reading both would double-count
the build's sales.

## Defects in the old export besides the source

1. **Silent 1,000-row cap.** Tickets, sales, donations and passes were each
   read in one PostgREST request. Only `showings` was paged.
2. **UTC month edges.** `new Date('2026-09-01').toISOString()` is 5 pm Pacific
   on 31 August.
3. **Per-line rental tax** at `amt * 0.06`, against Square's order-level,
   half-to-even rounding (see CLAUDE.md, Square).
4. **Default range was year-to-date**, not a month.

## Found on the way

`account_mappings` had an admin-only "manage" policy but `authenticated` was
only ever granted SELECT (measured on staging, 3 Nov 2026), so the Account
Mappings tab's Save could never succeed.

## The entry now

Credit each Square category's account with gross − discounts; debit Returns;
credit Sales Tax Collected and Tips with Square's own figures; debit
Undeposited Funds with Square's total collected. If those do not close (gift
card sales and service charges are not item sales), one "Unreconciled — review
before posting" line shows the difference instead of hiding it. The August
sample in `square_reporting_test.ts` does not close by $28.48, so expect that
line on a real month until we know what Square puts there.

## Measured against live Square, 3 Nov 2026

Run through `square-analytics` on production with an admin session.

### The measures exist

`/reporting/v1/meta` (read once through a temporary, since-removed path):

- **ItemTransactions** measures include `sales_gross_amount`,
  `item_discount_money`, `item_comps_money`, `returns_gross_amount`,
  `sales_net_amount` (= gross − discounts; returns are *not* subtracted),
  `item_tax_money`. Dimensions include `revenue_recognition_state`,
  `check_state`, `order_id`, `transaction_type`, `line_item_type`.
- **Sales** measures include `top_line_product_sales` (gross),
  `discounts_amount`, `comps_amount`, `itemized_returns`,
  `refunds_by_amount_amount`, `service_charges_only_sum`,
  `gift_card_sales_amount`, `total_collected_amount`, `net_sales`.
  Discounts, comps and returns come back negative.

### Square's two reports disagree, and why

Square's Sales cube is self-consistent for October:
57,813.10 gross − 813.25 discounts − 45.00 itemized returns = 56,954.85 net.
The ItemTransactions cube said 59,713.75 gross: **1,900.65 more**. The gap
is additive across months (Aug 33.54, Sep 2,755.82, Oct 1,900.65) and does not
move when the range is widened, so it is not a timing edge.

Comparing the two cubes order by order for October (3,099 orders in items,
3,070 in sales) put every cent of it in two groups:

| | orders | items − sales |
|---|---|---|
| item lines on orders Square never counted as a sale | 29 | **+2,145.00** |
| invoices whose ~3% surcharge is a service charge, not an item | 10 | −244.35 |
| | | **+1,900.65** |

The 29 have `revenue_recognition_state = PROJECTED`, `check_state =
OPEN_CHECK`; every paid line is `RECOGNIZED` / `CLOSED_CHECK`. The split is
total: no paid line was PROJECTED and no unpaid line RECOGNIZED, in either
September (3,792.04 unpaid) or October. They include a $960 Theater Rental
order, a $400 Film Sponsorship, and many single online-style ticket and pass
orders, several in identical pairs ("Gem State Flyers + Donation" ×2) — the
shape of an abandoned checkout followed by the retry that paid. Whether those
pairs come from this build's `ticket-checkout` is not yet checked.

**Consequence:** the Overview has been counting unpaid orders since it moved
to the Reporting API in August — Revenue by Category, the over-time chart,
Tickets Sold, Avg / Ticket and top performers. That is the likely source of
the September mismatch against Square that started this. Every
ItemTransactions query now filters to `RECOGNIZED`.

### The Overview's fixed lists were stale

October's bar sales were rung up as `4 Cocktails & Wine`, which the concession
list did not contain: $2,898 sat in Other and out of Concession Rev. Grouping
now falls back on the numbered taxonomy (1–5 stand, 6 tickets, 9 passes), and
film passes and rentals have their own groups. Uncategorized stays Other,
because a till item with no category cannot be told apart by category.
