# Brief (for Claude Code / QA): Square Labor — end-to-end functionality & wiring test

**Status:** 🟡 Test plan — to run tomorrow alongside the Square production cutover
**Date:** August 13, 2026
**Requested by:** Tom — the Square Labor suite has never been tested; get it ready to test end to end.

## What "Square Labor" is here
A full labor suite under Admin → Labor (`LaborTab`), part Square-backed and part local:

| Sub-tab / surface | Backed by | `square-labor` action(s) |
|---|---|---|
| **Roster** (`LaborRoster`) — team + link to staff accounts | Square + `staff_square_links` | `list_team` |
| **Timecards** (`LaborTimecards`) | Square | `list_shifts`, `list_team` |
| **Scheduling** (`ScheduleBuilder`) | Square | `list_scheduled_shifts`, `list_team`, create shift |
| **Labor vs Sales** (`LaborVsSales`) | Square | `labor_summary` |
| **Payroll Export** (`PayrollExport`) | Square + `staff_square_links` + QBO | `list_shifts`, `list_team` |
| **Shift Requests** (`ShiftRequestsInbox`) | **local** `shift_requests` table | — |
| **Wage/Tip Rules** (`WageTipRules`) | **local** `labor_settings` table | — |
| Staff self-view | Square | `my_upcoming_shifts` |

Function endpoints (`square-labor`): `/team-members/search`, `/labor/team-member-wages/search`, `/labor/shifts/search`, scheduled shifts, labor summary.

## ⚠️ Critical dependency & a misleading banner (read first)
- **`square-labor` is hardcoded to sandbox** (see `BRIEF-square-production-cutover.md`): fixed `squareupsandbox` base, reads only `SQUARE_SANDBOX_ACCESS_TOKEN` / `SQUARE_SANDBOX_LOCATION_ID`. The `LaborTab` banner says these "switch to production automatically once live credentials are added" — that is **not true for this function** until it's moved onto the shared `_shared/square.ts` config (the cutover-brief fix). Decide the test environment accordingly:
  - **Sandbox now (recommended first pass):** exercises all wiring, but needs the Square **sandbox** account seeded with team/wages/shifts (Square sandbox returns an **empty team** by default — the function then returns `{ simulated: true, team_members: [] }` and every tab shows empty).
  - **Production:** only meaningful **after** the cutover fix lands and the real team/wages/shifts exist in the production Square account. If you test labor in production tomorrow, sequence the `square-labor` fix + `SQUARE_PRODUCTION_*` secrets **before** these tests.

## Prerequisites
1. `square-labor` deployed to the target project; the tester has an **admin** role (several actions are admin-gated: `list_scheduled_shifts`, create shift, etc.).
2. Secrets present for the chosen env: `SQUARE_SANDBOX_ACCESS_TOKEN` + `SQUARE_SANDBOX_LOCATION_ID` (sandbox) or `SQUARE_PRODUCTION_*` (after fix).
3. **Square account seeded** (this is the big one): at least 2–3 **team members**, each with a **wage** (hourly rate + title), a **location**, some **completed shifts/timecards** in a date range, and at least one **scheduled shift**. Without this, tabs are correctly empty and nothing can be verified.
4. **QBO connected** (for the Payroll Export test) — see the accounting/QBO setup.

## Test steps (each names how to verify)

### A. Roster + account linking (`LaborRoster`)
1. Open Admin → Labor → Roster. Expect the seeded Square team members with name, email, wage, status. (If it shows the "sandbox returned no team data" note, the Square account isn't seeded — fix prerequisite 3.)
2. Link a team member to a platform staff account via the dropdown → toast "Link updated".
3. DB: `select * from staff_square_links;` → a row mapping `user_id` ↔ `square_team_member_id`. Re-link to a different member → the old link for that member/user is replaced (unique on both). Unlink → row removed.

### B. Timecards (`LaborTimecards`)
1. Pick a date range with seeded shifts. Expect timecards (member, clock-in/out, hours) matching the Square dashboard for that range.
2. Empty range → empty state, no error.

### C. Scheduling (`ScheduleBuilder`)
1. Expect existing scheduled shifts (`list_scheduled_shifts`) and the team list.
2. Create a scheduled shift for a linked member → success; it appears here **and** in the Square dashboard's scheduling.
3. Admin-gate check: a **staff-only** (non-admin) account gets "Admin required" for the scheduling actions.

### D. Labor vs Sales (`LaborVsSales`)
1. Choose a period with both shifts and ticket/concession sales. Expect a labor-cost total (`labor_summary`) shown against sales for the same window; sanity-check the labor number against Timecards × wages.

### E. Payroll Export (`PayrollExport`)
1. With shifts + linked members + QBO connected, run the export. Expect a payroll summary per employee (hours × wage) and a push/preview to QuickBooks.
2. Verify the QBO side received it (or a clear "QBO not connected" message if it isn't).

### F. Shift Requests (`ShiftRequestsInbox`) — local
1. Have a staff member submit a shift request (wherever staff submit; confirm the entry path). As admin, see it in the inbox with the requester's name.
2. Approve / deny → status updates in the `shift_requests` table.

### G. Wage/Tip Rules (`WageTipRules`) — local
1. Edit and save rules → persists to `labor_settings`; reload shows the saved values.

### H. Staff self-view (`my_upcoming_shifts`)
1. Signed in as a **linked** staff account, confirm the staffer sees their own upcoming shifts. An **unlinked** account returns `{ linked: false }` and an empty/prompt state (verify it's handled gracefully).

## What to watch for (likely failure points)
- **Empty everywhere** → Square account not seeded (prereq 3), or wrong `SQUARE_*_LOCATION_ID`.
- **500 "Square sandbox credentials not configured"** → the sandbox token/location secret is missing (or, in prod, the function hasn't been moved off the sandbox-only reads).
- **403 "Admin required" / "Staff access required"** → tester's role; confirm `user_roles`.
- **Wages/shifts blank but team loads** → sandbox often returns members without wages/shifts unless explicitly seeded; note "simulated"/empty handling vs a real error.
- **Payroll export fails** → QBO not connected, or unlinked team members (no `user_id` mapping).
- Cross-check the **cutover brief**: don't test labor in production until `square-labor` is on the shared config and `SQUARE_ENV=production` + `SQUARE_PRODUCTION_*` are set.

## Recommended sequence for tomorrow
1. **Sandbox pass first:** seed the Square sandbox (team, wages, shifts, one scheduled shift), then run A–H against staging (`SQUARE_ENV` sandbox). This proves the wiring independent of the production cutover.
2. **Then production:** after the `square-labor` shared-config fix + production secrets (cutover brief), re-run A–E against the real production team to confirm live data flows.

## Deliverable
A short pass/fail note per test (A–H) with the failure text where any fail, so gaps can be turned into fix tickets. Any code gaps found (e.g. an action that errors, a tab that never renders data) become follow-up briefs.
