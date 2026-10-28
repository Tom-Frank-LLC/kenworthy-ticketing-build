---
brief: stand-at-patron-display
title: The patron pays on the Square Stand at the patron-facing display, straight from the donation step
status: built
track: feature
severity: P1
date: 2026-10-28
verified: false
---

# Brief: the Stand is the patron-facing display

**Requested by:** Tom, 28 Oct 2026. Corrects `BRIEF-ios-stand-reader.md`,
which assumed the iPad in the Square Stand was the staff till.

## The setup

- **Till:** staff, inside the box office, on any device (laptop, iPad, phone)
  at `/staff/pos`.
- **Patron-facing display:** the iPad in the Square Stand, outside the glass,
  running the Kenworthy iOS app at `/pos/display`, signed in as a staff
  account (for now an existing one; later a dedicated "box office display"
  account).

## The sale

1. Staff ring up the tickets, choose card, and enter the patron's email. The
   sale appears on the display, as today.
2. The patron chooses a donation (or none), then taps **Pay $X on the card
   reader**.
3. The till starts the sale (pending rows, Square Order) with no staff tap.
   The display takes the card on the Stand: Square's own tap/insert screen.
4. The display confirms the payment with the server, says thank you, and the
   till completes the sale and sends the tickets.

Staff can still press the Charge button themselves (the patron does not have
to tap Pay), and can **Cancel** while the display waits for the card.

## Rules

- **The amount never travels on the pairing channel.** Anyone with the
  pairing code can send on it. The till sends only the Square Order id; the
  display asks the server (`square-terminal` `stand_charge`, staff only), which
  reads the order from Square and holds it to the pending rows: our location,
  OPEN, total = rows plus a gift within the counter cap. The display charges
  Square's total for that order.
- **The order token never travels on the channel** either: it opens the
  tickets (`/t/:token`). The server hands it to the signed-in display.
- **Confirmation is the server's**, from Square's own record of the payment
  (`confirm_sale` with `payment_id`, unchanged). The display confirms, and the
  till confirms again on hearing "paid"; the second answers
  `already_confirmed`.
- **Cancel waits for the display.** The till releases the held seats only
  when the display says no payment was taken, or after staff say so
  explicitly when the display does not answer — a card charged after its seats
  were released is the worst outcome here.
- A declined or cancelled card leaves the sale waiting: the patron can try
  again on the display, or staff cancel.
- The patron display on a phone (the website, no Stand) is unchanged.

## Built and tested (28 Oct 2026)

On `feat/ios-stand-reader` (#399). Staging, Square sandbox: the display was the
staging app in the iPad simulator with Square's mock reader, signed in as a
staging staff account; the till was the staging site in headless Chrome.

| Case | Result |
|---|---|
| Patron chooses $5, taps Pay; mock card | ✅ $15.60 approved; 2 tickets confirmed with the Square payment id; the gift recorded against it; tickets emailed; no staff tap |
| Patron chooses nothing, taps Pay | ✅ paid, confirmed |
| Staff press Charge (patron never taps Pay) | ✅ Square's screen opens on the display |
| Staff Cancel while Square's screen is up | ✅ the display cancels Square's screen, says so, and only then the till releases the seats |
| Staff Cancel right after a paid sale | ✅ (this failed before a fix: below) |
| Patron cancels on Square's screen | ✅ display offers Try again; till keeps waiting and tells staff |
| Try again after that | ✅ Square's screen reopens for the same order |
| Square's own inactivity timeout, then staff Cancel | ✅ "The card reader timed out." on the display; seats released |
| App closed and reopened | ✅ reopens on the display, still paired |
| The alternative setup: till on the Stand iPad | ✅ paid, confirmed, tickets sent |

Fixed on the way:

- **A cancel answered from screen state.** The first Cancel test released the
  seats while Square's screen was still taking a card. That run had no trace;
  the cause found in the code afterwards is that the display answered a cancel
  from its screen's "working" flag, which an earlier run ending late could
  clear, so it could answer "no card taken" while Square's screen was up. Not
  reproduced in five later runs either way, so treat the cause as likely, not
  proven. Cancel is now answered from whether a Stand charge is actually
  running (`src/lib/displayStand.ts`), whatever the screen says, and a cancel
  that arrives before Square's screen opens stops the charge from starting.
  Unit-tested.
- **Cancelled is not the only "no card".** After Square's own timeout the
  answer is "declined (timed out)"; the till treated only "cancelled" as the
  display's confirmation and would have hung. After a cancel, every answer but
  "paid" releases the seats, except a payment Square has not settled, which
  goes to staff.

Not tested: a real Stand, a real card, production Square; the till on an iPad
or phone (it is the same web page).

## Out of scope

Film passes on the Stand (already refused on the Stand), refunds on the Stand.
