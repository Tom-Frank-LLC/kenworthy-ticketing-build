---
brief: fillable-blank-contract
title: The blank rental contract is a fillable worksheet that downloads whatever has been typed, with empty fields as ruled lines
status: shipped
track: feature
date: 2026-10-09
shipped_in: ["#375"]
shipped_at: 2026-10-09
verified: true
---

# Brief: Make the blank rental contract a fillable form

**Requested by:** Tom, 2026-10-09. Make the blank contract fillable, so staff can enter any amount of info (even just a name, or nothing) and download it at any point while filling it out.

Builds on the blank contract from #373 (`/contract/blank`).

## What was built

- `/contract/blank` has an editor above the contract (`print:hidden`, and outside
  `#contract-body`, so html2pdf never sees it). It is grouped as Who (name,
  organization, email, phone), When (agreement date, event date, end date, start
  time, end time), What (purpose, max attendees, alcohol addendum) and Costs (the
  eight rate/hour/fee fields).
- Every field is held as a string (`BlankFields`). An empty field prints as a
  ruled line, and a typed one prints its value. Numbers are strings on purpose,
  because a number falls back to 0 and prints `$0.00` for someone to cross out.
- Cost lines (`blankCosts`): a line has an amount only once everything in it has
  been typed, so a rate with no hours stays a line. The subtotal, estimated cost
  and total add up the lines that have amounts, and stay blank until at least
  one line does.
- The Term clause in blank mode is now "from ___ to ___", with separate start and
  end time fills, instead of one line. A blank form has 18 ruled fills (it had 17).
- The alcohol addendum defaults to undecided, which carries both addenda as
  before. Choosing one carries only that one.
- Save and Sign remain request-only. Request-backed contracts are unchanged.
- Download PDF and Print / Save PDF also sit beside Clear form, and again below
  the contract for admins as well as renters. That bottom pair moved off the
  white sheet onto the page, because the outline button on the paper was
  dark-on-dark.
- Ruled blanks are capped at the column (`max-w-full`), so a phone no longer
  scrolls sideways. The PDF is unchanged (compared page by page).
- The editor shows for anyone who opens `/contract/blank`, not only admins. The
  route was already public, and nothing is stored server-side.

## Decisions taken (the brief's recommendations, with one change)

1. **Editor panel**, not click-to-type on the document.
2. **Persistence: `sessionStorage`, not `localStorage`**, plus a **Clear form**
   button. The brief recommended localStorage. sessionStorage still survives a
   refresh, which was the stated need. It is also gone when the tab closes, and
   on a public page used from shared box-office machines a renter's name and
   phone number should not sit there for the next person (see audit L12 on
   shared devices).
3. **Filename:** `Kenworthy-Contract-<licensee name or organization>.pdf`, or
   `Kenworthy-Contract-BLANK.pdf` when neither has been typed.
4. **Field set:** as listed in the brief, plus phone, and with organization
   separate from name. "Correspondence should be addressed to" joins name,
   organization, email and phone.

## Verification

- `src/pages/RentalContract.test.tsx`: name-only fill (16 ruled lines left plus
  the named filename), partial fill prints only what was typed, addendum choice,
  refresh persistence and Clear, `blankCosts` arithmetic.
- In headless Chrome against the dev server, typing a name, $180/hr and 4 hours
  then clicking Download produced `Kenworthy-Contract-Jane-Doe.pdf` (9 letter
  pages). It had the name in the licensee, correspondence and all three signature
  lines, $720.00 on the rental line and in the subtotal and totals, every other
  field ruled, both addenda present, and no form controls. A reload kept the
  typed name.
