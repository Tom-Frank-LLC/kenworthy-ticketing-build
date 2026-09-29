# FINDINGS — Square team-member status, invitations, and creating members

Companion to `BRIEF-square-create-team-member.md`. Started 2026-09-28.

## Established

| # | Finding | Evidence |
|---|---|---|
| F1 | **Square's sandbox accepts a second team member with an email already in use.** The brief (and Square's integration guide) say `email_address` must be unique in the seller account. The sandbox created "Dupe Emailtest" with the same email as an existing member, no error. So `create_team_member` checks for itself: it searches every member (all locations, all statuses) and refuses a case-insensitive email match with 409 before calling Square. Whether *production* enforces uniqueness is untested — the guard makes that moot. | Staging, 2026-09-28: first attempt created and linked (toast "Dupe Emailtest created in Square and linked"); after the guard, the same email in different case was refused with "Tom (staff invite test) already uses …". |
| F2 | **CreateTeamMember with `assigned_locations: EXPLICIT_LOCATIONS [our location]` makes the member visible to `list_team`**, which searches by location. Without a location the member would be created and never appear on the roster. | Staging/sandbox create for "Tom (staff invite test)": appeared linked, "Active record in Square", on reload. |
| F3 | **A freshly created member is `status: ACTIVE`** — the same value an old, never-onboarded record has. `status` is the record's state, not onboarding. | Same create. |
| F4 | **Square can't delete a team member**, only deactivate one. The two sandbox test records ("Tom (staff invite test)", "Dupe Emailtest") are permanent there; the Dupe one was unlinked on staging. | Square Team API has no delete endpoint. |

## Established in production (2026-09-28, `scripts/square-inspect-team.mjs`, read-only)

| # | Finding |
|---|---|
| F5 | **The production token has `EMPLOYEES_WRITE`** (and `EMPLOYEES_READ`). It is a personal access token (no expiry). Create works in production with no Square-side grant. |
| F6 | **A TeamMember carries no invitation or sign-in field**, at the pinned `2024-01-18` or at `2025-07-16`. The key set across all members: `id, merchant_id, reference_id, is_owner, status, given_name, family_name, email_address, phone_number, created_at, updated_at, assigned_locations, wage_setting`. Nothing appears only at the newer version. The badge rewording stands; there is no signal to surface. |
| F7 | **The staff member in the brief has exactly one record, `ACTIVE`, untouched since it was created in 2022.** The Dashboard's "inactive / invite expired" is invitation state, which the API does not expose. The roster was linked to the right record and printed `status` faithfully; the old label over-claimed. |
| F8 | **Two records can share a name** — one person has an old `INACTIVE` record beside their live one. The link menu now marks inactive records "— inactive" so the dead one isn't picked by mistake. |
| F9 | No production member has a `reference_id`; every one was made in the Dashboard. Members created from the roster will be the first. |

Not checked: that the Dashboard token used is byte-identical to the Supabase secret (a digest comparison was offered, not run).

The raw dump holds staff contact details, so it stays outside the repo.
