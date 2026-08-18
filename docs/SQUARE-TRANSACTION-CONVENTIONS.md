# How the Kenworthy uses Square, and how our build should write to it

**18 August 2026.** Everything below is measured from the live account — a
989-item pre-damage catalog snapshot and the most recent 5,000–10,000 orders —
not from recollection. It exists so the new build records money the same way the
theatre has recorded it for years, and so the two can be reconciled.

## The headline

The theatre's revenue is **catalogued**. 7,868 of 7,888 recent line items —
**99.7%** — carry a `catalog_object_id` pointing at a specific item variation.
That is what makes Square's item-sales, category and tax reporting work.

Our build does not do this. `ticket-checkout`, `film-pass-checkout` and
`square-donation` all call `createPayment`, which posts a bare `/payments` with
an amount and a text `note` and **no order, no line items, no catalog link**:

```ts
// supabase/functions/_shared/square.ts
return await squareFetch(config, '/payments', {
  method: 'POST',
  body: { idempotency_key, source_id, amount_money, location_id,
          autocomplete: true, reference_id, note, ... },
});
```

Four consequences, all accounting-visible:

1. **No category attribution.** The sale never lands in `6 Film Tickets`,
   `6 METLive Tickets`, `9 Film Passes`. Category reports silently under-report.
2. **No item-sales reporting.** The showing does not appear in "Items Sold", so
   per-title and per-showtime revenue is invisible.
3. **No tax computed by Square.** Every catalog item carries `tax_ids`, gated by
   `is_taxable`. A bare payment references no item, so Square applies nothing —
   tax has to be right in our own arithmetic, and it is not recorded the way the
   rest of the account records it.
4. **Not reconcilable.** Square's ledger and ours agree on the total and on
   nothing else.

`square-invoice` already does it correctly — it creates an `/orders` with
`line_items` and a `reference_id`, then attaches payment. That is the pattern to
generalise.

## What the theatre's Square actually looks like

### Catalog model

| | count |
|---|---|
| `EVENT` items | 823 |
| `REGULAR` items (concessions, merch, passes) | 162 |
| `DONATION` | 1 |

Screenings and performances are **`EVENT`** product-type items. `product_type`
is immutable after creation, and only `EVENT` items can hold a venue and
date/time — see `venue-date-square-mechanism.md`.

### One variation per ticket type per showtime

This is the convention that matters most. A film is one item; each *sellable
combination of tier and showtime* is a variation:

```
MET Live in HD: FEDORA
   Adult - January 14 at 9:55 AM      $20.00
   Student - January 14 at 9:55 AM    $15.00
   Adult - January 16 at 6 PM         $20.00
   Student - January 16 at 6 PM       $15.00

EMILY THE CRIMINAL
   Friday, September 16 at 7 PM        $7.00
   Saturday, September 17 at 4 PM      $7.00
   ...
```

Of 1,584 named variations: **540** use `<TIER> ~ <Weekday, Month D at TIME>`
and **712** use the bare `<Weekday, Month D at TIME>` when there is only one
price. Tier labels actually in use, by frequency:

`Adult` (224), `Child` (180), `Student` (54), `General Admission` (25),
`Preferred Seating` (20), `GA` (12), `Student/Senior`, `Students`, `VIP`,
`Student/Child`.

**Separator drift is real and worth settling.** Historically `~`; more recent
entries use `-` (276 vs 264). Pick one for new writes — `-` matches the most
recent hand-entered work — and know that the other exists when matching.

### Price points, as actually used

| tier | typical |
|---|---|
| Adult | **$8.00** (film), $20.00 (MET), $7.00 (older) |
| Child | **$5.00**, $3.00 |
| Student | **$15.00** (MET), $10.00 |
| General Admission | $40.00, $25.00, $20.00, $15.00 |
| Preferred Seating | $55.00, $40.00 |
| single-price showtime | **$8.00** (406×), $7.00, $10.00, $5.00 |

### Categories are a deliberate numbered taxonomy

The leading digits order them in Square's reports. Use them exactly:

```
1 Combos      2 Candy       3 Bottles    3 Soda      4 Beer     4 Wine
5 Popcorn     6 Film Tickets             6 Live Event Tickets
6 METLive Tickets           6 NT Live Tickets        6 Redeem
6 Rental Tickets            7 Merch      9 Film Passes
Cafe          Cocktails     Concessions
```

Set both `categories` and `reporting_category` — the latter is what revenue
reports group by. Note that at `SQUARE_API_VERSION` 2024-01-18 the category
field is quietly non-writable in one of its two shapes; see the note at
`square-catalog-sync/index.ts:1083` before writing categories.

### Tax

Every one of the 989 items carries `tax_ids`. What varies is `is_taxable`:
`DONATION` is not taxable, nor are 10 `REGULAR` items and 1 `EVENT`. So the rule
is **tax lives on the catalog item and Square applies it** when a line item
references that item. 4,603 of 5,000 recent orders carry tax.

### How money arrives

| source | orders |
|---|---|
| *(none — Square Point of Sale)* | 4,054 |
| Square Online | 913 |
| Invoices | 26 |
| Payment Links | 6 |
| **Kenworthy Website (our build)** | **1** |

| tender | count | | fulfillment | count |
|---|---|---|---|---|
| CARD | 3,585 | | IN_STORE | 3,001 |
| CASH | 1,148 | | DIGITAL | 891 |
| WALLET | 9 | | PICKUP | 21 |

1,367 tenders carry a **tip**. Orders are `COMPLETED` (4,030), `OPEN` (674),
`DRAFT` (221), `CANCELED` (75). Only 26 carry a `customer_id`, so customer
linkage is not an established convention and should not be assumed by reports.

## What to change

Replace the bare payment with **order-then-pay**, the way `square-invoice`
already works and the way POS and Square Online both do:

```ts
// 1. Create the order, with a real catalog line item per ticket.
const order = await squareFetch(config, '/orders', {
  method: 'POST',
  body: {
    idempotency_key,
    order: {
      location_id: config.locationId,
      reference_id: ourOrderId.slice(0, 40),      // our id, for reconciliation
      source: { name: 'Kenworthy Website' },      // already the established name
      line_items: [
        { catalog_object_id: variationId,          // THE important field
          quantity: String(qty) },
      ],
      fulfillments: [{ type: 'DIGITAL', state: 'COMPLETED', ... }],
    },
  },
});

// 2. Attach the payment to it.
await createPayment(config, {
  sourceId, amountCents: order.total_money.amount,
  idempotencyKey, orderId: order.id,             // <-- createPayment needs this
  referenceId: ourOrderId, buyerEmail,
});
```

`createPayment` needs one new optional field, `orderId`, passed through as
`order_id`. That is the whole plumbing change; the work is in having a
`catalog_object_id` to send.

### Which implies a prerequisite

Every showing we sell must exist in Square as a **variation on an `EVENT` item**,
named to the grammar above. Today the build sells showings that have no Square
variation, which is why it can only send an amount. So:

- when a showing is published, create/ensure its variation
  (`<Tier> - <Weekday, Month D at TIME>`) on the film's `EVENT` item;
- store the returned variation id alongside the showing;
- checkout sends that id.

`square-catalog-sync` already has safe read-modify-write plumbing to extend.

### Donations

Do **not** send donations as a ticket line. There is a `DONATION` product-type
item with `$10 / $20 / $50 / $100 / Custom Amount` variations, `is_taxable:
false`. Use its variations, and `Custom Amount` (`VARIABLE_PRICING`) with an
explicit `base_price_money` for other amounts.

### Fulfillment and tips

Use `DIGITAL` for web ticket sales — that is what Square Online's 891 orders
use. Web sales carry no tip today; if a tip is ever added, put it on the tender,
not as a line item, so it does not pollute item sales.

## Open questions

1. **Separator**: standardise on `-` or `~`? Recommend `-`.
2. **Tier vocabulary**: `General Admission` and `GA` are both in use, as are
   `Student`, `Students` and `Student/Senior`. Worth collapsing before we start
   generating variations programmatically.
3. **Per-showtime variations accumulate** — a long-running title grows a
   variation per screening. That is the established practice, but it is what
   made the Aug 14 flattening so destructive. Worth a deliberate decision.
4. **Tax on tickets**: 822 of 823 `EVENT` items are `is_taxable: true`. Confirm
   that is intended for admissions in Idaho before we start relying on Square to
   compute it.

## Sources

Measured on 2026-08-18 from `square-catalog-PRE-DAMAGE-2026-08-14T21-00Z.json`
(989 items) and `/v2/orders/search` over the most recent 5,000–10,000 orders, via
the read-only `square-event-probe` (`accounting_audit`, `orders_audit`).
