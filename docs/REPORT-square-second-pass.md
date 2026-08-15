# Square integration — second-pass findings

**Date:** 15 Aug 2026
**Purpose:** input for an action plan. The production cutover brief
(`BRIEF-square-production-cutover.md`) was executed on 13 Aug and surfaced none
of what follows. This records what it missed, why its method could not have
caught it, and what is still open.

Every claim below is marked **verified** (measured against production data or
read from deployed code) or **unverified** (inference, and what would settle it).

---

## 1. Why the cutover audit missed all of this

The brief audited exactly one axis. Its own findings table has a single
assessment column, "Env resolution", and every touchpoint was graded on whether
it pointed at the right Square:

| Touchpoint | Env resolution | Cutover status |
|---|---|---|
| `square-donation` | shared config | ✅ ready |
| `square-catalog-sync` | hardcoded sandbox | 🔴 breaks in prod |

It never asked **what a function does once connected**. Connectivity was the
whole question; write semantics were not in scope, and no acceptance criterion
referenced them.

That is visible in the brief's own test plan:

> *"Concessions 'Pull from Square': returns the **production** catalog (no
> error); pushing an item creates it in the production catalog."*

Pulling the entire production catalog without erroring **was the pass
condition**. The incident is that exact behaviour succeeding.

**The cutover fix armed the bug rather than causing it.** Before 13 Aug,
`square-catalog-sync` was hardcoded to sandbox and failing, so its unscoped pull
and its destructive push were inert. Making it env-aware — correct, and required
— pointed both at the live production catalog. A dormant defect became a live
one, and nothing in the audit's frame could have flagged it.

**Generalisation for the next pass:** an integration audit needs at least three
axes, not one.

1. **Connectivity** — right environment, right credentials. *(the brief did this)*
2. **Write semantics** — for each write: does the vendor **replace or merge**?
   Is the payload reconstructed from our columns, or read-modify-write?
3. **Blast radius** — if this runs unintentionally or at scale, what is the
   worst outcome? Is it scoped, staged, confirmable, reversible?

Axis 2 is the specific thing to grep for: **any write built from our own
columns**. We store a handful of fields; vendors store dozens.

---

## 2. Confirmed incident (14 Aug) — summary

Full detail in `docs/INCIDENT-2026-08-14-square-catalog.md`.

- **Verified.** An unscoped `pull` imported all 998 Square catalog ITEMs into
  `concession_items` as active, publishing the theatre's entire sales history as
  a concessions menu.
- **Verified.** `toggleActive` called `pushItem`, which rebuilt the Square object
  from four columns. Square's `UpsertCatalogObject` replaces, so **906 live
  catalog objects** were overwritten, losing category, description, images, taxes
  and variations beyond the first.
- **Verified by measurement.** A dry-run against the live catalog found **392**
  items whose category no longer matches the pre-incident snapshot. Tom confirmed
  in the dashboard that a probe item has neither category nor variation.
- **Verified.** The concession stand itself was never touched. All 51 core stand
  items (combos, candy, bottles, soda, beer, wine, popcorn) still carry
  `square_synced_at = 19:41`, the original pull, and share one bulk-UPDATE
  `updated_at` to the millisecond. **Registers were never at risk.**
- **Unverified.** Whether damaged items are still sellable. Depends on whether
  the push left a `Regular` variation or none. Affects tickets and merch only.
  *Settled by:* opening one damaged item on a register.

**Not recoverable from our side:** descriptions, images, variations past the
first. Never stored by us. Only a Square export or Square Support can restore
them, and backups age — this is the most time-sensitive open item.

---

## 3. Audit of every Square write path

Read from `main` @ `8a74e8a`. The question asked of each: *does this reconstruct
a vendor object from our columns?*

| Function | Writes | Verdict |
|---|---|---|
| `square-catalog-sync` `pushItem` | `POST /catalog/object` | **Was the bug — fixed.** Now read-modify-write. |
| `square-catalog-sync` `pull` | DB only | **Fixed.** Category allowlist, never auto-activates, dry-run preview, refuses >200. |
| `square-catalog-sync` `deleteItem` | `DELETE /catalog/object` | **Fixed at the caller.** The admin trash button fired this for any Square-linked row; now site-only with a second explicit confirmation. |
| `square-labor` `mutateShift` | `PUT /labor/shifts/{id}` | ✅ **Correct, and instructive.** Already reads the current shift and puts it back changed, with the reasoning in a comment. Someone met this trap here and solved it properly. |
| `square-labor` `updateScheduledShift` | `PUT /labor/scheduled-shifts/{id}` | 🔴 **Same bug class. Live.** See below. |
| `square-labor` `deleteScheduledShift` | `PUT` with `is_deleted` | 🔴 **Same shape.** Reconstructs `draft_shift_details` from caller params. |
| `square-invoice` `deleteDraft` | `DELETE /invoices/{id}` | ✅ Safe. Reads first, refuses anything not `DRAFT`. |
| `square-invoice` order/invoice create | `POST` | ✅ Safe. Creates fresh, never rewrites. `resolveCustomer` searches before creating. |
| `square-terminal` / `square-donation` / `square-refund` | `POST` payments | ✅ Safe. Create-only. |
| `ticket-checkout` / `film-pass-checkout` | `POST /payments` | ✅ Safe. Create-only, no catalog reference. |

### The one live instance

`square-labor` `updateScheduledShift` PUTs `draft_shift_details` built only from
caller params:

```js
const details = { location_id, team_member_id, job_id, start_at, end_at,
                  ...(params.notes ? { notes: params.notes } : {}) };
```

`notes` and `job_id` are both conditional, so editing a shift without passing
them drops whatever Square held. Lower blast radius than the catalog — notes on a
shift, not the item library — but the same mistake, writing to production labour
data.

**Genuine constraint:** Square exposes no GET-one for scheduled shifts, so
straightforward read-modify-write is unavailable. The fix is to source the full
record from the list endpoint before writing. This is harder, not safe.

---

## 4. Do movies / showings / events write to Square?

**No — verified exhaustively.** Every reference to Square's `/catalog` endpoint
in the codebase lives in `square-catalog-sync`, whose only caller is
`ConcessionItemsTab.tsx`. Nothing in the movies, showings, events or performances
admin reaches Square's catalog. Checkouts create payments, with no
`catalog_object_id` anywhere.

**Implication:** the ~876 film and event titles in the Square catalog were
created by staff **directly in Square, over years**. They are hand-curated work,
not app-generated data we could regenerate. That is what was overwritten.

---

## 5. Reconciliation architecture

Prompted by the question: if Square is the verifiable register, can our reports
be confirmed against it without aligning how the systems track data?

### What works today — verified

Two deliberate hooks make this **two-way**:

- `square_payment_id` stored on paid rows (`tickets`, `donations`,
  `film_pass_orders`)
- `reference_id` on the Square payment = our `order_token`

The decomposition was tested on all 7 real production payments and ties out
exactly, including many-tickets-to-one-payment:

```
order_token 393bd22e…  1 ticket   $8.48   = Square $8.48
order_token d738ce8a…  2 tickets  $21.20  = Square $21.20
order_token db046567…  3 tickets  $25.44  = Square $25.44
```

### 🔴 Cash never reaches Square — a policy violation, not a design choice

**The policy** (stated by Tom, 15 Aug): *no money is collected that doesn't go
through Square — cash transactions must be registered with Square to keep the
books accurate.* Square is intended to be the **complete** register.

**The code does not implement that.** Verified by reading every POS flow:

| Flow | Card | Cash |
|---|---|---|
| Online ticket checkout | ✅ Square payment | n/a |
| `StaffPOS` tickets | ✅ Square terminal | 🔴 **DB only** |
| `FilmPassPOS` | ✅ Square terminal | 🔴 **DB only** |
| `ConcessionPOS` | 🔴 **DB only** | 🔴 **DB only** |
| DVD rentals (`DvdLibraryTab`) | 🔴 **DB only** | 🔴 **DB only** |

The gate is explicit — `FilmPassPOS.tsx:236`:

```js
if (!order && paymentMethod === 'card' && selectedType) {
  squarePaymentId = await collectTerminalPayment(...)
}
```

Cash falls straight through with `squarePaymentId = null`. `StaffPOS.handleCashSale`
is the same shape: it calls `createTickets('cash')` and writes rows, and never
contacts Square.

**Verified: nothing in the codebase creates a Square cash tender.** No
`cash_details`, no `source_id: 'CASH'`, no `buyer_supplied_money`. Square's
Payments API supports cash tenders; we never use them.

`ConcessionPOS` is the sharpest case: it contacts Square for **neither** cash nor
card. It inserts `concession_sales` + `concession_sale_items` and shows a success
toast. For a card sale it does not charge a card.

**Unverified, and it decides the severity:** whether staff ring these on a
**separate physical Square register** and use our POS only for inventory and
records. If so this is a double-entry workflow — reconcilable but manual — rather
than lost revenue. If not, cash and concession revenue never enters Square at
all. *Settled by:* asking the box office how a cash concession sale is actually
rung up today.

### Correction to an earlier reading

An earlier draft treated 8 cash film passes ($480) as evidence that "Square is
structurally a subset of revenue, and that is by design." **That was wrong on
both counts.** Those rows are test data, and the policy is the opposite: Square
is meant to be complete. The correct reading is that they are **8 instances of
the gap above**, not a category Square cannot see.

### Consequence

- **Card revenue** — verifiable against Square one-to-one. Already aligned.
- **Cash and concession revenue** — currently unverifiable against Square,
  because it never gets there. This is the gap to close, not a reporting nuance
  to work around.
- **Per-film attribution** — our system only. Square holds a total plus the title
  as free text in `note`. Verifiable in aggregate, not independently attributable.

Once cash is registered in Square, the "unifier" model works as intended: our
system holds the itemised detail, Square holds the complete money record, and the
two tie out through `square_payment_id` / `reference_id`.

### Reporting-shape gap at cutover

Tickets rung up on the Square register against a catalog item appear in Square's
**Item Sales** reports per film. Tickets sold through our system appear only as
payments. As sales shift to the new system, Square item-sales exports will show
film revenue *apparently declining* while total payments stay correct.

**Unverified:** whether staff actually ring tickets against those catalog items.
Inferred from the catalog holding 243 items under `6 Film Tickets`. *Settled by:*
asking the box office. This determines whether the gap matters at all.

Note `AccountingTab` imports a yearly xlsx with monthly sheets, not a Square item
export — so today's bookkeeping may already not depend on Square itemisation,
which would shrink this considerably.

---

## 6. Open items

**Time-sensitive**

1. **Register cash in Square.** Every cash flow — POS tickets, film passes,
   concessions, DVDs — records to our DB only, and `ConcessionPOS` never contacts
   Square for card either. This breaks the stated policy that all money runs
   through Square, and it breaks the books. First step is the unverified question
   in §5: find out whether staff already double-enter on a physical register.
   If not, this is the highest-priority item in this document.
2. Obtain a Square item-library export, or open a Square Support ticket, for the
   descriptions/images/variations on ~906 items. Backups age. Nothing on our side
   can reconstruct these.
3. Confirm whether damaged items are sellable (variation present or absent).

**Code**

4. Add Square cash tenders (`source_id: 'CASH'` + `cash_details`) to every cash
   path, and make `ConcessionPOS` take payment through Square rather than only
   writing rows. Scope depends on item 1.
5. Fix `square-labor` `updateScheduledShift` and `deleteScheduledShift` —
   source the full record from the list endpoint before the PUT.
6. Re-run `repair_categories` restore (the `additional_category` duplicate is
   fixed; ~381 expected to succeed). Till-facing categories are individually
   skippable.
7. `order_token` is `uuid` on `tickets` but `text` on `donations` — joins need a
   cast. Standalone donations carry no `order_token`.

**Decisions**

8. Ticket itemisation in Square — leave as payments-only; add ad-hoc order line
   items (itemised, no catalog coupling); or reference real `catalog_object_id`
   (best fidelity, reintroduces coupling). Recommend ad-hoc line items **if**
   per-film Square reporting is actually wanted.
9. Catalog hygiene, pre-existing and unrelated to the incident: 535 items
   uncategorised in Square (verified pre-existing — recorded as `General` at
   19:41, hours before any push); `SILENT FILM FESTIVAL PASS` exists three times;
   `Poster Design` / `Poster Print` are proposed as merch but look like services.

**Process**

10. Re-run the cutover audit on axes 2 and 3 (write semantics, blast radius) for
   every integration, not only Square — LGL and Mailchimp have the same shape and
   both share credentials between staging and production.

---

## 7. Rules worth carrying forward

1. **Never reconstruct a vendor object from our columns.** We store a handful of
   fields; the vendor stores dozens. Anything built from scratch deletes the
   rest. Read-modify-write, always.
2. **An import must be scoped and must not self-publish.** Arriving inactive is
   what makes a mis-scoped pull survivable.
3. **Vendor-side damage is invisible from our UI.** The site looked fine
   throughout; Square's dashboard still showed items as present and available.
   Timestamps were the only evidence.
4. **"It ran without erroring" is not an acceptance criterion** for anything that
   writes to a live vendor system.
