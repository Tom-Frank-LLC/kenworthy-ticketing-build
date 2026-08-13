# Brief (for Claude Code): "Add to calendar" on the ticket page, email, and SMS

**Status:** 🟢 Implemented in a cloud session; delivered as `add-to-calendar.patch`. This brief lets Claude Code apply that patch (fast path) or rebuild it from spec.
**Date:** August 13, 2026
**Branch:** `feat/add-to-calendar` off `origin/main`.

## Goal
When someone buys a ticket, give them a one-tap way to add the showing to their calendar — on the public ticket page (`/t/:token`), in the confirmation email, and in the SMS. One calendar event per order, generated from a single source so the three surfaces can never disagree.

## Fast path — apply the ready patch
```
git fetch origin
git checkout -b feat/add-to-calendar origin/main
git am < add-to-calendar.patch        # the delivered patch file
npm run build                          # must pass
git push -u origin feat/add-to-calendar
gh pr create --base main --head feat/add-to-calendar \
  --title "Add to calendar on ticket page, email, and SMS" \
  --body "One ICS event per order, served by ticket-access and reused by the page, email, and SMS, plus a Google Calendar link. Times emitted as the UTC instant."
```
If the patch applies cleanly and `npm run build` passes, skip the spec below — go to **Verify** and **Deploy**.

## Design decisions — preserve these if rebuilding
1. **One source of truth.** The `.ics` is generated once, by the existing token-gated `ticket-access` edge function, and *linked to* from the page, email, and SMS. Don't generate the ICS in three places.
2. **Times are the UTC instant (`…Z`)** taken straight from `start_time` (a `timestamptz`). Do **not** convert to `VENUE_TIME_ZONE` for the calendar — a calendar client renders the instant in the viewer's own zone. This also keeps the calendar correct independent of the display-offset bug in `BRIEF-listings-time-offset`.
3. **End time** = `start + movies.duration_minutes`; default **120 min** when there's no duration (events/live performances).
4. **Bearer-token access.** The `.ics` route reuses the same `order_token` gate as the JSON/QR responses — no new auth.
5. **RFC 5545 correctness:** CRLF line endings, UTC `DTSTART`/`DTEND` as `YYYYMMDDTHHMMSSZ`, escape `,` `;` `\` and newlines in TEXT fields, fold lines >75 octets.

## File-by-file spec

### New: `supabase/functions/_shared/calendar.ts`
Exports:
- `buildIcs(order: Order, ticketUrl: string, stampIso: string): string` — full `VCALENDAR`/`VEVENT`. `UID` = `${order.order_token}@kenworthy.org`; `DTSTAMP` from `stampIso` (caller passes `new Date().toISOString()`); `SUMMARY` = title; `LOCATION` = `${venue||VENUE_NAME}, 508 S Main St, Moscow, ID 83843`; `DESCRIPTION` = ticket count + `ticketUrl`; `URL` = `ticketUrl`.
- `googleCalendarUrl(order: Order, ticketUrl: string): string` — `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=<startZ>/<endZ>&location=…&details=…` (build with `URLSearchParams`).
- `ticketCalendarUrl(supabaseUrl: string, token: string): string` — `…/functions/v1/ticket-access?token=<t>&ics=1`.
Helpers (module-private): `toCalUtc(iso, addMinutes)` → `YYYYMMDDTHHMMSSZ`; `escIcs`; `fold`; `durationMinutes(order)` (→ `duration_minutes` or 120). No `Deno` usage — keep it pure and unit-testable.

### `supabase/functions/_shared/tickets.ts`
- `Order` interface: add `duration_minutes: number | null`.
- `loadOrder` select: `movies(title)` → `movies(title, duration_minutes)`.
- `loadOrder` return: add `duration_minutes: showing?.movies?.duration_minutes ?? null`.

### `supabase/functions/ticket-access/index.ts`
- Import `ticketPageUrl` (from `tickets.ts`) and `buildIcs` (from `calendar.ts`); add `const SITE_URL = Deno.env.get('SITE_URL') || '<prod worker url>'`.
- Parse `const wantsIcs = ['1','true','yes'].includes((url.searchParams.get('ics')||'').toLowerCase())`.
- **After** the `if (!order) 404` check and **before** the `qrTicketId` branch: if `wantsIcs`, return `buildIcs(order, ticketPageUrl(SITE_URL, token), new Date().toISOString())` with `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="kenworthy-ticket.ics"`, `Cache-Control: public, max-age=3600`.

### `supabase/functions/_shared/notify.ts`
- `buildEmailHtml` opts: add `calendarUrl?: string|null`, `googleCalendarUrl?: string|null`. Render a centered "Add to your calendar" row with an `.ics` button (calendarUrl) and, when present, a "Google Calendar" button — placed right after the "View tickets on your phone" row.
- `buildEmailText` opts: add `calendarUrl?`; append `Add it to your calendar:` + the url.
- `buildSmsBody(order, ticketUrl, calendarUrl?)`: when `calendarUrl` is present, append `Add to calendar: <url>` (note: a second URL usually pushes the SMS to a 2nd billed segment — acceptable, and callers can omit to stay in one).

### `supabase/functions/_shared/deliver.ts`
- Import `{ ticketCalendarUrl, googleCalendarUrl }` from `./calendar.ts`.
- Near `ticketUrl`: `const calendarUrl = ticketCalendarUrl(SUPABASE_URL, orderToken);` and `const googleCalUrl = googleCalendarUrl(order, ticketUrl);`.
- Pass `calendarUrl` + `googleCalendarUrl: googleCalUrl` into `buildEmailHtml`; `calendarUrl` into `buildEmailText`; `calendarUrl` as the 3rd arg to `buildSmsBody`.

### `src/lib/tickets.ts` (client)
- `PublicOrder`: add `duration_minutes: number | null`.
- Add `export function ticketCalendarUrl(token: string)` → `${TICKET_ACCESS}?token=<t>&ics=1`.

### New: `src/lib/calendar.ts` (client)
- `googleCalendarUrl(order: PublicOrder): string` — same template as the server, using `window.location.href` for the ticket link. Times via the same `toCalUtc` UTC logic; default 120 min.

### `src/pages/PublicTicket.tsx`
- Import `CalendarPlus` (lucide), `ticketCalendarUrl` (from `@/lib/tickets`), `googleCalendarUrl` (from `@/lib/calendar`).
- Under the date/venue header, add a button row: an **Add to calendar** button linking to `ticketCalendarUrl(order.order_token)`, and a **Google Calendar** ghost link to `googleCalendarUrl(order)` (`target="_blank" rel="noreferrer"`).

## Verify
- `npm run build` passes.
- ICS is well-formed: CRLF endings; `DTSTART`/`DTEND` match `/\d{8}T\d{6}Z/`; `DTEND − DTSTART` == runtime (120 default); commas/semicolons escaped; long `DESCRIPTION` folded (CRLF + leading space). (A standalone Node check of the builder confirmed all of this in the cloud session.)
- Manual: open `/t/:token` → both buttons show; the `.ics` downloads and imports into Apple/Google/Outlook at the correct local time; the Google link opens a prefilled event; a test confirmation email shows the calendar row; an SMS shows the calendar line.

## Deploy (per environment)
- Rebuild + redeploy the **frontend** (`build:staging`/`build:production` → `wrangler deploy …`).
- Redeploy the edge functions that changed: **`ticket-access`** (new `.ics` route) **and the checkout/confirmation function that bundles `deliver.ts`** (e.g. `ticket-checkout` / `send-ticket-confirmation`) — `supabase functions deploy <fn> --project-ref <ref>`.
- Ensure the **`SITE_URL`** secret is set on each Supabase project so the ticket link *inside* the calendar event is correct (already tracked in `RUNBOOK-deploy-staging-prod.md`).

## Out of scope
- No change to `MyTickets` (auth-only page; dormant per `BRIEF-disable-member-login`).
- No recurring events, no per-ticket (vs per-order) calendar entries.
