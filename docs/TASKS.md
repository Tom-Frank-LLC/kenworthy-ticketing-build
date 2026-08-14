# Kenworthy Ticketing — Tasks & Refactor Log

> Living document. Known issues, planned refactors, and technical debt found during and after the launch push. Update as items are added, started, or completed.
>
> **Legend:** 🔴 Launch blocker · 🟡 Soon after launch · 🟢 Backlog · ✅ Done

---

## Active / Launch Blockers

### ✅ Pass eligibility is per pass, not per screening (see `BRIEF-film-passes-eligibility-architecture.md`)
`showings.film_pass_eligible` — one boolean, forced false for anything without a movie — is gone. A pass is good at a screening iff a `pass_type_showings` row exists for (its type, that showing), so a festival pass covers its own run across films, events and live performances and **nothing else**, while the standard pass keeps the screenings it always had. `film_pass_types` gains `per_showing_use_limit` (NULL = unlimited, N = cap, restoring the guard #49 removed as a per-type choice) and `is_default_for_movies` (pre-ticks the standard passes on a new $8 movie, which is what stops the old default vanishing silently).
**Shipped to staging and production 2026-08-14** — PR #52 (`e216dfa`); migrations `20260814093200`, `20260814093250`, `20260814093300`. Prod backfill: **1,109** eligibility rows against the real `10-film pass`. Staging verified through the real door scanner — admit at the discounted rate, both cross-pass refusals with balances intact, and the per-screening limit. 148 vitest tests, 17 database-level checks.
**Note for the box office:** production has no festival pass yet — create the type under Admin → Film Passes, then tag its run in **Screenings & Passes**.
**Deploy note:** the two migrations must straddle the frontend deploy (apply `093200`, deploy, then `093300`), and the branch must be merged to `main` first — a concurrent deploy of an older bundle breaks the door scanner, which happened three times on staging.


### 🔴 Film passes → physical, activated on handoff (see `BRIEF-film-passes.md`, `FINDINGS-film-passes.md`)
A film pass is now a paper card with a stickered QR. Kenworthy prints blank batches; a sticker becomes a funded pass only when staff scan it at handoff; it is redeemed **in person only**, deducting a configured amount (default $6) from the balance at an eligible standard movie. Buying online creates a `film_pass_orders` obligation — collect at the box office or have it posted — and issues **no** digital pass. Online redemption is gone: `Showing.tsx` and `MyPasses.tsx` no longer offer it and `ticket-checkout` returns 400 for `payment_method='film_pass'`.
**Shipped to staging 2026-08-12** — migration `20260813000000_film_passes_physical.sql`, functions `film-pass-batch` / `film-pass-checkout` / `ticket-checkout`, Worker deployed. 21 database-level lifecycle checks, 14 Deno tests, 43 vitest tests, all passing; every deployed function curl-verified to boot and enforce its own rules.
**Remaining before production:**
- Merge `fix/staff-attendee-names` (carries `20260812190000`, applied to staging but not on `main`) — `supabase db push` refuses while a remote migration has no local file. **Do not** `migration repair --status reverted` it; it is a live RLS fix.
- One sandbox purchase of each fulfilment kind (pickup, post) end-to-end through Square.
- Print a sticker sheet and scan it with a real phone camera — the one check that cannot be faked.
- Configure the real pass type(s) on production (`redemption_price` defaults to 6.00) and decide which upcoming screenings are `film_pass_eligible`.
Also fixed, not in the brief: film-pass tickets were about to be counted as ticket income on top of the pass sale (double count), and pass income was booked from `status='active'` rows only — silently dropping any pass sold and fully spent in the same period. Both corrected in `QboExportTab`.

### 🔴 History page images broken (Lovable asset stubs)
The 10 archival photos in `src/assets/history/*.jpg.asset.json` are **Lovable CDN pointers**, not real files — their `url` fields are Lovable-internal (`/__l5e/...`) paths that don't resolve on Cloudflare. Unlike movie posters, there is no WordPress source to rehost from; the actual JPEGs live only on Lovable's R2 storage.
**Fix (do while Lovable is still accessible):** retrieve the 10 originals from the Lovable project (preview page or asset export), drop real `.jpg` files into `src/assets/history/`, and change `History.tsx` imports from `*.jpg.asset.json` + `imgX.url` to direct `*.jpg` + `imgX` (same pattern as the logo and hero fixes). Fallback sources: kenworthy.org/history, or originals from KPAC.
**Urgency:** the retrieval window closes when Lovable is disconnected.

### 🔴 Ticket delivery — confirmation email + SMS (see `BRIEF-ticket-email.md`)
`guest-checkout` never delivers the ticket. It creates the account and stores the ticket, then only fires Mailchimp *marketing* sync — no transactional confirmation. Confirmed via prod test: email purchase → nothing; phone purchase → nothing; account created silently.
Required: transactional email (likely Resend) with QR; **SMS delivery for phone purchases** (Twilio vs. Mailchimp SMS — see decision note below); account-access path for guest-created accounts; custom SMTP on both Supabase projects for auth email at scale; a public mobile-friendly QR ticket page for the SMS link.
**Shipped to production 2026-08-11** (`a72aabe`, `23d6bd3`) — full write-up, setup runbook and test plan in `docs/TICKET-DELIVERY.md`.
Live on prod: migration applied (`order_token` + `confirmation_*` on `tickets`); `ticket-access` and `send-ticket-confirmation` deployed; `guest-checkout` redeployed. Verified end to end against prod — the deployed endpoint serves the ticket page unauthenticated, 404s unknown and cross-order tokens, and the PNG it returns decodes back to the exact `tickets.qr_code` the door scanner matches.
Also fixed, not in the brief: the **signed-in** checkout path had the same no-delivery gap, and the My Tickets "QR code" was decorative — a grid coloured from `charCodeAt` of the ticket UUID, which could never scan. Both now issue real QRs.
**Remaining:** set `RESEND_API_KEY` (+ `SITE_URL`) as edge function secrets — until then email records `confirmation_error` and purchases still succeed. Twilio not set up yet, so phone-only purchases still have no delivery path. Scanning and QR issuing are testable now without either.
**Note on the SMS decision below:** the code is written against Twilio, behind `TWILIO_*` secrets. If Colin's answer points to Mailchimp SMS instead, only the `sendViaTwilio` function in `send-ticket-confirmation` changes — the branching, ticket page and QR work are provider-agnostic.
Cleanup: remove test purchase data created in production during diagnosis — reviewed script ready at `supabase/scripts/cleanup_test_purchases.sql` (read-only inspection first, DELETEs commented out). Prod currently holds 2 such tickets.

**SMS provider decision (pending Colin):** Mailchimp now offers transactional SMS, but it requires an existing paid SMS marketing plan and shares SMS credits between marketing and transactional (a marketing blast could starve ticket delivery). Twilio is purpose-built, isolates ticket delivery from marketing volume, cheaper to start. **Decision hinges on one question for Colin: does Kenworthy's Mailchimp plan already include SMS credits?** If yes → Mailchimp SMS is the pragmatic consolidation. If no → Twilio.

### 🔴 SMTP for Supabase auth emails
No custom SMTP configured on either project. Password resets currently squeak through Supabase's rate-limited built-in service; won't hold at production volume. Awaiting Kenworthy's email provider details.
**Scope reduced:** ticket delivery no longer depends on this. The "set your password" link in the confirmation email is generated with `generateLink({type:'recovery'})` and sent by us via Resend, so guest account access works without SMTP. This now covers only auth-initiated email — password resets started from the login page, and magic links.

### ✅ `sign-contract` boot error — fixed 2026-08-11
`POST /functions/v1/sign-contract` was returning `BOOT_ERROR` (503) on prod, so **rental contract signing was broken**. Found while deploying ticket delivery. Fixed and deployed to production; it now returns its own `{"error":"Not authenticated"}` for an unauthenticated call.
**Cause (isolated, not guessed):** it imported `createClient` from `npm:@supabase/supabase-js@2.45.0` and `corsHeaders` from `npm:@supabase/supabase-js@2/cors`. Deno dedupes npm packages by name, so the `@2/cors` import resolved against the pinned 2.45.0 — and `./cors` was not added to that package's exports until after 2.50.0 (verified: absent in 2.45.0/2.50.0, present in 2.96.0). Both now come from `https://esm.sh/@supabase/supabase-js@2`, matching `guest-checkout`.
**`npm:` is not broadly unsafe** — `pdf-lib` was deliberately left on `npm:` and boots fine; leaving it there is what isolated the cause. What breaks is mixed `@supabase/supabase-js` versions, and packages needing node streams/zlib (`npm:qrcode` → pngjs).
**Still to verify:** only the boot was tested. A real signature run needs an admin session and a live rental request, so signing, PDF stamping and Ed25519 are unverified since the change — worth one manual contract signature before launch.
**Lesson worth keeping:** `deno check`/`deno test` passing says nothing about whether a function boots. Curl every function after deploy — and note that `verify_jwt = true` functions return a gateway 401 *before* booting, so an auth error can hide a dead function. Pass a valid anon key.

### 🔴 Four edge functions not deployed to production
`mailchimp-subscribe`, `mailchimp-ecommerce`, `qbo-sync` and `lgl-sync-donation` return 404 on prod — they exist in the repo but were never deployed there. `guest-checkout` calls the two Mailchimp functions fire-and-forget, so ticket-buyer tagging and e-commerce sync have been silent no-ops on production. Decide whether to deploy them or accept marketing sync as staging-only for now.

### 🔴 Finish poster migration to production
Staging poster migration is progressing (~200/click due to Edge Function timeout). Production not yet run. Click "Run re-fetch" on each site's Superadmin page until `total: 0`. Confirm with:
`SELECT (SELECT COUNT(*) FROM movies WHERE poster_url LIKE '%kenworthy.org%') AS m, (SELECT COUNT(*) FROM events WHERE poster_url LIKE '%kenworthy.org%') AS e, (SELECT COUNT(*) FROM live_performances WHERE poster_url LIKE '%kenworthy.org%') AS p;`
**Improvement (optional):** add self-batching to `refetch-posters` so each invocation reports progress and needs fewer clicks (or a loop script). Currently manual and tedious.

### 🔴 Reconcile migrations between staging and production — they drift both ways
Before launch, deliberately apply to production: the missing-showings fix (`kenworthy_showings_fix.sql`) and the poster migration. Verify counts match staging.

**Measured 2026-08-11/12 (`supabase migration list` against each project) — the drift runs in both directions, so "staging is ahead" is not the whole picture:**

| Migration | prod | staging |
|---|---|---|
| `20260810165116_grant_public_read_access` | ✅ applied | ❌ **missing** |
| `20260811120000_ticket_delivery` | ✅ applied | ✅ applied |
| `20260811190137_grant_service_role_crud` | ❌ pending | ❌ pending |
| `20260811214728_grant_authenticated_content_writes` | ❌ pending | ❌ missing |
| `20260812063211_has_role_hierarchy` | ❌ pending | ✅ applied |

So **staging is missing the `anon` public-read grant that production has**, which is a likely cause of "works on prod, broken on staging" reports. And `20260811190137_grant_service_role_crud` is applied nowhere and **is not committed to git** — it exists only in one working tree, so it will be lost if that tree is cleaned. Commit it before relying on it.

Note both projects already have full `service_role` CRUD on `tickets` independently of that migration (verified directly), so it is less urgent than it looks.

**Also: staging had no edge functions deployed at all** until 2026-08-11. `ticket-access`, `send-ticket-confirmation`, `guest-checkout` and `sign-contract` are now deployed there; the other 13 are still absent, so anything calling them from the staging site 404s. Production is missing 7 (all `mailchimp-*`, `qbo-sync`, `lgl-sync-donation`).

Deploy to a specific project without disturbing the shared CLI link with `supabase functions deploy <fn> --project-ref <ref>`. `db push` has no such flag — it needs `--linked` (re-link, then restore) or `--db-url`.

### ✅ Press page + admin Press tab — shipped to production 2026-08-14 (see `BRIEF-press-page.md`)
`/press` was a `ComingSoon` stub while being linked from the header and the mobile menu — a page visitors already reached that told them nothing. It is now DB-driven: `press_articles` (link metadata for third-party coverage — headline, outlet, date, a staff-written blurb, thumbnail; **never the article body**, every card links out to the outlet) plus a single-row `press_page_content` for the page's own banner photo and intro paragraph. Up to two articles pin to the top; the rest run newest→oldest. New admin **Press** tab (`isAdmin`, next to Hiring).
**Live on staging (`66ce7bbc`) and production (`fdf043bd`, rollback `3c3dd77b`) from `42cda95`** — migration `20260814020000_press_page.sql` applied to both, anon reads work and anon writes return 401 on both, and the deployed production chunk was fetched and checked to be the real page rather than a cached stub. No edge functions involved.
Worth carrying forward: `published_date` is a Postgres DATE, and `new Date('2026-08-01')` parses as **UTC** midnight — July 31 in Pacific — so use the new `formatPlainDate` in `src/lib/datetime.ts` for any date-only column, never `formatShowtime` (that one is for TIMESTAMPTZ instants). Same trap as the Boise/Pacific import bug, different mechanism.
**Remaining:** the manual test plan hasn't been run in a browser — verification so far is API- and bundle-level, and both environments' Press tabs are still empty.

### ✅ Square Labor — tested for the first time, then fixed — shipped to production 2026-08-14 (see `BRIEF-square-labor-testing.md`, `FINDINGS-square-labor-testing.md`)
The suite had never worked, and not because the sandbox was unseeded: **five Square requests were malformed**, and every failure was returned as `200 {simulated:true, note:"…sandbox…"}`. So the tabs read "no data yet" instead of broken, and scheduled-shift create and delete showed **success toasts while writing nothing**. Wrong shapes (each replayed against live Square to confirm): shift search nested a TimeRange inside `start_at` (400); wages came from `/labor/team-member-wages/search`, which doesn't exist (404); scheduled search asked for `limit 200` against a cap of 50 (400); create sent flat fields instead of `draft_shift_details` and omitted the required `job_id`; delete used `DELETE`, which doesn't exist. `publish_week` wrote a `draft:false` field Square has no concept of — now `bulk-publish`.
`square-labor` also answered **500 to every request on production**, because it hardcoded the sandbox host and read only `SQUARE_SANDBOX_*` while prod holds the unprefixed secrets. It now resolves through `_shared/square.ts`, so Labor follows `SQUARE_ENV` exactly like ticket payments, and the LaborTab banner no longer promises a switchover that could not happen.
Errors now throw and surface as 502 with Square's own message — which immediately exposed two more live defects: **breaks were impossible** (`break_type_id` is required and was never sent) and **scheduling fails for any member with no job assigned** (now resolved from their wage record). Also fixed a live crash: `TimeClockWidget` read `start_at` off the nested scheduled-shift payload and called `format(new Date(undefined))`, throwing `RangeError` for any linked staffer with an upcoming shift.
**Live on staging (`5b0dc7bc`, bundle `index-nCExKFm7.js`) and production (`1dc853de`, bundle `index-l4K9NmuB.js`) from `e4958f6`** — `square-labor` deployed to both projects, no migrations. Verified end to end against the sandbox: a seeded 5h shift with a 30-minute unpaid break at $18.50/hr reports 4.5 hours and **$83.25**. Role gates re-checked with a purpose-made staff-only account (403 "Admin required") and a non-staff account (403 "Staff access required"). The deployed production chunk was fetched and confirmed to carry the fix.
**Remaining, none of it code:**
- `qbo-sync` is deployed to **neither** project, so Payroll Export's preview computes but has no push target. Deploy it or hide the tab.
- **No break types are configured in Square** — staff cannot take breaks until one is added (Team → Settings → Breaks).
- Every real team member needs a **job assigned** in Square, or they cannot be scheduled.
- Square refuses to schedule **more than 10 days ahead without Team Plus**. A plan question, not a code one.
- Labor now reads whichever Square account `SQUARE_ENV` selects. The Timecards tab says so on screen when it is reading the sandbox — worth a glance on prod to confirm which account is live.

---

## Planned Refactors

### 🟡 Rental invoices — first Square call has still not been made (see `BRIEF-rental-multiday-invoice.md`)
Shipped to staging and production 2026-08-14 from `a8ee428`: multi-day rental dates (`end_date` + range display through the form, admin listing and contract), a `square-invoice` edge function that builds a **draft** Square invoice from `rental_invoice_lines`, and the contract restyled as a black-on-white document. Migrations applied to both projects; the function boots on both; production serves the new admin chunk.
**Nothing has ever called Square from this path.** The request shapes for Customers / Orders / Invoices are reasoned from the API, not observed. Production's `SQUARE_ENV` points at the live account, so the first `Generate Invoice` there creates a draft in the real Square account — it sends and charges nothing, but do the first run on **staging** and compare it line for line against a real Kenworthy event invoice (tax, terms, wording) first. The contract restyle is done and confirmed — Tom checked the deployed `/contract/:token` on 2026-08-14 both on screen and through the "Draft PDF" export; both render black on white.

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
| Import full event history w/ correct Pacific-time handling (Moscow is Pacific, not Mountain — the original import used America/Boise and stored every showtime an hour early; fixed 2026-08-12) | ✅ |
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
