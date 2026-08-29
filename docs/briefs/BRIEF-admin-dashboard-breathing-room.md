---
brief: admin-dashboard-breathing-room
title: Admin dashboard — a lit section title, more breathing room, clustered tabs
status: built
track: ux
severity: P2
date: 2026-08-28
verified: false
---

# Brief (for Claude Code): Admin dashboard — a lit section title, more breathing room, better grouping

**Status:** 🟢 Admin UX/visual polish. The section-title-in-lights is small and reuses existing pieces; the breathing-room/grouping pass is design judgment with concrete levers.
**Date:** August 28, 2026
**Requested by:** Tom — the admin dashboard is hard to navigate: not enough visual breathing space, information isn't grouped/clustered to clarify. Also add the **name of the selected section above the tab menu**, wrapped in a **border of lights like the concessions menu**.

## Current state (verified)
- Header is a generic `h1 "Admin Dashboard"` (`AdminDashboard.tsx:596`), then a 4-up **stats** grid, then `UndeliveredOrdersCard`, then a **12-tab** top nav.
- **Desktop tabs are icon-only** (`TabsList … hidden md:grid`, L722): twelve glyphs, the active one shown by a **lit gold glow**, labels live only in **tooltips / aria-labels**. So on desktop there is **no visible name of the section you're in** — exactly the orientation gap. (Mobile has an arrow pager that *does* show `current.label`, L700.)
- The active tab's label and icon are **already computed**: `current`, `current.label`, `CurrentIcon` (L677–681) — so the section name is in hand, it just isn't displayed on desktop.
- **The lights border already exists as a reusable component:** `<MarqueeFrame>` (`src/components/MarqueeFrame.tsx`) draws the marquee bulb ring in CSS (`.marquee-frame` in `index.css`), is `aria-hidden`/ornamental, and takes a `--mq-band` custom property to size the ring. It's already used on the Concessions page — reuse it, don't rebuild.
- Layout is dense: tight `gap-4`/`mb-8`, stacked `CollapsibleSection`s, and (post the #228 type bump) bigger text in the same boxes — so it reads cramped.

## Part A — Selected section name, in lights, above the tabs
1. **Render the active section's name** as a heading (with its icon) that updates as the tab changes — use the already-computed `current.label` / `CurrentIcon`. Place it **directly above the `TabsList`** (inside the `Tabs`, before the desktop grid), so it labels the icon bar beneath it.
2. **Wrap it in `<MarqueeFrame>`** so the title sits inside the marquee bulb ring, matching the concessions treatment: e.g. `<MarqueeFrame className="…"><h2 class="font-display uppercase …">{current.label}</h2></MarqueeFrame>`. Tune `--mq-band` so the ring is proportionate to a title strip (lighter than the full concessions panel). Keep it decorative/`aria-hidden` (the component already is); the `<h2>` carries the accessible name.
3. **Reconcile with the existing headings (Decision 1):** the generic `h1 "Admin Dashboard"` becomes redundant next to a live section title. Options: replace the `h1` with the framed live title (recommended — one clear "you are here"), or keep a small "Admin" eyebrow above the framed section title. On **mobile**, the pager already shows the label — either keep the pager as-is and show the framed title above it too, or let the framed title be the single source and simplify the pager to arrows only (Decision 1).
4. Respect `prefers-reduced-motion` if any bulb animation is ever added (the frame is static today — keep it static).

## Part B — Breathing room & grouping (the navigation fix)
The dashboard needs vertical rhythm and clustering so twelve destinations and long stacked tables don't read as one dense wall.
1. **Increase spacing scale:** raise the between-block spacing (stats → title → tabs → content) and the `Tabs` `space-y`, widen card gaps (`gap-4` → `gap-6` where it helps), and give `CollapsibleSection`s consistent vertical separation and internal padding. Let sections breathe now that type is larger (#228).
2. **Group the 12 tabs into clusters (Decision 2):** twelve equal icons is a memory test. Cluster them by purpose with subtle separators/labels in the icon bar (or grouped rows), e.g.:
   - **Programming** — Listings, Passes, Concessions, DVDs
   - **Operations** — Rentals, Staff, BOR
   - **Audience & Growth** — Sponsors, Analytics, Mailchimp, LGL
   - **Site** — Pages
   Keep the lit-glyph selection and tooltips; add thin dividers or small cluster captions so related tools sit together. (Confirm the exact grouping with Tom — this is his "cluster to clarify" ask.)
3. **Within a tab's content:** give each `CollapsibleSection` a clear header hierarchy and consistent spacing; group related tables/cards visually (a light card/section background or a divider) so, e.g., the LGL sync controls read as one cluster and the donations list as another. Align card paddings and heading sizes across tabs so switching tabs feels like one system.
4. **Stats row:** consider more generous padding and grouping the four tiles with a touch more gap; optionally a subtle section label ("At a glance") so it reads as a unit rather than floating chrome.
5. Keep it **mobile-safe** (the recent mobile pass): more spacing must not introduce horizontal scroll; the framed title wraps cleanly on a phone.

## Decisions for Tom
1. Framed live section title **replaces** the generic "Admin Dashboard" h1 (recommended) vs sits below a small "Admin" eyebrow; and on mobile, framed title + arrow pager vs framed title only.
2. Tab **grouping** into clusters (recommended) — confirm the four groups above or adjust; visual separators in the icon bar vs grouped rows.
3. Marquee ring weight for the title (`--mq-band`) — lighter strip (recommended) vs the fuller concessions ring.
4. How far to push spacing: a measured increase (recommended) vs a larger redesign of each tab's internal layout (bigger scope).

## Test plan
- The **section name shows above the tab bar**, inside the marquee light ring, and updates when the active tab changes (desktop and mobile); the ring is decorative and the heading is the accessible name.
- The dashboard reads with **more breathing room** — clearer separation between stats, title, tabs, and content; consistent card gaps and section spacing; no cramped stacking.
- Tabs are **grouped/clustered** per Decision 2 with the lit-glyph selection and tooltips intact; every tab still reachable by keyboard with its `aria-label`.
- No horizontal scroll or overflow at 375/768/1280; the framed title wraps cleanly on mobile; type from #228 fits its boxes.
- No change to what each tab does or to any data; `npm run build` + tests pass.

---

## Decisions as taken (2026-08-29)

Tom picked these before implementation; recorded here so a later session does
not re-open them.

1. **The framed live title replaces the `h1 "Admin Dashboard"`** and *is* the
   page's `h1`, so there is one "you are here" and it names the section rather
   than the screen. The stats row above it keeps a plain caption ("At a
   glance") and not an `h2` — an `h2` there would sit above the `h1` and invert
   the document outline.
2. **Mobile shows the framed title *and* the pager unchanged**, label and 1/12
   counter included. The label appears twice by design: the pager is the only
   nav on a surface with no tooltips, so it has to keep describing itself.
3. **Four groups, with captions**, exactly as proposed — Programming /
   Operations / Audience & Growth / Site — separated by thin rules.
4. **Lighter ring** for the title strip (`--mq-band` 1rem desktop, 0.8rem
   mobile) rather than the fuller concessions weight.
5. **Measured spacing increase**, not a per-tab redesign.

## What implementation added beyond the brief

- **Groups are filtered then dropped when empty.** Five of the twelve tabs are
  `isAdmin`. For a non-admin, Site is empty (Pages is its only member) and
  Audience & Growth falls to one — so the bar builds from group definitions,
  filters within each, and drops the empties. Verified: a non-admin gets three
  groups and two rules, no orphan caption.
- **The icon run inside each group is capped at `4rem` per glyph and centred.**
  Stretching each group to fill its share spread a four-glyph run wider than
  the gap to the next group, which inverts the proximity the grouping depends
  on. This was caught in the width probe, not in review.
- **Group captions share a fixed height, bottom-aligned.** "Audience & Growth"
  wraps to two lines in a narrow group while "Site" does not; without a shared
  height the wrapped caption pushed its own glyphs a line below every other
  group's.

## Verification performed

`tsc -p tsconfig.app.json --noEmit` clean; 725 tests pass (55 files);
`build:staging` succeeds. Layout measured in iframes at 375 / 768 / 1280
against the real built stylesheet (admin routes need auth, so the page itself
could not be driven): no horizontal scroll at any width, the tab bar does not
overflow its own box, icon rows align across groups, and the title strip wraps
to three lines inside its frame at a 27-character stress label without
overflowing. Edge functions untouched.
