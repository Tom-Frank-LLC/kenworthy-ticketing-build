# FINDINGS: how Square actually totals an order (tax and discount rounding)

**Measured:** 21 Sep 2026, Square **sandbox**, API `2024-01-18`, via `POST /v2/orders/calculate`
(prices an order, persists nothing). 49 orders across four batches.
**Probe:** `supabase/functions/square-discount-probe/` — inputs and raw results are in its
`cases/` folder. Deployed to **staging only**; it refuses to run against production.
**Why it was run:** `BRIEF-ticket-discounts.md` requires a discounted order's three totals
(ours, the built order's, Square's) to agree to the cent, and said "this is where it will break
if it breaks". It does.

## The result

Square does **not** tax per line, and does **not** round half-up.

```
discount  D = half_even( pct × Σ gross of the lines the discount applies to )     (percentage)
            = the stated amount                                                   (fixed)
tax       T = half_even( 6% × ( Σ gross of taxed lines − D ) )
total       = Σ gross − D + T
```

Both roundings happen **once, on the order-wide sum**, half-to-even. Square then spreads the
cents across lines for display (`40, 41, 40, 41`), but the per-line figures are an
apportionment of the order figure, not independent calculations.

A model built from those three lines predicted **24 of 24** randomized orders exactly
(`cases/batch3.*`): mixed prices including $8.25, $6.75, $10.75, $8.02, $19.99, $3.33;
quantities 1–7; a fixed discount shared across several ticket lines; an untaxed donation line
present.

## The measurements that establish it

| case | what | ours (per-ticket, half-up) | Square |
|---|---|---|---|
| A1 | 1 × $6.75, tax 40.5¢ | 41 | **40** |
| A2 | 1 × $10.75, tax 64.5¢ | 65 | **64** |
| A3 | 1 × $8.25, tax 49.5¢ | 50 | 50 |
| A5 | 1 × $0.75, tax 4.5¢ | 5 | **4** |
| B1 | 25% of $8.50 = 212.5¢ | 213 | **212** |
| E1 | two separate 1 × $8.25 lines | 1750 | **1749** |
| E3 | three 1 × $6.75 lines (121.5¢ tax) | 2148 | **2147** (lines taxed 41, 40, 41) |
| E10 | 3 × $8.25 on one line (148.5¢) | 2625 | **2623** |
| C1/C2/E6 | 4 × $9 at 25% off, as one line, four lines, or four lines each with its own fixed $2.25 discount | 2864 | **2862** in all three shapes |
| H1/H2 | 25% off 3 × $8.50, one line or three | — | discount **638** both ways (order-wide 637.5 → 638), not 3 × 212 |
| H3 | 25% `scope: ORDER`, tickets + untaxed donation | — | **the donation is discounted too** (−$1.25) |

A3 is why this went unnoticed. The earlier probe (`square-order-probe`) tested only $8.25, where
49.5 rounds to 50 under *both* half-up and half-even. It is the one awkward price that cannot
tell the two apart.

## What this overturns

1. **`_shared/square-order.ts` — the split-lines rule does not work.** Its header says a tier
   is split into single-quantity lines "only when aggregating would change the number", on the
   premise that separate lines reproduce our per-ticket rounding. E1 shows they do not: two
   separate $8.25 lines total 1749, the same as one 2 × line. Splitting changes nothing about
   Square's total. For such an order `expectedTotalCents` is 1750, Square returns 1749, and the
   order is abandoned to a bare payment either way.
2. **The brief's Decision 4** ("per-ticket proportional reduction preserves the tax invariant +
   reconciliation"). It preserves our internal invariant and breaks reconciliation: 25% off $9 is
   $6.75, and four of them are $28.64 our way and $28.62 Square's.

## Why nothing is broken today

6% of any multiple of 50¢ is a whole number of cents, so for such prices **no system rounds at
all** and every model agrees. Every real price on staging (a copy of the production catalogue:
1,796 showings, 5 tiers) is a multiple of 50¢ — the only exception is a test row at $8.02. The
flaw is latent. It is armed by the first $8.25 tier, or the first percent discount: 25% off $5,
$7, $9, $15 or $25 all land on x.25 / x.75.

**Verified against production** (read-only, 21 Sep 2026, with Tom's approval): 919 ticket rows
and 453 paid orders — no ticket at a non-50¢ price, and no order whose tax would differ under
Square's rule. One showing is priced $8.02 and has never sold.

## Consequences for any Square order this codebase builds

- A discount must be `scope: LINE_ITEM` and applied only to ticket lines. `scope: ORDER`
  discounts donations and surcharges (H3).
- Sending the discount as a **fixed amount we computed** removes Square's percentage rounding
  from the picture entirely; only the tax model then has to match.
- Line shape (one line per tier vs one per ticket) has **no effect** on the total. Always
  aggregate by tier, which is Square's convention anyway.
- The same exposure exists wherever else this codebase computes 6% itself and then asks Square
  to total an order: film-pass checkout and concessions. Not investigated here; flagged.

## Reproducing

```bash
# staging only. The probe proves the bearer is a service key by using it.
curl -s -X POST https://rpqzrpboyhshdrfdwayk.supabase.co/functions/v1/square-discount-probe \
  -H "Authorization: Bearer <staging service_role key>" -H "Content-Type: application/json" \
  --data @supabase/functions/square-discount-probe/cases/batch3.json
```

`batch3.model-prediction.json` holds the model's predicted total per label; compare with
`batch3.result.json`. Assumes `/orders/calculate` and `POST /orders` share a pricing engine —
the build must still assert Square's returned total on the real order, as `ticket-checkout`
already does.
