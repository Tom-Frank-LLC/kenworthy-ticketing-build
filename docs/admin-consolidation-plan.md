# Admin dashboard consolidation — Phase 2 proposal

**Status:** awaiting Tom's decision. Nothing here is built.
**Date:** 20 August 2026
**Follows:** Phase 1 of `docs/briefs/BRIEF-admin-collapsible-sections.md`, which is
shipped — every table and card group in the admin area is now a
`<CollapsibleSection>`.

## Read this first: the brief's premise had moved

`BRIEF-admin-collapsible-sections.md` was written on 18 August against a
dashboard with **~16 top tabs** and proposed five merges. By the time Phase 1 was
built, `main` was at **12 tabs** and **three of those five merges had already
shipped** in other sessions:

| Brief's Phase 2 candidate | Actual state on `main` |
|---|---|
| Merge Concession Items + Menus | **Done** — one *Concessions* tab, sub-tabs "Items & combos" / "Menu PDFs" |
| Fold Chart of Accounts / Mappings / QBO Export out of sub-tabs | **Done, the other way** — they are sub-tabs of *Analytics* |
| Roster + Timecards into one Labor tab | **Done** — the *Staff* tab, with eight sub-tabs |
| Group Hiring, Press, Sponsors, Bios, DVDs as "Content" | **Partly** — *Pages* holds Festival, Hiring, Press, Backstage. Sponsors and DVDs are still top-level; Bios sits under Staff |
| Mailchimp + LGL into one "Audience" tab | **Not done** |

So the remaining consolidation is much smaller than the brief implies. What
follows is written against the real 12 tabs, not the 16 the brief describes.

## The constraint that decides most of it

Seven tabs are visible to **all staff**; five are gated on `isAdmin`
(`AdminDashboard.tsx:488-501`):

| Audience | Tabs |
|---|---|
| All staff | Listings, Concessions, Passes, DVDs, Rentals, Sponsors, BOR |
| Admin only | Staff, Pages, Analytics, Mailchimp, LGL |

**Merging across that line changes who can see what.** Several groupings that
read well on paper — "BOR is a report, put it under Analytics"; "Sponsors edits a
public page, put it under Pages" — would either expose admin-only data to
counter staff or take a tool away from the people who use it. That is a
permissions decision, not a layout one, so those are listed below as *blocked*
rather than recommended.

## Recommended

### 1. Mailchimp + LGL → one **Audience** tab

The only clean merge left. Both are admin-only, both are read-mostly views onto
an external system we sync to, both are visited rarely and neither fills a
screen. Two top-level tabs for two panels is the clearest remaining waste.

- **Audience**
  - *Mailchimp* — integration status, draft a campaign from a showing
  - *LGL* — Little Green Light integration, completed donations

Sub-tabs rather than collapsible sections, matching how Concessions and Rentals
already split two unrelated jobs inside one tab.

**Cost:** `?section=mailchimp` and `?section=lgl` become stale. Both are live
links today. `src/lib/adminSections.ts` already exists for exactly this problem —
it redirects `?section=press|hiring|festival` to the Pages tab — so the fix is
three lines and a test, not a new mechanism. **Do not merge these tabs without
adding them to `LEGACY_PAGE_SECTIONS`'s equivalent**; a bookmarked link that
lands on a blank panel is the failure that module was written to prevent.

12 tabs → 11.

## Worth deciding, but genuinely arguable

### 2. Staff → Bios, or Pages → Bios?

`StaffBios` is the odd one out on the Staff tab and `LaborTab.tsx` says so in a
comment: everything else there reads live from Square Labor, while Bios is our
own table feeding the public About page. By subject it belongs in *Pages* with
the other public-page editors. By workflow it belongs next to the roster, since
the person adding a new hire to Square is the person who writes their bio.

Both tabs are admin-only, so there is no permissions cost either way. **I have no
strong recommendation** — it depends on whether bios are written when someone is
hired (leave it) or when the About page is refreshed (move it).

## Blocked by the staff/admin split — not recommended without a decision

### 3. BOR → Analytics

Coherent on subject: box office receipts are a report, and Analytics already
absorbed the accounting views. But BOR is visible to **all staff** and Analytics
is **admin only**. Merging either hides BOR from the people who file Comscore
receipts, or exposes revenue analytics and the QBO export to counter staff.

### 4. Sponsors → Pages

Sponsors edits a public page, which is exactly what Pages is for. Same problem:
Sponsors is all-staff, Pages is admin-only.

Both become straightforward *if* you decide the underlying permission question —
"should counter staff see revenue analytics?" and "should counter staff edit
public pages?". That is your call, not a layout one, and it should be made on its
own merits rather than as a side effect of tidying tabs.

### 5. DVDs stays where it is

The brief listed DVD Library under a proposed "Content" tab. It does not fit:
DVDs is a rental business line with its own library, reservations, active
rentals, reports and settings — five sub-views and the most complex tab after
Listings. Filing it beside "edit the Press page" would bury it.

## What this adds up to

| | Tabs |
|---|---|
| Today | 12 |
| After the recommended merge | 11 |
| If the permission questions resolve toward admin-only | 9 |

The brief's "~16 top tabs to a handful" is no longer available without the
permission decisions above, because the tabs that remain are mostly distinct jobs
for distinct audiences. Phase 1 is what actually bought the de-clutter: each tab
now opens to one useful thing and a scannable list of section headers with counts,
and each admin's open/closed choices persist.

## Decisions needed

1. **Merge Mailchimp + LGL into Audience?** (recommended — with the legacy-link
   redirect)
2. **Bios: leave under Staff, or move to Pages?** (no recommendation)
3. **Should counter staff see Analytics?** — decides whether BOR can fold in
4. **Should counter staff edit public pages?** — decides whether Sponsors can fold in
