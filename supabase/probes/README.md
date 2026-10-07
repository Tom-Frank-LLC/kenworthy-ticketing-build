# Debug probes (not deployable as they stand)

One-off diagnostic functions that answered a question about Square. They live
here, outside `supabase/functions/`, so that a bulk `supabase functions deploy`
cannot ship them (security audit 2026-10-06, L11). They are kept because the
docs cite them as evidence and because two of them can regenerate test data.

| probe | what it answered | cited by |
|---|---|---|
| `square-event-probe` | how Square stores venue and date on EVENT items; accounting and orders audits; catalog snapshots | `docs/venue-date-square-mechanism.md`, `docs/SQUARE-TRANSACTION-CONVENTIONS.md`, `docs/square-catalog-history-recovery.md` |
| `square-event-create-probe` | whether Connect V2 can create an EVENT item (it can) | `docs/FINDINGS-square-line-items.md` |
| `square-order-probe` | Square's tax rounding on a single price | `docs/FINDINGS-square-order-arithmetic.md`, `_shared/square-order.ts` |
| `square-discount-probe` | how Square totals discounted orders; regenerates the `discounted` section of `_shared/pricing_vectors.json` | `docs/FINDINGS-square-order-arithmetic.md`, `docs/DESIGN-order-level-tax-and-ticket-discounts.md` |

The three that write to Square (`square-event-create-probe`,
`square-order-probe`, `square-discount-probe`) refuse the production Square
environment. `square-event-create-probe` used to accept
`confirm:"PRODUCTION-CREATE"` to write to the live catalog; that override is
gone. `square-event-probe` makes no Square writes (`assertRead`) and was run
against production on purpose, because only production holds the live catalog;
it does write a catalog snapshot to the private `catalog-snapshots` bucket.

## Running one again

Staging, unless the question is about the live catalog and the probe is
`square-event-probe`.

1. Copy it into `supabase/functions/` and change its `../../functions/_shared/`
   imports back to `../_shared/`.
2. `npx supabase functions deploy <probe> --project-ref rpqzrpboyhshdrfdwayk`
3. Run it, record the result in the doc that needs it.
4. `npx supabase functions delete <probe> --project-ref rpqzrpboyhshdrfdwayk`, and
   delete the copy from `supabase/functions/`. Do not commit it there.
