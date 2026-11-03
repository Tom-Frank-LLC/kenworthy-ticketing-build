---
brief: qbo-export-from-square
title: The QBO Export books the month from Square's reports, so it matches Square and the Overview
status: built
track: bug
severity: P1
date: 2026-11-03
verified: false
findings: FINDINGS-qbo-export-from-square.md
---

# The QBO Export books the month from Square's reports

## Problem

The accountant reported the month's Journal CSV shows far less income than
Square, and less than the Reporting Overview. See the findings file for why.

## Change

- `square-analytics` gains `mode: "journal"`: three Reporting API reads
  (Sales totals, ItemTransactions by category, Uncategorized by item) shaped by
  `_shared/square-journal.ts` into one balanced entry.
- `account_mappings` gains two source types: `square_category` (key = Square
  reporting category) and `square_item` (key = item name inside Uncategorized).
  Unambiguous categories are seeded (tickets, the stand); everything else is
  left UNMAPPED for the accountant to choose on the export screen.
- `authenticated` is granted INSERT/UPDATE on `account_mappings`. The admin-only
  policy existed since June but was unreachable, so Account Mappings' Save never
  worked.
- The export screen previews the entry and every Square source with an account
  picker, opens on last month, and refuses to export a truncated read.

## Not done here

- **Unverified against live Square.** The Reporting API is production-only, so
  the measure names `item_discount_money`, `returns_gross_amount` and
  `sales_net_amount` (from `/reporting/v1/meta` in Aug 2026, per
  FINDINGS-square-reporting-api.md) have not been exercised. Check October
  against the accountant's Square report before calling this shipped.
- The Overview's Tickets / Concessions / Other split still uses the hard-coded
  category lists in `_shared/square-reporting.ts`. It could read
  `square_category` mappings instead.
- Square processing fees are not in any sales report; they arrive with payouts.
