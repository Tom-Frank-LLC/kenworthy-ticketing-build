# Findings: the November rise in failed ticket purchases

**Date:** 2026-11-23 · **Question:** the theatre saw more failed online
ticket attempts over the past two weeks. Is something broken?

**Answer:** no fault in our system shows up in the data. Every failed attempt
the database recorded is a card issuer declining the card. The decline *rate* is normal; the
*count* rose because sales roughly tripled. Most buyers who were declined
bought successfully within minutes. One gap remains: refusals that happen
before a charge leave no row, and those are only in function logs
(see "Not covered").

## How attempts are recorded

`ticket-checkout` inserts `pending` ticket rows, charges, then marks them
`confirmed`, or `failed` with Square's reason in `payment_error`
(`supabase/functions/ticket-checkout/index.ts:521`). One attempt is one
`checkout_idempotency_key`. Read-only queries against production
(`vlmslygnimfbamrtwvyo`), `payment_method = 'online'`.

## Decline rate, per fortnight

| fortnight from | attempts | declined | % of attempts | buyers | buyers declined | declined, never bought |
|---|---|---|---|---|---|---|
| 2026-11-10 | 358 | 34 | 9.5 | 310 | 17 | 5 |
| 2026-10-27 | 111 | 3 | 2.7 | 100 | 2 | 0 |
| 2026-10-13 | 130 | 19 | 14.6 | 105 | 8 | 2 |
| 2026-09-29 | 162 | 8 | 4.9 | 145 | 5 | 1 |
| 2026-09-15 | 256 | 43 | 16.8 | 203 | 20 | 1 |
| 2026-09-01 | 286 | 40 | 14.0 | 230 | 19 | 5 |

The last fortnight's 9.5% is inside the 2.7–16.8% range of the twelve weeks
before. It looks like a rise only next to the fortnight before it, which was
both the cleanest and the quietest in the period.

## Reasons (Square's codes)

| | GENERIC_DECLINE | CVV_FAILURE | PAN_FAILURE | TRANSACTION_LIMIT |
|---|---|---|---|---|
| last 14 days | 19 | 13 | 2 | 0 |
| prior 42 days | 8 | 13 | 4 | 5 |

All are issuer responses: Square accepted the request and the bank refused it.
`CVV_FAILURE` / `PAN_FAILURE` mean a mistyped security code or card number.
`GENERIC_DECLINE` is the bank declining without giving a reason.

## Not card testing

Card testing looks like many distinct cards, tiny amounts and rapid bursts from one
source. These were normal orders ($8.48 to $63.60) on real showings, from 19 buyers
with one to four tries each, and 14 of the 19 bought within minutes
(typically re-typing the security code or switching cards).

## Not a release

The only payment-path changes in the window are promo codes (#426, deployed
11-21) and tier limits (#427, 11-22). Declines start on 11-11. No change to
card tokenisation (`SquareCardForm`) since October.

## Not covered: refusals that write no row

The bot check, rate limit, sold-out races, pricing and promo refusals all
return before the pending insert (`index.ts:226–514`), so they leave no
`tickets` row. They are visible only in the `ticket-checkout` edge-function
logs (Supabase dashboard → Edge Functions → ticket-checkout → Logs, or Logs
Explorer, within the plan's retention). `rate_limits` keeps only the current
10-minute window, so it cannot answer this. That count was **not** checked.

## Related

Until `feat/checkout-error-visibility` (BRIEF-checkout-error-visibility),
these declines were shown to the buyer only as a toast that disappeared in
seconds. That may explain why the five buyers who were declined and never
bought gave up. It does not explain the declines themselves.
