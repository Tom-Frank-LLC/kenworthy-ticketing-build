---
brief: remove-archive-section
title: Temporarily remove the screened-films Archive — preserve for post-launch
status: shipped
track: feature
date: 2026-08-14
verified: false
---

# Brief (for Claude Code): Temporarily remove the screened-films Archive — preserve for post-launch

**Status:** ✅ Shipped — no `archive` section remains in `AdminDashboard.tsx`.
**Date:** August 14, 2026
**Requested by:** Tom — turn the Archive feature **off** everywhere on the platform, but **store the whole feature + its data locally** so it can be resumed after launch. Nothing archive-related should remain live.

## What "Archive" means here (the screened-films archive)
The searchable record of films that have screened at the Kenworthy (`historical_screenings`). It appears in **three** live places; the History page's **milestone photos + text stay** (those are separate, hardcoded/`kenworthy_history` — not the archive):
1. **Admin → Archive tab** (superadmin only) — `ArchiveTab`.
2. **History page** (`History.tsx`) — screenings overlaid on the milestone timeline (per-year chip lists / "+N more"), and any searchable screenings table. All driven by `historical_screenings`.
3. **Showing page** — `PreviouslyScreened` ("previously screened at the Kenworthy" for a movie).

## Step 1 — Preserve BEFORE removing (so it's fully restorable)
1. **Code:** cut a branch/tag from the current state, e.g. `git tag deferred/archive-feature` (or branch `deferred/archive-feature`) and push it — the exact working feature stays recoverable in full context.
2. **Data:** export **all** `historical_screenings` rows to both CSV and a re-insertable `.sql` (INSERTs) — this is imported runtime data, not in a migration, so it must be dumped or it's lost. Save alongside the creating migration `20260608170228_…sql`.
3. **Local bundle:** assemble a `deferred-archive/` folder (deliver it to Tom) containing: the removed components (`ArchiveTab.tsx`, `PreviouslyScreened.tsx`, `normalizeTitle.ts`), the History archive code that's being stripped, the data export (CSV + SQL), the creating migration, and a short `README` describing how to restore. This is the "store it locally" deliverable.

## Step 2 — Remove from the platform (leave no trace)
- **Admin (`src/pages/admin/AdminDashboard.tsx`):** remove the `ArchiveTab` import (L19), the `topTabs` entry `{ value:'archive', … show:isSuperadmin }` (L458), and the `<TabsContent value="archive">` block (L864-867). Delete `src/components/admin/ArchiveTab.tsx`.
- **History page (`src/pages/History.tsx`):** remove **all** `historical_screenings` usage — the paginated query (~L491-496), `screeningsByYear` (~L532), the `screenings` prop threaded through the timeline/`ItemCard` (~L327-404, L595), the per-milestone chip list (~L439-466), and any bottom searchable screenings table. **Keep** the milestone data (DB `kenworthy_history` + the hardcoded `SEED`) and the timeline rendering of **photos + text**. Net result: History shows the photo/text milestones only.
- **Showing page (`src/pages/Showing.tsx`):** remove the `PreviouslyScreened` import (L17) and its render (`<PreviouslyScreened movieId={…}/>`, L545). Delete `src/components/PreviouslyScreened.tsx`.
- **Helper:** `src/lib/normalizeTitle.ts` is used only by the archive — remove it (it's in the preserved bundle). Confirm no other importer first.
- **Data/table:** after the export in Step 1, **drop `historical_screenings`** (and any archive-only objects/RLS/policies from `20260608170228`) via a new migration, so nothing archive-related remains in the live DB. Keep a **restore migration** in the deferred bundle. *(Decision below if you'd rather leave it dormant.)*

## Step 3 — Verify nothing remains
- `grep -rniE "historical_screenings|ArchiveTab|PreviouslyScreened|normalizeTitle" src` → **no matches**.
- History renders photos + text milestones, **no** screenings chips/table; Showing page has no "previously screened"; Admin has **no** Archive tab (for superadmin either).
- `npm run build` passes; `supabase db` has no `historical_screenings` (if dropped).
- The `deferred/archive-feature` tag/branch exists and the `deferred-archive/` bundle (code + data export + restore notes) is delivered.

## Step 4 — Restore path (post-launch, for the README)
Re-apply the creating migration `20260608170228` (or the restore migration), re-import the exported rows, and cherry-pick/restore the components from the `deferred/archive-feature` tag. The feature returns intact.

## Decisions for Tom
1. **Table:** **drop** `historical_screenings` after export (recommended — "nothing left on the platform") vs. leave it **dormant** (no UI touches it; simpler restore, but data still sits in the DB).
2. **Preservation location:** git tag/branch **plus** the delivered `deferred-archive/` bundle (recommended, belt-and-suspenders), or just one of them?
