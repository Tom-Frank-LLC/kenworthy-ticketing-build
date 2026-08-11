# Kenworthy Ticketing — Tasks & Refactor Log

> Living document. Known issues, planned refactors, and technical debt found during and after the launch push. Update as items are added, started, or completed.
>
> **Legend:** 🔴 Launch blocker · 🟡 Soon after launch · 🟢 Backlog · ✅ Done

---

## Active / Launch Blockers

### 🔴 History page images broken (Lovable asset stubs)
The 10 archival photos in `src/assets/history/*.jpg.asset.json` are **Lovable CDN pointers**, not real files — their `url` fields are Lovable-internal (`/__l5e/...`) paths that don't resolve on Cloudflare. Unlike movie posters, there is no WordPress source to rehost from; the actual JPEGs live only on Lovable's R2 storage.
**Fix (do while Lovable is still accessible):** retrieve the 10 originals from the Lovable project (preview page or asset export), drop real `.jpg` files into `src/assets/history/`, and change `History.tsx` imports from `*.jpg.asset.json` + `imgX.url` to direct `*.jpg` + `imgX` (same pattern as the logo and hero fixes). Fallback sources: kenworthy.org/history, or originals from KPAC.
**Urgency:** the retrieval window closes when Lovable is disconnected.

### 🔴 Ticket delivery — confirmation email + SMS (see `BRIEF-ticket-email.md`)
`guest-checkout` never delivers the ticket. It creates the account and stores the ticket, then only fires Mailchimp *marketing* sync — no transactional confirmation. Confirmed via prod test: email purchase → nothing; phone purchase → nothing; account created silently.
Required: transactional email (likely Resend) with QR; **SMS delivery for phone purchases** (Twilio vs. Mailchimp SMS — see decision note below); account-access path for guest-created accounts; custom SMTP on both Supabase projects for auth email at scale; a public mobile-friendly QR ticket page for the SMS link.
**In progress:** Claude Code is building the `ticket-access` edge function, `src/lib/tickets.ts`, `_shared/tickets.ts` (server-side QR PNG for email), and the `/t/:token` public ticket page. Not yet committed as of this writing.
Cleanup: remove test purchase data created in production during diagnosis.

**SMS provider decision (pending Colin):** Mailchimp now offers transactional SMS, but it requires an existing paid SMS marketing plan and shares SMS credits between marketing and transactional (a marketing blast could starve ticket delivery). Twilio is purpose-built, isolates ticket delivery from marketing volume, cheaper to start. **Decision hinges on one question for Colin: does Kenworthy's Mailchimp plan already include SMS credits?** If yes → Mailchimp SMS is the pragmatic consolidation. If no → Twilio.

### 🔴 SMTP for Supabase auth emails
No custom SMTP configured on either project. Password resets currently squeak through Supabase's rate-limited built-in service; won't hold at production volume. Awaiting Kenworthy's email provider details.

### 🔴 Finish poster migration to production
Staging poster migration is progressing (~200/click due to Edge Function timeout). Production not yet run. Click "Run re-fetch" on each site's Superadmin page until `total: 0`. Confirm with:
`SELECT (SELECT COUNT(*) FROM movies WHERE poster_url LIKE '%kenworthy.org%') AS m, (SELECT COUNT(*) FROM events WHERE poster_url LIKE '%kenworthy.org%') AS e, (SELECT COUNT(*) FROM live_performances WHERE poster_url LIKE '%kenworthy.org%') AS p;`
**Improvement (optional):** add self-batching to `refetch-posters` so each invocation reports progress and needs fewer clicks (or a loop script). Currently manual and tedious.

### 🔴 Sync production with staging data fixes
Staging is ahead of production on several data migrations. Before launch, deliberately apply to production: the missing-showings fix (`kenworthy_showings_fix.sql`), the `service_role` CRUD migration, the `authenticated` content-writes migration, and the poster migration. Verify counts match staging.

---

## Planned Refactors

### 🟡 Comprehensive grants audit + single authoritative migration
We have now hit **three separate grant-inconsistency bugs** from Lovable's migrations:
1. `anon` missing SELECT on many tables (fixed)
2. `service_role` missing CRUD (fixed)
3. `authenticated` missing writes on content tables — movies/events/showings/etc. (fixed 2026-08-11)
This pattern means grants were set up table-by-table and inconsistently throughout. Post-launch, do one comprehensive audit across all roles (anon, authenticated, service_role) × all tables × all privileges, reconcile against the RLS policies that should gate them, and consolidate into a single authoritative grants migration so this never surprises us again.

### 🟡 `profiles` table — authenticated has SELECT only
Users typically need to UPDATE their own profile row (RLS gating to `auth.uid() = id`). `profiles` currently grants authenticated SELECT only. Was deliberately excluded from the content-writes migration because it needs its own RLS verification (own-row-only), not the admin-gated pattern. If a "can't edit profile" error appears, this is the cause — grant UPDATE once the own-row RLS policy is confirmed present and correct.

### 🟡 Merge Listings + Archive onto one paginated source of truth
Admin **Listings** (operational: now/soon) and superadmin **Archive** (history-page timeline) both draw on `movies`/`showings` but were separated to keep historical data out of screening analytics. Interim: Listings filters `is_active = true` (small, uncapped) and stats use `COUNT(*)`. Target: both share the tables via a server-side paginated hook (`useAdminListings.ts`, already written) with different query lenses; analytics documents how it excludes archival data. Deferred because it touches history page, archive tab, and analytics at once — unsafe pre-launch, not customer-facing.

### 🟡 Pricing tiers for ticketed events
Import captured a single `ticket_price` and missed price ranges (e.g. `$12–27`). ~11 events, mostly APOD theatrical productions and comedy shows. Schema supports tiers via `showing_price_tiers`; enter accurately via admin, verified against Square. Not a candidate for automated text scraping.

### 🟡 Showing / ticketing page media parity (see `BRIEF-showing-page-media.md`)
`/showing/:id` already fetches poster, trailer, rating, genre, duration but renders only the description. Add the drawer's media block (trailer/poster + rating/genre/runtime badges). Display-only change; ideally extract a shared `ProductionMedia` component used by both the drawer and the Showing page.

---

## Post-Launch Integrations (client-requested, tracked for later)

### 🟢 Letterboxd sync — log Kenworthy attendance to members' Letterboxd diaries
**Client goal:** Kenworthy members who also use Letterboxd opt in to have their attendance auto-logged — ideally when a ticket is **scanned at the door** (confirmed attendance), a diary entry is written to their Letterboxd account.
**Feasibility:** The seamless auto-sync **requires the official Letterboxd API with member OAuth** — writing to a member's account legitimately can only happen with their authorization via the API. There is no acceptable no-API path for the automatic version (scraping/storing member passwords is a security and ToS non-starter).
**Access risk:** Letterboxd API is request-only and their policy declines many use cases (analytics, recommendation, LLM, recreating paid-tier features). This use case — *feeding* diary entries *into* Letterboxd for a historic theater's members — is at least on-brand and doesn't obviously fall in the prohibited buckets, but approval is not guaranteed and they don't individually reply.
**Design (if approved):** member opts in → connects Letterboxd via OAuth (Authorization Code flow) → store their token → on ticket **scan** (attendance, not just purchase), create a Letterboxd log entry for that film + date. Match films via Letterboxd's search/catalog; may need to map our movie records to Letterboxd film IDs.
**Fallback (no API, always shippable):** offer members a "your Kenworthy viewing history" export formatted for Letterboxd's CSV diary import — opt-in, member-driven, no credentials, no approval needed. Less seamless, most of the value.
**Next step:** apply for API access describing the opt-in attendance-logging use case; in parallel, the CSV-export fallback can be built anytime.

### 🟢 TMDB integration — auto-fill film metadata & posters
Separate from Letterboxd. TMDB (The Movie Database) has an open, free, well-documented API purpose-built for film metadata. Use it in the **"add a movie" admin flow** to auto-populate synopsis, cast, runtime, genre, rating, and poster from a title lookup — reducing manual entry and providing a durable poster source for *future* films (complementing the one-time WordPress poster migration already done). Clean fit, no access gatekeeping. Good post-launch quality-of-life improvement for admins.

---

## Technical Debt

| Item | Priority |
|---|---|
| 3.7MB JS bundle — needs code splitting for mobile | 🟡 |
| No race-condition protection on seat booking | 🟡 |
| Tax rate hardcoded — confirm Moscow, ID jurisdiction & rate | 🟡 |
| `xlsx` package has no security fix — replace with `exceljs` | 🟡 |
| Multi-day showings not in WP export (e.g. extra Cat Video Fest days) — verify/add manually | 🟡 |
| Historical archive under-represents multi-day runs — MEC export flattened recurrence; the `days`-field parse (`kenworthy_showings_fix.sql`) recovered most, but validate coverage | 🟡 |
| Home page `buildFeed` duplicates `useFeed` logic — consolidate | 🟢 |
| Drawer `DialogContent` missing `aria-describedby` (a11y warning) | 🟢 |
| Seat map not tied to specific venue room | 🟢 |
| Remaining npm vulnerabilities | 🟢 |
| Comp tickets (`HostDashboard` `COMP-` prefix) — verify they render a real QR and scan | 🟢 |

---

## Completed

| Item | Done |
|---|---|
| Migrate off Lovable → GitHub → Cloudflare Workers | ✅ |
| Staging + production Cloudflare Workers | ✅ |
| Staging + production Supabase projects, schema migrated | ✅ |
| Fix `gen_random_bytes` extensions-schema migration bug | ✅ |
| Grant anon SELECT on all public tables (root cause + migration) | ✅ |
| Grant service_role full CRUD (root cause + migration) | ✅ |
| Grant authenticated content-table writes its RLS gates (migration) | ✅ |
| Import full event history w/ correct Mountain-time handling | ✅ |
| Add showings for live events (238) | ✅ |
| Recover missing multi-day showings from MEC `days` field (383+) | ✅ |
| Fix HTML entities in imported titles | ✅ |
| Fix drawer crash (`e.showings is undefined`) — calendar + home | ✅ |
| Pass `ticket_price` through FeedItem to drawer | ✅ |
| Real scannable QR on tickets (was decorative grid) | ✅ |
| Poster migration to Supabase Storage (full-res) — staging in progress | ✅ (staging) |
| Deploy Square edge functions to both projects | ✅ |
| Remove `lovable-tagger`, upgrade Vite | ✅ |
| Logo fix (SVG asset + inversion) | ✅ |
| Hero image fix (bundled, compressed) | ✅ |
| Calendar defaults to month view | ✅ |
| Home page layout restructure | ✅ |
