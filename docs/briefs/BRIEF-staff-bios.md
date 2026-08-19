---
brief: staff-bios
title: Staff bios — admin management + "Kenworthy Staff" on About Us
status: needs-triage
track: ux
severity: P2
date: 2026-08-14
verified: false
---

# Brief (for Claude Code): Staff bios — admin management + "Kenworthy Staff" on About Us

**Status:** 🟢 Ready — the About page already exists (no dependency to wait on)
**Date:** August 14, 2026
**Requested by:** Tom — in the admin **Staff** section, add a **Bios** area to upload staff headshots + bios with a "Display on About Us" checkbox per member; on the **About Us** page, add a **Kenworthy Staff** section directly under Board of Directors (presented like the Board).

## Where things live (both already exist)
- The admin **"Staff" tab is the Labor tab** (`AdminDashboard.tsx:452` → `{ value:'labor', label:'Staff' }` → `LaborTab`, with sub-tabs Roster / Timecards / … ). The Bios area is a **new sub-tab there**.
- The **About page is already built** — `src/pages/About.tsx` — with a **Board of Directors** section (`<section className="container py-16 max-w-5xl">`, `<h2>… Kenworthy Board of Directors</h2>` + `{BOARD.map(...)}`, ~L127–144), immediately followed by the **History** section (~L146). The new **Kenworthy Staff** section is inserted **between** those two. (No dependency to wait on.)

## Data model
New table **`staff_bios`**:
- `id`, `name text`, `title text` (role/position), `bio text`, `headshot_url text`, `display_on_about boolean default false`, `sort_order int default 0`, `is_active boolean default true`, `user_id uuid null → profiles` (optional link to a platform account — see Decisions), `created_at`, `updated_at`.
- **RLS:** admin/staff **write**; **public read** limited to `display_on_about = true AND is_active = true` (the About page only needs those); admin/staff read all. Anon must not see hidden/inactive bios.

## Admin — new **Bios** sub-tab in the Staff (Labor) tab
- Add a `<TabsTrigger value="bios">Bios</TabsTrigger>` + `<TabsContent value="bios"><StaffBios/></TabsContent>` in `LaborTab.tsx`; new `src/components/admin/StaffBios.tsx`.
- **CRUD** on `staff_bios` (mirror the `SponsorsTab`/`DvdLibraryTab` pattern): add / edit / delete a member with fields **name, title, bio (textarea), headshot** (via the existing `PosterUpload`, e.g. `folder="staff"` → stored in the public `posters` bucket), and ordering (`sort_order`).
- A **"Display on About Us"** checkbox per member (`display_on_about`), shown right in the list so staff can toggle visibility quickly — that's the switch that puts them on the public page.

## Public — "Kenworthy Staff" section on About Us
- On the real About page, **directly under the Board of Directors** section, add a **Kenworthy Staff** heading + a grid of staff cards from `staff_bios` where `display_on_about = true AND is_active`, ordered by `sort_order` (then name).
- Each card: **headshot, name, title, bio** — presented consistently with how the Board of Directors is rendered ("in the fashion" of the Board). Hide the whole section if no staff are flagged for display.

## Images
- Reuse `PosterUpload` → the public `posters` bucket (`folder="staff"`). Headshots are public About-page content, so a public bucket is appropriate. (Optionally a dedicated `headshots`/`staff` bucket for tidiness — Decision.)

## Decisions for Tom
1. **Link to platform accounts?** Keep `staff_bios` **standalone/editorial** (recommended — some About-page staff may not have logins, and you control exactly who shows) vs. tie each bio to a `profiles`/`user_roles` staff account. Recommend standalone with an optional `user_id` link for later.
2. **Ordering:** manual drag/`sort_order` (recommended) vs. alphabetical.
3. **Bucket:** reuse `posters` (simple) vs. a dedicated headshots bucket.

## Test plan
- Add 3 staff bios with headshots; flag 2 as "Display on About Us."
- About page shows exactly those 2 under Board of Directors, in order, with headshot/name/title/bio; the un-flagged one and any inactive one do **not** appear; anon can't read hidden bios.
- Toggle a bio off → it disappears from About on reload; delete a bio → gone.
- Non-admin/staff can't edit; `npm run build` passes.

---

## Built — August 14, 2026 (`feat/staff-bios`)

### Decisions taken
All three took the brief's own recommendation. Any of them can be revisited
without a rewrite; noting them here so the next session doesn't re-litigate.

1. **Standalone/editorial**, with a nullable `user_id → profiles` column that
   nothing reads yet. The public section is a page the theatre curates, not a
   projection of who holds a login — deriving it from `user_roles` would mean
   /about changes shape every time someone is on- or off-boarded. RLS does not
   consult `user_id`: a bio is not editable by its subject.
2. **Manual `sort_order`**, up/down buttons in the admin list. Alphabetical
   would put the Executive Director wherever the alphabet does.
3. **Reused the `posters` bucket** (`folder="staff"`), as `press` already does.
   Worth knowing: that bucket is public, so an uploaded headshot is reachable by
   URL before the bio is published. The admin tab says so on screen.

### Two flags, not one
`display_on_about` publishes; `is_active` means still on staff. Both must hold
for a card to appear. They are separate so someone leaving comes off the site
without their headshot and write-up being deleted — the admin tab's Delete
button is admin-only and warns about exactly this.

### What shipped
- `supabase/migrations/20260814183831_staff_bios.sql` — table, partial index on
  the public read, RLS (anon sees published+active only; staff read all and
  write; admin deletes).
- `src/lib/staffBios.ts` (+ tests) — shared row type, column list, and the
  ordering both screens use. The `sort_order` tie-break on name is the load-
  bearing bit: every row starts at 0, so until someone reorders, name is all
  the sort has.
- `src/components/admin/StaffBios.tsx` — the Bios sub-tab. Reorder renumbers
  rather than swapping, because swapping two rows that both sit at 0 is a
  no-op and the first few clicks would appear to do nothing.
- `src/pages/About.tsx` — "Kenworthy Staff" between the Board and the History,
  rendered in the Board's card idiom plus headshot and bio. Initials stand in
  when there is no photo. The section is absent, not empty, when nobody is
  flagged.

### Verified
- Migration applied to a throwaway `postgres:15` with stubbed
  `profiles`/`has_role`/`update_updated_at_column`; all statements clean.
- RLS exercised with one row of each state: anon and signed-in-non-staff both
  see only the published+active row, staff see all four, a non-staff INSERT is
  refused by the policy.
- `tsc -p tsconfig.app.json --noEmit`, `npm run build:staging`, and the full
  vitest suite (19 files, 152 tests) all pass.

### Not done
Nothing has been pushed to a Supabase project or deployed — the migration is
committed but unapplied. The brief's end-to-end pass (add three bios, flag two,
confirm on /about) needs the table to exist somewhere, so it waits on that.
