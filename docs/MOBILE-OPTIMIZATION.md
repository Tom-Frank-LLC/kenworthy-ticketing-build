# Mobile Optimization — P0 + P1 implementation notes

**Date:** August 12, 2026
**Scope delivered:** Priority 0 (blockers) and Priority 1 (app-shell baseline) from
the mobile optimization brief. P2 (staff polish) and P3 (Capacitor) are **not**
done — see [What is still open](#what-is-still-open).

---

## Why this was needed

The site was desktop-first with **no mobile navigation layer at all**. Every
header link was behind a `sm`/`md`/`lg` breakpoint with nothing replacing it, so
below 640px a visitor could reach nothing but Sign In and a "Get Tickets" button
that pointed at an anchor which does not exist. That is now fixed, along with
the first-load weight that made the site slow to reach in the first place.

---

## What changed

### P0-1 · Mobile navigation drawer

**New file:** `src/components/MobileNav.tsx`, wired into `src/components/Layout.tsx`.

A `Menu` button (44×44) in the header opens a left-side `Sheet` containing every
destination: primary links (What's On, Theatre Rentals, DVD Rentals, Donate),
account links, role/staff shortcuts, and the Info and Support groups. Rows are
`min-h-[48px]`, above the ~44px touch floor. It hides at `lg`, which is the first
width where the desktop bar is complete.

Supporting header changes in `Layout.tsx`:

- Role buttons (Admin / POS / Scan / Superadmin / Host) and the "Me" dropdown are
  now `hidden lg:inline-flex` / `hidden sm:inline-flex` — they are all reachable
  in the drawer, and at 375px they crowded out the logo.
- Left-cluster gap is `gap-3 sm:gap-6 md:gap-8` instead of a flat `gap-6`.
- The header carries `pt-[env(safe-area-inset-top)]` for notch clearance.

The drawer closes on route change (a `useEffect` on `location`), because links
navigate without unmounting the sheet.

### P0-2 · Dead primary CTAs

| Location | Was | Now |
| --- | --- | --- |
| `Layout.tsx` "Get Tickets" | `/#calendar` | `/calendar` |
| `MyTickets.tsx` empty state | `/#now-showing` | `/calendar` |

Neither `id="calendar"` nor `id="now-showing"` existed anywhere in the app, so
both buttons scrolled nowhere. A repo-wide grep confirms no remaining `/#`
anchor links.

### P0-3 · Seat map on a phone

`src/components/SeatMap.tsx` is now a zoom/pan surface instead of a fixed ~900px
grid in an `overflow-x-auto` box.

- Opens **fitted to width**, so the whole 265-seat house is visible at 375px.
- One finger pans via **native scrolling** — this was deliberate: native scroll
  keeps taps on seats unambiguous, which a JS drag handler would not.
- Two fingers pinch-zoom; `⌘/Ctrl + scroll` zooms on desktop. Both need
  non-passive listeners, so they are attached natively rather than via React's
  synthetic events.
- Explicit `−` / `+` / `Fit` controls (44px) for anyone who cannot pinch.
- Zoom is focal-point anchored: the point under the fingers/cursor stays put
  across the scale change.

Measured on the real seat data at a 375px viewport:

| | Seat target |
| --- | --- |
| Fit-to-width (overview) | 11px |
| After 4 taps of `+` | 37px |
| After 5 taps of `+` | **50px** (above the 44px minimum) |
| Max zoom (2.5×) | 70px |

`src/pages/Showing.tsx` also gains a **sticky mobile order bar** (`lg:hidden`):
on a phone the Order Summary column stacks *below* the map, so the running total
and the route to checkout were a screenful away from the seat just tapped. The
bar shows ticket count, seat labels and total, and scrolls to `#order-summary`.

### P1-4 · PWA / app-shell baseline

- `public/manifest.webmanifest` — name, scope, `display: standalone`,
  `theme_color`, shortcuts to What's On and My Tickets.
- `public/icons/icon-{192,512}.png`, `public/icons/icon.svg`,
  `public/apple-touch-icon.png` — generated from the existing marquee mark on
  the `#0f0f0f` marquee black, inset to 68% so they clear the Android maskable
  safe zone.
- `index.html` — `viewport-fit=cover`, `theme-color`, `color-scheme`,
  `apple-mobile-web-app-*`, `mobile-web-app-capable`, manifest and
  apple-touch-icon links.
- `src/index.css` — `html` gets the background colour (edge-to-edge painting
  under `viewport-fit=cover` otherwise flashes white), `-webkit-tap-highlight-color`
  is cleared, and `.pt-safe` / `.pb-safe` / `.px-safe` utilities are available.
- Service worker via `vite-plugin-pwa` (`registerType: 'autoUpdate'`).

**The service worker deliberately does not precache the JS bundles.** It
precaches only the shell (HTML/CSS/SVG/fonts, 6 entries / 112KB) and
runtime-caches hashed assets `CacheFirst` on first use. Precaching everything
would bulk-download the admin tree over cellular — exactly what the code
splitting below exists to prevent.

### P1-5 · Code splitting

`src/App.tsx` now uses `React.lazy` for every route except the home page and
`NotFound`. The whole `/admin/*` tree — POS, scanner, recharts, xlsx, jspdf,
html2pdf, html5-qrcode — is out of a ticket buyer's download.

| | Before | After |
| --- | --- | --- |
| First-load JS + CSS | one ~3.6MB chunk | **694KB raw / 198KB gzipped** |
| Largest lazy chunks | (all in the entry) | AdminDashboard 972KB, html2pdf 720KB, TicketScanner 372KB |

> ### Trap: do not add `manualChunks` here
>
> Grouping recharts/xlsx/jspdf/html5-qrcode into named vendor chunks made things
> **worse**. A manual chunk becomes a *shared* chunk, which Vite then emits as a
> `<link modulepreload>` on `index.html` — so the home page eagerly downloaded
> recharts and jsPDF (~1.8MB) it never uses. Rolldown's default splitting already
> places those libraries in chunks reachable only from the lazy admin routes.
> `vite.config.ts` carries this note; verify with:
>
> ```sh
> grep -o 'assets/[^"]*' dist/index.html
> ```
>
> No heavy vendor chunk should appear in that list.

### P1-6 · Images

Optimized variants live in `src/assets/optimized/`. **The full-resolution
originals in `src/assets/` are untouched** — they are simply no longer imported,
so they stop being bundled while remaining available as archival masters.

- Hero (`KPACmarquee.jpg`, 3810×2542, 1.9MB) → `hero-{768,1280,1920}.{jpg,webp}`,
  served through a `<picture>` with `srcSet`/`sizes="100vw"` and
  `fetchPriority="high"`. **A phone now pulls ~38KB instead of 1.9MB.**
- 14 history JPGs (1.2–1.9MB each, near-lossless) → capped at 1440px, WebP.
  `src/pages/History.tsx` imports the optimized files; markup is unchanged and
  was already `loading="lazy"`.
- Source image weight: **11MB → 1.9MB**. Total images in `dist`: 2.5MB.

Regenerate with `sips` + `cwebp` (both already on macOS/homebrew here):

```sh
sips -Z 1440 --setProperty format jpeg --setProperty formatOptions 72 in.jpg --out out.jpg
cwebp -q 72 out.jpg -o out.webp
```

### P1-7 · Container gutters

`tailwind.config.ts` container padding was a flat `2rem` — 64px, 17% of a 375px
screen. Now `1rem` → `1.5rem` at `sm` → `2rem` at `lg`.

---

## Bug found while verifying

The home page **overflowed horizontally by 112px at 375px**. Cause: in
`src/components/home/UpcomingList.tsx` the list and preview are grid items, and
grid items default to `min-width: auto`, so a long showing title pushed the
column past the viewport and the `truncate` on the title could never engage.
Fixed by adding `min-w-0` to both grid children. Verified `scrollWidth ===
clientWidth` at 375px afterwards.

---

## Three brief claims that did not hold up

1. **"`useIsMobile`'s 768px breakpoint doesn't match Tailwind's."** It does —
   768px *is* Tailwind's `md`. No change was needed; `src/hooks/use-mobile.tsx`
   now documents the coupling and exports `MOBILE_BREAKPOINT` so it stays
   deliberate.
2. **"`vite-plugin-pwa` — consider `manualChunks`."** See the trap above.
   `manualChunks` is actively harmful with Rolldown here.
3. **Assigned seating is not in use.** Answering the brief's open question 4:
   **zero of 34 production showings** have `requires_seat_selection = true` (same
   in staging). Every showing is currently general admission, so the seat map is
   not on today's critical path — the work is done and correct, but it should not
   be treated as a launch blocker. The POS reuses the same component, so it
   benefits automatically whenever assigned seating is switched on.

---

## How this was verified

- `npm run build:staging` — exit 0.
- `npm test` — 26 tests, 5 files, all passing.
- `npx tsc --noEmit -p tsconfig.app.json` — clean **except** two pre-existing
  errors in `src/hooks/useAdminListings.ts` (lines 220 and 275, enum-narrowing on
  `listing_type` / `performance_type`). That file is untracked work in progress
  and was not touched here. `vite build` does not typecheck, so it does not block
  deploys, but it should be cleaned up.
- Rendered at a true 390px viewport in Chrome: drawer opens with all 16 links,
  seat map fits and zooms to 50px targets, seat taps register, no horizontal
  overflow anywhere.

---

## What is still open

**P2 — staff mobile polish (not started):**

- POS Sell button buried on mobile; needs a sticky bottom Order-Summary + Sell
  bar (`StaffPOS.tsx:526,653` — the existing `sticky` only sticks within its column).
- Cash sale has no tendered/change entry (`StaffPOS.tsx:321`).
- Nested sub-tab bars clip at 375px — Analytics, Concessions, Rentals,
  HostDashboard. Reuse the arrow-pager already in `AdminDashboard.tsx:296-322`.
- List-row icon actions are ~36px; nudge to 44px.

**P3 — Capacitor / store builds (not started):** blocked on the Apple Developer
and Google Play org accounts. The PWA baseline above is the substrate Capacitor
reuses, so this is now mostly configuration.

**Deliberately left desktop-first**, per the brief: analytics charts,
accounting/labor tables, and `ScheduleBuilder`.

**Housekeeping:** `src/assets/history/Milburn-Day1930s.jpg` (1.8MB) and
`Milburn-Day-crowd-1930s.jpg` were already unreferenced before this work and
still are.
