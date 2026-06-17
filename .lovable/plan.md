## Goal

Tag every dollar that moves through the app (revenue and expenses) to a QuickBooks Online account, seeded from your 2025 Statement of Activity, editable in admin, exportable to QBO today, and ready to sync live to QBO later.

## Phase 1 — Chart of Accounts foundation

**New tables**

- `chart_of_accounts` — `code` (e.g. `4100-RNT-GEN`), `name`, `qbo_account_name` (exact QBO match), `qbo_account_id` (nullable, filled after live sync), `account_type` (`income` | `expense` | `other_income` | `other_expense` | `contra_income`), `parent_id` (self-FK for groups like Sponsorships → Film sponsorships), `is_active`, `sort_order`, `notes`.
- `account_mappings` — links app-side sources to a `chart_of_accounts.id`. Source is a `(source_type, source_key)` pair:
  - `source_type` ∈ `ticket_type`, `pass_type`, `concession_item`, `concession_category`, `merch_item`, `rental_line_kind`, `donation_designation`, `sponsorship_program`, `tip`, `sales_tax`, `expense_category`, `payroll_category`, `discount`, `refund`, `square_fee`, `bank_fee`, `interest`, `grant_program`, `capital_line`.
  - `source_key` is a free-text or FK-string (e.g. `film`, `met_live`, `silent_film_fest`, or a specific `concession_items.id`).
  - One row per source; `default = true` means fallback when no specific override.
- `financial_entries` already exists (47 cols) — we add `account_id uuid references chart_of_accounts` and a backfill that resolves it from `account_mappings` based on the entry's source.

**Seed migration** loads the ~60 accounts from your 2025 Statement of Activity, grouped exactly as in the PDF (Contributed income → Sponsorships → Film sponsorships, etc., and Expenditures → Event expenses → Film Expenses → Film Licensing, etc., including contra accounts like Non-profit discounts, Discounts, Returns).

## Phase 2 — Admin: Chart of Accounts editor

New tab under **Analytics → Accounting** (Chart of Accounts):

- Tree view of accounts (collapsible parents).
- Add / rename / deactivate accounts, edit `qbo_account_name`, reorder, set parent.
- Per-source mapping panels:
  - **Ticket types** (Film, Live Event, Met Live, NT Live) → income accounts
  - **Pass types** (Film Pass, Met Live Pass, Movie Night Gift Cards, Silent Film Fest Pass) → income accounts
  - **Concession items / categories** → Concessions income; Discounts contra
  - **Merchandise** → Merchandise / Discounts on Merchandise
  - **Rental line kinds** (General, Live Theater, Fees, Film Licensing Fees, Non-profit discount, Poster print, Marquee, Rental Ticket Sales) → Rentals accounts
  - **Donation designations** (Business, Individual, Monthly, Jar, Marquee Restoration, EOY, Unrestricted Capital, Fall Banquet) → Donations / Capital accounts
  - **Sponsorship programs** (Black History Month, Film, Live event, Met Live, Saturday Cartoons, Silent Film Festival, Summer Family Matinee) → Sponsorships accounts
  - **Tips** → Tips
  - **Sales Tax Collected / Sales Tax (expense)** → tax accounts
  - **Expense categories** (everything under Expenditures: Advertising sub-accounts, Contract labor → Artist fees / Sound tech, Contracted Programming → Met Live / NT Live, Film Expenses → DVD/Bluray / Booking / Licensing / Shipping, Facilities → Maintenance × 3 / Utilities × 3, G&A → Bank fees / Square Fees / Accounting / Insurance / etc., Payroll → Tax / Salaries × 4 / Wages, Capital sub-lines)
- "Default" toggle so unmapped sources fall back to a configured catch-all per source_type.

## Phase 3 — Tagging at the source

Wherever we already write to `financial_entries` (ticket sales, pass sales, concession sales, rental invoices, donations, sponsorships, refunds, tips, sales tax, manual expense entries), resolve `account_id` at write time using `account_mappings`. A trigger on `financial_entries` enforces it: if `account_id` is null at insert, look up the mapping; if no mapping exists, fall back to source_type default; if still null, flag the row `needs_account_review = true` rather than failing.

Rental invoices specifically: each invoice line gets `account_id`, defaulting from `rental_line_kind`, overridable per line by staff before sending.

## Phase 4 — QBO-formatted export

New admin screen **Analytics → Accounting → Export**:

- Date range picker, account filter, "include unmapped" toggle.
- Two output formats:
  1. **Journal Entry CSV** — one row per (account, date), debit/credit, memo. Importable into QBO via Transaction Pro / SaaSAnt or copy-paste into a Journal Entry.
  2. **IIF** — classic QBO desktop format, useful as a universal fallback.
- Group by QBO account name, not internal code, so the file matches the user's QBO chart.
- Warns on any `needs_account_review` rows in range and links to a fix-up queue.

## Phase 5 — Live QBO sync (deferred wiring, built but inactive)

- Edge function `qbo-sync` with stubs for: OAuth start/callback, refresh token storage, account list pull (to populate `qbo_account_id` by exact-name match against `qbo_account_name`), invoice push, journal entry push.
- Requires Intuit Developer app credentials when activated: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` (sandbox/production), `QBO_REDIRECT_URI`. We don't ask for them now — admin screen surfaces a "Connect QuickBooks" button that prompts for these when first clicked.
- Sync queue table `qbo_sync_jobs` with status (`pending`, `synced`, `failed`, `skipped_unmapped`) so nothing pushes to QBO with a missing account.

## What ships in this build

Phases 1–4 fully shipped. Phase 5 scaffolding (tables, edge function shell, admin "Connect" button) included but disabled until you provide Intuit creds.

## Technical notes

- All new tables: `GRANT` to `authenticated` (admin reads via RLS using `has_role`), `service_role` full; only admins can mutate accounts/mappings.
- Seed uses stable `code` values so admins can rename without breaking mappings.
- Contra accounts (Non-profit discounts, Discounts, Returns, Discounts on Merchandise) are negative-balance income — exported as credits to the same parent, debits to contra child, matching how QBO expects.
- Capital section in your PDF mixes income and expense lines; we model those as `other_income` / `other_expense` so they don't pollute operating P&L.
- No client-side price/account trust — `account_id` is resolved server-side from the mapping table.
