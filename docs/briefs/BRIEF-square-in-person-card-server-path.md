# Brief: move the in-person card sale onto the server path

**Status:** 🟡 Not launch-blocking — the money is registered correctly today.
This is about the three things *around* the money that are still wrong.
**Date:** 15 Aug 2026
**Source:** found while executing `BRIEF-square-transaction-registration.md`.
Tom chose "cash now, card as a follow-up" — this is the follow-up.

---

## What is already right

An in-person **card** sale does take real money through Square. `square-terminal`
creates a Terminal checkout, the POS polls it, and the resulting `payment_id` is
stored on the ticket rows, so the sale reconciles and refunds credit the right
card. **Nothing here is an accounting gap.** Do not treat this as urgent the way
the cash hole was.

## What is still wrong

The card sale is the last path that writes ticket rows from the browser
(`StaffPOS.createTickets` → `supabase.from('tickets').insert(...)`). Three
consequences, none of which are about Square:

1. **The browser decides the price.** `buildTicketRows` computes price, tax and
   total client-side. The database trigger overwrites them on insert, so this is
   not currently exploitable — but it is the exact arrangement `ticket-checkout`
   was built to end, and it survives here only because nobody moved this path.
2. **The staff account owns the tickets.** `createTickets` uses
   `supabase.auth.getUser()` — the person working the till. Every walk-in card
   sale lands in a staff member's ticket list, and the patron has no record of
   the purchase at all.
3. **No ticket is ever delivered.** The POS demands an email or phone "for
   digital ticket delivery" and then delivers nothing: no path from
   `createTickets` reaches `deliverConfirmation`. The patron is asked for an
   address that is never used.

Cash had all three problems. Routing it through `ticket-checkout` fixed all three
as a side effect of fixing the money, which is why the asymmetry now exists:
**two buttons on the same screen behave differently.** Cash gets a patron-owned,
emailed, server-priced ticket; card does not.

## The change

`ticket-checkout` already has everything needed — the in-person branch, the staff
gate, `MAX_TICKETS_IN_PERSON`, the `'none'` pricing channel. It needs one more
tender: a card sale whose money **has already been taken** by the Terminal.

Suggested shape:

```
payment_method: 'terminal_card'
square_payment_id: <payment_ids[0] from the completed Terminal checkout>
```

The function verifies the payment against Square rather than trusting the id
(`GET /v2/payments/{id}` — check `status: COMPLETED`, the amount matches what it
just priced, and no other order already claims it), then writes the rows,
attaches the attribution order, and delivers. `StaffPOS.handleCardSale` and
`pollCheckoutStatus` stop calling `createTickets` and call the server instead;
`createTickets` and `buildTicketRows` can then be deleted outright.

**The verification step is the whole design.** Taking a client-supplied
`square_payment_id` on trust would let any staff browser mint confirmed tickets
by naming a payment — including someone else's.

Note the ordering difference from cash: the Terminal takes the money *before* the
server hears about the sale, so the rows cannot be written first. A completed
Terminal payment with no ticket rows behind it is the failure mode to design for
— probably a `pending` row written before the checkout starts, the way online
checkout already does it.

## Also worth folding in

* **`square-terminal` requires `admin`, not `staff`** (pre-existing, noted in
  `SQUARE-PAYMENTS.md`). A staff-only account cannot take a card at the box
  office at all. Fix it in the same pass.
* **The donation on a card sale** already rides the terminal charge and is
  recorded by `square-donation record_in_person` with the payment id. That works;
  leave it alone unless the sale moves wholesale.

## Test plan

* An in-person card sale creates the ticket rows **server-side**, owned by the
  patron, with `square_payment_id` set and a confirmation actually sent.
* A forged `square_payment_id` (valid Square payment, wrong amount; or a payment
  already used by another order) is **refused**, and no tickets are created.
* The attribution order names the film, as the cash and online paths now do.
* Refunds still credit the card.
* A cancelled or timed-out Terminal checkout leaves no confirmed tickets.
* Dashboard-verified, not just a 2xx.
