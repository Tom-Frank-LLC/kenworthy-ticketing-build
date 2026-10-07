---
brief: contract-blank-assignee-print
title: A blank printable contract, a point person on each rental request, and Print that produces the same PDF as Download
status: built
track: feature
severity: P2
date: 2026-10-07
shipped_in: []
verified: false
---

# Brief: Blank printable contract · assign a point person · make Print match Download

**Requested by:** Tom, 2026-10-07 — (1) an empty contract to download and fill in
by hand for rare manual cases; (2) let the team assign a team member (point
person) to a rental request, alongside its status; (3) make "Print / PDF" match
the Download version exactly (it printed with the browser's URL/date header).

## What was built

### 1. Blank contract — `/contract/blank`
- `RentalContract` takes a `blank` prop, routed at `/contract/blank` (before
  `/contract/:token`). It loads no request and shows no Save / Sign / rate editor;
  the toolbar offers **Download PDF** and **Print / Save PDF**.
- Every merge field is empty and `Fill` draws an empty child as a ruled
  inline-block line of a given em width (Decision 1b: ruled line, not
  underscores). Nothing falls back to today's date, `__________` or `$0.00`. The
  cost table keeps its labels with blanks for rate and hours, and empty amount
  cells whose row rules are the writing line.
- **Both addenda** (alcohol / no alcohol) are printed, each with its own
  signature lines, because which one applies is not known for a blank form.
- Same html2pdf path as a real contract → `Kenworthy-Contract-BLANK.pdf`, 9
  letter pages.
- Entry point (Decision 1a): a **Blank contract** button in the rentals admin
  (the "Public rental form" section), opening `/contract/blank` in a new tab — the
  same way the per-request **Contract** button works. Both the button and the
  route, then; the route is harmless public boilerplate.

### 2. Point person — `rental_requests.assigned_to`
- Migration `20261007200156_rental_request_assigned_to.sql`: nullable `uuid`,
  FK `auth.users(id) ON DELETE SET NULL`, partial index.
- **No new RLS policy.** The live "Admins update rental requests" policy already
  gates every column to `has_role(uid,'admin')` (superadmins pass), and `/admin`
  is `AdminOnly`. The brief's "staff/admin may set it" does not match the system:
  staff have never been able to update rental requests (status included), so
  "mirror the status policy" means admin-only. Verified on staging in rolled-back
  transactions: admin → 1 row, staff-only account → 0 rows, anon → permission denied.
- Internal only (Decision 2): `get_rental_request_by_token` returns a fixed
  column list, so the renter's contract page never sees it (checked on staging).
  Not printed on the PDF. No email on assignment.
- UI: an **Assigned to** select beside Status in the request dialog (team =
  `user_roles ∈ TEAM_ROLES` + `profiles`, as TeamRoster builds it; **Unassigned**
  clears it), and a badge with the person's name beside the status badge on each
  card. The write `.select()`s and refuses a zero-row result. An assignee who
  leaves the team shows as "Former team member" rather than as Unassigned.

### 3. Print = Download
- `window.print()` is gone from both the admin toolbar and the renter's buttons.
  **Print / Save PDF** renders through `renderPdfBlob` (the same routine as Sign &
  Download) and opens the blob in a new tab (Decision 3: repoint, not remove). The
  tab is opened before the render so the popup blocker counts it as the click's;
  with popups blocked it falls back to downloading the file.
- Verified: on staging data and on the blank form, the Print output and the
  Download output rasterise **pixel-identical** on every page; the files differ
  only in the PDF `CreationDate`.

## Tests
- `src/pages/RentalContract.test.tsx`: blank renders with no request, 17 ruled
  blanks, no `$0.00` / default rate / year / name / underscores, boilerplate and
  both addenda present, no Save/Sign, BLANK filename; a real contract still fills
  in; Print (admin and renter) calls `outputPdf('blob')` + `window.open`, never
  `window.print`.

## To ship
1. Merge.
2. `npx supabase db push` against production (the migration) — **before** the
   Worker deploy, or the dialog's assignee write fails on a missing column.
3. `wrangler deploy` production.

Staging already has the migration and this branch (Worker `181d3e44`, rollback
`3d028e1d`).
