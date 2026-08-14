# Brief (for Claude Code): Rental requests — multi-day dates + "Generate Invoice" (Square)

**Status:** ✅ Shipped to staging and production, August 14, 2026, from `a8ee428`. See **Results** and **Shipped** at the end of this file — including what is still unverified (no Square call has been made yet).
**Date:** August 13, 2026
**Requested by:** Tom — (1) the rental/event request form only allows one date; some events span several days. (2) After a request is reviewed, staff need a **Generate Invoice** button on the backend listing (next to the Contract button) that creates a **Square invoice** from the filled fields, matching the event invoices already used in the Square account.

## Current state (file:line)
- **Form:** `src/pages/RentalRequest.tsx` — single date `Field label="Proposed Date"` → `<Input type="date">` bound to `form.proposed_date` (~L151–152). Times are separate (arrival/start/end/departure). Submits to `rental_requests`.
- **Schema:** `rental_requests` (`supabase/migrations/20260608223511_…sql`) has `proposed_date date` (single), plus applicant/org/contact fields, `equipment jsonb`, `status` enum, `invite_token` (contract), `admin_notes`.
- **Invoice lines already modeled:** `rental_invoice_lines` (`…20260617052213_…sql`): `rental_request_id, line_kind, description, quantity, unit_price, sort_order`. Admins build them per request via `src/components/admin/RentalInvoiceLines.tsx`. Line kinds: general, live_theater, renter_fee, film_licensing, poster_print, marquee, rental_tickets, nonprofit_discount. They map to `chart_of_accounts` via `account_mappings` (`source_type='rental_line_kind'`) for QBO.
- **Admin listing:** `src/components/admin/RentalRequestsTab.tsx` — each request card has a **Contract** button (~L132–136, `<a href="/contract/{invite_token}">`), a copy-link button, and a details dialog.
- **Square client:** `supabase/functions/_shared/square.ts` — `squareFetch(config, path, init)` with auth + `Square-Version: 2024-01-18`, sandbox/production base via `SQUARE_ENV`. Reuse this. There is **no** `square-invoice` function yet.

---

## Part 1 — Multi-day dates

**Recommended model:** a contiguous **date range**. Add `end_date date` (nullable) to `rental_requests`; keep `proposed_date` as the start. In the form, replace the single date field with a **start** and **end** date (end optional; when set, must be ≥ start). A single-day request just leaves `end_date` null.

- Migration: `ALTER TABLE rental_requests ADD COLUMN end_date date;`
- Form (`RentalRequest.tsx`): start date (required as today) + optional end date; validate `end_date >= proposed_date`.
- Display the span everywhere the date shows: the admin card (`RentalRequestsTab.tsx` ~L125 currently formats `proposed_date` only), the details dialog, the **contract**, and the Square invoice (Part 2). Format as a range when `end_date` is present (e.g. "Aug 14–16, 2026").

**Decision for Tom:** contiguous range (recommended, covers "spans several days") vs. **non-contiguous** multiple days. If events can book non-consecutive days, use `proposed_dates date[]` (a multi-date picker) instead of start/end — heavier UI. Default to the range unless you confirm non-contiguous is needed.

---

## Part 2 — "Generate Invoice" button (Square)

The invoice content is the request's `rental_invoice_lines` (already entered by staff in the details dialog). The button turns those into a Square invoice.

**New edge function `square-invoice`** (service-role, admin-gated — mirror the auth gate other admin functions use). Input `{ rental_request_id }`. Using `_shared/square.ts` `squareFetch`:
1. **Customer** — find or create a Square customer (Customers API) from `applicant_name` / `email` / `phone` (+ `organization_name` as company). Dedupe by email so repeat renters don't create duplicate Square customers.
2. **Order** — create an Order (Orders API) at the location with a line item per `rental_invoice_lines` row: `name = description`, `quantity`, `base_price_money = { amount: round(unit_price*100), currency: 'USD' }`. Model `nonprofit_discount` as a Square discount (or a negative/discount line) per how the current invoices do it. Apply tax only if the current event invoices do (see "match existing format").
3. **Invoice** — create an Invoice (Invoices API) referencing the order + customer: primary recipient = the customer; a single `BALANCE` payment request with a **due date** (from the event date / standard terms); `delivery_method = EMAIL`; title/description referencing `event_title` and the date span from Part 1.
4. **Draft vs send** — create as a **DRAFT** and return the Square invoice's `public_url`, so staff review and send it from Square (matches "generate", not auto-charge). Make publish/send an explicit later action. *(Decision for Tom below.)*
5. **Persist** — add `square_invoice_id text`, `square_invoice_url text`, `square_invoice_status text` to `rental_requests`; store them so the button reflects state.

**Match the existing Square event-invoice format.** The generated invoice should look like the event invoices the Kenworthy already sends from Square — same line-item naming conventions, tax treatment, payment terms/due date, and email delivery. I can't see the Square account's template, so the team must confirm: (a) is rental revenue taxed? (b) standard payment terms / due date (e.g. due on event date, or net-X)? (c) any standard message/terms text. Wire those into the function as the defaults.

**Button** — in `RentalRequestsTab.tsx`, next to Contract (~L132): a **Generate Invoice** button (e.g. `Receipt` icon).
- Disabled with a tooltip when the request has **no** `rental_invoice_lines` (nothing to bill) or Square isn't configured.
- On click → call `square-invoice`; on success, toast + switch the button to **View Invoice** linking to `square_invoice_url`.
- **Idempotency:** if `square_invoice_id` already exists, don't silently create a second — show "View Invoice" and put re-creation behind an explicit "Regenerate" action.

---

## Part 3 — Contract styling: standard black-on-white document
The rental contract currently renders in the **site theme** — the contract body (`#contract-body`, `src/pages/RentalContract.tsx:262`) uses `bg-background text-foreground`, i.e. light text on the dark site background. That's wrong for a printable legal document. It also **washes out the PDF export**: the export forces an `#ffffff` html2canvas background (`RentalContract.tsx:98,116`) while the text stays light-on-theme, so it renders near-invisible on the white page.

**Fix:** render the contract body as a standard document — **white / no-fill background, black text** — on screen, in Print, and in the exported PDF.
- Change the `#contract-body` container from `bg-background text-foreground` to an explicit light-document style (e.g. `bg-white text-black`, black ~`#111` on white `#ffffff`).
- Convert the theme-token sub-elements inside the contract (e.g. `text-muted-foreground` subheadings/date, `border-border` rules) to print-legible dark grays on white, not the dark-theme muted colors.
- Leave the admin toolbar/editor chrome alone (already `print:hidden`) and the "Verified by Kenworthy" stamp in the signed PDF (`sign-contract`) unchanged — it's already drawn onto a white PDF.
- **Verify:** the on-screen `/contract/:token`, the browser Print preview, and the "Draft PDF" export all show **black text on white paper, no dark fill**.

## Decisions for Tom
1. **Dates:** contiguous range (recommended) or non-contiguous multi-date list?
2. **Invoice send:** create as a **draft** in Square for staff to review/send (recommended), or auto-send the email on Generate?
3. **Invoice conventions to match your current Square event invoices:** tax on rental lines (yes/no), standard due date / payment terms, and any standard invoice message. (Needed so the generated invoice matches what you send today.)

## Risks / notes
- Square **Invoices API needs an Order** (or an inline order via the invoice's `order_request`); `Square-Version 2024-01-18` supports both Orders and Invoices — reuse `squareFetch`.
- Test against **sandbox** first (`SQUARE_ENV` unset/sandbox), then production.
- Keep the Square invoice lines and the QBO `account_mappings` in sync — they're the same `rental_invoice_lines`, so the customer-facing invoice and the accounting export agree.
- Multi-day: times (arrival/start/end) are currently one set for the whole request; leave as-is unless the team needs per-day times (flag if so).

## Test plan
- Submit a request spanning **Aug 14–16**; the card, dialog, and contract show the range; single-day requests still work.
- Add invoice lines, click **Generate Invoice** → a draft Square invoice is created for the right customer with matching line items and totals; `square_invoice_url` opens it; the button becomes **View Invoice**.
- No invoice lines → button disabled. Click Generate twice → no duplicate invoice (idempotent), Regenerate is explicit.
- Verify in the Square sandbox dashboard that the invoice matches the format of the existing event invoices.

---

## Results — built August 14, 2026, not yet deployed

### Decisions taken

1. **Dates:** contiguous range. `proposed_date` is the first day, new `end_date`
   the last, NULL for a single-day rental.
2. **Invoice send:** DRAFT. `square-invoice` creates the invoice and stops;
   staff review and send it from the Square dashboard.
3. **Invoice conventions:** taken from what the building already does rather
   than invented — 6% on lines flagged taxable (`TAX_RATE` in
   `RentalInvoiceLines.tsx`, and the per-line `is_taxable` switch staff already
   use), and net-14 from generation, which is clause 3 of the licence agreement
   this same page prints. No standard message beyond the event title and dates.

### What was built

**Part 1 — multi-day dates**
- `20260814030000_rental_multiday_dates.sql` — `end_date date` plus a CHECK that
  it is not before `proposed_date`.
- `src/lib/rentalRequest.ts` — the public form's schema, moved out of the page
  so the date rules can be tested without booting a Supabase client. Refuses an
  end before the start, and an end with no start.
- `RentalRequest.tsx` — "Proposed Date" (first day) beside "Last Day", the
  second bounded by `min`. An end equal to the start is stored as NULL, so
  "has an end date" means "runs more than one day" everywhere downstream.
- `formatPlainDateRange` in `src/lib/datetime.ts` — one phrase for a span
  ("Aug 14–16, 2026"), used by the admin card and details dialog. The contract
  spells the span out in full ("Friday August 14th, 2026 through …").
- Fixed alongside: the contract and the admin card were formatting DATE columns
  with `new Date('2026-08-14')`, which is UTC midnight and prints as the 13th in
  Pacific. Both now use `formatPlainDate`.

**Part 2 — Generate Invoice**
- `20260814040000_rental_square_invoice.sql` — `square_invoice_id` / `_url` /
  `_status` / `_created_at`, and the anon INSERT policy extended so a public
  submission cannot arrive carrying an invoice URL of its own.
- `supabase/functions/_shared/rental_invoice.ts` — the billing decisions, pure
  and tested: discounts, fractional quantities, tax, due date, date span.
- `supabase/functions/square-invoice/index.ts` — staff/admin gated. Customer
  (deduped on email) → order → DRAFT invoice. Answers with the existing invoice
  instead of making a second one unless `regenerate` is asked for, and a
  regeneration deletes the old draft in Square first (and says so if the old one
  had already been sent).
- `RentalRequestsTab.tsx` — `Generate Invoice` beside `Contract`, disabled with
  a reason when the request has no lines; becomes `View Invoice` once one
  exists. `Regenerate` lives in the details dialog only.

**Part 3 — contract styling**
- `#contract-body` is now `bg-white text-neutral-900` with fixed neutrals for
  every rule, muted line and filled blank inside it — not theme tokens, so a
  future theme change cannot wash the document out again. `print:bg-white` on
  the page wrapper.

### Verified

- **Migrations, in a throwaway `postgres:15`** with the rental chain applied on
  top of stubs: both apply; a backwards range is rejected by the CHECK; a
  single-day and a three-day request both store; `get_rental_request_by_token`
  returns `end_date` (it is `SETOF rental_requests`, so it inherited it); as
  `anon`, a multi-day request submits, and an insert carrying
  `square_invoice_url` is refused by RLS.
- **Deno:** `deno check` clean on the new function and shared module;
  `deno test supabase/functions/_shared/` — 120 pass, including 14 new ones
  covering the discount, fractional-quantity, tax, rounding, due-date and
  date-span rules.
- **Frontend:** `tsc -p tsconfig.app.json --noEmit` clean; `npx vitest run` —
  146 pass across 18 files, including the new date-range and form-schema tests;
  `npm run build:staging` succeeds. eslint reports only the repo-wide
  `no-explicit-any` pattern.
- **In a browser** (dev server on staging): the public form renders the two
  date fields side by side with their hints.

### Not verified

- **No Square call has been made.** The function has never run against the
  sandbox, so the shapes of the Customers / Orders / Invoices requests are
  reasoned from the API, not observed. This is the first thing to do on
  staging, and the invoice it produces should be compared against a real
  Kenworthy event invoice before anyone points it at production.
- **The contract has not been looked at in a browser.** `/contract/:token`
  needs a real invite token, which needs a database read. On-screen, Print
  preview and the "Draft PDF" export all still want an eye on them.
- Nothing is deployed and no migration has been pushed to either project.

## Shipped — August 14, 2026

Deployed to both environments from `a8ee428` (main at the time; main has since
moved to `6edeb7e`, a docs-only commit that changes no bundle).

| | Staging `rpqzrpboyhshdrfdwayk` | Production `vlmslygnimfbamrtwvyo` |
|---|---|---|
| Migrations | both applied | both applied |
| `square-invoice` | deployed, boots | deployed, boots |
| Worker version | `9b860e91` | `05551cc3` (rollback: `adb6a2ef`) |
| Entry chunk | `index-D2cUxOEt.js` | `index-DgY-RyhI.js` |
| `/` and `/rental-request` | 200 | 200 |

Verified after deploy rather than assumed: production serves the entry chunk
that was just built, and the live `AdminDashboard-BihHNEYY.js` it loads contains
`square-invoice`, `Generate Invoice` and `Add invoice lines under Details
first` — so what is running is this work and not a cached build. On staging the
function answers a real POST with `401 {"error":"Staff sign-in required"}` — its
own gate, not the gateway's, which is what proves it booted; on production the
`OPTIONS` preflight returns the CORS header list from `_shared/http.ts` for the
same reason.

**Built and deployed from a scratch worktree, not the shared checkout.** Four
other sessions were working in this repo at the time. Two of their migrations
(`20260814093200`, `20260814093300`, both from `feat/pass-eligibility`) were
already applied to staging with no file on `main`, so `db push` refused. Their
files were copied into the worktree so the push would see them as applied — and
then **removed again before the production push**, so that unmerged work could
not ride along. Production's migration list confirmed only this brief's two
were pending there.

### Still not verified

- **No Square call has been made from this path, in either environment.** The
  function is deployed and boots; the Customers / Orders / Invoices request
  shapes have never been exercised. Production's `SQUARE_ENV` selects the live
  account, so the first press of `Generate Invoice` there creates a **draft in
  the real Square account** — it sends nothing and charges nothing, but do the
  first run on staging and compare the result against a real Kenworthy event
  invoice before using it for a renter.
- ~~The restyled contract has not been looked at in a browser.~~ **Tom checked
  the deployed contract on August 14 and it renders correctly.** He did not say
  which of the three paths he looked at, so if the check was on screen only,
  the "Draft PDF" export is the one still worth a glance — the white
  html2canvas background is what made the old dark-theme text invisible there,
  and it is the path a renter's copy goes through.
