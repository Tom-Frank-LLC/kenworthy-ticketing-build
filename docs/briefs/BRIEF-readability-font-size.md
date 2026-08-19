# Brief (for Claude Code): Raise default readability & font size across the platform (older patron base)

**Status:** ✅ Shipped to production August 19 2026 — `ac3e857` (PR #100) and `36203da` (PR #101), deployed as `fc2765d8`. See `FINDINGS-readability-font-size.md`, including two things this brief got wrong.
**Date:** August 15, 2026
**Requested by:** Tom — the Kenworthy's patrons skew older, so the **default** reading experience should be more accommodating everywhere: larger base text, a sensible minimum size, comfortable line spacing, and adequate contrast. This is about the shipped default, not an opt‑in widget.

## Current state (verified)
- **Base text:** `body` is **17px**, `line-height 1.6`, font‑family **Fraunces** (serif) — `src/index.css:79–83`. `html` has **no explicit font‑size**, so it defaults to **16px**.
- **Type scale:** Tailwind's **default** scale (no custom `fontSize` in `tailwind.config`), and those sizes are **rem‑based off the 16px root** — so `text-xs`=12px, `text-sm`=14px, `text-base`=16px, regardless of the 17px body value.
- **Small text is pervasive** (the core problem for older readers): **~84 files use `text-xs` (12px)**, **~100 use `text-sm` (14px)**, and **28 spots use `text-[10px]`/`text-[11px]`** — the last of these is too small for anyone, let alone an older audience. Much of this small text is also `text-muted-foreground` (secondary color) — small *and* lower‑contrast, the worst combination.

## Approach — proportional first, then a floor (preserve hierarchy)
Do the cheap global lever before touching 84 files individually.

### 1. Raise the root size (the single biggest lever, one line)
Set the root font‑size up so **every rem‑based `text-*` class scales together**, keeping the visual hierarchy intact:
- `html { font-size: 112.5%; }` (18px) — recommended starting point (Decision 1: 17px/106% vs 18px/112.5% vs 19px/118%).
- Reconcile the body's **absolute 17px** to a **rem** value (e.g. `body { font-size: 1rem }` or `1.0625rem`) so the body scales with the root instead of pinning to 17px. After an 18px root: `text-sm`≈15.75px, `text-base`=18px, `text-xs`≈13.5px — an immediate, even lift everywhere.
- Because sizes stay in `rem`, this also makes **browser zoom and OS "large text" settings** work correctly — don't reintroduce fixed `px` font sizes that block scaling.

### 2. Set a minimum readable size (kill the tiny classes)
- **Eliminate `text-[10px]` / `text-[11px]`** (28 spots) — raise to at least `text-xs`, and to `text-sm` where it's actual reading (not a decorative micro‑label).
- **Audit `text-xs` on real body copy** — prices, showtimes, dates, descriptions, form labels, helper text, buttons, nav — and raise those to `text-sm` (or `text-base` for primary reading). Truly incidental chips/badges can stay at the small end but **no smaller than ~12–13px effective** after the root bump.
- Prioritize by where patrons actually read and act: the **listings/calendar, showing & checkout, film passes, donate, and all forms/labels/buttons** first; deep admin tooling can lag.

### 3. Line height & spacing
- Keep body `line-height` generous (≥1.6; consider **1.65** for long copy). Ensure paragraphs, list items, form fields, and buttons have comfortable leading and tap/click size after the size bump.

### 4. Contrast (pairs with size for real readability)
- `--muted-foreground` (`38 10% 65%`) is used everywhere for secondary text. Verify it clears **WCAG AA 4.5:1** against the dark background at the new small sizes; if it's marginal, **raise its lightness** a few points. (This is the *fixed* neutral text color — separate from the adjustable purple/green in the Color Lab brief, but the same readability goal: the magenta primary already sits at only ~4.6:1, so don't let secondary text be worse.)

### 5. Keep the brand fonts
Keep **Anton** (display headings) and **Fraunces** (body serif) — this is a size/contrast/leading change, not a typeface change. (Decision 3 if Tom wants to reconsider the body serif for small‑size legibility.)

## Verify — this is where a global type bump goes wrong (do not skip)
Enlarging every rem size can break fixed layouts — "mechanically applied, visually broken." After the change, do a **visual regression pass** (before/after screenshots at ~375px, ~768px, ~1280px) across: **home list + calendar views, a showing/checkout page, film passes, donate, the rental form, admin dashboard + StaffPOS, and the footer.** Specifically inspect the known‑fragile spots:
- **The month calendar's fixed cells** — `MonthCalendar.tsx` uses `md:grid-cols-[repeat(7,minmax(0,132px))]`; larger text may overflow or clip. Adjust cell sizing/truncation as needed.
- **Buttons, top nav, and tab rows** wrapping or overflowing at the larger size.
- **Tables / receipts / QR ticket layouts** (box‑office receipts, POS) staying aligned.
- **Badges/pills** not blowing up out of proportion.
Fix the layout casualties as part of this brief — the deliverable is "bigger *and* still tidy," not just bigger.

## Decisions for Tom
1. **Root size:** 17px (106%), **18px (112.5%, recommended)**, or 19px (118%)? (Bigger is friendlier but stresses layouts more.)
2. **Minimum floor aggressiveness:** just kill `≤11px` and raise body‑copy `text-xs`→`text-sm` (recommended), or push further and bump `text-sm`→`text-base` broadly?
3. **Body typeface:** keep Fraunces serif (recommended) or evaluate a more neutral sans for small‑size legibility?
4. **Optional future add:** a user‑facing **text‑size control** (A / A+ / A++) that scales the root and remembers the choice per session — nice for accessibility, but out of scope unless you want it now.

## Test plan
- The whole site renders visibly larger by default; no meaningful text remains below the chosen floor; `grep` shows no `text-[10px]`/`text-[11px]` left on patron‑facing screens.
- Body copy line‑height is comfortable; secondary (`muted-foreground`) text meets AA contrast at the new sizes.
- Browser **zoom** and OS large‑text settings still scale the UI (rem preserved).
- The regression pass shows the fragile areas (calendar cells, nav, buttons, tables, ticket/QR) intact at all three breakpoints.
- `npm run build` passes.
