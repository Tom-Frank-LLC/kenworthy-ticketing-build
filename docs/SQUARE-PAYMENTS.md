# Square Payments

How money is taken at the Kenworthy: online tickets, film passes, donations,
box office, and refunds. Written alongside the implementation of
`docs/briefs/BRIEF-square-ticket-payments.md`.

---

## The problem this replaced

Online ticket checkout and online film-pass purchase created **confirmed,
scannable tickets and funded passes without charging anything**. Not a sandbox
credential waiting to be flipped — there was no Square code on either path at
all. A whole-frontend search for `window.Square` or `tokenize` matched only
`Donate.tsx`.

Three separate holes, all closed here:

| Hole | Before | Now |
|---|---|---|
| No charge | `guest-checkout` inserted tickets; `Showing.tsx` inserted them from the browser; `MyPasses.tsx` inserted a funded pass | Server charges Square first; nothing is created until it succeeds |
| No price authority | The browser built the ticket rows and the pass balance | Every amount is recomputed server-side from the showing's own price rows |
| No live switch | SDK URL, API host, and credential names were hardcoded to sandbox in each function | One `SQUARE_ENV` secret selects everything, for every Square call |

---

## The rule

> **Price on the server → write the order pending → charge Square → confirm → deliver.**

Nothing scannable exists before the money moves. A decline leaves `failed` rows
and sends no email. A crash between charge and confirm leaves a `pending` order
carrying its Square payment id — recoverable by hand, and never a free ticket.

This mirrors what the box-office Terminal path already did correctly: it awaited
`COMPLETED` before creating tickets.

---

## Where the code lives

### Edge functions

| Function | Role |
|---|---|
| `_shared/square.ts` | Environment resolution, API access, `createPayment`, `refundPayment`. **Every** Square call goes through here. |
| `_shared/pricing.ts` | Authoritative order pricing. Mirrors the `enforce_ticket_pricing` trigger exactly, including per-row tax rounding. |
| `_shared/buyers.ts` | Resolves who is buying: JWT wins, else match by email/phone, else create the account. |
| `ticket-checkout` | **The only web path to a ticket.** Guest and signed-in, card and film-pass redemption. |
| `film-pass-checkout` | Pass sales: `purchase` (self-serve card), `staff_sale` (box office), `lookup` (patron search). |
| `square-refund` | Real Square refunds, film-pass balance restoration, staff-only. |
| `_shared/rental_invoice.ts` | What a rental is billed: line items, discounts, 6% on taxable lines, net-14 due date, the date span. Pure — tested without Square. |
| `square-invoice` | Builds a **draft** Square invoice for a rental request from its `rental_invoice_lines`. Customer → order → invoice. Staff or admin; sends nothing. |
| `guest-checkout` | Retired. Answers 410 and points at `ticket-checkout`. **Must be redeployed** — deleting it from the repo would leave the old free-ticket function running. |
| `square-donation` | Unchanged behaviour, now on the shared env config. |
| `square-terminal` | Same, plus it returns `payment_id` so box-office card sales are refundable. |

### Frontend

| File | Role |
|---|---|
| `src/lib/square.ts` | SDK loading, config fetch, tokenising. |
| `src/components/SquareCardForm.tsx` | The one card-input component, used by every payment surface. |
| `src/lib/functions.ts` | `invokeFunction` — unwraps the server's error message, which supabase-js otherwise discards behind "non-2xx status code". Without it a decline reads as a generic failure. |
| `Showing.tsx`, `GuestCheckoutForm.tsx`, `MyPasses.tsx`, `FilmPassPOS.tsx`, `Donate.tsx`, `StaffPOS.tsx` | Call the functions above. None of them creates a ticket or a pass any more. |

---

## PCI position

The card number is typed into an iframe served by Square, from Square's origin.
The browser calls `card.tokenize()` and sends us a **single-use token**; the edge
function sends that token to Square with a server-computed amount. Our servers
never see, transmit, or store a card number. This is SAQ A-EP.

We store only `square_payment_id`, `square_receipt_url`, and `square_refund_id`.

---

## Environment: sandbox → live

`SQUARE_ENV` on the edge functions is the **only** switch. It selects both the
credential set and the API host:

```
SQUARE_ENV=production  →  SQUARE_PRODUCTION_*  +  connect.squareup.com
anything else          →  SQUARE_SANDBOX_*     +  connect.squareupsandbox.com
```

Missing or misspelled `SQUARE_ENV` falls back to **sandbox**, deliberately: the
failure mode of a typo must never be "started charging real cards".

The browser does not get its own environment flag. `get_config` reports which
environment the server is in, and the frontend loads the matching SDK bundle
(`sandbox.web.squarecdn.com` vs `web.squarecdn.com`). Two switches for one
decision can disagree, and the failure mode of disagreement is a live card
entered into a sandbox form.

### Secrets

Each credential is read from its env-prefixed name if present, otherwise from
the unprefixed name:

```
SQUARE_ENV                       sandbox | production   (absent = sandbox)

SQUARE_SANDBOX_APPLICATION_ID    ─┐ used when SQUARE_ENV is not production
SQUARE_SANDBOX_ACCESS_TOKEN       │
SQUARE_SANDBOX_LOCATION_ID       ─┘

SQUARE_PRODUCTION_APPLICATION_ID ─┐ used when SQUARE_ENV=production
SQUARE_PRODUCTION_ACCESS_TOKEN    │
SQUARE_PRODUCTION_LOCATION_ID    ─┘

SQUARE_APPLICATION_ID            ─┐ fallback for either, and what both
SQUARE_ACCESS_TOKEN               │ projects are actually configured with
SQUARE_LOCATION_ID               ─┘
```

As deployed today: **production** (`vlmslygnimfbamrtwvyo`) holds only the
unprefixed trio; **staging** (`rpqzrpboyhshdrfdwayk`) holds
`SQUARE_APPLICATION_ID` with `SQUARE_SANDBOX_ACCESS_TOKEN` and
`SQUARE_SANDBOX_LOCATION_ID`. Both work through the fallback. (`SQUARE_ENVIRONMENT`
also exists on both — it predates this and nothing reads it.)

Going live is then either: set the three `SQUARE_PRODUCTION_*` secrets and flip
`SQUARE_ENV=production`, or replace the unprefixed values with live credentials
and flip the same flag. Prefer the first — it keeps sandbox credentials
available to switch back to.

Confirm before go-live that the production application and location belong to
**the theatre's own Square account** (`PLATFORM.md §2.4`).

---

## Database changes

`supabase/migrations/20260812150000_square_ticket_payments.sql`:

* `tickets`: `square_payment_id`, `square_receipt_url`, `square_refund_id`,
  `refunded_at`, `payment_error`, `checkout_idempotency_key`.
* `user_film_passes`: same payment columns plus `price_paid`, `status`
  (`pending|active|failed|refunded`), `sold_by_user_id`,
  `checkout_idempotency_key`.
* `enforce_ticket_pricing`: an insert that explicitly asks for `pending` keeps
  it. Everything else about the trigger — comp handling, seat-tier override,
  price derivation — is unchanged.
* **RLS**: `"Users can purchase tickets"` (customer self-insert) and
  `"Authenticated users can purchase passes"` are dropped. Staff keep a
  box-office insert policy; hosts keep their comp policy. Online purchases now
  happen only under the service role, after payment.
* `redeem_film_pass` execute is revoked from `authenticated`. It is
  `SECURITY DEFINER` and never checked that the pass belonged to the caller, so
  anyone with a pass id could drain someone else's pass. The checkout function
  checks ownership and supplies its own amount.

### Consequence: `pending` and `failed` rows exist now

Every reader that counts tickets had to be told the difference between a sale
and an attempt. Updated: the public ticket page (`_shared/tickets.ts`),
`MyTickets`, `BoxOfficeReceiptsTab`, `AdminDashboard`, `HostDashboard`,
`exportContacts`, `QboExportTab`. Analytics and Mailchimp already filtered on
`confirmed`.

A `pending` row holds its seat for **15 minutes** (`PENDING_HOLD_MS`). After
that it is treated as abandoned, so a checkout that died mid-charge cannot make
a seat permanently unsellable.

---

## Money details

**Tax is rounded per ticket, not once on the subtotal.** The trigger stores
`ROUND(price * 0.06, 2)` on each row, so the order total is the sum of the rows
— which is what gets charged, and what the refund path re-reads. `booking.ts`
was computing it once on the subtotal, which differs by a cent at some prices
(e.g. 4 × $8.25 → $2.00, not $1.98).

**All of it is computed in integer cents**, client and server alike. Postgres
evaluates `price * 0.06` in exact numeric; JavaScript does not. At $4.25,
`4.25 * 0.06 * 100` is 25.499999999999996 in doubles and rounds *down* to
$0.25, while the database stores $0.26 — quoting one number and charging
another. Both test suites pin this: `src/lib/booking.test.ts` and
`supabase/functions/_shared/pricing_test.ts`.

**The buyer does not pay the card processing fee.** A patron buying a ticket
pays the ticket price and Idaho sales tax, and nothing else; Square's cut is a
cost the theatre absorbs. This holds for online and box-office sales alike.

The one exception is **theatre rentals**, settled case by case: a promoter may
agree that their buyers carry the fee rather than have it come out of their
share, which is what the per-production `pass_processing_fee` toggle in the host
dashboard is for. It is off on every production
(`20260812160000_no_buyer_processing_fee.sql` resets any that were on, and the
column defaults to false), so it only ever applies where someone deliberately
turns it on for a specific rental. When it is on, the fee is grossed up so the
theatre nets the full ticket total, recomputed server-side, and refunded along
with the ticket.

**Film passes stay tax-inclusive.** Redemption deducts the pre-tax subtotal and
collects no additional tax, exactly as before; the only change is that the
deduction amount now comes from the server instead of the browser.

**Idempotency.** The browser generates one key per attempt and resends it on
retry. The server returns the order that key already made instead of charging
again, and hands the same key to Square. A key is *replaced* after a failure —
reusing it would make Square replay the decline instead of trying the corrected
card. The key is deliberately not the `order_token`: that token is a bearer
credential, and a client-supplied value must never be able to name someone
else's order.

---

## Refunds

`square-refund` (staff/admin) handles three cases:

* **Card** — refunds `total_price + processing_fee` against the stored
  `square_payment_id` through Square's Refunds API, then marks the tickets
  refunded. If Square refuses, the tickets stay `confirmed`: a ticket marked
  refunded without the money going back is the failure this exists to prevent.
* **Film pass** — returns the deducted balance to the pass it came from and
  removes the redemption row.
* **Cash / comp** — marked refunded, with a warning surfaced to the operator
  that the till has to be opened.

Box-office card sales record `payment_id` from the Terminal checkout, so they
are refundable too.

---

## Rental invoices

Every other Square path here takes money. This one does not: `square-invoice`
turns a rental request's `rental_invoice_lines` — the same rows the QBO export
reads — into a **draft** invoice in Square and stops. Staff review it in the
Square dashboard and press Send there.

`Generate Invoice` sits beside `Contract` on the admin rental listing
(`RentalRequestsTab.tsx`). It is disabled until the request has invoice lines,
and once an invoice exists the button becomes `View Invoice`; making a second
one requires the explicit `Regenerate` action in the details dialog, which
deletes the old draft in Square first.

What the invoice says, and where each rule comes from:

| | | |
|---|---|---|
| Tax | 6% on lines flagged taxable | `TAX_RATE` in `RentalInvoiceLines.tsx` — the number staff already see on screen |
| Due | 14 days from generation | Licence agreement clause 3, "paid in full no later than fourteen (14) days following the receipt of event invoice" |
| Discounts | `nonprofit_discount`, or any negative line, becomes an order-level FIXED_AMOUNT discount | Square rejects a negative `base_price_money` |
| Quantity | whole numbers bill per unit ("4 × $180"); fractional ones bill the extended amount with the arithmetic in the line note | Square's `quantity` is a whole-number string without a `quantity_unit` |
| Delivery | `EMAIL`, card only, DRAFT | Nothing reaches a renter until staff send it |

Square only gives an invoice a `public_url` once it is published, so
`square_invoice_url` holds the dashboard link for a draft and Square's own
public URL after it is sent.

Note one arithmetic difference: Square applies an order-level discount before
tax, while the admin table taxes each line at full price. Where a rental has
both a discount and a taxable line, the two totals can differ by a few cents —
the invoice reports Square's total back to the toast so it can be compared.

---

## Deploying

The Supabase CLI in this repo is linked to **production** (see the environment
notes in `PLATFORM.md`). Nothing here has been deployed; check which project you
are pointed at first.

```bash
supabase db push                       # applies 20260812150000_square_ticket_payments.sql
supabase functions deploy ticket-checkout film-pass-checkout square-refund \
                          guest-checkout square-donation square-terminal
supabase secrets set SQUARE_ENV=sandbox
```

`guest-checkout` **must** be in that list — it is the retirement shim, and the
free-ticket endpoint stays live until it is redeployed.

Then regenerate types (they were hand-edited to match the migration):

```bash
supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts
```

And after every deploy, curl the function — a local check cannot detect a dead
edge function:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/ticket-checkout" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"action":"get_config"}'
# → {"applicationId":"...","locationId":"...","environment":"sandbox"}
```

---

## Test plan

### Automated (run these before deploying)

```bash
npm test                                                   # includes booking.test.ts
deno test supabase/functions/_shared/pricing_test.ts        # server pricing authority
npx tsc -p tsconfig.app.json --noEmit
npm run build:staging
```

`pricing_test.ts` covers the adversarial cases directly: a browser claiming a
cheap tier for an expensive seat, an inactive tier, a tier belonging to another
showing, and the rounding rules above.

### Manual, against Square sandbox

Sandbox first, both paths, then flip and run one real card you refund.

1. **Config loads.** Ticket checkout mounts the card iframe, no console SDK
   error, and the sandbox test-card hint appears (it is hidden in production).
2. **Guest happy path.** `4111 1111 1111 1111`, any future expiry/CVV → charge
   succeeds → ticket is `confirmed` with `square_payment_id` set → confirmation
   email arrives with a scannable QR → the payment appears in the Square
   sandbox dashboard for the amount shown at checkout.
3. **Charge gates creation.** Decline card `4000 0000 0000 0002` → the customer
   sees Square's decline text, the ticket rows are `failed`, nothing scannable
   exists, no email is sent.
4. **Amount authority.** Send a tampered request (extra `amount`, `price`, or a
   cheaper `tier_id` for a seat that is mapped to a dearer tier) → the server
   charges its own recomputed amount, or rejects.
5. **Idempotency.** Double-submit → exactly one Square payment and one order;
   the second response comes back `replayed: true`.
6. **Signed-in path.** Repeat 2–3 while logged in; the ticket lands in
   `/my-tickets` and the pending row never appears there.
7. **Film pass.** Buy a pass with a test card → the balance exists only after
   the charge; decline → the row is `failed` and is not spendable. Redeem it
   against a showing → the deduction equals the server-computed subtotal.
8. **Refund.** Refund a card ticket from the POS → a refund appears in the
   Square dashboard for ticket + fee, and the ticket shows `square_refund_id`.
9. **Production flip.** Set `SQUARE_ENV=production` plus the production trio,
   buy one real ticket with a real card, confirm it in the live dashboard, then
   refund it.

---

## Known gaps

* **Box-office Terminal in sandbox is simulated.** `square-terminal` falls back
  to an auto-approved fake checkout when no reader answers. That fallback is now
  refused when the production credentials are in use — a reader that cannot be
  reached is a failed sale, not an approved one — but it means POS card sales
  cannot be end-to-end tested until a real reader is paired.
* **Box-office ticket sales still insert client-side** under the staff policy.
  They are staff-attested, money-in-the-room sales; moving them server-side was
  out of this brief's scope.
* **Abandoned `pending` rows are ignored but not cleaned up.** They stop holding
  seats after 15 minutes; a periodic job to mark them `failed` would keep the
  table tidy.
* **A film-pass redemption that fails partway** (only possible if a concurrent
  redemption drains the pass mid-order) leaves the already-recorded deductions
  in place while the tickets are marked failed. Visible to an admin, not
  self-healing.
* **`AttendeeSheet.tsx`** (in-flight, untracked at the time of writing) was left
  alone; it should get the same `pending`/`failed` filter as the other readers.
* **`supabase/functions/_shared/tickets_test.ts` cannot run locally** — it pulls
  `npm:pngjs` which is not in `node_modules` for Deno. Pre-existing.
* **`square-terminal` still requires the `admin` role**, not `staff`.
  Pre-existing; a staff-only account cannot take a card at the box office.
