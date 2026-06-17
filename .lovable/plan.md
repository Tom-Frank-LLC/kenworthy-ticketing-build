# Labor & Time Clock — Square-backed staff management

## Context on "real vs sandbox"

Yes — your Square sandbox account is a real Square account, just sandboxed. When you signed up for Square dev access, Square provisioned a paired **Production account** (same login, same dashboard, toggle in the top-left). Sandbox uses fake locations, fake team members, and fake cards; Production is the live business. Same APIs, different tokens (`SQUARE_SANDBOX_ACCESS_TOKEN` vs a future `SQUARE_PRODUCTION_ACCESS_TOKEN`). Code we write against sandbox endpoints will work against production by swapping the base URL + token — no app rewrite.

Caveat we already know: a few APIs (notably **Labor scheduled shifts** and parts of **Team wages**) have partial sandbox coverage. We'll build defensively so the UI degrades gracefully when sandbox returns empty/unsupported, and lights up automatically in production.

## What we'll build

A new admin tab **"Labor"** (admin-only) with three sub-sections:

### 1. Team Roster
- List Square team members (name, email, role, hourly wage, active/inactive)
- Pulled live from Square `Team API` → `SearchTeamMembers`
- Read-only for v1 (creating team members in Square is better done in the Square dashboard)
- Map each Square `team_member_id` to a Lovable `profiles.id` via a new `staff_square_links` table so POS sales can already attribute correctly

### 2. Time Clock (Punch In / Out)
- Big "Clock In" / "Clock Out" / "Start Break" / "End Break" buttons on the POS for the currently signed-in staff user
- Backed by Square `Labor API` → `CreateShift` / `UpdateShift` (open shift = `end_at` null)
- Current shift status badge in POS header ("On the clock since 4:12 PM")
- Admin view: today's open shifts across all staff, with force-close

### 3. Timecards & Hours
- Date-range picker (default: this pay period)
- Table of shifts per staff member: clock-in, clock-out, breaks, total hours, wage × hours = labor cost
- CSV export
- Pulled from `Labor API` → `SearchShifts`

### 4. (Stretch, behind a feature flag) Scheduling
- Read scheduled shifts from `Labor API`
- Calendar view by week
- Create/edit scheduled shifts — **sandbox-limited**, so we'll show a banner: "Scheduling writes require production Square account"

## Technical details

**New edge function** `supabase/functions/square-labor/index.ts`
- Mirrors `square-terminal` pattern: admin-only JWT check, sandbox base URL, graceful sandbox-fallback responses
- Actions: `list_team`, `list_shifts`, `current_shift`, `clock_in`, `clock_out`, `start_break`, `end_break`, `force_close_shift`, `list_scheduled_shifts`

**New migration**
```sql
CREATE TABLE public.staff_square_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  square_team_member_id text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);
-- GRANTs + RLS: admin full, staff select own
```

**New UI files**
- `src/components/admin/LaborTab.tsx` — tab container with sub-tabs (Roster / Timecards / Scheduling)
- `src/components/admin/LaborRoster.tsx`
- `src/components/admin/LaborTimecards.tsx`
- `src/components/pos/TimeClockWidget.tsx` — punch in/out card shown at top of `StaffPOS`
- Add "Labor" tab to `AdminDashboard.tsx`

**Sandbox behavior**
- `list_team` returns Square sandbox seed team members (Square creates a few by default)
- `clock_in`/`clock_out` work fully in sandbox against Labor API
- `list_scheduled_shifts` returns `{ simulated: true, shifts: [] }` if endpoint 4xxs in sandbox, with banner in UI
- Wage data falls back to `$0.00` with "Set in production" tooltip if `Team Wages` returns nothing

## What "flipping to production" will require later
1. Add `SQUARE_PRODUCTION_ACCESS_TOKEN` + `SQUARE_PRODUCTION_LOCATION_ID` secrets
2. Add an env flag `SQUARE_ENV=production` read by the edge function to switch base URL + token
3. Re-link each Lovable staff user to their real production `team_member_id` (one-time admin action — UI we're building already supports this)
4. Test punch-in flow end-to-end on one staff member before rolling out

## Scope NOT included in v1
- Editing team members from inside Lovable (use Square dashboard)
- Payroll runs / paystubs (Square Payroll is a separate paid product with its own API)
- Tip distribution
- Schedule publishing & shift-swap requests
- Mobile-optimized standalone time clock kiosk (POS works on tablets, that's enough for v1)
