# Brief (for Claude Code): Assess & optimize ADA / accessibility across the site

**Status:** 🟡 Audit → prioritized remediation. Patron-facing ticketing has real ADA Title III exposure (theatres and ticketing sites are frequent web-accessibility defendants), so treat the public purchase paths as the priority.
**Date:** August 18, 2026
**Requested by:** Tom — assess and optimize ADA compliance throughout the site.
**Standard:** WCAG **2.2 Level AA** (what ADA Title III and Section 508 are read against). Audit and remediate to AA.

## Current state (quick scan)
- An **Accessibility page/route exists** (`/accessibility`) but appears thin — confirm it makes an accurate, current statement after remediation, not aspirational claims.
- Accessibility attributes are **sparsely used** (~53 files reference `aria-`/`role`/`alt` out of a large component set) — coverage is unknown and almost certainly uneven.
- Related in-flight work to align with, not duplicate: `BRIEF-readability-font-size.md` (type size + contrast) and `BRIEF-admin-collapsible-sections.md` (keyboard-operable disclosure). This brief subsumes their a11y aspects into one standard.

## Phase 1 — Audit (produce a report before fixing)
Run **automated + manual** passes and record findings by WCAG criterion, severity, and page.
- **Automated:** axe-core / Lighthouse / pa11y across every public route (home, calendar, showing, checkout, film passes, donate, DVDs, about, press, silent-film-festival, backstage, rentals, contact) **and** the admin dashboard. Capture violations, not just scores.
- **Manual (the part automation misses):**
  - **Keyboard-only:** every interactive element reachable and operable, logical focus order, **visible focus** everywhere, no traps (modals, drawers, the collapsible admin sections, the seat picker, date pickers).
  - **Screen reader** (VoiceOver/NVDA) on the core flows: buy a ticket, buy a film pass, donate — names/roles/labels announced, errors associated with fields.
  - **Forms:** every input has a programmatic `<label>`; required/'`aria-invalid`'; error text linked via `aria-describedby`; error summaries; the checkout/comp/rental forms specifically.
  - **Color contrast:** text and UI against the dark theme meet AA (4.5:1 body, 3:1 large/UI). The amethyst primary sits ~4.6:1 and muted secondary text is the known-risk pairing — verify against `BRIEF-readability-font-size.md`.
  - **Images:** meaningful `alt` on content images (hero, history, posters, staff bios, festival/backstage galleries); decorative images `alt=""`/`aria-hidden`. The marquee/starburst SVG decor must be hidden from AT.
  - **Structure:** one `<h1>` per page, no skipped heading levels, landmark regions (`<main>`, `<nav>`), a **skip-to-content** link, correct `<html lang>`.
  - **Motion:** everything animated respects `prefers-reduced-motion` (the neon glows, marquee, color-lab).
  - **Dynamic updates:** toasts, seat availability, cart totals announced via `aria-live`.
  - **Target size** (2.2 AA): interactive targets ≥24px; comfortable on mobile.
  - **PDFs as content:** the concession menus and Silent-Film-Festival **program PDFs/images** are patron-facing — a scanned/graphic PDF is not accessible; provide an accessible alternative (HTML text of the menu, or tagged PDF + text summary). Flag these explicitly.
  - **Media:** any video/audio needs captions/transcript (check press/history/backstage).
- **Deliverable:** `docs/accessibility-audit.md` — issues table (criterion · page · severity · fix), prioritized **public money-paths first**, admin second.

## Phase 2 — Remediate (by priority from the audit)
Fix in order: ticket checkout → film passes → donate → calendar/showing → other public pages → admin. Prefer systemic fixes (shared form-field, button, dialog, and section components) over per-page patches so the whole site benefits at once. Re-run the automated pass after each area.

## Decisions for Tom
1. **Target:** WCAG 2.2 AA (recommended) — confirm (AAA is not expected for Title III).
2. **Scope:** public-first, admin included (recommended) vs public-only for now.
3. **PDF menus/programs:** provide HTML/text equivalents (recommended) vs remediate the PDFs themselves.
4. **Accessibility statement:** update `/accessibility` to reflect the real post-remediation state + a contact for access requests (recommended) — and whether to state the conformance target publicly.

## Test plan (acceptance)
- Automated: **0 critical/serious** axe violations on the public money-paths and top public pages; documented remaining minor items.
- Keyboard-only: a ticket purchase, a film-pass purchase, and a donation can each be completed start to finish with visible focus and no traps.
- Screen-reader: the same three flows are operable and every form error is announced and fix-described.
- Contrast: all text/UI meets AA in the shipped theme(s).
- Every content image has appropriate `alt`; decorative SVG is hidden from AT; `prefers-reduced-motion` disables non-essential animation.
- The menu/program PDFs have an accessible text equivalent.
- `/accessibility` statement matches reality.
- `npm run build` + tests pass.
