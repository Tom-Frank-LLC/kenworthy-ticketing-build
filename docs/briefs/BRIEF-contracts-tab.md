---
brief: contracts-tab
title: Rentals → Contracts lists every contract, blanks can be saved, contracts keep a version history and signed PDFs are archived, and downloads are named YYYY_MM_DD_Title
status: shipped
track: feature
date: 2026-10-16
shipped_in: ["#387"]
shipped_at: 2026-10-16
verified: true
evidence: prod Worker e6bd00ee (rollback 62b50643); migration 20261016204420 applied on prod and staging
---

# Brief: Contracts tab, saved blanks, version history, download names

**Requested by:** Tom, 2026-10-16. (1) Name the downloaded contract
`YYYY_MM_DD_Title`. (2) Move the public rental form panel into a new
**Contracts** tab under Rentals. (3) List every contract there: request
contracts and saved blank ones. (4) Version history, and what it costs.

## Decisions (Tom, 2026-10-16)

- **Blank contracts get into the list two ways:** an explicit *Save to
  Contracts*, and any Download or Print by an admin of a blank that has
  something typed in it. A blank with nothing typed is the paper worksheet,
  so downloading it writes no row.
- **History keeps JSON snapshots and the signed PDF.** Each signing stores the
  stamped file in the private `signed-contracts` bucket.
- These follow the brief's recommendations without a separate ask: underscores,
  `-signed` suffix, `BLANK` when there is no title; the panel moves entirely;
  Requests stays the enquiry queue.

## Two corrections to the draft brief

1. **A PDF rebuilt from `contract_data` is not the signed PDF.** Signing hashes
   the exact bytes html2canvas produced, plus the stamped verify page. A rebuild
   is a fresh rasterisation and never matches `signed_pdf_sha256`. Before this,
   the only copy `/verify` could confirm was whatever the staffer downloaded.
   That is why the signed file is now archived. `sign-contract` uploads it
   *before* recording the signing, and refuses to record a signing whose upload
   failed. It also now checks its own update, which used to go unchecked.
2. **`contract_data` alone does not reproduce a contract.** The page prints the
   renter's name, email, purpose, dates and alcohol choice from the request row.
   So a request version also stores `request_snapshot`: the printed columns from
   the `get_rental_request_by_token` projection, without the invite token.

## What was built

- `contractFilename` (`src/lib/contracts.ts`), for example
  `2026_11_13_Harvest_Gala.pdf`. The date is the Term day, else the requested
  day, read with `formatPlainDate` so there is no UTC off-by-one. A blank uses
  purpose → licensee → organization, then `BLANK`.
- `blank_contracts`: staff read, admin write. It is audited, and
  `/contract/blank/:blankId` reopens a row.
- `contract_versions` is written **only by triggers**: on `rental_requests`
  when `contract_data` or `signed_pdf_sha256` changes, and on
  `blank_contracts.fields`. Nobody holds a write grant on it, so history
  can't be edited. Staff can read it.
- `rental_requests.signed_pdf_path` holds the latest signed file.
- The Contracts tab (`ContractsTab.tsx`) shows both sources together, latest
  event first, filterable by signed / not signed. Row actions: Open, Download
  (`?download=1`, because the PDF can only be drawn from the rendered page),
  Signed PDF (a 60-second signed URL), copy renter link, and delete for blanks.
- History on the contract page loads only when opened. View shows a past
  version with its renter details and disables Sign. Save restores its terms.
  "Back to the current version" undoes the view.

## Cost

Measured from the design, not from production data: a version is a few KB of
jsonb, about 1–1.5 MB a year at roughly 400 saves. A signed PDF is ~100–200 KB
per signing. Nothing reads versions except an opened History panel.

## Checks

- `src/lib/contracts.test.ts`: filename, date choice, union and sort.
- `src/pages/RentalContract.test.tsx`: save/insert then update, record on
  download, no record for an empty form or a renter, reopen, `?download=1`,
  request filenames, History lazy-load/view/back.
- `supabase/tests/contracts/run.sh`: full migration replay, 30 cases covering
  roles, triggers, the bucket and cascade.
- Deployed 2026-10-16: prod Worker e6bd00ee (rollback 62b50643), sign-contract
  deployed to both environments. The live chunks matched the build byte for byte.
  Tom is testing the admin flows and a signing on production.
