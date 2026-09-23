---
brief: site-performance
title: The admin dashboard loads a fraction of what it did, and the public pages stop re-downloading the catalogue on every navigation
status: built
track: ux
severity: P2
date: 2026-09-22
verified: false
findings: FINDINGS-site-performance.md
---

# Brief: Site performance — admin dashboard weight and public navigation

**Status:** built 2026-09-22, not yet deployed. The migration is **not applied anywhere yet** — the auto-mode classifier refuses `supabase db push` even against staging, so Tom pushes it to staging first, checks the dashboard there, then production *before* the Worker deploy (see *Deploy order*). Until it has run on staging, "the RPC pages through `.order().range()`" is PostgREST's documented behaviour for set-returning functions, not something this session observed.
**Date:** September 22, 2026
**Requested by:** Tom — "the team is wondering if we can speed up the site (load time, navigation)." The person who raised it works the events back end, and the measurements agreed with that instinct: the public site was already in reasonable shape; the admin dashboard was not.

## What was measured (before)

Production build of `origin/main` (`b10bc0c`), Vite 8.1.5 / Rolldown. Gzipped
transfer sizes unless marked raw.

| | raw | gzip |
|---|---|---|
| `AdminDashboard-*.js` | 1,111 KB | 309 KB |
| Home page, everything `index.html` loads eagerly (20 chunks) | 841 KB | 247 KB |

The admin chunk carried recharts, the xlsx parser and jsPDF — confirmed by
grepping the emitted file — because `AdminDashboard.tsx` statically imported
all thirty tab components. Every admin download and parsed all of it to open
Listings.

Separately, `AdminDashboard.loadData()` fetched every confirmed ticket ever
sold (`id, showing_id, scanned_at`, paged 1,000 at a time) on every mount and
counted per showing in the browser with a `filter()` per badge. Unbounded in
both bytes and CPU as the theatre sells more tickets.

On the public side, `useFeed` (Calendar) and an inline copy of the same fetch
in `Index.tsx` (home) each ran the four catalogue queries on every mount, with
no cache. Home → Calendar → Home was three full downloads of the same data.
The audit's note that `useFeed` had five consumers was wrong: it had one, and
the home page had its own duplicate builder. That duplication is the actual
cause of the navigation cost, and is what this fixes.

## What changed

### 1. Every admin tab is its own chunk (`src/pages/admin/AdminDashboard.tsx`)

The tab components are `lazyWithRecovery()` imports — the same helper the
routes use in `App.tsx`, so a deploy that removes a chunk from under an open
dashboard reloads once instead of blanking on the next tab click. Each panel
body sits in a `<Suspense>` with the same "Loading..." fallback the routes
render. Radix mounts only the active `TabsContent`, so only the selected tab's
chunk is requested. `SquareLinkPanel` stays static: it is on the default tab.

### 2. Ticket counts are aggregated in the database (`showing_ticket_counts()`)

Migration `20260922233021_showing_ticket_counts.sql`. A `STABLE SECURITY
INVOKER` set-returning function: `showing_id, sold, scanned` grouped from
confirmed tickets. Invoker, so `tickets` RLS decides what is counted and there
is no admin check to keep in step with the policies; anon revoked all the same.
The dashboard pages it through `fetchAllRows` like every other read (PostgREST
caps RPC results at the same 1,000 rows, and there are more showings than
that) and keeps a `Map<showing_id, {sold, scanned}>`. The "Tickets Sold" total
sums `sold` across every row, including a `showing_id IS NULL` group if one
exists, so it still equals the old `tickets.length`.

### 3. One cached feed for home and calendar (`src/hooks/useFeed.ts`)

`useFeed` is a react-query hook on key `['feed']` with a 60 s `staleTime`;
`fetchFeed` is exported for anything that wants the data without the hook.
`Index.tsx` now calls `useFeed` instead of its own copy, so the second page
renders from cache and revalidates in the background. `QueryClient` in
`App.tsx` gets the same 60 s default. The `showings` query names its columns
(`SHOWING_FEED_COLUMNS`) because the raw row never leaves the file; events and
live performances still come back whole because their rows *do* — as
`productionsById`, which the detail drawer reads. `useFeed.test.tsx` pins the
feed shape, the named columns and the cache hit.

## What was measured (after)

| | raw | gzip |
|---|---|---|
| `AdminDashboard-*.js` | 59 KB | 15 KB |
| Home page eager set (30 chunks) | 850 KB | 252 KB |

recharts, xlsx and jsPDF no longer appear in the admin chunk (`grep -c
recharts dist/assets/AdminDashboard-*.js` → 0) and still do not appear in the
public entry.

**The home page eager set grew by 4.6 KB gzip and ten small chunks**, and that
is deliberate. 2.1 KB / ten chunks: modules that were shared between the entry
and the one admin chunk (a few lucide icons, `datetime`, `genres`, `richText`,
date-fns `format` and its `en` locale) are now shared between the entry and
many tab chunks, and Rolldown emits each such sharing pattern as its own small
chunk. The remaining 2.5 KB is react-query's `useQuery` code, newly reachable
from the home page. Rolldown's only merge control is group-based
`advancedChunks`, which is the shared-vendor-chunk trap the note in
`vite.config.ts` records; it was not worth reopening for ~2 KB. The ten chunks
preload in parallel and the service worker caches them after the first visit.

## Deploy order

The migration must be on production **before** the Worker deploy: the new
dashboard calls `showing_ticket_counts()`, and without it every ticket badge
reads 0 / 0 and "Tickets Sold" reads 0. The public pages do not depend on it.

1. `npx supabase link --project-ref vlmslygnimfbamrtwvyo` (needs the prod DB
   password), `migration list --linked` to confirm only `20260922233021` is
   pending, `db push --linked`, link back to staging.
2. Deploy the Worker per `CLAUDE.md` (record the current Version ID first).
3. Verify on the live dashboard: badge numbers match what they showed before,
   the Network tab shows one `rpc/showing_ticket_counts` call and no paged
   `tickets` fetch, and a tab click fetches that tab's chunk.

## Not done (from the audit's Finding 4)

- A realtime-free Supabase client build for the public bundle.
- A poster image sizing / `loading="lazy"` pass against live data.
- Trimming `events` / `live_performances` to named columns — needs an audit of
  what the drawer, `ProductionMedia` and `purchasable.ts` read off the row
  first, and the tables are tiny.
