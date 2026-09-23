# Audit: Site performance (load time & navigation)

**Status:** ✅ Measured, not guessed. Ran a real production build and inspected the emitted chunks + the data-fetch paths. The headline: the **public site is already well-optimized**; the **admin / events back-end is where the weight is**, which matches the staff report. The single biggest lever is the admin dashboard — one 309 KB-gzip JavaScript chunk that also re-downloads *every ticket ever sold* on each visit.
**Date:** September 22, 2026
**Requested by:** Tom — "the team is wondering if we can speed up the site (load time, navigation)." Steer: the person who flagged it "deals with events on the back end, so maybe it is slower in those areas." That instinct is correct.

## How this was measured
Built `origin/main` (`b10bc0c`) with `vite build --mode production` (Vite 8.1.5 / Rolldown) and inspected the output: which chunks `index.html` eagerly loads, their gzipped transfer sizes, and which libraries land in which chunk (grep for library symbols in the emitted JS). Then read the actual fetch paths (`useFeed.ts`, `AdminDashboard.loadData`) end-to-end. Numbers below are gzipped transfer sizes (what the browser actually downloads) unless noted "raw."

---

## What's already good (don't re-do these)
- **Route-level code-splitting is working.** All ~45 routes are `lazyWithRecovery(() => import(...))` in `App.tsx`, and the heavy libraries are correctly kept out of a ticket-buyer's download. Confirmed by grepping the entry chunk: **no recharts, xlsx, jspdf, tiptap, or embla in the public bundle.**
- **The `manualChunks` decision is right.** `vite.config.ts` documents (and I re-verified) that forcing vendor chunks made things *worse* by module-preloading recharts/jsPDF onto the home page. Leaving it to Rolldown is correct — don't reintroduce `manualChunks`.
- **The service worker shell strategy is sound** (network-first shell, cache-first hashed assets, images stale-while-revalidate). No change needed.
- **Public first-load is reasonable:** ~**241 KB gzip** total eager (~730 KB raw) for the home page — entry app 95 KB, react-dom 43 KB, Supabase client 43 KB, CSS 20 KB, DOMPurify 11 KB, plus small Radix/util chunks. Not the problem.

---

## Findings, ranked by impact

### 🔴 1. The admin dashboard is one 309 KB-gzip chunk (1.11 MB raw)
`dist/assets/AdminDashboard-*.js` = **1,111 KB raw / 309 KB gzip** — by far the largest chunk in the build (next largest reachable-on-demand chunks are separate: html2pdf 219 KB gz, TicketScanner 114 KB gz, sponsorship PDF 131 KB gz).

**Root cause (verified):** `src/pages/admin/AdminDashboard.tsx` (lines 22–53) **statically imports all ~30 tab components** at the top of the file — `AnalyticsTab`, `TransactionsTab`, `AccountingTab`, `ChartOfAccountsTab`, `QboExportTab`, `LaborTab`, `SponsorsTab`, `FilmPassesTab`, `SquareCatalogTab`, `MailchimpTab`, `LglTab`, `NotificationsTab`, and the rest. Because they're static, Rolldown bundles every tab **plus the libraries they pull in** into the one AdminDashboard chunk. Confirmed by grep inside the emitted chunk: **recharts (16 hits, from `AnalyticsTab`/`LaborVsSales`), xlsx (from `AccountingTab` → `parseFinancialXlsx`), jsPDF (from `LaborTimecards`).**

So an admin or events staffer downloads and parses all of recharts + xlsx + jsPDF + every tab's code **before the dashboard renders**, even though they open one tab. On a mid-tier laptop or a slower connection (the back-office reality), that parse/execute cost is exactly the "it's slow" they're describing. recharts (~5.5 MB unpacked) and xlsx (~7.4 MB unpacked) are the two heaviest passengers and are needed by only two tabs (Analytics, Accounting).

**Fix:** apply the *same* `lazy()` pattern already used at the route level, one level deeper — lazy-load each tab component inside AdminDashboard so each becomes its own chunk loaded on tab-select. This drops the initial admin download from ~309 KB gz to a small shell + the default tab, and recharts/xlsx/jsPDF load only when Analytics/Accounting is actually opened. Wrap the `<TabsContent>` bodies in `<Suspense>` with a lightweight fallback. Highest impact, low risk, isolated to one file's import list.

### 🔴 2. The dashboard re-downloads *every confirmed ticket ever sold* on each visit
`AdminDashboard.loadData()` (`src/pages/admin/AdminDashboard.tsx:192–224`) runs on every mount and fetches, uncached:
- all movies, all events, all live_performances (paged),
- all showings **with four joins** (`*, movies(title), events(title), live_performances(title), venues(name)`),
- all venues + seat counts,
- and **all confirmed tickets of all time** — `supabase.from('tickets').select('id, showing_id, scanned_at').eq('status','confirmed')`, paged 1,000 rows at a time (L216).

Then it computes sold/scanned counts **in the browser** with repeated array scans: `getTicketsSoldForShowing` / `getScannedForShowing` / `...ForEvent` / `...ForConcert` all do `tickets.filter(...)` (L230–249), i.e. **O(showings × tickets)** work per render. Both the download and the compute grow **without bound as the theatre sells more tickets** — so the dashboard gets measurably slower every month, and it's worst for the person who lives in it. This is the strongest structural match for the back-end report.

**Fix (address the cause):** move the counts to the database. A single grouped read — an RPC or a view returning `showing_id → (sold, scanned)` (`SELECT showing_id, count(*), count(scanned_at) FROM tickets WHERE status='confirmed' GROUP BY showing_id`) — replaces the full-table download with a small aggregate, and the browser stops doing O(n·m) filtering. If a full rework is too big for one pass, the interim is to fetch counts only for the showings actually on screen. Either way, stop pulling the entire ticket table to the client.

### 🟡 3. `useFeed` refetches the whole catalog on every navigation (no caching)
`src/hooks/useFeed.ts` uses a raw `useEffect(..., [])` — **not** react-query — so it refetches movies + events + live_performances + showings **on every mount**. It's consumed by five components (`Index`, `Calendar`, `TrailerFeed`, `BoothNote`, `MonthCalendar`), so navigating home ↔ calendar ↔ back re-runs the full four-query fetch each time. This is the "navigation feels sluggish" half of the request.

Two sub-issues in the same file:
- **Over-fetch:** movies are correctly scoped (`MOVIE_PUBLIC_COLUMNS`), but events, live_performances, and showings use `select('*')` (L37–41), pulling every column including ones the feed never reads.
- **No shared cache:** `App.tsx:78` is `new QueryClient()` with **no `defaultOptions`** (staleTime 0, refetchOnWindowFocus true) — but it doesn't even matter here because `useFeed` bypasses react-query entirely.

**Fix:** move `useFeed` into react-query with a stable `queryKey` (e.g. `['feed']`) and a sensible `staleTime` (30–60 s), and set `QueryClient` defaults so a back-navigation within the stale window is **instant from cache** instead of a fresh round-trip. Trim the three `select('*')` calls to the columns the feed maps. Low risk; visible navigation win on the public side.

### 🟢 4. Smaller items (nice-to-have, not causes)
- **Supabase Realtime is in the eager public bundle.** The Supabase client chunk (43 KB gz / 163 KB raw) includes `RealtimeClient` (Phoenix websocket). If the public site never subscribes to realtime, importing a realtime-free client build would shave a bit off first load — worth checking, low priority.
- **DOMPurify (11 KB gz) loads eagerly on home.** Fine if listings sanitize on render; not worth chasing.
- **Poster images:** confirm posters are sized/compressed and lazy (`loading="lazy"`) below the fold — image bytes usually dwarf JS on a media-heavy home page. Not measured here (depends on live data), but the cheapest real-world win if posters are large. Worth a quick check against the live site.

---

## Recommended order of work
1. **Split the admin dashboard tabs with `lazy()` + `<Suspense>`** (Finding 1) — biggest back-end win, one file, low risk. Do this first.
2. **Aggregate ticket counts in the DB** (Finding 2) — removes the unbounded, ever-growing download + client compute. The durable fix for "it keeps getting slower."
3. **Move `useFeed` to react-query + trim `select('*')` + set QueryClient defaults** (Finding 3) — the public navigation win.
4. Optional: realtime-free public client, poster-image pass (Finding 4).

Items 1–3 are each a self-contained brief. Suggested next step: turn **Finding 1** into an implementation brief for Claude Code first (fast, high-impact, low-blast-radius), then Finding 2.

## Verification for whoever implements
- After the tab split: rebuild and confirm the AdminDashboard chunk drops sharply and recharts/xlsx/jsPDF no longer appear in it (`grep -c recharts dist/assets/AdminDashboard-*.js` → 0); confirm each tab still renders behind its Suspense fallback and the public bundle is unchanged (`grep recharts dist/assets/index-*.js` → still 0).
- After the ticket-count change: confirm the dashboard no longer issues the full `tickets` paged fetch (network tab shows one small aggregate), badge numbers still match, and load time is flat regardless of total tickets sold.
- After the `useFeed` change: confirm a home→calendar→home round-trip serves from cache within the stale window (no repeat network calls), and listings still render identically.
- `npm run build` + `npm test` pass at each step.
