---
brief: contract-cost-lines
title: Rental contract cost lines — rehearsal line, unused lines dropped, DCP fees TBD, no "(3.5%)", non-profit discount
status: built
track: feature
date: 2026-10-16
verified: false
---

# Brief: Rental contract cost lines

**Requested by:** Tom, 2026-10-16. All in `src/pages/RentalContract.tsx`; applies to
both the request-backed contract (`/contract/:token`) and the blank form
(`/contract/blank`). No schema change: `contract_data` is freeform `jsonb` and
`get_rental_request_by_token` returns the whole blob.

## What was asked

1. A fillable **rehearsal hours** cost line.
2. When **additional hours** isn't filled, drop the line rather than print it blank.
3. Remove **"(3.5%)"** from the ticketing clause (Section 5F) — confusing.
4. **"TBD"** on the licensing / DCP fees.
5. A **non-profit discount** line item when applicable.

## Decisions taken (the brief's recommendations; Tom said "execute")

1. **Rehearsal bills at its own rate × hours** (`rehearsal_rate`, `rehearsal_hours`).
   No default rate is set — the price wasn't given, so the field starts empty.
2. **Additional Hours, Rehearsal and Non-Profit Discount drop out when unused.**
   On the request contract that means amount > 0 (Additional Hours already worked
   this way). On the blank form a line appears once any of its fields is typed — a
   rate alone brings it back with the hours still a ruled blank — and drops again
   if what was typed comes to $0. **Concessions stays** as an always-present line
   (a write-on line on the blank form).
3. **DCP fee: the amount if positive, else "TBD"**, and TBD adds nothing to the
   subtotal. "Positive" rather than "entered" because a request contract cannot
   tell an entered 0 from the default 0 every saved contract already carries.
4. **Discount is a flat dollar amount** (`nonprofit_discount`), printed as
   "Non-Profit Discount −$X.00" above Subtotal, and subtracted from Subtotal,
   Consideration, Estimated and Total. The optional editable label was not built.
5. **Both paths.**

Side fix: the request editor's number fields (`NumField`) had labels not tied to
their inputs; they now are, as `BlankField`'s are.

## Effect on the blank form

An untouched blank form now carries 16 ruled fills instead of 18 (the Additional
Hours rate × hours pair is gone until typed), and its DCP row reads "TBD" where it
used to be a blank to write the amount on.

## Tests

`src/pages/RentalContract.test.tsx`, "cost lines" and `blankCosts`: rehearsal math,
collapse on both paths, TBD exclusion, discount through Estimated/Total, save and
reload through `contract_data`, sessionStorage round-trip and Clear, Section F text.
