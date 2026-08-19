---
brief: activity-log-admin-only
title: Activity log — make it admin-only + close coverage gaps (it already exists)
status: shipped
track: security
date: 2026-08-14
shipped_in: ["f697800"]
verified: true
findings: BRIEF-activity-log-admin-only-OUTCOME.md
---

# Brief (for Claude Code): Activity log — make it admin-only + close coverage gaps (it already exists)

**Status:** ✅ Shipped — admin-only activity log, `f697800`. See `BRIEF-activity-log-admin-only-OUTCOME.md` for what changed.
**Date:** August 14, 2026
**Requested by:** Tom — an activity log visible **only to admin**.

## Important: this feature already exists (verified) — don't rebuild it
- **Table:** `admin_audit_log` (`actor_id`, `actor_email`, `action`, `entity_type`, `entity_id`, `details jsonb`, `created_at`) with entity/actor indexes — migration `20260617072515`.
- **Auto-logging trigger:** `log_audit_event()` (migration `20260617072944`) logs INSERT/UPDATE/DELETE with a **field-level diff** of what changed (excludes `updated_at`), and special-cases a few actions (`sponsorship_opportunities.publish/unpublish`, `tickets.scan`). Service-role/edge-function writes log with `actor_id = null` (shown as "system").
- **Currently attached to 10 tables:** `sponsorship_opportunities, showings, movies, events, live_performances, tickets, profiles, user_roles, concession_items, film_pass_types`.
- **UI:** `src/pages/admin/AuditLog.tsx`, routed `/admin/audit-log` (`App.tsx:103`), linked from the dashboard as **"Activity Log"** (`AdminDashboard.tsx:396`). It has actor/entity/date filters, expandable detail rows, newest-first, `limit 500`.

So most of what's requested is live. The two real gaps vs. the ask are **visibility** (it's admin *and staff* today, not admin-only) and **coverage** (several important tables aren't logged).

## Change 1 — make it admin-only (the actual request)
Tighten all three layers (defense in depth; the RLS layer is the real boundary):
1. **RLS SELECT policy** on `admin_audit_log` (currently `has_role(admin) OR has_role(staff)`, migration `20260617072515`) → **admin only**: drop the staff clause so it reads `has_role(auth.uid(),'admin')`. *(This also resolves `BRIEF-rls-security-audit.md` finding #5: audit-log SELECT should be admin+.)* Keep INSERT as-is (staff actions still need to be recorded — staff **write** audit rows via their own actions, they just can't **read** the log).
2. **Page guard** `AuditLog.tsx:52` — change `if (!isAdmin && !isStaff)` to `if (!isAdmin)` so staff are redirected.
3. **Dashboard link** `AdminDashboard.tsx:396` — gate the "Activity Log" link with `{isAdmin && …}` so staff don't see the entry point.

## Change 2 — close coverage gaps (so the events you care about actually appear)
Extend the `log_audit_event()` trigger list (the `tables[]` array in `20260617072944`) via a **new migration** to add the tables that matter operationally and financially — recent incidents (the Square concessions over-pull) would have been visible with fuller coverage. Recommended additions:
- **Concessions (siblings of the already-logged `concession_items`):** `concession_menus`, `concession_combo_items`, `concession_sales`.
- **Money / passes:** `donations`, `film_pass_orders`, `user_film_passes`, `film_pass_redemptions`, `dvd_rentals`, `rental_requests`, `rental_invoice_lines`.
- **Config / security (high value):** `app_config` (Mailchimp/LGL/webhook secrets + toggles — who changed a setting), `venues`, `seats`/`venue_seats`, `showing_price_tiers`.
- Leave **`signing_keys`** to service-role only; logging its *changes* is fine but never log key material into `details` (see Change 3 redaction).
Confirm the final list with Tom (Decision 1) — pick the set worth the write overhead.

## Change 3 — guardrails (learned from the over-pull)
1. **Don't let bulk syncs flood the log.** The `square-catalog-sync` pull upserts *thousands* of `concession_items` rows — with the trigger firing per row, one bad pull would also write thousands of audit entries. Add a guard: either (a) have high-volume sync functions **suppress the per-row trigger** and instead write **one summary audit row** (`action: 'concession_items.bulk_sync', details: { pulled: N, source: 'square' }`) via an explicit `logAudit` call, or (b) keep per-row logging but ensure the sync fix (scoping/no-auto-activate, see `BRIEF-concessions-square-overpull.md`) lands first so volumes are sane. Recommend (a) for any bulk importer.
2. **Redact secrets from `details`.** For `app_config` (and anything holding tokens), the diff must **not** copy secret values into `admin_audit_log.details` — log that a key *changed*, not its value. Add a redaction list (keys matching `*_secret`, `*_key`, `*token*`, `api_key`, etc.) to the trigger's change-diff so credentials never land in the log.
3. **Retention.** The table grows unbounded. Add a retention policy — e.g. a scheduled prune keeping ~12 months (or archive older rows). Decision 2.

## Change 4 (optional) — log non-table events (Decision 3)
Table triggers only capture DB writes. If Tom wants a fuller "activity log" — **staff logins**, **integration runs** (Square pull/push, LGL donation sync, Mailchimp campaigns), **email sends**, **failed auth** — add explicit `logAudit(action, entity, details)` calls in the relevant edge functions (a small shared helper writing one row as `service_role`). Recommend at least logging **integration runs** (a Square pull/push, an LGL sync) since those are exactly the operations that caused trouble.

## Decisions for Tom
1. **Coverage set:** confirm which tables to add (the Change-2 list, or a subset). More coverage = more insight but more write volume.
2. **Retention:** keep everything, or prune/archive after N months (recommend 12)?
3. **Non-table events:** log integration runs / logins / email sends too (Change 4), or keep it to DB changes for v1? (Recommend at least integration runs.)
4. **"System" actor:** edge-function/service-role actions log as `actor_id = null` ("system"). Fine as-is, or should sync functions record *which admin clicked the button* by passing the caller's id through? (Recommend passing it through for admin-triggered syncs.)

## Test plan
- **Admin-only:** an **admin** sees the "Activity Log" link and the page loads; a **staff** user does **not** see the link, is redirected from `/admin/audit-log`, and a direct `select` on `admin_audit_log` as a staff JWT returns **nothing** (RLS). A staff member's own edit still **creates** an audit row (INSERT still allowed).
- **Coverage:** editing/toggling a row in each newly-added table produces an entry with the correct `action`, `entity_type`, actor, and a sensible diff.
- **Guardrails:** a (fixed, scoped) Square pull writes **one** summary row, not thousands; changing an `app_config` secret logs the change **without** the secret value in `details`.
- Existing filters (actor/entity/date), expand, and the 500-row limit still work.
- `npm run build` passes; migration applies cleanly on staging then prod.
