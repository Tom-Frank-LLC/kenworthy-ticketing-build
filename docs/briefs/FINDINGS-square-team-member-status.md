# FINDINGS — Square team-member status, invitations, and creating members

Companion to `BRIEF-square-create-team-member.md`. Started 2026-09-28.

## Established

| # | Finding | Evidence |
|---|---|---|
| F1 | **Square's sandbox accepts a second team member with an email already in use.** The brief (and Square's integration guide) say `email_address` must be unique in the seller account. The sandbox created "Dupe Emailtest" with the same email as an existing member, no error. So `create_team_member` checks for itself: it searches every member (all locations, all statuses) and refuses a case-insensitive email match with 409 before calling Square. Whether *production* enforces uniqueness is untested — the guard makes that moot. | Staging, 2026-09-28: first attempt created and linked (toast "Dupe Emailtest created in Square and linked"); after the guard, the same email in different case was refused with "Tom (staff invite test) already uses …". |
| F2 | **CreateTeamMember with `assigned_locations: EXPLICIT_LOCATIONS [our location]` makes the member visible to `list_team`**, which searches by location. Without a location the member would be created and never appear on the roster. | Staging/sandbox create for "Tom (staff invite test)": appeared linked, "Active record in Square", on reload. |
| F3 | **A freshly created member is `status: ACTIVE`** — the same value an old, never-onboarded record has. `status` is the record's state, not onboarding. | Same create. |
| F4 | **Square can't delete a team member**, only deactivate one. The two sandbox test records ("Tom (staff invite test)", "Dupe Emailtest") are permanent there; the Dupe one was unlinked on staging. | Square Team API has no delete endpoint. |

## Not yet established (needs production)

- **Does the production token carry `EMPLOYEES_WRITE`?** Required for create in production. Checked by `POST /oauth2/token/status`.
- **Is there really no invitation/sign-in field on a TeamMember?** Square's docs say none; the badge rewording rests on that. Dump Ben Ramalingam's raw record at the pinned (`2024-01-18`) and a current version and list every key.
- **Is there more than one Ben record?** Tom reports Square shows Ben *inactive* with an expired invitation, while the roster's linked record reads `ACTIVE`. Either the Dashboard's "inactive" is the invitation state (not `status`), or we are linked to a second, active Ben record. `list_team` filters by location, so a search with no location or status filter is the test.

How to answer them: `scripts/square-inspect-team.mjs` (read-only, production by default, needs the token in your own shell), or a temporary admin-only read-only edge function that uses the secret server-side (the labor-testing precedent). Record the answers here.
