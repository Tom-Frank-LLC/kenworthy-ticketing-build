---
brief: qbo-export-from-square
title: The QBO Export books the month from Square's reports, so it matches Square and the Overview
status: shipped
track: bug
severity: P1
date: 2026-11-03
verified: true
shipped_in: ["#410"]
shipped_at: 2026-11-03
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

- Every ItemTransactions query (Overview and export) counts only
  `revenue_recognition_state = RECOGNIZED`: unpaid orders were being counted.
- Overview: film passes and rentals are their own groups; categories fall back
  on their number (1–5 stand, 6 tickets, 9 passes), so `4 Cocktails & Wine`
  is concessions. Comps and service charges get their own journal treatment.

## Not done here

- **Not yet compared with the accountant's Square report.** Measured against
  Square's own Sales cube instead (see findings).
- Whether the unpaid duplicate orders come from this build's checkout.
- Square processing fees are not in any sales report; they arrive with payouts.
