---
brief: staff-notifications
title: Staff are emailed about every marquee and rental request, and admins choose who
status: shipped
track: feature
date: 2026-09-16
shipped_in: ["#307"]
shipped_at: 2026-09-16
verified: true
evidence: "prod: migration 20260916200042 applied, rental-request deployed, Worker version 88c4aedc (rollback 795d52f7); staging admin_audit_log email.sent to d***@resend.dev, subject 'New marquee request — QA Marquee 202609162009'"
---

# Brief (for Claude Code): Manageable staff notifications (starting with rental/marquee requests)

**Status:** 🟢 Additive. The immediate win (email events@ on a rental/marquee request) is a small hook in an existing function; the "way to manage" is a light admin-editable config so recipients/toggles change without code.
**Date:** September 16, 2026
**Requested by:** Tom — set up a way to **manage staff notifications**; first case: email **events@kenworthy.org** when someone requests to rent the **marquee** or the **theatre**.

## Current state (verified — build `931e141`)
- **One server hook already handles both forms.** The marquee form (`MarqueeBookingForm` → `invokeFunction('rental-request', …)`) and the full theatre rental form both post to the **`rental-request` edge function**; the row's **`venue_area`** distinguishes marquee vs auditorium/backstage. The function's own header even names "**a notification**" as the thing this single choke point exists to make possible. **No staff email is sent today.**
- **Email infra exists:** `_shared/deliver.ts` `sendTransactionalEmail()` (Resend, from a verified `@kenworthy.org` sender); **`events@kenworthy.org`** is already the ticket **reply-to** (`TICKET_REPLY_TO`).
- **Config infra exists:** `app_config` (key/value JSON, already used for flags like `lgl_sync_paused`, and **audited**).
- Requests land in the admin **Rentals** tab (`RentalRequestsTab`, `AdminDashboard` `rentals` tab).

## Part A — Send the staff notification (the concrete ask)
In `rental-request`, **after a successful insert**, send a staff notification email:
- **Recipients:** the admin-configured list (Part B), defaulting to **events@kenworthy.org**.
- **Content:** who (`applicant_name`, `email`, `phone`), what — **marquee** (show `marquee_text`) vs **theatre/backstage** (show `venue_area`) — the **dates** (`proposed_date`/`end_date`), and `event_description`; plus a **deep link to the admin Rentals queue** so staff act in one click. Subject line distinguishes the two, e.g. "New marquee request — <name>" vs "New rental request — <name>".
- **Reply-to = the requester's email** (Decision 5) so staff can reply directly; the **To** is always the staff list, never the submitter.
- **Best-effort, non-blocking:** the patron's submission already succeeded and returned; a failed staff email must **log and move on**, never fail the request or surface an error to the public user (mirror the fire-and-forget pattern used for ticket confirmations). Reuse `sendTransactionalEmail`.

## Part B — A small way to manage notifications
So staff can change recipients / turn a notification on or off without a deploy:
1. **Store settings** as an `app_config` JSON entry (reuses existing, audited infra — Decision 2), e.g.
   `staff_notifications = { "rental_request": { "enabled": true, "recipients": ["events@kenworthy.org"] } }`.
   Keyed by a **notification-type registry** so adding a type later is a one-line addition, not a new mechanism.
2. **The function reads it** to decide whether to send and to whom (fall back to `events@kenworthy.org` if unset, so it works before anyone configures it).
3. **Admin UI:** a small **"Notifications"** settings section (in the admin dashboard, admin-gated) listing each notification type with an **enabled toggle** and an **editable recipient list** (comma-separated / chips). Writes the `app_config` entry (RLS: admin write, same pattern as other admin config). Show the current recipients so it's obvious where these go.

## Part C — Extensibility (design now, don't over-build)
Seed the registry with **`rental_request`** (covers marquee + theatre — the ask). Structure it so future staff notifications are trivial to add — candidates to note, not build now: a new **donation**, a **comp** issued, an **undelivered confirmation**, a **Backstage/contact enquiry**. Each would be one registry entry + one `sendTransactionalEmail` call at its own hook. **Decision 4:** ship rentals-only + the framework (recommended) vs wire several event types now.

## Security / abuse guardrails (important)
- **Recipients come ONLY from the admin config — never from the submission payload.** The form must not be able to make the system email an arbitrary address (no open relay). The submitter's address may be used as **reply-to**, never as a **to/bcc**.
- Send from the verified `@kenworthy.org` Resend sender (as today).
- Keep the notification content free of anything that shouldn't leave the building; it's staff-facing, but still avoid embedding secrets/tokens.

## Decisions for Tom
1. **Scope:** build the manageable config + admin toggle (recommended — matches "a way to manage") vs hardcode events@kenworthy.org for rentals only for now.
2. **Storage:** `app_config` JSON (recommended, reuses audited infra) vs a dedicated `notification_settings` table (cleaner if this grows large).
3. **Recipients:** allow **multiple** addresses per notification (recommended) vs a single address.
4. **Event types now:** `rental_request` (marquee + theatre) + the framework (recommended) vs wire donations/comps/enquiries too.
5. **Reply-to:** set to the requester's email (recommended, convenient for staff) vs a no-reply.

## Test plan
- Submitting the **marquee** form emails the configured staff list (default events@kenworthy.org) with the marquee message, contact, dates, and a working link to the admin Rentals queue; subject marks it as marquee.
- Submitting the **theatre/backstage** rental form does the same, distinguished by `venue_area`.
- A **failed** staff email (bad address, Resend hiccup) is logged and **does not** fail the patron's submission or show them an error.
- Admin can **change recipients** and **toggle** the rental notification in the UI; the function honors it immediately; with no config set, it still defaults to events@kenworthy.org.
- The system **cannot** be made to email an address taken from the form payload (verify the recipient list is config-only; reply-to may be the submitter).
- Emails send from the verified `@kenworthy.org` sender; admin config writes are audited; `npm run build` + tests pass.

---

## Outcome (2026-09-16)

All five recommended decisions taken: manageable config + admin toggle, `app_config`
storage, multiple recipients, `rental_request` only plus the framework, reply-to
= requester.

**What was built**

| piece | where |
|---|---|
| Registry, settings reader, sender, rental message | `supabase/functions/_shared/staff_notifications.ts` (+ `_test.ts`, 14 tests) |
| `sendTransactionalEmail` takes an optional `replyTo` | `supabase/functions/_shared/deliver.ts` |
| The hook, after the insert, under `EdgeRuntime.waitUntil` | `supabase/functions/rental-request/index.ts` |
| Admin write policy on the one key, seeded default row | `supabase/migrations/20260916200042_staff_notifications_config.sql` |
| Frontend registry mirror, recipient parsing, validation | `src/lib/staffNotifications.ts` (+ `.test.ts`, 8 tests) |
| The screen: `/admin?section=notifications`, admin-only | `src/components/admin/NotificationsTab.tsx`, wired in `AdminDashboard.tsx` under **Site** |

**How the open-relay guard is enforced, structurally rather than by review:**
`notifyStaff` has no recipient parameter. The only path to a To address is
`app_config.staff_notifications`, which only admins can write (RLS, audited).
The test "recipients come from config; the submitter is Reply-To and never To"
pins it.

**Fallback semantics** (identical in the Deno module and the Vite mirror): a
missing or malformed entry, or an empty recipient list, means *events@*. Only a
literal `enabled: false` means nobody. The admin screen refuses to save
"enabled with no addresses" because that state would not mean what it looks
like.

**Adding a notification type:** one entry in `STAFF_NOTIFICATION_TYPES` in
*both* registries, then one `notifyStaff(admin, kind, message, { replyTo })`
call at the hook that knows the event happened.

**Production (2026-09-16, ~20:15 UTC):** migration pushed, `rental-request`
deployed, PR #307 squash-merged as 98d6e39, `wrangler deploy` from that commit
→ Worker version `88c4aedc-70ff-4a75-b6e8-0601865344c9` (previous, for
rollback: `795d52f7-bfd5-4291-baf3-69bd9de73f7c`). Verified against the live
origin: entry chunk matches the build, the AdminDashboard chunk is served as
text/javascript at the built size and carries the Notifications screen. Before
deploying, production was proven equal to origin/main by content: every chunk
whose hash differed was byte-for-byte the same size, and the entry chunk
differed only in chunk-hash references.

**Staging note:** the seeded staging row was pointed at Resend's
`delivered@resend.dev` sink for verification, so staging test submissions do
not land in the real events@ inbox. Production is seeded with events@.
