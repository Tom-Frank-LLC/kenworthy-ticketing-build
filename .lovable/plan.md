# Square Plus optimization plan

A focused build that turns the admin hub into a labor/scheduling control center on top of Square Plus, with a clean push to QuickBooks Payroll. We'll extend the existing `square-labor` edge function rather than introduce a new integration surface.

## What you'll get

1. **Scheduling tab** in Admin Dashboard — build/publish weekly shifts per staff member, drag to assign, copy last week.
2. **Staff side** — in the POS time-clock widget, staff see their upcoming shifts and can request a swap or time-off; managers approve in admin.
3. **Labor vs sales dashboard** — daily/weekly labor cost (from Square Shifts) plotted against ticket + concession revenue, labor % KPI.
4. **Wage & tip rules editor** — per-role wage defaults, OT threshold (default 40 hr/wk Idaho), tip pool method (pooled equally / by hours / off).
5. **QBO payroll export** — one-click "Send approved timecards to QuickBooks" for a pay period; pushes hours per employee against the existing QBO connection. Status pill shows last export.

## Architecture

```text
Admin Dashboard
 └─ Labor tab (new)
     ├─ Schedule builder        → square-labor: shifts.upsert / publish
     ├─ Swap/time-off inbox     → public.shift_requests (new table)
     ├─ Labor vs Sales report   → square-labor: shifts.search + local sales
     ├─ Wage & tip rules        → public.labor_settings (new table)
     └─ Payroll export to QBO   → qbo-sync: payroll.timecards.push
```

### Backend changes

- Extend `supabase/functions/square-labor/index.ts` with actions:
  `list_team`, `list_shifts`, `upsert_shift`, `publish_week`, `approve_timecard`, `labor_summary`.
  All sandbox-safe; reuses existing `SQUARE_SANDBOX_*` secrets.
- Extend `supabase/functions/qbo-sync/index.ts` with `payroll_export` action that maps Square team members → QBO employees (via `staff_square_links`) and posts a `TimeActivity` per shift.
- New tables (migration):
  - `shift_requests` — type (swap/time_off), shift_id, requester user_id, target user_id, status, note.
  - `labor_settings` — singleton row: ot_weekly_hours, tip_method, role_wage_defaults jsonb.
  - `payroll_exports` — period_start, period_end, qbo_batch_id, status, totals.

### Frontend changes

- `src/components/admin/LaborTab.tsx` — promote from roster-only to four sub-tabs: **Roster · Schedule · Requests · Payroll**.
- `src/components/admin/labor/ScheduleBuilder.tsx` (new) — week grid, click-to-add shift, publish button.
- `src/components/admin/labor/LaborVsSales.tsx` (new) — chart pulling shifts + tickets + concession_sales.
- `src/components/admin/labor/WageTipRules.tsx` (new) — settings form.
- `src/components/admin/labor/PayrollExport.tsx` (new) — period picker, preview table, "Push to QuickBooks" button.
- `src/components/pos/TimeClockWidget.tsx` — add upcoming-shifts list + "Request swap / time off" buttons.

## Out of scope (call out, don't build)

- Switching to Square Payroll (you chose to keep QBO Payroll).
- Real Square production credentials — stays in sandbox per existing constraint.
- Mobile push for swap requests — in-app inbox only.

## Order of work

1. Migration: `shift_requests`, `labor_settings`, `payroll_exports` (+ grants, RLS, audit triggers).
2. Extend `square-labor` edge function with schedule + summary actions.
3. Build LaborTab shell + Roster (existing) + Schedule sub-tab.
4. Wire staff-side shift view & swap requests in TimeClockWidget.
5. Labor vs Sales chart + Wage/Tip rules.
6. Extend `qbo-sync` with payroll export, then build PayrollExport UI.
7. Smoke test end-to-end in sandbox.

Approve and I'll start with step 1.
