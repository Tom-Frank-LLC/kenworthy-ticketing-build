# Brief (for Claude Code): Fill in About / Hiring / Volunteer from kenworthy.org, remove Plan a Visit

**Status:** ✅ Shipped and verified in production August 13 2026 — `53ad127`
**Date:** August 13, 2026
**Requested by:** Tom — three nav pages are still "coming soon" stubs; port their content from the current kenworthy.org site. Also remove the Plan a Visit page entirely.

## Goal
Replace the placeholder **About Us**, **Hiring** (called "Job Openings" on the old site), and **Volunteer** pages with real content ported from kenworthy.org, and **delete the Plan a Visit page** and all references to it.

## Current state (file:line)
- All four are shared "coming soon" stubs in `src/App.tsx`: `AboutPage` (L51), `HiringPage` (L54), `PlanAVisitPage` (L56), `VolunteerPage` (L57) — each `lazy(() => comingSoon()...)`.
- Routes: `/about` (L113), `/hiring` (L116), `/plan-a-visit` (L118), `/volunteer` (L119).
- Nav entries: `src/components/Layout.tsx` (~L21–32: `['About Us','/about']`, `['Hiring','/hiring']`, `['Plan a Visit','/plan-a-visit']`, `['Volunteer','/volunteer']`) and `src/components/MobileNav.tsx` (~L48–58, same labels).

## Content source (first-party — the Kenworthy's own site)
Port the copy **verbatim from the live pages** (the live site is the source of truth; pull current text, don't paraphrase):
- **About** → https://www.kenworthy.org/about/
- **Job Openings / Hiring** → https://www.kenworthy.org/hiring/
- **Volunteer** → https://www.kenworthy.org/volunteer/  (redirects to `http://www.kenworthy.org/volunteer` — follow it)

Structural outline to scaffold each page (confirm against the live copy):

**About** — sections: Mission statement; **Goals** (four bulleted objectives); **Board of Directors** (~12 names with titles, e.g. President Stevie Steely-Johnson, VP Mike O'Brien); **Our History** (Crystal Theatre 1908 → Milburn Kenworthy 1926 → 1928 expansion → 1949 remodel → nonprofit 2000 → National Register 2002). Render the board as a clean list and the history as prose.

**Hiring / Job Openings** — currently lists **volunteer positions only** (no paid staff openings; the page notes "stay tuned for more job openings"). Roles: concessions, box office, post-show cleanup, special events. Requirement: 16+. Perks: free movie passes + training. **Contact:** Natalia Valencia, Volunteer Coordinator — `hiring@kenworthy.org`, (208) 882-4127. Make the email a `mailto:` and the phone a `tel:` link. (Keep the app's nav label "Hiring"; the page heading can read "Job Opportunities" to match the old site.)

**Volunteer** — volunteering overview, roles, and how to sign up; same coordinator/contact as above (`hiring@kenworthy.org`, (208) 882-4127). Pull the live copy for the specifics.

## Implementation
- Replace the three "coming soon" stubs with **real page components** (e.g. `src/pages/About.tsx`, `src/pages/Hiring.tsx`, `src/pages/Volunteer.tsx`, or keep them in whatever module `comingSoon` lives in — but with actual content). **Mirror an existing static content page** (e.g. `History`, `Accessibility`, or `Press`) for layout, container widths, typography, and the shared `SEO` component.
- Give each a proper `<SEO title description />` (e.g. About — "About — The Kenworthy…"; Hiring — "Job Opportunities…"; Volunteer — "Volunteer…").
- Keep the existing routes `/about`, `/hiring`, `/volunteer` and their nav entries.
- **Images (optional):** the About page uses historic photos + the KPAC logo. Prefer reusing assets already in `src/assets` (there are historic Kenworthy images) rather than hotlinking the old WordPress media; skip images if that's faster and add later.

## Remove Plan a Visit (delete entirely)
- `src/App.tsx`: remove the `PlanAVisitPage` lazy import (L56) and the `/plan-a-visit` route (L118).
- `src/components/Layout.tsx`: remove the `['Plan a Visit','/plan-a-visit']` nav entry (~L26).
- `src/components/MobileNav.tsx`: remove the Plan a Visit nav entry (~L53).
- Remove `/plan-a-visit` from `public/sitemap.xml` / `public/robots.txt` if present.
- Grep for any other `plan-a-visit` / `Plan a Visit` references and remove them. After removal, `/plan-a-visit` should fall through to `NotFound`.

## Acceptance
- `/about`, `/hiring`, `/volunteer` render the real ported content (mission/goals/board/history; volunteer roles + contact links; volunteer overview + signup), each with SEO tags.
- `/plan-a-visit` no longer exists and is not linked in desktop or mobile nav.
- `npm run build` passes.

---

## Quick unrelated fix: remove the duplicate "CALENDAR" header
The `/calendar` page shows the word **CALENDAR** twice, stacked. Two headers render back to back:
- Page header — `src/pages/Calendar.tsx` (~L42–50): eyebrow "What's on" + `<h1>Calendar</h1>` + "Every showing, in order…". **Keep this one.**
- Month-view header — `src/components/home/MonthCalendar.tsx` (~L82–90): eyebrow "What's Playing" + `<h2>Calendar</h2>` + "Tap a day to see what's on…". This duplicates the title.

**Fix:** in `MonthCalendar.tsx`, remove the redundant `<h2>Calendar</h2>` **and** the "What's Playing" eyebrow `<p>`, but **keep** the "Tap a day to see what's on. Tap a title for tickets and details." helper line and the month-navigation controls to its right. Result: a single "CALENDAR" header on the page, with the helper text and month nav intact.

**Acceptance:** `/calendar` shows the title once; the "Tap a day…" hint and month prev/next controls remain; build passes.

---

## Verified in production — 2026-08-13

Checked against `kenworthy-ticketing-build.mrtomfrank.workers.dev` by loading each page.

| Acceptance item | Result |
|---|---|
| `/about` renders the ported content | ✅ mission, 4 goals, **12** board members, history 1908 → 2002 |
| `/hiring` | ✅ "Job Opportunities" heading, the four volunteer roles, 16+ requirement, training + free passes |
| `/volunteer` | ✅ overview, roles, shifts/training/perks, how to sign up |
| Contact links on both | ✅ Natalia Valencia, `mailto:hiring@kenworthy.org`, `tel:+12088824127` |
| SEO tags on each | ✅ |
| `/plan-a-visit` gone, unlinked | ✅ renders the 404 page; zero `plan-a-visit` references remain in `src/` or `public/` |
| `/calendar` shows the title once | ✅ single CALENDAR header; "Tap a day…" hint and month prev/next both intact |
| Build passes | ✅ |

The contact details are shared from `src/lib/volunteering.ts` (`VOLUNTEER_COORDINATOR`) rather than
duplicated across the two pages — tidier than the brief asked for, and it means the coordinator
changing is a one-line edit.

### One content inconsistency, not a brief violation

`/about` names the 1927 pipe organ two different ways in two sections:

- *The Theatre*: "A Robert **Morgan** theatre pipe organ was purchased in 1927"
- *Our History, 1927*: "purchases a Robert **Morton** theatre pipe organ"

**Morton** is the historically correct maker (the Robert Morton Organ Company). The brief said to
port the copy verbatim, so this may faithfully reproduce an error on kenworthy.org — but the page
contradicts itself either way. Left as-is pending a decision.

### False alarm worth recording

`What's Playing` still appears in the production bundle, which looks like the duplicate eyebrow this
brief asked to remove. It is a separate heading in `UpcomingList.tsx` on the home page.
`MonthCalendar` is clean — both its `<h2>Calendar</h2>` and its eyebrow are gone.
