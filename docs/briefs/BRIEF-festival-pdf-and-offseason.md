---
brief: festival-pdf-and-offseason
title: A single PDF upload gives the festival page its flip-through, and an admin can put the festival between seasons
status: shipped
track: feature
date: 2026-09-25
shipped_in: ["#345"]
shipped_at: 2026-09-25
verified: true
---
# Brief (for Claude Code): Silent Film Festival — one-PDF flip-through upload + off-season "About the Festival" mode

**Status:** 🟡 Two festival-subsystem features. (1) Make an in-admin PDF upload produce the page-by-page flip-through automatically (today only an offline script does that, so a hand-uploaded PDF is download-only). (2) Add a manageable "between festivals" mode that moves the finished year into the archive and shows an **editable** general "About the Festival" at the top until the next year is announced. Both are managed from **Pages → Festival Programs**, where the rest of this content already lives.
**Date:** September 25, 2026
**Requested by:** Tom — uploading one program PDF gave a success toast but the festival page says "not scanned page by page yet" and only offers a download; and 2026 is over, so move it to the archive and replace the featured section with general About-the-festival content until 2027 is announced. (Tom is fine waiting for the flip-through to be built rather than uploading page images by hand.)

## Current state (verified, build `59deec3`)
### The program viewer is image-based; the in-app upload doesn't rasterize
- The festival page renders a program as **page-by-page images**, not an embedded PDF — deliberately (avoids the browser PDF toolbar over a scanned booklet). `SilentFilmFestival.tsx`: the slideshow draws `entry.pages` (image rows) — `pages[index]` at L131/155/215; when a year has a file but no page images it shows **"This programme has not been scanned page by page yet."** (L184) plus a **Download PDF** button (L285).
- `festival_programs` rows are per **file**, typed `file_type: 'pdf' | 'image'` (`FestivalProgramsTab.tsx:268`). A year's flip-through is its **image** rows; a **pdf** row is the download. So the model already supports *N page-images + one PDF download* per year.
- **The rasterization is offline-only.** The admin `handleUpload` (`FestivalProgramsTab.tsx:219–290`) just stores the file and inserts one row — it does **not** split a PDF. The per-page images are produced by an **import script using `pdftoppm`** (noted at `FestivalProgramsTab.tsx:58–62`). A hand upload has "no such luxury," which is exactly why a single PDF ends up download-only. Today's manual cover field (L250–257, L474–486) is the stopgap for a PDF's thumbnail.

### The featured section auto-follows the current year; the general blurb is hardcoded
- The top of the page speaks for **`heroYear`** = the lineup's year, or if none, *the newest year that has a written blurb/trailer* (`SilentFilmFestival.tsx:397–416`). `currentEntry` is that year's archive entry, shown above `pastYears` (L431–434). So **the most recent year stays featured as long as it has a lineup or a blurb/trailer** — there is no "off-season" state.
- The general description is a **hardcoded constant `FESTIVAL_BLURB`** (used at L518 and as the fallback at L577: `(heroYear && blurbs.get(heroYear)) || FESTIVAL_BLURB`). It is **not editable** from the back-end.
- Per-year trailer / blurb / hero live in `festival_years` and are editable in **Pages → Festival Programs** (`FestivalProgramsTab.tsx:100–214`, section ids `pages.festival.*`). So year-level content is already manageable there; festival-level "About" content and an off-season switch are what's missing.

---

## Part 1 — Upload one PDF, get the flip-through automatically
On a PDF upload in `FestivalProgramsTab`, rasterize the PDF into per-page images and create the image rows, so the viewer shows the flip-through — while keeping the PDF row as the download.

- **Where the rasterizing runs — Decision 1.** Recommended: **client-side with pdf.js** in the admin upload flow (render each page to a canvas at ~2000px wide — matching the existing scan width the page already expects, `SilentFilmFestival.tsx:448` — export PNG/JPEG, upload each). This fits the stack: Supabase edge functions run Deno and can't shell out to `pdftoppm`, and this work is admin-only and small (festival programs are ~8–30 pages). Alternative: a server-side rasterizer (more infra, not recommended).
- **What gets written:** keep uploading the **PDF** as today (it stays the "Download PDF" file — one `pdf` row), and additionally create one **image** row per rendered page, each with `display_order` = page index, same `year`/`festival_slug`, `is_published` following the upload's publish state. The viewer then builds `entry.pages` from those image rows automatically — no page-side change needed.
- **Thumbnail — Decision 2:** use **page 1's rendered image as the thumbnail** automatically (drop or de-emphasize the manual cover field), so a hand upload matches a script-imported year without extra steps.
- **Parity with the import script:** match the script's output (page width, format, ordering) so script-imported years and hand-uploaded years render identically. Reference the `pdftoppm` settings the script uses.
- **Robustness:** show progress while rendering multiple pages; if rasterization fails, fall back to today's behavior (store the PDF as a download, leave the "not scanned" state) rather than losing the upload. On **re-upload** of a year's PDF, replace that year's previously auto-generated page images rather than appending duplicates (key them so a re-import is idempotent — e.g., a marker on auto-generated rows).

## Part 2 — Off-season "About the Festival" mode, managed in Pages
Let an admin flip the festival into a between-seasons state that (a) shows an **editable** general "About the Festival" at the top, and (b) puts the finished year (2026) into the archive with everything else — then flips back when the next year is announced.

- **Make the general blurb editable.** Move `FESTIVAL_BLURB` out of the page constant into festival-level settings (a `festival_settings` row keyed by `festival_slug`, or an `app_config` key), edited via `RichTextEditor` in **Pages → Festival Programs** as **"About the Festival (standing description)"**. The page's fallback becomes this stored value instead of the hardcoded string (year blurb → stored About → nothing).
- **Add an off-season control — Decision 3.** Recommended: a simple **"Festival is between seasons"** toggle at the festival level. When **on**: `currentEntry` resolves to none (so `heroYear`/lineup no longer pull the newest year out of the archive), the top shows the **About** content (and no active pass/lineup), and **every** year — including 2026 — appears under Past Programs. When **off**: today's behavior (feature the active/newest year). Alternative: an explicit **featured-year selector** with a "None (off-season)" option. The toggle is the simpler mental model ("is a festival currently on?").
- **Auto-return:** when 2027 gets a lineup (or the toggle is turned off), 2027 becomes the featured year again automatically, and 2026 stays in the archive — no content is lost or re-entered. 2026's own blurb/trailer/hero remain attached to 2026 in the archive.
- **Optional top-of-page line — Decision 4:** in off-season, show a short standing line under the About (e.g. "The next festival will be announced soon") — editable, or omit. Confirm.

Everything above is edited from the existing **Pages → Festival Programs** area, which is where Tom expected to manage it.

## Decisions for Tom
1. **PDF rasterization:** client-side pdf.js on upload (recommended) vs a server-side renderer.
2. **Thumbnail:** auto-use page 1 and retire the manual cover field (recommended) vs keep the manual cover.
3. **Off-season model:** a "between seasons" toggle (recommended) vs a featured-year selector with a "None" option.
4. **Off-season copy:** show an editable "next festival announced soon" line (recommended) vs About text only.
5. **About content store:** a `festival_settings` row per slug (recommended, room to grow) vs an `app_config` key.

## Test plan
- **Part 1:** uploading a single multi-page **PDF** in Pages → Festival Programs produces the **page-by-page flip-through** on the public festival page (no "not scanned" message), keeps a working **Download PDF**, and uses **page 1 as the thumbnail**; ordering matches the printed booklet; a script-imported year and a hand-uploaded year render identically; a failed render falls back to download-only without losing the upload; re-uploading a year's PDF replaces its pages rather than duplicating them; uploads still start **unpublished** until published.
- **Part 2:** an admin can edit the **"About the Festival"** text in Pages and see it on the page; turning **"between seasons" on** moves 2026 into the archive, shows the editable About at the top, and hides the active-festival pass/lineup; **every** past year (incl. 2026) is reachable in Past Programs with its own blurb/trailer intact; tagging a 2027 lineup (or turning the toggle off) re-features 2027 automatically with 2026 still archived.
- RLS unchanged (admin writes only; public reads published rows); `npm run build` + tests pass (add tests for the off-season split in the page's current-vs-archive logic and for the upload creating page rows from a PDF).

---

## Outcome (shipped 2026-09-25)

Both parts shipped in PR #345 (`d2ab0b6`). Migration `20260925171251` is on
staging and production (Tom pushed both). Production Worker version
`646d7090-d7f1-42a5-9a4b-92d47a66e9fb`; rollback target (the #343 deploy)
`dde1dd7a-133f-4699-8367-fec6b7b20950`. Verified at the origin: the new
entry chunk is served and the festival tab chunk carries the change. Prod
was confirmed equal to main by content before the deploy.

### Decisions taken (all on the brief's recommendation)

1. **Rasterization is client-side with pdf.js** (`src/lib/pdfPages.ts`),
   loaded on demand inside the upload so the admin bundle does not carry it
   (a 431 KB chunk plus a 1.3 MB worker asset, neither preloaded from
   `index.html`). Output matches the import script: 2000 px wide, JPEG at
   88%, `Page N` rows at `display_order` N, the PDF last at 500 with the
   script's `Full programme (N pages)` title and page 1 uploaded again as its
   cover.
2. **Page 1 is the thumbnail**; the manual cover field is gone. A PDF that
   fails to render is stored download-only with no cover, which is what the
   brief asked for as the fallback.
3. **A "Festival is between seasons" switch**, on a new `festivals` row.
4. **An editable line** shown in place of the lineup while between seasons,
   seeded as "The next festival will be announced soon."
5. **A `festivals` table keyed by slug**, not `festival_settings` and not an
   `app_config` key. `20260820180722_festival_year_copy.sql` had already said
   a home for the festival's name and standing description "wants a festivals
   table"; this is that table (`slug`, `name`, `about`, `between_seasons`,
   `off_season_note`). Public read, admin write, seeded with the words the
   page carried as constants so nothing changes on apply.

### Things the brief did not ask for, and why they are here

- **`festival_programs.generated_from`** (FK to the PDF row, `ON DELETE
  CASCADE`) is the idempotency marker. A re-upload replaces exactly the
  earlier booklet and the pages that point at it; pages from the script or
  from hand uploads carry NULL and are never touched. Deleting a booklet in
  the admin list now takes its rendered pages (rows by cascade, objects by
  the tab).
- **"Publish all of <year>"** per year in the admin list. A rendered booklet
  is thirty-one draft rows, and publishing them one at a time would leave a
  flip-through with holes in it for as long as that took.
- **Pages render with `intent: 'print'`.** The default display intent paces
  its work with `requestAnimationFrame`, and Chrome delivers no frames to a
  hidden tab, so an admin who switched tabs mid-upload came back to page two
  after ~25 s per page. Print intent draws the same pixels in ~10 ms without
  waiting for a frame. Found while testing in an unfocused automation tab.
- **The hero photograph is per year, so between seasons there is none** and
  the page starts at its title. If Tom wants the room photograph to stay up
  in the off-season, that is a festival-level image, a small follow-up.

### Verified

- `tsc -p tsconfig.app.json`, `vitest` (75 files, 946 tests; 12 new for
  `chooseHeroYear`, the current-vs-archive split, `pageRowsForPdf`,
  `previousGeneratedSet`), `build:staging`.
- The migration in a throwaway `postgres:15`: seed row present and readable
  as `anon`; `anon` cannot write (no grant); `authenticated` without the
  admin role updates 0 rows; admin update lands and `updated_at` moves;
  deleting a booklet cascades to its rendered pages and leaves a hand page.
- `renderPdfPages` in real Chrome against the dev server with a three-page
  test PDF: three 2000×3091 JPEGs of 66–75 KB, page 2 drawn correctly.
- The public page against staging **without** the table: renders exactly as
  before (defaults hold; 2026 still featured because the switch does not
  exist there yet).

### Staging walkthrough (2026-09-25, after Tom pushed the migration)

Migration `20260925171251` on staging; Worker version
`cf19041b-550d-48dc-87ab-b20e5caf7751`. Walked through in Chrome as
superadmin:

- Uploaded a 3-page test PDF for 2026 → rows exactly as designed: `Page 1–3`
  images at order 1–3 carrying `generated_from`, the PDF at 500 titled
  `Full programme (3 pages)` with a `cover-*.jpg` thumbnail. Tom's earlier
  hand-uploaded 2026 PDF (no marker) untouched.
- "Publish all of 2026" → the public page shows *This Year's Programme* as a
  flip-through, "Page 1 of 3", arrows turn pages, View trailer and Download
  PDF present.
- Switch on + Save → the page leads with the standing description, the
  "next festival" line replaces the lineup, no pass, and Past Programs lists
  2026 (3 pages), 2025, 2024, 2023 with 2026's trailer intact.
- Re-uploaded the same PDF → the earlier rendered set (PDF + 3 pages + cover
  object) was removed and one new set remains; the old cover URL returns 400.
- Deleted the test booklet → its three pages went with it (cascade) and all
  four objects are gone. Staging is back to Tom's original 2026 row, with
  **between seasons left ON** since that is the state Tom asked for.
- One gotcha: the service worker served the previous shell on first load
  after the deploy; a hard reload picked up the new bundle.

### To ship

```bash
cd ~/dev/kw-festival-offseason
npx supabase db push --linked                     # linked to staging; only 20260925171251 pending
npm run build:staging && npx wrangler deploy --env staging
# walk through: upload the 2026 PDF in Pages → Festival Programs, Publish all of 2026,
# flip "between seasons" on, check /silent-film-festival; then:
npx supabase link --project-ref vlmslygnimfbamrtwvyo && npx supabase db push --linked
npx supabase link --project-ref rpqzrpboyhshdrfdwayk
# merge, build:production, wrangler deploy, verify at the origin
```
