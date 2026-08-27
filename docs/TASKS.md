# Kenworthy Ticketing — Task catalogue

> **Generated** by `scripts/generate-tasks.mjs` from the frontmatter in
> `docs/briefs/`. Do not hand-edit above the hand-maintained block —
> change a brief's frontmatter and re-run the script. Schema:
> [`briefs/.frontmatter-schema.md`](briefs/.frontmatter-schema.md).

**68 briefs** — 62 shipped, 3 built, 3 open, 0 needs triage, 0 closed.

## Built, not deployed

Code complete and merged. **Merging does not deploy** — only `wrangler deploy` does.

- `P2` **Inventory what on the site would be flagged as AI-generated, and decide how to disclose it**<br>`docs` — [brief](briefs/BRIEF-ai-provenance-audit.md) · [notes](briefs/../ai-provenance-images.md)
- `P2` **A production can carry more than one genre, stored the way the DVD library already stores them**<br>`feature` — [brief](briefs/BRIEF-multiple-genres.md)
- `P2` **Rebuild /rentals — marquee-led hero, a real marquee booking form, hourly day-view availability, and the official rate grid**<br>`feature` — [brief](briefs/BRIEF-rentals-page-overhaul.md)

## Open

- `P2` **Comp tickets are issued but never delivered to the person receiving them**<br>`bug` — [brief](briefs/BRIEF-comp-ticket-delivery.md)
- `P2` **The Mailchimp campaign has never been able to send, because it queries a column that does not exist**<br>`bug` — [brief](briefs/BRIEF-mailchimp-campaign-dead-column.md)
- `P2` **Settle the privacy model for media buckets, and fix the one place it already broke**<br>`security` — [brief](briefs/BRIEF-media-bucket-privacy-model.md)

## Shipped

- **A curator's pick can be a whole run or a single night, and says which**<br>`feature` — `#201` — [brief](briefs/BRIEF-showing-level-curator-pick.md)
- **Concessions moves off the home page to /concessions, framed in the marquee bulbs**<br>`ux` — `#186`, `#188`, `#189`, `#190` — [brief](briefs/BRIEF-concessions-marquee-border.md) · [notes](briefs/FINDINGS-marquee-bulb-border.md)
- **Tighten the hero, put search on the Upcoming row, and give the curator's pick a carousel**<br>`ux` — `#195` — [brief](briefs/BRIEF-home-layout-search-carousel-preview.md)
- **Listings show the other showtimes inline and play trailers in a lightbox**<br>`ux` — `#187` — [brief](briefs/BRIEF-listings-showtimes-trailer.md)
- **Movies and events can be linked to a Square catalog item again, not only dismissed**<br>`bug` — `#185` — [brief](briefs/BRIEF-square-link-movies-events-ui.md)
- **A hidden Backstage page, reached only by clicking the neon sign**<br>`feature` — `#143`, `#152`, `#153` — [brief](briefs/BRIEF-backstage-page.md)
- **Show run times as hours + minutes, not raw minutes**<br>`ux` — `#181` — [brief](briefs/BRIEF-runtime-format.md)
- **Split the counter tools into a Staff section, with Print QRs in it**<br>`ux` — `#172` — [brief](briefs/BRIEF-staff-section-print-qr.md)
- **Description fields get a formatting toolbar, and the render path is sanitised to match**<br>`feature` — `#170` — [brief](briefs/BRIEF-richtext-descriptions.md) · [notes](briefs/FINDINGS-richtext-description-surface.md)
- **A searchable Transactions log of confirmed Square and site sales, with reconciliation**<br>`feature` — `#161` — [brief](briefs/BRIEF-transactions-tab.md) · [notes](briefs/FINDINGS-transactions-tab.md)
- **Missing Ticket Confirmation & Account Emails**<br>`ops` — `a72aabe`, `23d6bd3`, `202c6a2`, `cb17100`, `fc44c33`, `6ddfa72`, `3de95a8`, `#91`, `2bb68d4` — [brief](briefs/BRIEF-ticket-email.md)
- **Every admin table becomes a collapsible section, and the tabs get a consolidation map**<br>`ux` — `#151` — [brief](briefs/BRIEF-admin-collapsible-sections.md)
- **The admin Overview reads the theatre's real revenue, from Square**<br>`bug` — `#142`, `#144`, `#145`, `#147` — [brief](briefs/BRIEF-analytics-square.md) · [notes](briefs/FINDINGS-analytics-square.md)
- **Send a ticket confirmation for box-office (StaffPOS) sales**<br>`feature` — `#91`, `bb9a506` — [brief](briefs/BRIEF-pos-ticket-delivery.md)
- **Re-activate phone capture and connect Twilio SMS**<br>`ops` — `#86`, `#90`, `#96`, `#98`, `#104`, `#105`, `#118`, `#119`, `#122`, `#124`, `070efee`, `dd1dc71`, `b3dfb97`, `62c6559`, `4354dbc`, `ba2d03c`, `1f63153`, `da670a8`, `1ea3a23` — [brief](briefs/BRIEF-reactivate-phone-sms.md)
- **Make ticket / event / MET / film-pass sales write catalogued line items in Square**<br>`data` — `#103`, `9d5876a` — [brief](briefs/BRIEF-square-line-items.md)
- **Fix staging password-reset "email rate limit" — wire the Send Email hook to Resend**<br>`ops` — [brief](briefs/BRIEF-staging-auth-email-hook.md)
- **Restore venue + event date/time to film/event/MET items via the Square API — safely**<br>`ops` — `#85`, `3b26771`, `c095abd` — [brief](briefs/BRIEF-square-venue-date-api.md)
- **Color Lab as a live, session-only theme override on the real site**<br>`ux` — [brief](briefs/BRIEF-colorlab-live-session.md)
- **Temporarily hide phone fields on purchases; require email (until SMS is wired)**<br>`ops` — `#84`, `3f186ad` — [brief](briefs/BRIEF-disable-phone-until-sms.md)
- **System-wide rule — no ticket/purchase for a past showing (hide the button, enforce on the server)**<br>`bug` — `#102`, `c551357` — [brief](briefs/BRIEF-past-no-purchase.md)
- **Add the Privacy Policy + Terms of Use pages + footer links**<br>`ux` — `#82`, `2c70348` — [brief](briefs/BRIEF-privacy-page-footer.md)
- **Raise default readability & font size across the platform (older patron base)**<br>`ux` — `#100`, `#101`, `36203da`, `ac3e857`, `fc2765d8` — [brief](briefs/BRIEF-readability-font-size.md) · [notes](briefs/FINDINGS-readability-font-size.md)
- **Register platform transactions in Square correctly — cash tenders + ticket/pass attribution**<br>`ops` — `#103`, `9d5876a` — [brief](briefs/BRIEF-square-transaction-registration.md)
- **Activity log — make it admin-only + close coverage gaps (it already exists)**<br>`security` — `f697800` — [brief](briefs/BRIEF-activity-log-admin-only.md) · [notes](briefs/BRIEF-activity-log-admin-only-OUTCOME.md)
- **Calendar view — drop the redundant per-entry date/time line so titles get more room**<br>`ux` — `99cc1d8` — [brief](briefs/BRIEF-calendar-entry-date-declutter.md)
- **🚨 EMERGENCY — Square catalog over-pull flooded concessions on the LIVE site**<br>`bug` — `#78`, `20e5d3f`, `5b5ab23` — [brief](briefs/BRIEF-concessions-square-overpull.md)
- **Film-pass admin — search, status filter/sort, delete cancelled**<br>`feature` — [brief](briefs/BRIEF-film-pass-admin-search.md)
- **Generalize pass eligibility (festival passes + per-showing use limits)**<br>`feature` — `#52`, `e216dfa` — [brief](briefs/BRIEF-film-passes-eligibility-architecture.md)
- **Gate the DVD page + nav entries to logged-in users only**<br>`security` — `c90637c` — [brief](briefs/BRIEF-gate-dvds-login.md)
- **In-app "Invite / Add staff member" (create account + assign role)**<br>`ops` — `#62`, `481772b` — [brief](briefs/BRIEF-invite-staff.md) · [notes](briefs/BRIEF-invite-staff-OUTCOME.md)
- **Make the listing preview pane a vertical two-column split (portrait artwork + info)**<br>`ux` — [brief](briefs/BRIEF-listing-preview-vertical-split.md)
- **Fix the footer newsletter signup + switch ticket-checkout marketing to opt-OUT**<br>`ops` — [brief](briefs/BRIEF-mailchimp-signup-optout.md)
- **Press page + admin Press tab**<br>`ux` — `42cda95` — [brief](briefs/BRIEF-press-page.md)
- **Temporarily remove the screened-films Archive — preserve for post-launch**<br>`feature` — `9eb7448` — [brief](briefs/BRIEF-remove-archive-section.md)
- **Full RLS / permissions audit before launch**<br>`security` — `#59`, `43496e8` — [brief](briefs/BRIEF-rls-security-audit.md) · [notes](briefs/FINDINGS-rls-security-audit.md)
- **Seating is per-showing, venue owns the map — fix + seed the venue**<br>`bug` — `7545b35` — [brief](briefs/BRIEF-seating-per-showing.md)
- **The 1000-row cap on the movie picker — fix and data audit**<br>`data` — `f01527f` — [brief](briefs/BRIEF-showing-movie-1000-cap.md)
- **Staff bios — admin management + "Kenworthy Staff" on About Us**<br>`ux` — `#55` — [brief](briefs/BRIEF-staff-bios.md)
- **"Add to calendar" on the ticket page, email, and SMS**<br>`ops` — [brief](briefs/BRIEF-add-to-calendar.md)
- **Calendar/listings polish + admin Hiring**<br>`ux` — [brief](briefs/BRIEF-calendar-listings-hiring.md)
- **Publish the Color Lab team tool at /colorlab.html**<br>`ux` — [brief](briefs/BRIEF-colorlab-page.md)
- **Fill in About / Hiring / Volunteer from kenworthy.org, remove Plan a Visit**<br>`ux` — `53ad127` — [brief](briefs/BRIEF-content-pages.md)
- **Turn off patron login (staff/admin-only auth), keep the data model**<br>`security` — `c90637c`, `cb7a22f` — [brief](briefs/BRIEF-disable-member-login.md)
- **Donation wiring — verify, fix the missing email, add checkout donations (tax-free)**<br>`ops` — [brief](briefs/BRIEF-donations.md)
- **Restore the DVD inventory**<br>`data` — `65503b1` — [brief](briefs/BRIEF-dvd-inventory-import.md)
- **Brand the default email template — logo, site colors, correct name**<br>`ops` — `#50`, `#51`, `abdf6ef` — [brief](briefs/BRIEF-email-branding.md)
- **Film Passes — physical, activated-on-handoff, in-person only**<br>`feature` — [brief](briefs/BRIEF-film-passes.md) · [notes](briefs/FINDINGS-film-passes.md)
- **Mail fulfilment queue — a posted pass is not a mailed pass**<br>`feature` — `999d5bb` — [brief](briefs/BRIEF-mail-fulfillment-queue.md)
- **Stop blank pages after deploy — serve the app shell NetworkFirst**<br>`ops` — [brief](briefs/BRIEF-pwa-shell-networkfirst.md) · [notes](briefs/FINDINGS-pwa-shell-networkfirst.md)
- **Rental requests — multi-day dates + "Generate Invoice" (Square)**<br>`ops` — `a8ee428` — [brief](briefs/BRIEF-rental-multiday-invoice.md)
- **Scanner + film-pass redemption refinements, purchase type, POS scanner**<br>`feature` — [brief](briefs/BRIEF-scanner-filmpass-pos.md)
- **Searchable movie picker when creating a showing**<br>`feature` — [brief](briefs/BRIEF-showing-movie-search.md)
- **Square Labor — end-to-end functionality & wiring test**<br>`ops` — [brief](briefs/BRIEF-square-labor-testing.md) · [notes](briefs/FINDINGS-square-labor-testing.md)
- **Square production cutover — audit + fix the sandbox-locked functions**<br>`ops` — `7f465d1` — [brief](briefs/BRIEF-square-production-cutover.md)
- **Rename "Get Tickets" → "Tickets" and add a "Film Pass" button beside it**<br>`feature` — `a046ca3` — [brief](briefs/BRIEF-tickets-filmpass-buttons.md)
- **Admin Dashboard — Listings Section Improvements**<br>`ux` — [brief](briefs/BRIEF-admin-listings.md)
- **Listings Show Times One Hour Off — Diagnose & Fix**<br>`bug` — `e15beb7` — [brief](briefs/BRIEF-listings-time-offset.md) · [notes](briefs/FINDINGS-listings-time-offset.md)
- **Restore Per-Year Movies on the History Page**<br>`ux` — `3bf4256` — [brief](briefs/BRIEF-restore-history-movies.md)
- **Online Ticket & Film-Pass Purchases Take No Payment**<br>`ops` — `#103`, `9d5876a` — [brief](briefs/BRIEF-square-ticket-payments.md)
- **Update the Handoff Doc (`PLATFORM.md`) to Match Reality**<br>`feature` — `22daa6a` — [brief](briefs/BRIEF-update-handoff-doc.md)
- **Enrich the Showing / Ticketing Page with Drawer Elements**<br>`ux` — [brief](briefs/BRIEF-showing-page-media.md)

## Briefs with no frontmatter

The generator cannot place these. Add frontmatter per the schema.

- `BRIEF-ada-accessibility-audit.md`
- `BRIEF-security-audit-e2e.md`
- `BRIEF-silent-film-festival-page.md`

---

## Tracked outside the brief system

Hand-maintained. The generator copies this block through untouched, so
anything here survives regeneration. Give an item a brief when it grows one,
then delete it from here.

<!-- HAND-MAINTAINED:START -->

### 🔴 History page images broken (Lovable asset stubs)
The 10 archival photos in `src/assets/history/*.jpg.asset.json` are **Lovable CDN pointers**, not real files — their `url` fields are Lovable-internal (`/__l5e/...`) paths that don't resolve on Cloudflare. Unlike movie posters, there is no WordPress source to rehost from; the actual JPEGs live only on Lovable's R2 storage.
**Fix (do while Lovable is still accessible):** retrieve the 10 originals from the Lovable project (preview page or asset export), drop real `.jpg` files into `src/assets/history/`, and change `History.tsx` imports from `*.jpg.asset.json` + `imgX.url` to direct `*.jpg` + `imgX` (same pattern as the logo and hero fixes). Fallback sources: kenworthy.org/history, or originals from KPAC.
**Urgency:** the retrieval window closes when Lovable is disconnected.

### ✅ `sign-contract` boot error — fixed 2026-08-11
`POST /functions/v1/sign-contract` was returning `BOOT_ERROR` (503) on prod, so **rental contract signing was broken**. Found while deploying ticket delivery. Fixed and deployed to production; it now returns its own `{"error":"Not authenticated"}` for an unauthenticated call.
**Cause (isolated, not guessed):** it imported `createClient` from `npm:@supabase/supabase-js@2.45.0` and `corsHeaders` from `npm:@supabase/supabase-js@2/cors`. Deno dedupes npm packages by name, so the `@2/cors` import resolved against the pinned 2.45.0 — and `./cors` was not added to that package's exports until after 2.50.0 (verified: absent in 2.45.0/2.50.0, present in 2.96.0). Both now come from `https://esm.sh/@supabase/supabase-js@2`, matching `guest-checkout`.
**`npm:` is not broadly unsafe** — `pdf-lib` was deliberately left on `npm:` and boots fine; leaving it there is what isolated the cause. What breaks is mixed `@supabase/supabase-js` versions, and packages needing node streams/zlib (`npm:qrcode` → pngjs).
**Still to verify:** only the boot was tested. A real signature run needs an admin session and a live rental request, so signing, PDF stamping and Ed25519 are unverified since the change — worth one manual contract signature before launch.
**Lesson worth keeping:** `deno check`/`deno test` passing says nothing about whether a function boots. Curl every function after deploy — and note that `verify_jwt = true` functions return a gateway 401 *before* booting, so an auth error can hide a dead function. Pass a valid anon key.

### 🟡 Three functions in the repo are deployed nowhere
`mailchimp-subscribe`, `mailchimp-ecommerce` and `lgl-sync-donation` — the three
this entry used to name — **are now live on both projects.** Re-measured
2026-08-19 by HTTP, not by the function list alone. What is actually missing:

- **`qbo-sync`** — 404 on both. A whole QuickBooks surface calls it:
  `QboExportTab` at three call sites, `PayrollExport` for `?action=status`, and
  the Chart of Accounts / Mappings / QBO Export tabs all render in
  `AdminDashboard.tsx:942-955`. In progress by intent — see
  [`briefs/FINDINGS-quickbooks-integration-state.md`](briefs/FINDINGS-quickbooks-integration-state.md)
  for what exists, what does not, and the staged path with the risk mitigated.
- **`mailchimp-webhook`** — 404 on both. This is the *inbound* endpoint Mailchimp
  calls on unsubscribe/cleaned. Outbound opt-out works (the UI calls the deployed
  `mailchimp-subscribe`); what is missing is the sync back when someone
  unsubscribes from the footer link in an email, so our opt-out state can drift
  from Mailchimp's.
- **`mailchimp-bootstrap`** — 404 on both. It is what registers the webhook URL
  and its shared secret with Mailchimp, so the webhook above was never set up.

Also undeployed but expected: `poster-identify`, `square-event-create-probe`,
`square-order-probe` — one-off tools and diagnostics, not wired to any UI.

### 🔴 Finish poster migration to production
Staging poster migration is progressing (~200/click due to Edge Function timeout). Production not yet run. Click "Run re-fetch" on each site's Superadmin page until `total: 0`. Confirm with:
`SELECT (SELECT COUNT(*) FROM movies WHERE poster_url LIKE '%kenworthy.org%') AS m, (SELECT COUNT(*) FROM events WHERE poster_url LIKE '%kenworthy.org%') AS e, (SELECT COUNT(*) FROM live_performances WHERE poster_url LIKE '%kenworthy.org%') AS p;`
**Improvement (optional):** add self-batching to `refetch-posters` so each invocation reports progress and needs fewer clicks (or a loop script). Currently manual and tedious.

### ✅ Comprehensive grants audit + single authoritative migration — done 2026-08-14
Delivered by PR #59 (`43496e8`), migration
`20260814214233_rls_permissions_hardening.sql`, with the role x table audit in
[`briefs/FINDINGS-rls-security-audit.md`](briefs/FINDINGS-rls-security-audit.md).
It states the intended privilege set per table explicitly rather than copying one
environment onto the other, and the audit records both projects as "now identical
in both grants and policies — which means the next drift shows up in a diff
instead of hiding."

### ✅ `profiles` table — authenticated can UPDATE — done 2026-08-14
The same hardening migration grants it: `GRANT UPDATE ON public.profiles TO
authenticated`. INSERT and DELETE stay revoked on purpose — rows are created by
the SECURITY DEFINER `handle_new_user()` and are never deleted by a client.

### 🟡 Merge Listings + Archive onto one paginated source of truth
Admin **Listings** (operational: now/soon) and superadmin **Archive** (history-page timeline) both draw on `movies`/`showings` but were separated to keep historical data out of screening analytics. Interim: Listings filters `is_active = true` (small, uncapped) and stats use `COUNT(*)`. Target: both share the tables via a server-side paginated hook (`useAdminListings.ts`, already written) with different query lenses; analytics documents how it excludes archival data. Deferred because it touches history page, archive tab, and analytics at once — unsafe pre-launch, not customer-facing.

### 🟡 Pricing tiers for ticketed events
Import captured a single `ticket_price` and missed price ranges (e.g. `$12–27`). ~11 events, mostly APOD theatrical productions and comedy shows. Schema supports tiers via `showing_price_tiers`; enter accurately via admin, verified against Square. Not a candidate for automated text scraping.

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

<!-- HAND-MAINTAINED:END -->
