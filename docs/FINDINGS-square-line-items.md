# Catalog-linked line items — what the ground turned out to look like

**18 August 2026.** Implementation notes for
`docs/briefs/BRIEF-square-line-items`, whose authoritative spec is
`docs/SQUARE-TRANSACTION-CONVENTIONS.md`. Read the spec first; this records
where the brief's plan met the schema and had to change, and what was actually
built.

**Scope built this session: Part B prerequisites only.** Schema, item
resolution, and the variation-ensure plumbing, planning-only. **No checkout
code was changed and no catalog write has been executed.** Part A
(order-then-pay in `ticket-checkout` / `film-pass-checkout` / `square-donation`)
is not started.

## Five findings that change the brief

### 1. The variation grain is the price tier, not the showing

The brief says to add `square_variation_id` to **showings**. A showing row can
hold one id, but Square's convention — the one the whole spec rests on — is one
variation per *tier per showtime*. A showing with Adult/Student/Child needs
three. `showing_price_tiers` (`showing_id, tier_name, price, is_active`) is the
exact analogue, and `_shared/pricing.ts` already prices from it.

So the mapping is a **table**, not a column: `showing_square_variations`.

### 2. Tier ids do not survive an edit, so the key is the tier NAME

Both writers of `showing_price_tiers` DELETE every tier for a showing and
reinsert them on each save — `src/pages/admin/ShowingForm.tsx:245` and
`src/components/admin/SeatTierEditor.tsx:303`. Keying the mapping on
`showing_price_tiers.id` would therefore orphan the Square variation every time
an admin re-saved a showing, and mint a duplicate on the next sale. That is the
same unbounded-accumulation failure the spec flags as its open question 3,
triggered by an ordinary edit.

The key is `(showing_id, tier_name)`. `tier_name` is `NOT NULL DEFAULT ''`, with
`''` meaning "single price, bare showtime grammar" — a NULL would not dedupe
under a UNIQUE constraint and would quietly accumulate one row per sync.

### 3. Nothing links a production to a Square item

`movies`, `events` and `live_performances` had no `square_item_id`. The brief
treats "resolve the film's EVENT item" as one bullet; it is the largest unbuilt
piece, because it has to be resolved against 823 live EVENT items by title.

Worse — creating one may not be possible. Square's reference says Connect V2
allows creating only `REGULAR` and `APPOINTMENTS_SERVICE` items, and
`product_type` is immutable after creation, so an item created by the build
could never become an EVENT and could never hold a venue or date.

**That claim is untested for creation, and should be tested.** The same sentence
in the reference did *not* prevent 739 successful writes to `item_data.event` on
existing EVENT items (`venue-date-square-mechanism.md`), so it is not a reliable
guide to what the API actually refuses — and this repo's history is emphatic
about distrusting inherited impossibilities: the Aug 14 damage was called
unrecoverable for four days and was not. One create plus a read-back settles it.
Not done here, because this session was scoped to no live catalog writes.

Until it is settled, the planner **does not create items**: it emits a dashboard
work list of titles a human must create as Event items, with the intended
category for each. So the "match, then auto-create" decision is delivered as
*match automatically, create by hand* — and the auto-create half is one
experiment away from being answerable either way.

### 4. Letting Square compute tax would break the refund path

The spec says to charge `order.total_money.amount` and let Square apply the
item's tax. That conflicts with code already in the build:

- `_shared/pricing.ts` deliberately mirrors the `enforce_ticket_pricing` DB
  trigger, which rounds tax **per ticket row**;
- `square-refund/index.ts:115` refunds `SUM(total_price + processing_fee)`.

Square rounds tax **per line item**, so a qty-2 Adult line is one rounding where
ours is two. At prices like $8.25 the two differ by a cent — and the charge would
no longer equal `SUM(tickets.total_price)`, so a "full" refund would not match
what was taken.

**Decision: our arithmetic stays authoritative.** When Part A is built, line
items carry `catalog_object_id` **and** an explicit `base_price_money`. The
catalog link is what drives item-sales and category reporting; the price
override is what keeps the ledger self-consistent. Adopting Square's totals
instead is possible, but it is a change to the trigger and the refund path, not
a checkout change.

### 5. MET and NT Live are a title convention, not a field

There is no strand column. `movies.circuit` is free text for film buying
("Clark Film Buying") and `release_label` is free text too. MET and NT Live are
`movies` rows whose title carries the prefix — which is also how Square names
them. Classification is therefore by **anchored title prefix**, reusing the
regexes already proven in `square-catalog-sync`'s `desiredCategory`.

Anchored, never substring. Substring matching is what filed
`GUILLERMO DEL TORO'S PINOCCHIO` under merch for containing "pin".

## What was built

| | |
|---|---|
| `supabase/migrations/20260818201900_square_showing_variations.sql` | `square_item_id` on the three production tables; the `showing_square_variations` mapping table, RLS on, service-role write, admin read |
| `supabase/functions/_shared/square-catalog.ts` | The conventions as pure code: variation grammar, tier vocabulary, category taxonomy, title normalisation, `diffPaths` |
| `supabase/functions/_shared/square_catalog_test.ts` | 22 tests |
| `supabase/functions/square-showing-variations/` | Admin-gated planner; `plan` is read-only and the default |

### Category lives on the item, not the variation

A variation appended to a correctly-filed EVENT item inherits that item's
category and its `tax_ids`. So the append path sets **no** category — which
removes the whole `category_id` / `categories` / `reporting_category`
writable-shape hazard from this path. Categories only matter for items a human
creates in the dashboard, and the plan output states the intended category for
each so they can be filed correctly on creation.

### The guardrails, inherited from `square-event-write`

That function is the proven implementation and this one copies its three
defences rather than reinventing them:

1. **Read-modify-write.** The object sent is the object Square just returned,
   with exactly one variation appended. Never reconstructed from our columns —
   that is the Aug 14 mechanism that destroyed 906 items.
2. **A pre-send diff assertion.** The only permitted change is
   `item_data.variations.length`. Any other moved path refuses the item.
3. **A post-write read-back.** A 2xx is not evidence: at this API version
   `item_data.categories` is accepted and silently ignored, and a whole repair
   run once reported success having changed nothing. The mapping row is written
   **only after** Square confirms it holds the variation at the right price.

Plus: a duplicate re-check against the freshly retrieved item (the catalog walk
can be minutes stale), a 429 stop-and-resume for the catalog lock Square holds
during upsert, and `max_batch` defaulting to 1.

## How to run it

```jsonc
// Read-only. Writes nothing, anywhere. Start here.
{ "action": "plan", "horizon_days": 120 }
```

Returns per-status counts, plus `needs_dashboard_item` — the titles a human must
create as Event items before those showings can be linked.

Statuses: `linked` (mapping matches Square) · `adopt_existing` (the variation is
already in Square, only our mapping is missing — **needs no catalog write**) ·
`would_append` · `price_drift` · `needs_item` · `ambiguous_item` ·
`stored_item_gone` · `not_event_item`.

```jsonc
// Records adoptions (database only), and dry-runs the appends.
{ "action": "apply" }

// A real catalog write. All three required, and it is capped.
{ "action": "apply", "dry_run": false, "confirm": "WRITE", "max_batch": 1 }
```

Work `adopt_existing` to zero first: those cost nothing and shrink the append
list.

## Open, and genuinely blocking

**The CSV-import bleed is still the load-bearing risk.** Square's
`UpsertCatalogObject` replaces the whole object, and a dashboard Library CSV has
no column for per-showtime variations or the event block — so a CSV round-trip
re-flattens exactly what this builds. `venue-date-square-mechanism.md` records
770 of 838 EVENT items losing their event block that way, and calls it an
ongoing bleed rather than finished damage.

Nothing in this repo performs that import; it is a human dashboard workflow.
**It has to stop before Part B is applied at any scale**, or the variations will
be created and destroyed on a loop. This is a process decision, not a code
change, and it is the one thing that would make this work wasted.

## Not done

- **Part A.** No checkout function was touched. `createPayment` still has no
  `orderId`, and every sale is still a bare payment.
- **Film passes.** `film_pass_types` sell under `9 Film Passes` as a REGULAR
  item with no showtime — a simpler shape that needs its own mapping, not this
  one. The `6 Redeem` $0 redemption line is a checkout-path change and belongs
  with Part A.
- **`src/integrations/supabase/types.ts`** is generated from the database and
  does not yet carry the new table or columns. No frontend code reads them, so
  nothing is broken; regenerate on the next types pull.
- **No live catalog write has been made, and no plan has been run against the
  production catalog.** The planner has not yet seen real data.
