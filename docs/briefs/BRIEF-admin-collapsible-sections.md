---
brief: admin-collapsible-sections
title: Every admin table becomes a collapsible section, and the tabs get a consolidation map
status: shipped
track: ux
severity: P2
date: 2026-08-18
shipped_in: ["#151"]
shipped_at: 2026-08-21
verified: true
evidence: "Phase 1 only. Deployed to production 2026-08-21 (version 5b9a3ee9-44d7-4e65-b6a0-7a51bee001af) and verified live: the Analytics sections render with Square data and stay unmounted until expanded. Phase 2 is a proposal awaiting a decision — see docs/admin-consolidation-plan.md; it is NOT shipped."
---

# Brief (for Claude Code): De-clutter the admin dashboard — collapsible sections everywhere, then consolidate

**Status:** 🟢 UI refactor (presentational; no data/logic changes in Phase 1). Touches many files — do it tab-by-tab, verify each.
**Date:** August 18, 2026
**Requested by:** Tom — the admin dashboard is an unbroken stream of tables and hard to read. Put **every table/section into a collapsible section** (like the Passes tab's Square-catalog section), then **consolidate** what's redundant, across **every** admin tab.

## Current state (verified)
- `AdminDashboard.tsx` has ~16 top tabs: Analytics, Concession Items, Concession Menus, Film Passes, Host Management, Accounting (+ sub-tabs Chart of Accounts / Account Mappings / QBO Export), Rental Requests, Box Office Receipts, Labor (Roster/Timecards), Sponsors, DVD Library, Mailchimp, LGL, Hiring, Press, and a Listings tab (Movies / Live Events / Venues) with heavy filter rows. Each tab stacks its tables/cards straight down the page.
- **Primitives already exist but are unused in the tabs:** `src/components/ui/collapsible.tsx` (Radix Collapsible) and `accordion.tsx`. There is **no reusable section wrapper** — the Passes "collapsible" is bespoke. So standardize one.

## Phase 1 — one wrapper, applied to every section (mechanical, low-risk)
### Build `<CollapsibleSection>` (`src/components/admin/CollapsibleSection.tsx`)
A single reusable wrapper on top of the Radix `Collapsible`, used for **every** table/card group in the admin area:
- **Props:** `id` (stable key for persistence), `title`, `count?` (badge, e.g. row count), `description?`, `actions?` (header-right slot for buttons like "Add"/"Refresh"), `defaultOpen?`, `children`.
- **Header:** a full-width, keyboard-focusable button — title + optional count badge + a rotating chevron; `aria-expanded` wired; the header stays visible when collapsed so the page becomes a scannable list of section headers.
- **Persistence:** remember open/closed per `id` in `localStorage` (this is the real app, not a Claude artifact — `localStorage` is fine here), so a section a user keeps open stays open across visits.
- **Lazy content (perf):** don't mount/fetch a section's heavy contents until it's first expanded (see "defer data," below) — this is what turns "a constant stream of information" into a fast, quiet page.
- Consistent Card styling, comfortable spacing, and the larger default type/contrast from `BRIEF-readability-font-size.md`.

### Wrap every section, in every tab
Go tab by tab and wrap each logical block (each table, each card cluster, each form group) in a `<CollapsibleSection>` with a clear title and a count where it helps. Cover: Analytics, both Concession tabs, Film Passes (pass types / orders / redemptions / eligibility / mail queue / Square catalog), Host Management, Accounting + its three sub-views, Rental Requests, Box Office Receipts, Labor (Roster + Timecards), Sponsors, DVD Library, Mailchimp, LGL, Hiring, Press, and the Listings tab's tables/filters.

- **Default state (Decision 1):** recommend the tab's **primary** section open and everything secondary **collapsed** — so each tab opens to one useful thing, not a wall. (Alternative: all collapsed with counts.) Persistence then lets each admin tune it.
- **Defer data until expanded (Decision 2):** for sections that run heavy queries (Analytics/Square, big tables), fetch on first-expand rather than on tab mount. Big readability *and* performance win; do at least for the heaviest.
- **Presentational only:** do **not** change any query, mutation, form, or action. Every button/table that works today works identically inside its section. This is wrapping, not rewriting.

## Phase 2 — consolidate (proposal first, then implement)
After Phase 1, **produce a short consolidation map for Tom to approve before moving anything** — this is a navigation change with opinions, so don't do it blind. Candidate groupings to evaluate:
- **Concessions:** merge Concession Items + Concession Menus (+ any sales) into one **Concessions** tab with collapsible sub-sections.
- **Content:** group Hiring, Press, Sponsors, Staff Bios, DVD Library under one **Content** tab of collapsible sections (they're all "manage a public page's content").
- **Audience/CRM:** group Mailchimp + LGL under one **Audience** tab.
- **Accounting:** fold Chart of Accounts / Account Mappings / QBO Export from sub-tabs into collapsible sections of one Accounting view (or keep sub-tabs if they're genuinely distinct workflows).
- **Labor:** Roster + Timecards as collapsible sections of one Labor tab.

Deliver the map as `docs/admin-consolidation-plan.md` (current tab → proposed home, with a one-line rationale and anything that shouldn't move), get Tom's sign-off, then implement the approved merges. Reducing ~16 top tabs to a handful of grouped tabs is the second half of the de-clutter.

## Cross-cutting
- **Accessibility:** every section header is a real button — keyboard toggle, `aria-expanded`, visible focus; collapsing must not trap focus or hide an in-progress form's validation.
- **Readability/mobile:** honor the larger type/contrast defaults; section headers and chevrons must be comfortable tap targets; the collapsed list should be clean at ~375px.
- **Don't regress deep-linking/actions:** if any tab is linked to or auto-opens a section (e.g. from a toast/notification), make sure that still lands and expands the right section.

## Decisions for Tom
1. **Default open/closed:** primary-section-open per tab (recommended) vs everything collapsed.
2. **Defer data until expanded** for heavy sections (recommended) vs keep current on-mount fetch.
3. **Consolidation groupings:** approve/adjust the Phase 2 map before it's built.
4. **Persistence scope:** per-user via `localStorage` (recommended) vs always reset to defaults each visit.

## Test plan
- A reusable `<CollapsibleSection>` exists and is used across all admin tabs; expanding/collapsing works by mouse and keyboard, chevron/`aria-expanded` reflect state, and open/closed persists across reloads.
- Every previously-visible table/action is still reachable and fully functional inside its section (spot-check the money paths: Film Passes orders/redemptions, Box Office Receipts, Accounting/QBO export, LGL sync).
- Heavy sections don't fetch until first expanded (verify in the network panel), and a collapsed-by-default tab renders fast.
- No data/logic changed — a diff shows only presentational wrapping in Phase 1.
- Layout holds and headers are tappable at 375 / 768 / 1280; type/contrast match the readability defaults.
- Phase 2: the consolidation plan doc exists and, once approved, the merged tabs contain exactly the sections listed, nothing lost.
- `npm run build` + tests pass.
