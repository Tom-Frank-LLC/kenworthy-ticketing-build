---
brief: square-create-showtime
title: Create in Square works on an Event item limited to some locations, and the panel says why a showtime was not created
status: built
track: bug
severity: P1
date: 2026-10-19
verified: false
findings: FINDINGS-square-create-showtime-locations.md
---

# Brief: "Create in Square" lists a showtime but the write doesn't take

Staff report, 19 Oct 2026. In Admin → Live Events → "Showtimes in Square",
**Backstage Stories: Ghost Stories — General Admission · Sunday, November 1 at
7 PM** stayed on the "to create" list through repeated Create clicks.

The brief as written suspected, in order: a non-EVENT item, a DST
naming mismatch on 1 Nov, the collateral-change guard, or a 2xx with nothing
stored. The audit log showed none of them. Square answered 400 because the new
variation defaulted to every location and the item, made in the dashboard that
afternoon, was not at every location. The full investigation is in
`docs/FINDINGS-square-create-showtime-locations.md`.

## Scope

- The appended variation copies its item's location presence
  (`locationPresenceOf`, `_shared/square-catalog.ts`).
- The Showtimes-in-Square panel lists each showtime Square did not take, with
  the reason.
- A test pins the 1 Nov fall-back-day name, which the brief asked for.

The Ghost Stories showtime itself was fixed by hand in Square and recorded at
23:38 UTC. Nothing here repairs it.

## Test plan

- [x] `deno test` for `_shared/square_catalog_test.ts`: location copy, diff
      guard unaffected, fall-back-day name.
- [x] Boot harness, vitest, `tsc -p tsconfig.app.json`. Its 9 errors are
      already on main, in `NotificationsTab.test.tsx`.
- [ ] Next time a showtime is created on an Event item made in the dashboard,
      confirm `tally.written = 1` in `admin_audit_log`.
