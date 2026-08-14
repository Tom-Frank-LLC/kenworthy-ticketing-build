# Brief (for Claude Code): Make the listing preview pane a vertical two-column split (portrait artwork + info)

**Status:** 🟢 Ready — CSS/layout change, one component
**Date:** August 14, 2026
**Requested by:** Tom — the listing preview screen should be **split into two columns** (artwork in one, info in the other) instead of the current stacked/landscape layout. Movie one-sheets are portrait, so a vertical artwork column shows the whole poster instead of cropping it to a horizontal band.

## What "the listing preview screen" is (verified, file:line)
The desktop **preview pane** in the home listings, `src/components/home/UpcomingList.tsx`:
- The list + preview live in a two-column grid: `grid lg:grid-cols-[1fr_1.2fr]` (**L115**) — left = the tappable showings list, right = the **preview pane** (`lg:sticky lg:top-4`, **L173+**). The pane is **desktop-only** (`hidden … lg:block`); below `lg` the list rows open the `ProductionDetailDrawer` instead (per the deliberate comment at L170 — leave that behavior).
- **Inside the pane today it's stacked ("horizontal"):**
  - artwork block on **top**: `relative aspect-[16/10] bg-muted` → `img … object-cover` (**L175–180**) — this **crops portrait posters to a 16:10 landscape band**, throwing away most of the art;
  - then the **info block below** (`p-5 md:p-6`, **L195+**): date, title, `curatorNote` synopsis (`line-clamp-5`), and the **View details / Watch trailer** buttons.

So the poster sits above the text in one narrow column. Tom wants the poster and the text **side by side**.

## The change — inside the preview pane (`UpcomingList.tsx` ~L174–226)
Restructure the pane's card interior from a vertical stack into a **two-column split**: a **portrait artwork column** beside an **info column**.

1. **Card interior → two columns.** Replace the stacked `div`s with a side-by-side layout, e.g. `flex` or `grid grid-cols-[minmax(0,2fr)_3fr]` (poster column narrower, info column wider — tune the ratio). Keep the outer card (`rounded-lg border bg-card overflow-hidden`) and the sticky wrapper.
2. **Artwork column → portrait.** Change the artwork frame from `aspect-[16/10]` to a **portrait** ratio — `aspect-[2/3]` (standard poster) or `aspect-[27/40]` (true one-sheet); keep `object-cover` so the portrait frame fills cleanly (most posters are already portrait, so cropping is minimal). Keep the **Featured** badge (L189). The bottom **gradient overlay** (L188) exists to fade a landscape image into the text beneath it — in a side-by-side layout it no longer makes sense; **drop it** (or restyle) so the poster reads as clean artwork. Keep the **"No artwork yet"** placeholder for the no-poster case (L184), sized to the same portrait frame.
   - Reference for portrait handling that already exists in the repo: `ProductionMedia`'s `aspect='auto'` mode (`src/components/ProductionMedia.tsx` ~L73: `w-full h-auto object-contain`) is the app's existing "keep the poster's real proportions" path (used by the ticketing page). Match that intent — don't invent a new cropping scheme.
3. **Info column.** Move the existing date / title / synopsis / buttons block into the right column unchanged in content. With a tall poster beside it, the synopsis can breathe — consider relaxing `line-clamp-5` (tune to taste). Keep the **View details** and **Watch trailer** buttons and their `onSelect?.(active)` wiring exactly as-is.
4. **Outer grid width.** The preview column now holds two sub-columns, so it needs more horizontal room than `1.2fr`. Widen it (e.g. `lg:grid-cols-[1fr_1.8fr]`, or trim the list column) so neither the poster nor the text gets squeezed. Tune on real content.
5. **Sticky + height.** Keep `lg:sticky lg:top-4 lg:self-start`. A portrait poster makes the pane taller — confirm it still fits common viewports; if it gets too tall, cap it (`lg:max-h-[…]`) and let the info column scroll, mirroring the list's own `lg:max-h-[560px] lg:overflow-y-auto` (L121). Only add this if it actually overflows.

## Scope / non-goals
- **Mobile is unchanged.** The split is desktop-only (`lg`), where the horizontal space exists; on phones the row still opens the drawer. Don't add a two-column split on mobile.
- This is **layout only** — no data, query, or routing changes.

## Related, but ask before touching (Decisions)
1. **`ProductionDetailDrawer`** (`src/components/ProductionDetailDrawer.tsx`) — the click-through detail (and the mobile view) currently shows the poster cropped to 16:9 on top via `ProductionMedia aspect='video'`. For consistency with "posters are vertical," we *could* switch it to the existing `aspect='auto'` portrait mode and/or a side-by-side split on wider screens. **In scope for this brief, or leave the drawer as-is?** (Tom asked specifically about the preview screen — default: leave the drawer, flag for later.)
2. **`EditorialCalendar` featured block** (`src/components/home/EditorialCalendar.tsx` L85, `aspect-[16/10]`) uses the same landscape treatment. Align it to portrait too, or leave? (Default: leave.)
3. **Artwork fit:** `object-cover` on a 2:3 frame (fills, tiny crop — recommended) vs. `object-contain` (whole poster, may letterbox non-standard art).
4. **Poster/info width ratio** in the pane — start ~2:3 (poster:info) and tune.

## Test plan
- On desktop (`lg+`), selecting a showing shows the preview with the **poster in a portrait column on one side** and title/synopsis/showtime/buttons in the other — a real one-sheet is shown whole, not cropped to a landscape strip.
- A listing with **no artwork** shows the placeholder in the portrait frame; layout doesn't collapse.
- **Featured** badge still renders on the poster.
- **View details** and **Watch trailer** still open the drawer.
- The pane stays **sticky** while the list scrolls; nothing overflows the viewport awkwardly.
- **Below `lg`**, behavior is unchanged (tap row → drawer); no two-column preview appears on mobile.
- `npm run build` passes.

---

## Outcome (Aug 14, 2026) — 🟢 Done

### The brief's line references were stale
The preview pane had already been extracted out of `UpcomingList.tsx` into
**`src/components/home/ShowingPreview.tsx`**, and it now has **two** consumers,
not one:

- `src/components/home/UpcomingList.tsx` (home "Upcoming"), and
- `src/pages/Calendar.tsx` L118–135 (the Calendar page's desktop List view).

So this was a shared-component change. Both callers' outer grids were widened
to match, or the second one would have been left squeezing the new poster
column: `UpcomingList` `1.2fr → 1.8fr`, `Calendar` `1.1fr → 1.6fr`.

### Decision 3 (artwork fit) was resolved by measurement, not taste
The brief recommended `object-cover`, reasoning that "most posters are already
portrait, so cropping is minimal." **That premise is only two-thirds true**, and
the failure is visible: on `Farmers Market Cartoons` (1545×1999, ratio 0.773)
a 2:3 `cover` crop sliced the word "CARTOONS" clean off the poster.

Measured every reachable `poster_url` across `movies` + `events` on staging
(n=22 that resolved; **28 of 50 returned HTTP 404** — see below):

| | ratio |
|---|---|
| min | 0.625 |
| **median** | **0.667** (exactly 2:3) |
| max | 1.193 (landscape) |

14 of 22 fall in the 0.625–0.675 one-sheet cluster. The other 8 do not:
0.750, 0.773 ×3, 0.800 ×2, 1.000 (square), 1.193 (landscape).

**Therefore:** `aspect-[2/3]` is the right frame (it *is* the median and the
modal cluster), but the fit must be **`object-contain`**, not `object-cover` —
otherwise that non-conforming third gets cropped, worst on exactly the
community-made graphics whose titles live near the edge. This matches the
intent of `ProductionMedia`'s existing `aspect='auto'` path (show the whole
poster) while keeping a *fixed* frame.

### Why a fixed frame rather than natural height
Clicking all 20 upcoming rows in the browser gives a **constant 513px card
height** for every one of them. A natural-height poster (`w-full h-auto`)
would have resized the sticky pane on every selection; the fixed 2:3 frame
means the pane holds still while only its contents change.

### Verified in a browser (staging data, 1440px)
Whole poster shown portrait beside the info column · no-artwork placeholder
holds the portrait frame without collapsing · Featured badge still anchors
top-left of the poster · Get Tickets / All showings intact · Calendar List view
gets the same treatment · gradient scrim dropped (it existed only to fade a
landscape image into copy beneath it, and nothing sits beneath it now) ·
synopsis relaxed `line-clamp-5 → line-clamp-[10]` and now finishes.

**Mobile untouched, verified in code rather than by resizing:** `ShowingPreview`
is `hidden lg:block` in `UpcomingList`, and `Calendar` gates it behind
`inlinePreview = view === 'list' && splitLayout` (`min-width:1024px`). The
internal split therefore carries no breakpoint of its own and can never render
below `lg`.

`build:staging` passes, 146/146 tests pass. (The one eslint error in
`Calendar.tsx` is pre-existing, at L19 `useState<any>`, untouched here.)

### Flagged, not fixed — separate from this brief
1. **28 of 50 `poster_url` values on staging return HTTP 404.** A dead URL is
   not null, so it renders a broken `<img>` rather than the "No artwork yet"
   placeholder. Pre-existing, but a portrait frame makes the hole bigger. Worth
   either an `onError` fallback to the placeholder, or a data cleanup.
2. `ProductionDetailDrawer` and `EditorialCalendar` still use the landscape
   treatment — left alone per the brief's defaults (Decisions 1 and 2).
