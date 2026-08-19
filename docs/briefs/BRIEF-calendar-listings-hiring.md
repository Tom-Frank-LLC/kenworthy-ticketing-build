---
brief: calendar-listings-hiring
title: Calendar/listings polish + admin Hiring
status: needs-triage
track: ux
severity: P2
date: 2026-08-13
verified: false
---

# Brief (for Claude Code): Calendar/listings polish + admin Hiring

**Status:** 🟢 Draft for review
**Date:** August 13, 2026
**Requested by:** Tom — fix a double "$", hide the availability counter, make listings click-to-select, replace the desktop List-view drawer with an inline preview, and add an admin-managed Hiring section.

> Wallet passes (Add to Apple/Google Wallet) were part of an earlier draft of this brief and have been **moved to `POST-LAUNCH-BACKLOG.md`** — they need signing certs / developer accounts and are a post-launch item.

> These are independent — implement in order.

---

## 1. Remove the duplicate dollar sign
The showing meta row renders a `DollarSign` icon **and** a price string that already starts with "$", so it reads "**$ $10.00 per ticket**".
- `src/pages/Showing.tsx` — `priceDisplay` (L447) = `` `$${…} per ticket` ``; rendered at L536 as `<DollarSign …/> {priceDisplay}`.
- **Fix:** drop the redundant dollar — recommended: remove the `DollarSign` icon on that line and keep the text "$10.00 per ticket". Apply the same fix anywhere the price is shown with both the icon and a "$" (check `ProductionDetailDrawer` / the listing preview, which reuses this meta row — the screenshot is from that preview).

## 2. Hide the ticket availability counter
Don't show "N tickets available" / "N available".
- `src/pages/Showing.tsx` L634 (`{gaAvailable} tickets available`) and L640 (`{gaAvailable} available`) — remove/hide these.
- **Keep** the sold-out behavior (the `soldOut` state and the "Sold Out" notice) — only the *numeric remaining count* is hidden. Check the listing preview/drawer for a similar counter and hide it there too.

## 3. Listings: click-to-select instead of hover
On the **listings view** (home page `UpcomingList` and the Calendar page's list/`EditorialCalendar`), selecting/previewing a showing should be a deliberate **click**, not hover.
- Audit `src/components/home/UpcomingList.tsx` and `src/components/home/EditorialCalendar.tsx` for any `onMouseEnter`/`onMouseOver`-driven preview selection and switch it to `onClick`. (Row `onClick={() => onSelect(item)}` already exists in EditorialCalendar L146 — ensure the *preview panel* updates on click, not hover.)
- Keep hover *styling* (highlight) but not hover *selection*.

## 4. Desktop List view: inline preview instead of the slide-drawer
On **desktop**, List view should show the selected showing's details in an inline **preview panel beside the list** (with a direct link to the ticket page), not the slide-out drawer. **Keep the drawer** for the **Calendar (month) view**, and keep the drawer on **mobile** for both views (no room for side-by-side).
- The home `UpcomingList` already has this pattern (a preview column: "Pick a showing on the left to preview it." L77) — reuse that preview component.
- `src/pages/Calendar.tsx` currently routes **both** views through `ProductionDetailDrawer` (L98, `handleSelect`→`setDrawerOpen`). Change so: `view==='list'` on desktop (≥lg) renders the list + an inline preview panel (the reused preview component) with a prominent "Get Tickets" button linking to `/showing/:id`; `view==='month'` keeps `ProductionDetailDrawer`; below lg, both keep the drawer.
- The preview must let the user click straight through to the showing's ticket page.

## 5. Admin Hiring section (job postings + page on/off)
Make the **Hiring** page admin-managed instead of static.
- **Schema:** new `job_postings` table (`id, title, description text, is_active bool, sort_order int, created_at, updated_at`) with admin/staff write RLS and public read of active rows. Plus a **page toggle** — a `hiring_enabled` flag in `app_config` (mirroring the `lgl_sync_paused` pattern in `LglTab`).
- **Admin:** add a **Hiring** tab to the Admin Dashboard (`src/pages/admin/AdminDashboard.tsx` top-tabs / the `Tabs` at L444; new `HiringTab.tsx` beside the existing tab components) that: lists/creates/edits/deletes postings (title + description, active toggle, ordering), and a master **"We're hiring" on/off** switch (`hiring_enabled`).
- **Public Hiring page:** render active `job_postings` from the DB; when `hiring_enabled` is **off**, show a "no current openings — check back" state (and optionally hide the Hiring nav entry). This **supersedes the static-content approach** for Hiring in `BRIEF-content-pages.md` — the volunteer/contact block can remain static or become a default posting; the job listings themselves are now DB-driven.
- Keep the coordinator contact (Natalia Valencia, `hiring@kenworthy.org`, (208) 882-4127) on the page regardless of the toggle.

## Acceptance
- No "$ $" anywhere on a showing's price; the availability count is hidden while "Sold Out" still shows.
- Listings select on click; desktop List view shows an inline preview with a working "Get Tickets" link and **no** drawer; Calendar (month) view and mobile still use the drawer.
- Admins can add/edit/remove job postings and toggle the Hiring page on/off; the public page reflects both.
- `npm run build` passes.

## Decisions for Tom
1. Duplicate-$ fix: remove the icon (recommended) or the "$" text?
2. Hiring page when the toggle is **off**: show a "not currently hiring" message, or hide the page/nav entirely?

**Answered (Aug 13, 2026):** 1 — remove the `DollarSign` icon, keep the "$" in the
text. 2 — hide the page entirely.

---

## What shipped, and where it lives

| Piece | File |
|---|---|
| Duplicate `$` removed; availability counts hidden | `src/pages/Showing.tsx` |
| Shared inline preview panel (extracted from `UpcomingList`) | `src/components/home/ShowingPreview.tsx` |
| Hover-selection removed; preview reused | `src/components/home/UpcomingList.tsx` |
| `selectedId` highlight + `compact` split-column mode | `src/components/home/EditorialCalendar.tsx` |
| Desktop List → inline preview; month/mobile keep the drawer | `src/pages/Calendar.tsx` |
| `job_postings`, `app_config.hiring_enabled`, RLS | `supabase/migrations/20260813220000_hiring_job_postings.sql` |
| Shared, cached read of the hiring flag | `src/hooks/useHiringEnabled.ts` |
| Admin tab: postings CRUD, ordering, master switch | `src/components/admin/HiringTab.tsx` |
| DB-driven public page + redirect when off | `src/pages/Hiring.tsx` |
| Nav entry hidden when off | `src/components/Layout.tsx`, `src/components/MobileNav.tsx`, `src/pages/Volunteer.tsx` |

Built as specced, with four things the spec did not anticipate:

**"Hide the page entirely" collided with "keep the coordinator contact
regardless."** Resolved by redirecting `/hiring` → `/volunteer` rather than
404ing. `/volunteer` already renders the same `VOLUNTEER_COORDINATOR` block, so
Natalia's email and phone survive the toggle, and every inbound link to
`/hiring` — including the one on `/volunteer` itself, which is now hidden when
the toggle is off so it cannot become a self-link — still lands on an answer to
"how do I get involved?".

**`app_config` is admin-read-only, and the flag has to be readable by a
logged-out visitor.** The `lgl_sync_paused` pattern the spec pointed at is read
only from an admin tab and an edge function, so it never hit this. A blanket
public-read policy would have exposed the Mailchimp webhook secret and store id
that live in the same table, so the new policy is keyed by name:
`USING (key = 'hiring_enabled')`. Writes are the same shape — the rest of the
table stays superadmin-only; admins get this one key, because an editorial
toggle is not a credential.

**The upsert needs an INSERT policy as well as an UPDATE one.** PostgREST
resolves `upsert` to `INSERT ... ON CONFLICT DO UPDATE`, so an UPDATE-only
policy fails the call even when the row already exists. Both are in the
migration.

**The flag is seeded ON.** `/hiring` is currently live and linked from the
header, the mobile menu, and `/volunteer`; a migration that silently took a
linked page down would be a content decision smuggled into a schema change. The
switch in the admin tab is where that decision belongs.

### Deliberate scope note

`ShowingPreview` is one component used by both the home page and the Calendar
page, which is what "reuse that preview component" requires — so the home
page's preview gained the same prominent **Get Tickets** link, and its old
primary action ("View details" → drawer) is now the secondary **All showings**.
That is a visible change to the home page beyond the letter of §4. It follows
from sharing the component, and the alternative was two previews that drift.

`StaffPOS.tsx` still shows its remaining-ticket count. §2 is about what patrons
see; the box office needs the number.

### Still open

**The migration has not been applied to any database.** Everything above is
committed code only — `npm run build:staging` and the 111-test vitest suite
pass, but `supabase/migrations/20260813220000_hiring_job_postings.sql` still
needs to go to staging, then production, *before* the frontend ships, or
`/hiring` will query a table that does not exist. Verify which project the CLI
is linked to first.
