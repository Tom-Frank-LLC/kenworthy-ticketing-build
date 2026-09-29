---
brief: square-create-team-member
title: Admins can create a Square team member from the Team roster, and the Square badge stops implying onboarding
status: built
track: feature
severity: P2
date: 2026-09-25
verified: true
findings: FINDINGS-square-team-member-status.md
---

# Brief (for Claude Code): Create a Square team member from the platform + fix the misleading "Active in Square" badge

**Status:** 🟡 One new capability (create a Square team member via the API and auto-link it) plus a correctness fix to the status badge. They're the same subsystem (`TeamRoster` + `square-labor`), and the create feature will *reproduce* the badge problem if the badge isn't fixed — so they ship together. The care items: the Square access token needs write scope, and creating a member does **not** invite them (which is exactly why Ben reads "Invite expired").
**Date:** September 25, 2026
**Requested by:** Tom — (A) let us create a new team member's Square account from the Kenworthy platform when linking, rather than only linking to one that already exists in Square; (B) flag: Ben Ramalingam shows **Active** on our platform and **"Active in Square"** in the roster, but in Square he's **inactive with an expired invitation** (his Square record was created years ago and never used).

## Current state (verified, build `1789c1a`)
- **Linking is read-only against Square.** `TeamRoster.tsx` loads the Square team via `square-labor` `action: 'list_team'` (`TeamRoster.tsx:101`), which calls `/team-members/search` — a **read** (`square-labor/index.ts:226`). Linking just writes `staff_square_links` (`TeamRoster.tsx:161`). The `square-labor` action list (`index.ts:177–212`) has **no create action**; there is no path to make a Square team member from our platform.
- **The badge reads the Team API `status` field.** `TeamRoster.tsx:450–451`: `sq.status === 'ACTIVE' ? 'Active in Square' : '<status> in Square'`. `status` comes straight from Square's `TeamMember.status` (`square-labor/index.ts:253`, `m.status`).
- **The Invite button is platform-only.** `InviteStaffDialog` → `invite-staff` grants a **Kenworthy login** (`TeamRoster.tsx:40, 364`); it does nothing in Square.

## Why Ben looks "Active" here but "Invite expired" in Square (root cause)
Per Square's Team API docs, a `TeamMember.status` of `ACTIVE`/`INACTIVE` is the **record's** operational state — and it is **distinct from the invitation/onboarding state**. Square **does not expose invitation status through the API at all** ("Invite expired" is a Dashboard-only UI state). So Ben's record is genuinely `status: ACTIVE`, our badge faithfully prints that, and it's *mechanically correct* — but it *reads as* "fully set up in Square," which he isn't. The badge over-claims because it's showing the only field the API gives us and labeling it as if it were onboarding status. This is a structural mismatch (`status` ≠ invitation state), not a value bug — so the fix is honest wording, not a new lookup (there's no field to look up).

This also explains the feature's main caveat: **creating a team member via the API does not invite them** (see Part A) — so a freshly created member will look exactly like Ben until someone finishes the invite in Square.

---

## Part A — Create a Square team member from the platform
### Server: new `create_team_member` action in `square-labor`
Add an admin-gated action (mirror the `if (!hasAdmin) return 403` guard already used by `upsert_scheduled_shift`, `index.ts:198`) that calls Square **`CreateTeamMember`** (`POST /v2/team-members`):
- **Required:** `given_name`, `family_name`.
- **Recommended:** `email_address` (must be unique in the seller's account), `assigned_locations` = `{ assignment_type: 'EXPLICIT_LOCATIONS', location_ids: [config.locationId] }`, and **`reference_id` = our `user_id`** so the platform account and the Square member are tied together at creation (a clean, durable link that doesn't depend on the name picker).
- **Optional:** `phone_number` (E.164), `wage_setting` (job/hourly rate) — see Decision 3.
- Return the created member's `id`. Use the existing `SQUARE_ENV` config so it targets sandbox vs production like every other Square call.

### Client: a "Create in Square" path in `TeamRoster`
For an account not yet linked (and with no matching Square member), offer **Create in Square** alongside the existing picker: prefill first/last from the profile/`display_name` and email from the account email, allow an optional phone, confirm, then call `create_team_member`. On success, immediately write `staff_square_links` for that `user_id` → new member `id` (or, since we set `reference_id`, re-run `list_team` and auto-match on `reference_id`). Show the new member in the roster linked.

### Prerequisites / caveats (don't skip)
- **Write scope:** `CreateTeamMember` requires the **`EMPLOYEES_WRITE`** OAuth scope. Today's labor features only read (`EMPLOYEES_READ`). Verify the Square access token/OAuth grant includes `EMPLOYEES_WRITE` before building the UI; if not, that's a Square-side grant step (flag to Tom). **Decision 1.**
- **Creation ≠ invitation.** Square sends the Team-app/sign-in invitation only **after a seller assigns permissions in the Square Dashboard → Team section** — not on API creation. So "Create in Square" gives us the record + the link for **labor/timecards/wages**, but the person still can't sign in to the Square Team app/POS until an admin finishes the invite in Square. The UI must say this plainly (e.g. a note under the button: "Creates the Square team-member record and links it here. To let them clock in / sign in to Square, finish the invitation in Square Dashboard → Team."). This is the same state Ben is in. **Decision 2.**
- **Production writes real staff.** Test in sandbox first; a stray create in production adds a real team member.

---

## Part B — Fix the "Active in Square" badge so it stops over-claiming
Because the API can't tell us invitation status, the fix is to make the badge say only what `status` actually means and not imply onboarding:
- **Reword** the `ACTIVE` case from "Active in Square" to something that describes the *record*, e.g. **"Active record in Square"** or **"In Square"**, and keep a distinct **"Inactive in Square"** for `INACTIVE` (deactivated — genuinely worth surfacing). Add a short tooltip/help line: *"Square status is the team-member record (active/inactive). Whether they've accepted their Square invitation / can sign in is managed in Square and isn't reported by the API."*
- **Don't fabricate "Invite expired"** — the API doesn't provide it, so inventing it would be guessing.
- **Investigate first (cheap insurance):** before settling the wording, instrument `list_team` to log Ben's full raw `TeamMember` object once, to confirm there is genuinely no invitation/authorization field we could surface (`is_owner`, `assigned_locations`, `created_at`, an undocumented status). If a usable signal exists, surface it; if not (expected, per the docs), the reword stands. This is the "verify the structure before designing on it" step.

## Decisions for Tom
1. **Write scope:** confirm/enable `EMPLOYEES_WRITE` on the Square token so creation is possible (recommended — required for the feature; if it's a bigger Square-permissions conversation, we build Part B now and gate Part A on the scope).
2. **Invite step:** keep "Create in Square" as create-only and instruct the admin to finish the invitation in Square Dashboard (recommended — matches Square's model and keeps our scope small) vs. investigate whether permission-assignment can be driven from the API too (larger, and Square steers this through the Dashboard).
3. **Wage on create:** collect an hourly wage/job at creation via `wage_setting` (one less step in Square) vs. create the record only and set wages in Square (recommended first pass — wages are sensitive and already visible/managed in the roster's Square column).
4. **Badge wording:** "Active record in Square" + tooltip (recommended) vs. a shorter "In Square".

## Test plan
- **Create:** from an unlinked account, "Create in Square" makes a Square team member (correct first/last/email, `reference_id` = our user_id, assigned to the venue location) and the roster shows it linked; verified in the Square sandbox. A duplicate email is rejected with Square's own message surfaced.
- The new member is auto-linked (via `staff_square_links` and/or `reference_id` match); labor/timecards/wages read against it.
- The UI states that the person still needs the Square invitation finished in Square to sign in; creating does not silently imply they're onboarded.
- **Badge:** Ben (record ACTIVE, invitation expired) no longer reads "Active in Square" in a way that implies onboarding — it reads "Active record in Square" (or chosen wording) with the tooltip; a truly deactivated member reads "Inactive in Square"; the raw-object investigation is captured (a comment or the FINDINGS note) so the API limitation is documented, not rediscovered later.
- Admin-gating: `create_team_member` returns 403 for non-admins (matches the other write actions); scope errors surface Square's message rather than failing silently.
- `npm run build` + tests pass (add a test for the new action's admin gate and for the badge wording by status).

## Sources
- [Square Team API — Integration Guide](https://developer.squareup.com/docs/team/integration) (create requires `given_name`/`family_name`; invitation sent only after permissions are assigned in Dashboard; `EMPLOYEES_WRITE` scope)
- [Square Team API — Overview](https://developer.squareup.com/docs/team/overview) · [CreateTeamMember / BulkCreateTeamMembers reference](https://developer.squareup.com/reference/square/team-api/bulk-create-team-members) · [TeamMember object](https://developer.squareup.com/reference/square/objects/teammember) (`status` is ACTIVE/INACTIVE; no invitation-status field)
