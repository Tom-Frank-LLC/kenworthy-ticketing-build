---
brief: blank-contract-link-request
title: A filled-in blank contract is linked to an existing rental request or creates one, so it gets a renter link, signing and review without duplicate requests
status: shipped
track: feature
date: 2026-10-16
shipped_in: ["#390"]
shipped_at: 2026-10-16
verified: true
evidence: prod Worker 64d4fade (rollback 662549e2); migration 20261016215241 applied on prod and staging
---

# Brief: Link a blank contract to a rental request

**Requested by:** Tom, 2026-10-16, after #387. A contract made on
`/contract/blank` had no request behind it: no renter link, no signing, no
invoice, and no review/approve step. Saving or downloading one should link it
to the existing request, or create a new one, without making duplicates.

## Decisions (Tom, 2026-10-16)

- **Required, with skip.** Save, Download or Print on a filled-in blank (as an
  admin) asks which request it is for, once per visit. "Not now" keeps it a
  standalone blank, listed as *not linked to a request* with a **Link to a
  request** action (`?link=1`). An empty blank (the paper worksheet) is never
  asked about, and a renter is never asked.
- **Once linked, it is the request's contract.** The blank row is kept but
  retired (`blank_contracts.linked_request_id`). The list shows only the
  request, and the blank's address redirects to `/contract/:token`. The
  request's History lists the blank's versions under "Before it was linked".
  Its versions are BlankFields, a different shape from contract_data, so they
  open on the blank's page (read-only once linked), not in the request editor.
- **A new request starts `pending`**, with the admin note "Created by staff from
  a blank contract." No email goes out: the staff alert comes from the
  `rental-request` function for the public form, not from the table.
- **Differences are shown side by side, defaulting to the request's value.** A
  typed name, organization, email, phone or purpose that the staffer picks
  replaces the request's. A typed date or time that the staffer picks sets the
  contract's **Term**, and the request keeps what the renter asked for. Rates
  and terms always come from the blank.

## How duplicates are prevented

- The dialog lists matching requests before offering "Create a new request".
  A match is the same email (strongest), the same date, or shared words in the
  name, organization or title. If a strong match exists, the create form
  suggests linking to it instead.
- `link_blank_contract` locks the blank row and refuses one that is already
  linked (`23505`). It also refuses a request whose contract is already signed
  (`55000`). A request is created and linked in one transaction.

## Things a staffer should know

- A cost left empty on the blank prints the **standard rate** on the request's
  contract (request contracts are numbers, and an absent one uses DEFAULTS).
  The dialog says to check the costs.
- Deleting the request returns the blank to standalone (`ON DELETE SET NULL`).

## Checks

- `src/lib/blankLink.test.ts`: differences, conversion, new-request columns,
  match ranking.
- `src/pages/RentalContract.test.tsx`: no prompt for an empty form; Not now is
  asked once per visit; create → RPC args → `/contract/tok?download=1`;
  existing match → only the chosen differences; a linked blank redirects
  unless `?version=`.
- `src/components/admin/ContractsTab.test.tsx`: linked blanks hidden; unlinked
  ones get the link action.
- `supabase/tests/contracts/run.sh`: 46/46 with the link cases (roles,
  validation, twice refused, signed refused, allowlisted columns, Term vs
  requested date, version written, delete → standalone).
- Tom checked it on staging, 2026-10-16. Deployed to prod the same day: Worker
  64d4fade (rollback 662549e2); the live chunks matched the build byte for byte.
