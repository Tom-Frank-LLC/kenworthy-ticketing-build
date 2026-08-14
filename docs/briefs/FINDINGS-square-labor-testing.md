# FINDINGS: Square Labor — end-to-end functionality & wiring test

**Status:** ✅ Tested, then fixed — all defects below are resolved and re-verified against live Square
**Date run:** August 14, 2026
**Environment:** staging (`rpqzrpboyhshdrfdwayk`), Square **sandbox**
**Brief:** [BRIEF-square-labor-testing.md](BRIEF-square-labor-testing.md)

> The test run is recorded below as it happened (3 pass, 4 fail, 1 pass-with-caveat).
> **[Fixes applied](#fixes-applied--re-verified)** at the end records what changed and
> the evidence each fix now works. Not yet deployed to production.

---

## Headline

The Labor suite has never worked. It is not a seeding problem — **five separate
Square API calls are malformed**, and every one of them is caught and reported
to the operator as "the sandbox has no data yet." That message is why this went
unnoticed: the tabs look plausibly empty rather than broken. Four of the five
calls fail identically in production, so the pending Square cutover will not fix
any of them.

Separately, the suite is **dead in production right now**: `square-labor` reads
only `SQUARE_SANDBOX_*`, and production has no such secrets, so every action
returns HTTP 500.

Everything not backed by the Square Labor API — account linking, shift requests,
wage/tip rules, the role gates — works correctly.

---

## Environment blockers found before any test could run

| # | Finding | Evidence |
|---|---|---|
| **B1** | **Production `square-labor` returns 500 on every action.** It is deployed (v14) but reads only `SQUARE_SANDBOX_ACCESS_TOKEN` / `SQUARE_SANDBOX_LOCATION_ID`; production holds only the unprefixed `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID` / `SQUARE_APPLICATION_ID`. The credential check is the first thing in the handler, so nothing else runs. | `POST /functions/v1/square-labor` → `HTTP 500 {"error":"Square sandbox credentials not configured"}` |
| **B2** | **`square-labor` was not deployed to staging at all** (prerequisite 1 unmet). | `HTTP 404 {"code":"NOT_FOUND"}` → **resolved: deployed during this run** |
| **B3** | **`qbo-sync` is deployed to neither project.** It exists in the repo only. Payroll Export's QBO status check and push both target it. | staging `HTTP 404`, production `HTTP 404` |
| **B4** | **Square sandbox is essentially unseeded** (prerequisite 3 unmet): 1 team member (the default "Sandbox Seller"), a wage record with a title but **no hourly rate**, **0 timecards**, **0 scheduled shifts**. | `list_team` → 1 member, `wage: null` |

B4 means the seeding prerequisite in the brief was never met — but note that
seeding it would **not** have made these tabs work. The defects below are
independent of data.

---

## Test results

| Test | Result | Note |
|---|---|---|
| **A. Roster + account linking** | ⚠️ **PASS (degraded)** | Team loads; wage column permanently blank (D2) |
| **B. Timecards** | ❌ **FAIL** | Square 400, masked as "no shift data" (D1) |
| **C. Scheduling** | ❌ **FAIL** | List 400 (D3); create 400 reported as **success** (D4); delete 404 reported as **success** (D5). Admin gate passes. |
| **D. Labor vs Sales** | ❌ **FAIL** | Labor cost structurally $0 for two independent reasons (D1 + D2) |
| **E. Payroll Export** | ❌ **FAIL** | `qbo-sync` not deployed (B3); preview would be empty/zero regardless (D1 + D2) |
| **F. Shift Requests** | ✅ **PASS** | Full submit → inbox → approve cycle verified |
| **G. Wage/Tip Rules** | ✅ **PASS** | Persists and reloads |
| **H. Staff self-view** | ❌ **FAIL (frontend)** | Function returns the shift correctly; the widget **crashes** rendering it (D6) |

### A. Roster + account linking — PASS (degraded)

1. Roster renders the Square team, `simulated: false`. Only the default sandbox
   seller exists (B4).
2. **Wage column always reads "Set in production."** Not a sandbox limitation —
   see **D2**; the wage endpoint being called does not exist.
3. `staff_square_links` verified live as admin: insert → `HTTP 201` with the row
   returned; select back → row present; delete → row gone. Uniqueness holds —
   the migration declares `square_team_member_id text NOT NULL UNIQUE` and
   `UNIQUE(user_id)`, and `LaborRoster.setLink` deletes both sides before
   inserting, so re-linking replaces cleanly.

### B. Timecards — FAIL

```
Function returns: {"simulated":true,"shifts":[],"note":"Sandbox returned no shift data"}
Square actually returned: HTTP 400
  {"code":"EXPECTED_STRING","detail":"Expected a string value (line 1, character 68)",
   "field":"query.filter.start.start_at","category":"INVALID_REQUEST_ERROR"}
```

The tab can never show a timecard. Empty-range behaviour is untestable until
this is fixed, because every range is "empty."

### C. Scheduling — FAIL (admin gate passes)

1. **List** — `{"simulated":true,"scheduled_shifts":[],"note":"Scheduled shifts not available in sandbox. Will activate in production."}`
   masking:
   ```
   HTTP 400 {"code":"VALUE_TOO_HIGH","detail":"Field must not be greater than 50","field":"limit"}
   ```
   The note is false twice over: scheduled shifts *are* available in sandbox
   (I created and read one), and this will **not** start working in production.

2. **Create** — the UI toasts **"Draft shift added"** and nothing is created.
   The function returns HTTP 200, so `supabase.functions.invoke` reports no
   error and `ScheduleBuilder.saveShift` takes the success branch:
   ```
   {"simulated":true,"note":"Scheduled-shift writes are not supported in this sandbox; persisted locally.",
    "echo":{...},"square_status":400}
   ```
   masking:
   ```
   HTTP 400 {"code":"BAD_REQUEST","detail":"Must supply a valid location on a ScheduledShift.",
             "field":"scheduled_shift.draft_shift_details.location_id"}
   ```
   "persisted locally" is untrue — there is no local scheduled-shift table. The
   shift is silently dropped.

3. **Admin gate — PASS.** Staff-only account → `HTTP 403 {"error":"Admin required"}`
   on `upsert_scheduled_shift` and `publish_week`. Non-staff account →
   `HTTP 403 {"error":"Staff access required"}` on `list_team`.
   *Correction to the brief:* `list_scheduled_shifts` is **not** admin-gated —
   staff can read the schedule (verified 200). That looks intentional.

### D. Labor vs Sales — FAIL

```
{"series":[],"totals":{"labor_cost":0,"revenue":0,"labor_pct":null,"hours":0},"simulated":true}
```

Two independent causes, both of which must be fixed: shifts never load (D1), and
even with shifts the wage map is always empty (D2), so `labor_cost` would remain
$0. The sales half of the query is fine but had nothing to pair with. The tab
degrades to "No data in range yet."

### E. Payroll Export — FAIL

`qbo-sync` returns 404 on staging **and** production, so the connection badge is
permanently "QuickBooks not connected" and the button falls back to "Stage
export". Pressing it fetches the same 404 and toasts a bare `Push failed` — the
brief's expected clear "QBO not connected" message does not appear.

Even with `qbo-sync` deployed, the preview table is built from `list_shifts`
(empty — D1) and per-member `wage.hourly_rate_cents` (never populated — D2), so
every line would be 0.00 hrs / $0.00.

### F. Shift Requests — PASS

**Entry path confirmed:** `src/components/pos/TimeClockWidget.tsx:109` — the POS
time-clock widget's "Request" button, not an admin surface.

Verified live: staff account inserts → `HTTP 201`; admin reads the inbox → row
present; approve → `HTTP 200`, `status: "approved"`; requester name resolves
from `profiles`.

Gap (minor, **D9**): `ShiftRequestsInbox.decide()` writes `status` and
`resolved_at` but never `resolved_by`, so who approved a request is never
recorded even though the column exists.

### G. Wage/Tip Rules — PASS

`labor_settings` read as admin; PATCH `ot_weekly_hours=40→38`, `tip_method=off→by_hours`
→ `HTTP 200` with values persisted and `updated_at` bumped; reverted to 40/off.

### H. Staff self-view — FAIL (frontend)

- **Unlinked account: PASS.** `{"linked":false,"shifts":[]}`; the widget shows
  "Your account isn't linked to a Square team member yet." Handled gracefully.
- **Linked account: FAIL.** The function is correct here — it is the one
  scheduled-shift call that survives, because it uses `limit: 50`. Verified live,
  it returned the real shift. But the payload is nested:

  ```json
  {"linked":true,"shifts":[{"id":"HRPREFFDZ8XHR",
    "draft_shift_details":{"team_member_id":"...","start_at":"2026-08-20T18:00:00Z",
                           "end_at":"2026-08-20T23:00:00Z","notes":"QA diag"},
    "version":1}]}
  ```

  `TimeClockWidget.tsx:52` maps `s.start_at` / `s.end_at` off the top level →
  both `undefined` → `format(new Date(undefined), 'EEE MMM d')` at line 176
  throws `RangeError: Invalid time value`. **The staff time-clock widget crashes
  for any linked staffer who has an upcoming shift.** This is reachable today.

---

## Code defects — follow-up tickets

Each was confirmed against the live Square sandbox by proxying the exact
shipped request and then the corrected one.

| # | File / line | Defect | Fix (verified working) |
|---|---|---|---|
| **D1** | `square-labor/index.ts:269`, `:403` | Shift-search filter is double-nested: `filter.start.start_at = {start_at, end_at}`. Square wants a string there. → `400 EXPECTED_STRING` | `filter.start = { start_at: begin, end_at: end }` → verified `200` |
| **D2** | `square-labor/index.ts:121`, `:407` | `POST /labor/team-member-wages/search` does not exist → `404 NOT_FOUND`. In `listTeam` the failure is swallowed by `try/catch`, so there is no signal at all. | `GET /v2/labor/team-member-wages?limit=100` → verified `200`, returns the wage record |
| **D3** | `square-labor/index.ts:295`, `:368` | `limit: 200` on scheduled-shift search; Square caps it at 50 → `400 VALUE_TOO_HIGH` | `limit: 50` → verified `200` |
| **D4** | `square-labor/index.ts:314-325` | Create sends flat `scheduled_shift.{location_id,team_member_id,start_at,…}` → `400 BAD_REQUEST` | Nest under `scheduled_shift.draft_shift_details` → verified `200`, shift created and searchable |
| **D5** | `square-labor/index.ts:345-348` | `DELETE /labor/scheduled-shifts/{id}` does not exist → `404` (tried API versions 2024-01-18 and 2025-06-18) | `PUT` with `draft_shift_details.is_deleted = true` → verified `200` |
| **D6** | `ScheduleBuilder.tsx:125`, `TimeClockWidget.tsx:52` | Both read flat `start_at`/`end_at`/`team_member_id`/`draft` from a payload that nests them under `draft_shift_details`. Causes a live crash in the time-clock widget (H), and will crash the Scheduling grid the moment D3 is fixed (`s.start_at.slice(0,10)` on `undefined`). | Read through `draft_shift_details` (and `published_shift_details` once publishing works) |
| **D7** | `square-labor/index.ts` throughout | **Error masking.** Every Square failure becomes `HTTP 200 {simulated:true, note:"…sandbox…"}`. Three 400s and two 404s were invisible until instrumented, and D4/D5 surface in the UI as *success toasts*. | Return the real status and Square error body; reserve `simulated` for genuine empty results. At minimum, stop toasting success on `simulated:true` writes (`ScheduleBuilder.tsx:78`, `:90`). |
| **D8** | `LaborTab.tsx:19`, `square-labor/index.ts:9,36-37` | Banner claims these "switch to production automatically once live credentials are added." False — the function hardcodes `connect.squareupsandbox.com` and reads only `SQUARE_SANDBOX_*`. This is B1's root cause. | Move onto `_shared/square.ts` (`loadSquareConfig()` / `squareFetch()`), as every other Square function already does; then the banner becomes true |
| **D9** | `ShiftRequestsInbox.tsx:59` | `resolved_by` never written | Set `resolved_by: user.id` alongside `status` |

**Order to fix:** D8 first (it is the cutover-brief fix and unblocks production
at all), then D1 + D2 (they unblock B, D, E together), then D3/D4/D5 + D6 as one
scheduling change, with D7 applied as you touch each call site.

---

## Revised sequence for the production cutover

The brief's "sandbox pass first, then production" ordering still holds, but the
sandbox pass has now been run and the answer is that the wiring itself is broken.
Retesting in production before D1–D6 land would only reproduce these same five
failures against live data.

1. Land **D8** (`square-labor` onto `_shared/square.ts`) — until then the suite
   is 500-ing in production regardless of what else is fixed.
2. Land **D1–D7**.
3. Deploy `qbo-sync` (**B3**) if Payroll Export is in scope for launch; otherwise
   hide the tab rather than ship a button that always fails.
4. Re-run A–E against staging/sandbox. With D1–D5 fixed, seed the sandbox
   (2–3 members with hourly rates, a few closed shifts, one scheduled shift) —
   only now is seeding actually the gating factor.
5. Then production, with `SQUARE_ENV=production` + `SQUARE_PRODUCTION_*` set.

---

## How this was tested (reproducible)

- Admin/staff sessions minted against staging with
  `POST /auth/v1/admin/generate_link` (type `magiclink`, service-role key) →
  `POST /auth/v1/verify` with the returned `token_hash`. No email is sent.
- Role gates checked with three subjects: superadmin (satisfies admin+staff via
  `has_role` hierarchy), a purpose-made `staff`-only account, and an existing
  `regular_user`.
- Raw Square behaviour established with a temporary `square-labor-diag` edge
  function that proxied arbitrary path/method/body to
  `connect.squareupsandbox.com` and returned the untouched status and body —
  the only way to see what `square-labor` was swallowing. **Deleted after the
  run** (confirmed absent from `functions list`).

## Fixes applied — re-verified

`square-labor/index.ts` was rewritten onto `_shared/square.ts`; the frontend
changes are confined to the Labor components. Every fix was re-run against the
live Square sandbox after deploying to staging.

| Was | Now | Evidence |
|---|---|---|
| D1 shift filter double-nested | `filter.start = {start_at, end_at}` | `list_shifts` → `200 {"shifts":[…]}` with real rows |
| D2 wages via nonexistent search endpoint | `GET /labor/team-member-wages`, paged | roster wage resolves (`{"title":"Owner"}`), `wages_error: null` |
| D3 scheduled search `limit: 200` | `limit: 50` + cursor paging | `list_scheduled_shifts` → `200` with the shift |
| D4 flat create payload, no `job_id` | nested `draft_shift_details`, `job_id` resolved from the member's wage record | create → `200`, shift returned with `draft: true` |
| D5 `DELETE` (404) masked as success | `PUT` with `is_deleted: true` | delete → `200 {"ok":true}`; missing fields → real `400` |
| D6 frontend read flat fields off nested payload | function flattens both draft and published details before returning | `my_upcoming_shifts` returns usable `start_at`/`end_at`; widget no longer crashes |
| D7 every failure → `200 {simulated:true}` | `square()` throws; handler answers `502` with Square's own message | see the two new defects below — both were invisible before |
| D8 hardcoded sandbox host + `SQUARE_SANDBOX_*` | `loadSquareConfig()` / `squareFetch()`; response carries `environment` | banner rewritten; Timecards labels sandbox from live data |
| D9 `resolved_by` never written | set from the acting admin | — |
| `publish_week` wrote a `draft: false` field Square does not have | `POST /labor/scheduled-shifts/bulk-publish` | `{"published":2,"total":2,"failures":[]}` |
| labor cost used the member's *current* wage | prefers the wage Square stamped on the shift | see the end-to-end check below |

**End-to-end arithmetic check.** Seeded one shift — 5h with a 30-minute unpaid
break at $18.50/hr — and asked for a labor summary:

```
totals: {"labor_cost": 83.25, "revenue": 0, "labor_pct": null, "hours": 4.52}
  2026-08-12  hours 4.5  labor $83.25
```

4.5h × $18.50 = **$83.25**. The unpaid break is deducted, and the rate came off
the shift rather than the roster. Clock-in → break → clock-out → timecard was
also exercised as the real staff path.

### Two more defects, surfaced only because errors stopped being masked

- **Breaks were impossible.** `start_break` omitted `break_type_id`, which Square
  requires — it answered `400 Field must not be blank`, previously swallowed.
  Fixed: the function now looks up the location's configured break types and
  uses one. When a merchant has none configured it says so in words
  ("Add one in the Square dashboard (Team → Settings → Breaks)") rather than
  passing Square's blank-field error through. **Kenworthy has no break types
  configured in production** — that needs doing in the Square dashboard before
  staff can take breaks.
- **Scheduling requires a job per team member.** Square rejects a scheduled
  shift whose team member has no job assigned. The function now resolves it from
  the wage record and, failing that, returns "This team member has no job
  assigned in Square." Worth confirming every real staff member has a job before
  the first production schedule is built.

### Square constraints worth knowing before go-live

- **Scheduling more than 10 days ahead requires a Team Plus subscription.**
  Square: *"A subscription to Team Plus is required to schedule shifts more than
  10 days in the future."* If Kenworthy is not on Team Plus, the schedule builder
  works only inside a 10-day window. This is a plan question, not a code one.
- Scheduled shifts have **no GET-one and no DELETE** endpoint, and their search
  caps at 50 per page (shifts cap at 200). Both are now handled.

### Still outstanding

- **`qbo-sync` is deployed nowhere** (B3). Payroll Export's preview now computes
  correctly, but the push target does not exist. Deploy it, or hide the tab.
- **Production still needs `SQUARE_ENV` + credentials.** The function no longer
  hardcodes sandbox, so production will work as soon as the secrets are set —
  but it has not been deployed to production yet.

### State left behind

- ✅ `square-labor` deployed to **staging** with the fixes (it was missing
  entirely before — B2). **Not deployed to production.**
- ✅ `square-labor-diag`, the temporary raw-Square proxy, deleted.
- ✅ Supabase test data removed: `staff_square_links` empty, `shift_requests`
  empty, `labor_settings` back to 40 / `off`, QA staff account and its role row
  deleted, `user_roles` back to its original two rows.
- 🌱 **Deliberately left in the Square sandbox as seed data**, so the follow-up
  pass has something to read: one realistic timecard (2026-08-12, 5h with a
  30-minute unpaid break at $18.50/hr), two published scheduled shifts, and one
  "Rest Break" break type. Two zero-length clock-in/out shifts from testing were
  deleted. One older scheduled shift is flagged `is_deleted` — Square has no
  hard delete for those.
- ✅ Production was **read-only** throughout (a single unauthenticated 500 probe).
- 📝 Repository changes, uncommitted: `supabase/functions/square-labor/index.ts`,
  `LaborTab.tsx`, `LaborRoster.tsx`, `LaborTimecards.tsx`,
  `labor/ScheduleBuilder.tsx`, `labor/ShiftRequestsInbox.tsx`,
  `labor/PayrollExport.tsx`, and this document.
  Checks: `tsc -p tsconfig.app.json --noEmit` clean, `deno check` clean,
  146 vitest and 122 deno tests pass. (`_shared/tickets_test.ts` has a
  pre-existing `PNG.sync` type error, untouched by this work.)
