---
brief: staff-section-print-qr
title: Split the counter tools into a Staff section, with Print QRs in it
status: built
track: ux
severity: P2
date: 2026-08-18
verified: false
---

# Brief (for Claude Code): Split a Staff section from Admin, add "Print QRs" to it, rename it

**Status:** 🟢 Refactor + relocation. Mostly moving/extracting existing, working pieces — not new backend.
**Date:** August 18, 2026
**Requested by:** Tom — three linked changes:
1. Add the QR-sticker print-run generator (today only in Admin) to the **Staff** side.
2. Move **Staff POS** and **Scanner** out of Admin into their own **Staff** section, with a **"Staff" nav link next to "Admin."**
3. Rename **"Sticker Print Runs" → "Print QRs."**

## Current state (verified)
- The print-run generator is a **cluster inside `FilmPassesTab.tsx`**: a pass-type `Select` (`batchTypeId`), a quantity field (`batchQuantity`, default 30), a generate action that calls the **`film-pass-batch`** edge function (`{ action:'generate', pass_type_id, quantity }`), a past-batches list (`BatchSummary` via `action:'batches'`), and the printable `StickerSheet` view. It's a self-contained feature that happens to live in the Film Passes admin tab.
- **POS** = `/admin/pos` (`StaffPOS.tsx`), **Scanner** = `/admin/scanner` (`TicketScanner.tsx`), **AdminDashboard** = `/admin` — all under `/admin/*`.
- **Roles already exist:** `user_roles` carries `admin`, `staff`, `superadmin`, `host`; `useAuth` exposes `isAdmin`, `isStaff`, `isHost`, `isSuperadmin` (`src/lib/auth.tsx`). The nav (`Layout.tsx`) already partly distinguishes staff — it shows POS/Scanner links only to `isStaff && !isAdmin` today. So the access model to build on is present.
- `film-pass-batch` is described as a **staff-only** edge function — confirm it authorizes the `staff` role, not `admin`-only, since staff will now call it (see Access control).

## Part A — Extract the print-run generator into a reusable panel ("Print QRs")
1. Pull the batch-generate cluster out of `FilmPassesTab` into a reusable component, e.g. `src/components/admin/PrintQrPanel.tsx` (pass-type select + quantity + generate + recent batches + `StickerSheet`). No logic change — same `film-pass-batch` calls.
2. **Render it in both places:** keep it available in the admin Film Passes area **and** render it in the new Staff section (Part B). One component, two mount points — don't fork it.
3. **Rename the section label to "Print QRs"** everywhere it's shown (Tom's spelling; "Print QR's" is fine if he prefers the apostrophe — Decision 4). Update the heading and any nav/tab label.

## Part B — Create the Staff section, separate from Admin
1. **Routes:** introduce a `/staff` area housing **POS, Scanner, and Print QRs**. Either a `/staff` dashboard with three tools, or flat routes `/staff/pos`, `/staff/scanner`, `/staff/print-qr` (Decision 1). Move `StaffPOS` and `TicketScanner` here. **Keep `/admin/pos` and `/admin/scanner` as redirects** to the new paths for one release so bookmarks, and the `/admin/scanner` references in `BRIEF-pos-ticket-delivery.md` / `BRIEF-comp-ticket-delivery.md`, don't break (Decision 3).
2. **Nav:** add a **"Staff"** link **next to "Admin"** in `Layout.tsx`. Restructure the current role logic so:
   - **Staff link** (→ the Staff section) shows for **`staff`, `admin`, and `superadmin`** — admins run the counter too, so they get it as well, not just staff-without-admin.
   - **Admin link** stays **admin/superadmin only**.
   - Remove the current one-off "Point of Sale"/"Ticket Scanner" account-menu links for `isStaff && !isAdmin` — they're replaced by the single Staff section.
3. **What goes where:** Staff = day-to-day counter tools (POS, Scanner, Print QRs). Admin = management (listings, accounting, passes, content, analytics, etc.). Print QRs appears in **both** (staff need to print; admins manage passes) via the shared panel.

## Access control (get this right)
- The Staff section and its tools must be reachable by **`staff`, `admin`, `superadmin`** and gated from everyone else — both in the nav (client) **and** on the routes (guard) so a direct URL can't bypass it.
- **Server-side:** confirm every edge function these tools call accepts the **`staff`** role, not `admin`-only — `film-pass-batch` (print runs), the POS sale/activation paths, and the scanner's ticket read/check-in. If any is admin-gated, widen it to staff (or the intended operator set). Don't assume; check each.
- Host is unaffected (separate `/host`).

## Decisions for Tom
1. **Staff area shape:** a `/staff` dashboard with POS / Scanner / Print QRs as sections (recommended — one home for counter work) vs three flat `/staff/*` routes.
2. **Print QRs placement in Admin:** keep it in the Film Passes tab too (recommended — passes are managed there) vs move it out of Admin entirely into Staff-only.
3. **Old routes:** redirect `/admin/pos` + `/admin/scanner` → `/staff/*` for a release (recommended) vs hard-move.
4. **Exact label:** "Print QRs" (recommended) or "Print QR's" as written.

## Test plan
- A **staff (non-admin)** user sees a **Staff** nav link (not Admin), reaches POS, Scanner, and **Print QRs**, and can generate a sticker sheet **identical** to the one admins get today (same `film-pass-batch`, same `StickerSheet`).
- An **admin** sees **both** Admin and Staff links; Print QRs works from the Staff section and (if kept) the Film Passes tab, from the one shared component.
- A user with **no privileged role** sees neither link and is blocked from `/staff/*` by the route guard (not just hidden in nav).
- `/admin/pos` and `/admin/scanner` **redirect** to the new Staff routes.
- Generating a run from Staff produces the same printable sheet (codes, pass-type name, batch id) as before; `film-pass-batch` authorizes the staff role server-side.
- The label reads **"Print QRs"** everywhere; no "Sticker Print Runs" text remains.
- `npm run build` + tests pass (including `StickerSheet.test.tsx`).

## What was built (2026-08-23)

All four decisions taken as recommended: a `/staff` dashboard indexing three
tools, Print QRs kept in the Film Passes tab as well, `/admin/pos` and
`/admin/scanner` left as redirects, label "Print QRs".

**Part A.** `src/components/admin/PrintQrPanel.tsx` — pass-type picker,
quantity, Generate, past runs with Reprint blanks, and the `StickerSheet`.
Same `film-pass-batch` actions as before (`create`, `list`, `batches`; the
brief said `generate`, the code says `create`). It fetches its own active pass
types, so it needs nothing from a host page. Mounted twice: the Film Passes tab
(`CollapsibleSection`, id kept as `passes.stickers` — that id is the
localStorage key for the remembered open state, so renaming it would reset
everyone's preference) and `/staff/print-qr`.

**Part B.** `/staff` (dashboard), `/staff/pos`, `/staff/scanner`,
`/staff/print-qr`. `StaffPOS.tsx` and `TicketScanner.tsx` moved to
`src/pages/staff/`. `/admin/pos` and `/admin/scanner` are `<Navigate replace>`
redirects. `src/components/StaffOnly.tsx` refuses before the child mounts —
signed out goes to `/auth?redirect=…`, signed in without a role goes home, and
`loading` renders a spinner rather than bouncing staff on a hard refresh.
`/staff/scanner` passes `allowHost`, because a host scanning their own event's
door is the one staff tool that is theirs.

**Nav.** Header: Staff for `isStaff` (staff + admin + superadmin), Admin for
`isAdmin` only, and four buttons become two. The POS/Scanner one-offs are gone
from both the account menu and the mobile drawer.

**Staff are locked out of `/admin` entirely** (Tom, 2026-08-24 — the first pass
had left them the 7 of 12 tabs they could already reach, via "Dashboard" in the
Me menu). `src/components/RoleGate.tsx` now exports `AdminOnly` beside
`StaffOnly`, and every `/admin/*` route is wrapped in it, so the refusal happens
before the page mounts and queries. `AdminDashboard`'s own effect moved from
`!isStaff` to `!isAdmin`, and `SponsorshipForm` — the one form that also
admitted staff — moved with it. Every other `/admin` form was already
admin-only.

What a staff-only account loses: the Listings, Concessions, Passes, DVDs,
Rentals, Sponsors and BOR tabs. Most of it has a counter equivalent — the pass
pickup queue is mirrored in FilmPassPOS, the DVD catalogue is its own `/dvds`
page (still `isStaff`), and the POS carries Daily Sales and Transactions. Box
Office Receipts is the one with no `/staff` equivalent; move it if it turns out
to be counter work.

The `show: isAdmin` flags on the dashboard's tabs are now always true. Left in
place deliberately, so that widening the gate later cannot silently widen the
tabs with it.

**Donate.** Removed from the header for anyone signed in (Tom's addition), which
is what makes room for Staff beside Admin at `lg`. Still in the Support menu and
the mobile drawer.

## The server-side check found one gap

`film-pass-batch`, `film-pass-checkout`, `square-cash-sale`, `square-refund`,
`square-donation` and `square-labor` all gate on `has_role(uid, 'staff')`, which
`has_role` satisfies for admin and superadmin too (migration
`20260812063211_has_role_hierarchy.sql`). Correct already.

**`square-terminal` did not.** It gated on `'admin'` and answered "Admin access
required" — so a staff-only account could pick Card at the till and be refused
by the card reader, with a queue in front of them. Both of its actions
(`create_checkout`, `get_checkout`) are counter work; widened to `'staff'`,
matching every sibling. This was a live bug, not something this change
introduced: the POS was already linked for staff-only accounts.

## Verified

- `npx tsc -p tsconfig.app.json --noEmit` clean; `npx vitest run` 33 files,
  339 passed; `deno check` clean on `square-terminal`. `deno test` passes with
  272 tests; its type-check reports 11 pre-existing errors in
  `_shared/tickets_test.ts` and `_shared/calendar_test.ts`, untouched here.
- `npm run build:production` — `StaffDashboard`, `StaffPOS`, `TicketScanner`,
  `PrintQrs` and a shared `PrintQrPanel` chunk all present, production Supabase
  ref in the bundle.
- Browser, dev server on staging: `/staff`, `/staff/pos`, `/staff/scanner` and
  `/staff/print-qr` all bounce a signed-out visitor to `/auth?redirect=…`, and
  `/admin/pos` / `/admin/scanner` bounce via the new paths, which is the
  redirect firing. With the guard temporarily disabled, the dashboard and the
  Print QRs panel both render and the pass-type picker populates from staging.
- `src/components/staffNav.test.tsx` covers the header for patron / staff-only /
  admin, that a staff-only header carries no `/admin` href at all, and every
  guard branch including `AdminOnly` refusing staff.
- Browser: `/admin`, `/admin/audit-log`, `/admin/movies/new` and
  `/admin/sponsorships/new` all refuse before mount now.

**Not verified:** minting a real run as a signed-in staff account, and the
`square-terminal` widening against a live reader. Both need staff credentials.

## The count badge, and why it needed a hook

First pass dropped it. `CollapsibleSection` does not mount a closed section's
children, so a panel that owned the batch list could not report its size until
someone had already opened the section to see it — and fetching the list in the
tab *as well* would have cost two requests where there was one.

`src/hooks/useFilmPassBatches.ts` is the fix: the Film Passes tab calls it and
hands `batches` + `reload` down to the panel, which uses them instead of
fetching. The Staff page passes neither and the panel loads its own, the hook's
`enabled` flag keeping that second fetch from firing in the controlled case.
One request either way, and the badge is back.
