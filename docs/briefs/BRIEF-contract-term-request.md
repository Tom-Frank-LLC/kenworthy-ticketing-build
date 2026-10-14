---
brief: contract-term-request
title: A request's contract can set its own Term (date, hours, extra days), and Save says when it did not save
status: shipped
track: feature
date: 2026-10-14
shipped_in: ["#380"]
shipped_at: 2026-10-14
verified: true
---

# Brief: The Term on a request's contract

**Requested by:** Tom, 2026-10-14, following `BRIEF-contract-term-extra-days`
(blank contract only). Same need on `/contract/:token`: the Term runs from prep
to clean-up, so its hours differ from what the renter asked for, and a rehearsal
can fall on another day with other hours.

## Why no schema change

The earlier brief said this needed new `rental_requests` columns, a `types.ts`
regen and RLS. Checked, and it does not. `rental_requests.contract_data` (jsonb)
already holds the contract's own terms (rates, hours, fees, agreement date,
alcohol addendum); the admin editor already writes it with Save and Sign &
Download, and `get_rental_request_by_token` already returns it to the renter.
The signed PDF is rendered from the page, so it carries whatever the Term shows.

## What was built

- `ContractData` gains `term_date`, `term_end_date`, `term_start`, `term_end`
  and `extra_days`. **Absent means "as requested"**: the Term falls back to
  `proposed_date`, `end_date`, `event_start_time`, `event_end_time`. An empty
  string is a deliberate blank and prints `__________`.
- The admin editor on a request's contract has a **Term** group (Event date, End
  date, Start time, End time) prefilled with the effective values, a line showing
  what was requested, **Reset Term to the request** once anything is changed, and
  the same **Add another day** rows as the blank form (`TermDayRows`, shared).
- One Term renderer for both modes. A real contract now reads "from 6:00 PM to
  10:00 PM" where it read "from 6:00 PM–10:00 PM", matching the blank form and
  the extra days.
- **Save and Sign & Download check the write.** They `.select('id')` and require
  one row. Before, an RLS refusal (204, no error) toasted "Contract saved", and
  Sign went on to sign a PDF whose terms were not stored. RLS on
  `rental_requests`: SELECT for admin + staff, UPDATE for admin only (checked on
  staging, 2026-10-14) — so an admin's save returns its row, and a staffer's is
  now reported as not saved instead of silently dropped.
- `contract_data.extra_days` is sanitized on load, as the draft is.

## Not done

- Not exercised against a real request in a browser: that needs an admin
  session on staging. Check on staging: open a request's contract, change the
  Term hours, add a day, Save, reload.
- A contract already signed still re-renders from `contract_data`, so editing
  the Term after signing changes what the page shows (the signed PDF is stored
  separately). That was already true of every other field here.
