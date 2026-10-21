---
brief: contract-second-rate-classic-serif
title: Rental contract takes an optional second theater-rental rate, and is set in Georgia at a smaller size
status: shipped
track: feature
date: 2026-10-21
shipped_in: ["#398"]
shipped_at: 2026-10-21
verified: true
---

# Brief: Optional second theater-rental rate + a smaller, classic serif for the contract

**Requested by:** Tom, relaying the team, 2026-10-21. All in
`src/pages/RentalContract.tsx`, on both the request contract (`/contract/:token`)
and the blank form (`/contract/blank`). No schema change: `contract_data` is
freeform `jsonb`.

## What was asked

1. An optional second theater-rental rate, for an event billed at two (their
   example: a W–F evening event at both the $120 base rate and the $180 rate).
2. A smaller, less playful font for the contract, like Garamond, Cambria or
   Georgia — "do any match what we already use?" Georgia does: it is the
   fallback after Fraunces in the site's serif stack. Garamond and Cambria are
   not used anywhere.

## What was built

- **Second rate:** `rental_rate_2` / `rental_hours_2`, on `ContractData` and
  `BlankFields` (and in `blankLink.ts`'s `NUMBERS`, so linking a blank to a
  request carries it). The editors call them "Second rental rate ($/hr)" and
  "Second rental hours". The table prints a second
  "Theater Rental ($rate/hr × hours)" row, only when it is set — the #386
  collapse rule: on a blank, once either is typed and it does not come to $0;
  on a request, when it comes to more than $0. It adds into the subtotal.
- **Font:** a `font-contract` family (`Georgia, serif`) in `tailwind.config.ts`,
  used only on `#contract-body`. The body went from `text-base` to `text-sm`,
  the title from Anton `text-3xl` capitals to Georgia bold `text-2xl` in normal
  case, and the section and addendum headings to Georgia bold in normal case.
  The global `h1–h6` rule in `src/index.css` sets Anton in capitals on every
  heading, so each contract heading sets `font-contract normal-case` itself.
  The admin toolbar, editor and the rest of the site keep Fraunces and Anton.

## Decisions taken (the brief's recommendations)

- One fixed optional second rate, not a repeatable list. No editable label:
  each line shows its own rate, which tells the two apart.
- Georgia, not EB Garamond or Cambria. It is a system font on macOS and
  Windows, so html2canvas draws the same glyphs on any staff machine, with no
  webfont to load before the raster. Cambria is not reliably present outside
  Windows/Office. EB Garamond would need a webfont scoped to the contract.

## Verified

- Headless Chrome on `/contract/blank` (dev server, staging mode): every
  element inside `#contract-body` computes to `Georgia, serif`; body 17.3px,
  title 29.7px, section headings 19.8px, none in capitals. The downloaded PDF
  (html2pdf) shows both rental rows ($120 × 3 and $180 × 2) and a $720.00
  subtotal.
- Georgia uses old-style figures (3, 4, 5, 7 and 9 drop below the line), so
  the amounts look bookish. That is Georgia's design, not a fault.
