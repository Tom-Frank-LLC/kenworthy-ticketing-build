---
brief: backend-cleanup-team-analytics
title: The admin Team tab holds one Team Members sub-tab with roles, linking and bios; Labor vs Sales lives in Analytics; the two pie charts are ranked bars
status: shipped
track: ux
severity: P2
date: 2026-09-24
shipped_in: ["#342"]
shipped_at: 2026-09-24
verified: true
---

# Brief (for Claude Code): Back-end cleanup — Team section, Accounts & Roles, and Analytics charts

**Status:** 🟡 A grouped cleanup across the admin dashboard: a rename, a consolidation, two removals, a route/nav change, and two chart rebuilds. Mostly moving and deleting existing pieces — the care items are (1) keeping the accounts/roles logic in **one** place when it moves, (2) a factual correction about the "gone" poster function, and (3) rebuilding the two charts to the right *form* rather than tweaking the broken pies.
**Date:** September 24, 2026
**Requested by:** Tom — clean up the back end: rename Staff→Team, fold Team & Linking + Bios into "Team Members", pull role management + invite into it, delete the standalone Accounts & Roles (admin) page and the poster re-fetch, keep the superadmin page as-is, move Labor vs Sales into Analytics, delete Wage & Tip Rules, and fix the Revenue-by-Category and Genre-Popularity charts.

## Current state (verified, build `7451fbd`)
- **The "Staff" tab is the labor section.** `AdminDashboard.tsx:772` — `{ value: 'labor', label: 'Staff', icon: Clock, show: isAdmin }`. Its content (`TabsContent value="labor"`, L1505) renders `<LaborTab />`. The lit marquee section header above the bar reads `current.label` (L782), so renaming the label updates the header automatically.
- **`LaborTab.tsx` has eight sub-tabs** (L32–48): Timecards, Scheduling, Requests, **Labor vs Sales** (`LaborVsSales`), **Wage & Tip Rules** (`WageTipRules`), Payroll → QBO, **Team & Linking** (`LaborRoster`), **Bios** (`StaffBios`). The intro blurb (L26) names "labor-vs-sales" and calls out "Bios is the exception".
- **Accounts & Roles is one page at two routes.** `App.tsx:145` `/admin/accounts` and `App.tsx:184–186` `/superadmin` both render `AccountsRoles.tsx`. The component adapts by role via `useAuth` (`isSuperadmin` ? every role + invite-any : grant/revoke lower roles + invite staff/host only; protected accounts off-limits) — `AccountsRoles.tsx:20–52, 91–92`. The dashboard header has an **Accounts & Roles** button for `isAdmin` → `/admin/accounts` (`AdminDashboard.tsx:684–686`).
- **The poster re-fetch is a superadmin-only card** in `AccountsRoles.tsx` (state L74–75; `runRefetch`/invoke ~L143; the `{isSuperadmin && <Card>…}` block L281–315). It calls the `refetch-posters` edge function.
- **⚠️ The poster function is NOT gone.** Tom said "that function is now gone" — but `supabase/functions/refetch-posters/` (and `poster-identify/`) **still exist** in the repo. What was retired earlier was the poster-*restore* tooling (#322), a different thing. `refetch-posters` is referenced by exactly one place: `AccountsRoles.tsx:143`. So removing the UI leaves the function orphaned — see Decision 3.
- **Both charts are pies with too many categories.** `AnalyticsTab.tsx`: Revenue by Category (L292–304) is a `PieChart` with per-slice labels **and** a `<Legend>`, over ~18 categories, colored from a **6-entry `COLORS` array that cycles** (L30–37) — so labels collide, the legend overlaps the plot, and colors repeat. Genre Popularity (L307–323) is the same pattern (already capped at top 8) with overlapping/cut-off labels. This is a *form* problem, not a spacing one.
- **Verified for safe removal:** `WageTipRules` reads/writes only the `labor_settings` table, and **nothing else in the repo reads `labor_settings`** (grep: only WageTipRules + generated types) — no payroll/QBO/timecard path depends on it. `LaborVsSales` is self-contained (its own `this_week/last_week/last_30` range selector, no props).

---

## The changes

### 1. Rename the dashboard tab "Staff" → "Team"
`AdminDashboard.tsx:772`: change `label: 'Staff'` to `label: 'Team'`. **Keep `value: 'labor'`** so bookmarked `?section=labor` URLs and the URL-sync logic keep working (the label is display-only; the marquee header will read "TEAM" on its own). Sweep for any other user-visible "Staff" that means this section (not `/staff`, the box-office counter, which is unrelated and stays).

### 2. Consolidate into one "Team Members" sub-tab + bring in roles & invite
In `LaborTab.tsx`, replace the two sub-tabs **Team & Linking** (`roster`) and **Bios** (`bios`) with a single **Team Members** sub-tab, and fold the account role/invite management into it. Team Members then holds three things:
- **Members & roles** — the accounts table with grant/revoke + **Invite** (the *admin shape* of `AccountsRoles`: lower roles only, protected accounts off-limits, invite staff/host).
- **Square Labor linking** — `LaborRoster` (today's "Team & Linking").
- **Public bios** — `StaffBios` (today's "Bios").

**Decision 1 (do the roles logic once):** extract the accounts table + grant/revoke + invite dialog out of `AccountsRoles.tsx` into a shared component (e.g. `AccountRolesManager`) that keeps its existing `useAuth`/`isSuperadmin` branching, and render it in **both** the superadmin page and Team Members (recommended — the grant/revoke/invite rules mirror RLS and must not fork) vs. duplicating the UI. The component already adapts to role, so an admin in Team Members automatically gets the admin shape and a superadmin gets the full one.

**Decision 2 (layout of the consolidated tab):** stack the three as `CollapsibleSection`s (recommended — matches the dashboard's existing pattern, e.g. "Members & roles", "Square Labor linking", "Public bios") vs. an inner tab strip. Update the `LaborTab` intro blurb (L26) to drop the "labor-vs-sales" mention and reflect that bios now lives here.

### 3. Remove the standalone Accounts & Roles (admin), keep the superadmin page
- Delete the **`/admin/accounts`** route (`App.tsx:145`).
- **Keep `/superadmin`** → `AccountsRoles` (the superadmin page stays exactly as today, minus the poster card in change 4). It should render the shared manager in full-power mode.
- Header button (`AdminDashboard.tsx:684–686`): change it from `isAdmin → /admin/accounts` to **`isSuperadmin` → `/superadmin`** (recommended), so plain admins lose the button (they use Team → Team Members) while a superadmin keeps one-click access to the full page. Leave the Activity Log button as-is.

### 4. Remove the poster re-fetch
- In `AccountsRoles.tsx` (and therefore the superadmin page), delete the re-fetch card (L281–315), its state (`refetching`, `refetchSummary`, L74–75), the `runRefetch`/invoke logic (~L143), and the now-unused `ImageIcon` import.
- **Decision 3 (the orphaned function):** since `refetch-posters` is now referenced by nothing, also delete the `supabase/functions/refetch-posters/` edge function for a clean removal (recommended). Check whether `supabase/functions/poster-identify/` is still used by anything before removing it too; if it's only the sibling of the retired poster tooling, remove it as well. (Flagging because Tom's note assumed the function was already gone — it isn't; leaving it deployed but unreferenced is dead surface.)

### 5. Move Labor vs Sales into Analytics
- Remove the **Labor vs Sales** sub-tab from `LaborTab.tsx` (L35, L44).
- Render `<LaborVsSales />` inside `AnalyticsTab.tsx`, wrapped in a `CollapsibleSection` (e.g. `id="analytics.labor-vs-sales"`, title "Labor vs Sales"), near the other operational charts. It keeps its own range selector (it reads Square Labor on a weekly cadence, separate from the Square-Reporting range at the top of Analytics) — note in a one-line description that this section has its own range, so the two controls don't look like a bug. No new bundle cost: both tabs already pull recharts.

### 6. Rebuild "Revenue by Category" as a sorted horizontal bar chart
The pie is the wrong form for ~18 categories (per the dataviz method: comparing magnitude across many, long-named categories → **bar**, and cycling hues past 8 / a many-slice pie are explicit anti-patterns). Replace `AnalyticsTab.tsx:292–304` with a **horizontal** `BarChart` (like the existing Top Performers chart, L354–370):
- **Sort descending** by amount; **fold the tail into "Other"** (keep the top ~8–10, sum the rest into one "Other" bar) so the axis stays legible.
- **One series, one hue** (`hsl(var(--primary))` or accent) — a single-series bar needs **no legend and no per-slice color**, which removes the cycled-color ambiguity entirely.
- Category names on the Y axis (`type="category"`, adequate `width`), dollars on the X axis; direct `$` value labels at the bar ends or in the tooltip; **height scales with the number of bars** so nothing is cramped. Drop the `<Legend>` and the slice-label function.

### 7. Rebuild "Genre Popularity" as a sorted horizontal bar chart
Same treatment for `AnalyticsTab.tsx:307–323` (data already capped at top 8): horizontal `BarChart`, sorted descending by count, single hue, genre on the Y axis, count on the X axis with the value labeled at each bar end, no legend, no slice labels. Keep the existing "From this build's own ticket sales — Square does not record genre" description. This removes the overlap and the cut-off labels seen today (e.g. "Fantasy (126)").

> While here: the shared `COLORS` array (L30–37) has only 6 entries and is cycled anywhere categorical color is still used. After 6/7 convert to single-series bars it's no longer load-bearing for them; if any remaining chart still needs categorical color for >6 series, fold the tail into "Other" rather than cycling (dataviz non-negotiable). Don't invent new cycled hues.

### 8. Remove Wage & Tip Rules entirely
- Remove the **Wage & Tip Rules** sub-tab from `LaborTab.tsx` (L36, L45) and delete the `WageTipRules` component (`src/components/admin/labor/WageTipRules.tsx`).
- **Decision 4 (the backing table):** `labor_settings` is read/written by nothing else (verified). Drop it with a migration for a clean removal (recommended) vs. leave the table dormant. If dropped, regenerate `types.ts`. Either way, no payroll/QBO/timecard path is affected.

---

## Decisions for Tom
1. **Roles logic:** extract a shared `AccountRolesManager` used by both the superadmin page and Team Members (recommended) vs. duplicate the UI.
2. **Team Members layout:** collapsible sections — Members & roles / Square Labor linking / Public bios (recommended) vs. inner tabs.
3. **Poster function:** delete the orphaned `refetch-posters` (and, if unused, `poster-identify`) edge function too (recommended) vs. remove only the UI and leave the function deployed.
4. **`labor_settings` table:** drop it via migration now that nothing reads it (recommended) vs. leave dormant.

## Test plan
- The dashboard tab reads **Team** (bar + lit marquee header); `?section=labor` still opens it; no stray "Staff" label remains for this section (the `/staff` counter is untouched).
- **Team → Team Members** shows accounts with roles, grant/revoke and **Invite** working under the admin rules (lower roles only, protected accounts off-limits), plus Square Labor linking and public bios — all in one sub-tab. A superadmin sees the full-power role controls; an admin sees the restricted set. The role/invite UI is the **same component** used by `/superadmin` (no forked logic).
- **`/admin/accounts` is gone** (route removed); the dashboard's Accounts & Roles button shows only to a superadmin and points to `/superadmin`; **`/superadmin` still renders the full accounts & roles page**, now without the poster card.
- **No poster re-fetch** anywhere; the `refetch-posters` invoke is removed; per Decision 3 the edge function is deleted and nothing references it.
- **Analytics:** Revenue by Category and Genre Popularity render as sorted horizontal bars with no overlapping/cut-off labels, no cycled colors, and (Revenue) an "Other" bar for the tail; **Labor vs Sales** appears as a section in Analytics with its own range control and is gone from the Team section.
- **Wage & Tip Rules** is gone from the UI and the component is deleted; payroll/QBO and timecards still work; if Decision 4 = drop, the `labor_settings` migration applies cleanly and `types.ts` is regenerated.
- `npm run build`, `npm test`, and `check:app` pass; RLS is unchanged (the role rules still mirror the DB policies wherever the manager renders).

## What was built (2026-09-24)

All four decisions went the recommended way.

- **Roles logic once.** `src/components/admin/AccountRolesManager.tsx` is the
  accounts list, grant/revoke and invite dialog, lifted verbatim out of
  `AccountsRoles.tsx`. It keeps the `useAuth`/`isSuperadmin` branching, so the
  same component gives an admin the restricted shape and a superadmin the full
  one wherever it renders. `AccountsRoles.tsx` is now the `/superadmin` page
  shell (SEO, heading, redirect) around it.
- **Team Members** (`LaborTab.tsx`, sub-tab value `members`) stacks three
  `CollapsibleSection`s: *Members & roles* (the manager, open by default),
  *Square Labor linking* (`LaborRoster`) and *Public bios* (`StaffBios`).
  Section ids are `labor.members.roles` / `.linking` / `.bios`.
- **`/admin/accounts` is gone**; `/superadmin` stays. The dashboard's
  Accounts & Roles button is `isSuperadmin → /superadmin`; Activity Log is
  unchanged.
- **Poster re-fetch removed**, and both orphaned edge functions deleted from the
  repo: `refetch-posters` (referenced only by the removed card) and
  `poster-identify` (the Aug 2026 recovery's matcher — never deployed anywhere
  per `FINDINGS-security-audit-e2e.md`, and it writes to the dated
  `square_poster_matches_20260815` recovery table, so it was recovery tooling,
  not a live capability). `refetch-posters` **is still deployed** on both
  Supabase projects and needs deleting there — see below.
- **Labor vs Sales** renders in Analytics under `analytics.labor-vs-sales`,
  after the Square footer line. Its own nested `CollapsibleSection` was removed
  (a header inside a header) and the chart got a fixed 280px height in place
  of `height="100%"`, which has no parent height to fill inside a section.
- **Both charts are `RankedBars`** (one component in `AnalyticsTab.tsx`):
  horizontal, sorted descending, one hue (`--primary`), value at each bar end,
  no legend, height = 34px × rows. `rankWithOther()` keeps the top 9 (genre: 8)
  and folds the rest into `Other (N more)`; it only folds when there are at
  least two to fold, so a list of 10 never shows "Other (1 more)". Names over
  26 chars are truncated on the axis and shown in full in the tooltip. The
  `COLORS` cycle is deleted; Top Performers also lost its single-series legend.
- **Wage & Tip Rules deleted** with `labor_settings`:
  `supabase/migrations/20260924161742_drop_labor_settings.sql`. `types.ts` had
  the `labor_settings` block removed by hand rather than regenerated, because
  staging carries other sessions' unmerged migrations and a regen would have
  pulled those in.

### Still to do by hand (not done by the PR)

1. `npx supabase db push --linked` on staging, then the prod link/push/relink
   sequence. Note the staging dry run also lists `20260922233021_showing_ticket_counts.sql`
   (PR #333) as pending — that will apply in the same push.
2. `npx supabase functions delete refetch-posters --project-ref <ref>` on both
   `rpqzrpboyhshdrfdwayk` and `vlmslygnimfbamrtwvyo`. `poster-identify` is
   deployed nowhere.
3. `npx wrangler deploy` — merging does not ship.

### Revision (2026-09-24, after the first staging test)

Tom's direction on seeing it: the Team tab gets a people icon, Team Members
goes first, regular users stay out of it, and the three sections become one
roster — a contact card per team account with roles, Square link and bio on
the same line.

- `src/lib/roleRules.ts` holds the role rules (grantable, invitable,
  protected, `TEAM_ROLES`); `RoleControls.tsx` and `InviteStaffDialog.tsx`
  render them. Both `/superadmin` (`AccountRolesManager`, still the full list
  including regular users) and the roster use these, so nothing forks.
- `src/components/admin/TeamRoster.tsx` replaces `LaborRoster.tsx` and
  `StaffBios.tsx` (both deleted). One card per account holding a `TEAM_ROLES`
  role (superadmin/admin/staff/host — host included so an admin can still
  revoke it). The card carries: avatar from the bio headshot, roles with
  grant/revoke, a Square team-member picker (moves a link if the member was
  linked elsewhere, as before), and the bio — title, snippet, Display on
  About Us, Edit / Add / attach-an-existing-bio.
- The join is `staff_bios.user_id`, which existed nullable and unused since
  20260814183831. Migration `20260924231506` adds a partial unique index so
  one account has at most one bio. **No name-match backfill**: existing bios
  show under "Bios without an account" with an attach picker on each card, so
  linking is a deliberate click, not a guess. A bio can stay unattached
  forever (the About page is editorial — the ED need not have a login).
- About page ordering (the arrows) lives in its own "About page order"
  section over the published bios, because the roster sorts by role.
- Square members with no linked account are named in a line under the roster.
