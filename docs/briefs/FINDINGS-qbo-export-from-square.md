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
