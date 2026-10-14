---
brief: contract-term-extra-days
title: The blank contract's Term can list extra days (rehearsal, load-in) each with its own date and hours
status: shipped
track: feature
date: 2026-10-14
shipped_in: ["#379"]
shipped_at: 2026-10-14
verified: true
---

# Brief: Term clause — add a separate rehearsal/load-in day

**Requested by:** Tom, relaying the team on a real booking, 2026-10-14. The Term
should read e.g. *"shall include Friday November 13th, 2026, from 6:00 PM to
8:30 PM"*, with the time editable (the Term window covers prep, rehearsal,
load-in and clean-up, so it can differ from what the renter asked for), and with
a way to **add another date** when rehearsal falls on a different day from the
event, at different hours.

## What was already there

On `/contract/blank` the Term's event date, end date and both times were already
editable, and the "Term is assessed from the time in which KPAC staff begins
preparations…" sentence was already in the clause. The limit was one block:
`eventDays()` renders one day or one contiguous "X through Y" range, at a single
time window. There was no way to say "Thursday rehearsal 6–9 PM, Friday event
6–8:30 PM".

## What was built

- `BlankFields.extra_days: TermDay[]` (`{ label, date, start, end }`), in the same
  `sessionStorage` draft as the rest of the form. The primary event block and
  `end_date` are unchanged.
- In the editor, **Add another day** appends a block (For / Date / Start time /
  End time) with **Remove this day**; it repeats, so event + rehearsal + load-in
  works. Clear form removes them all.
- In the Term each added day follows the event:
  *"…from 6:00 PM to 8:30 PM, and for rehearsal / load-in Thursday November
  12th, 2026, from 6:00 PM to 9:00 PM. Term is assessed from…"*. An empty date
  or time prints as a ruled blank, like every other fill-in. A cleared label
  drops the "for …" words rather than printing a blank.
- Download and Print need no change; they render the same DOM.

## Decisions taken (the brief's recommended options)

1. **Repeatable list**, not a single fixed second day.
2. **Blank contract only.** The request-backed contract at `/contract/:token`
   was left for later. **Correction:** this brief said that would need new
   columns on `rental_requests`, a `types.ts` regen and RLS. It did not —
   `contract_data` (jsonb) already holds the contract's own terms, is saved by
   the admin editor and returned by the token RPC. Done that way in
   `BRIEF-contract-term-request.md`.
3. **`end_date` kept** for consecutive days at the same hours; extra days are for
   days with different hours. The editor says so under the button.
4. **Default label `rehearsal / load-in`**, lower-case because it reads
   mid-sentence ("and for rehearsal / load-in Thursday…"). Editable. It is
   printed as typed, not case-folded, so a name in it keeps its capitals.

## Tests

`src/pages/RentalContract.test.tsx`, "another day in the Term": the full Term
sentence with an added day; an empty added day adds exactly three ruled blanks
and no `0:00`; times without a date; a cleared label; removing the middle of two
days; Clear; a refresh round-trip; a draft holding only an empty added day is
still saved; a malformed saved draft does not crash; the real contract has none
of it.
