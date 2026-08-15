# Activity log — admin-only, wider coverage, guardrails

**Outcome doc for** `BRIEF-activity-log-admin-only.md`
**Date:** August 15, 2026
**Branch:** `feat/audit-log-admin-only`
**Migration:** `20260815015037_audit_log_coverage_and_guardrails.sql`

---

## What the brief got wrong, and why it matters

The brief was written against a snapshot that had already moved. Three
corrections, each of which changed what was built:

**1. The RLS layer was already done.** `20260814214233_rls_permissions_hardening.sql`
(the RLS security audit session, already on `main`) drops the staff clause,
creates `"Admins can view audit log"` as admin-only SELECT, and revokes
UPDATE/DELETE from `authenticated`. Rewriting it would have produced a second
migration fighting the first. **Change 1 was therefore a two-file UI job**, not
the three-layer change the brief describes.

**2. Coverage was 13 tables, not 10.** `20260626153407` added `dvds` and
`dvd_rentals`; `20260813000000` added `user_film_passes` on UPDATE/DELETE only.
That last one matters as precedent — see "append-only ledgers" below.

**3. `app_config` has no `id` column.** Its primary key is `key text`. The old
trigger read `(to_jsonb(NEW)->>'id')::uuid`, which for `app_config` evaluates to
`NULL::uuid` — no error, but every settings change would have logged with
`entity_id = null`, i.e. *"a setting changed, we won't say which"*. The brief
asked for `app_config` coverage without noticing this would have delivered
coverage that answered nothing.

## What was built

### Change 1 — admin-only (the actual request)

| Layer | File | State |
|---|---|---|
| RLS SELECT | `20260814214233_rls_permissions_hardening.sql` | already done, untouched |
| Page guard | `src/pages/admin/AuditLog.tsx` | `!isAdmin && !isStaff` → `!isAdmin` |
| Dashboard link | `src/pages/admin/AdminDashboard.tsx:414` | wrapped in `{isAdmin && …}` |

INSERT stays open to staff. Staff actions must still *write* audit rows; they
simply cannot *read* them. (The trigger is `SECURITY DEFINER` so it bypasses RLS
anyway — the INSERT policy only governs explicit client-side inserts, which is
now also how staff sign-ins get recorded.)

### Change 2 — coverage (the tuned set)

**Full INSERT/UPDATE/DELETE:** `concession_menus`, `concession_combo_items`,
`donations`, `film_pass_orders`, `rental_requests`, `rental_invoice_lines`,
`app_config`, `venues`, `venue_seats`, `showing_price_tiers`.

**UPDATE/DELETE only:** `concession_sales`, `film_pass_redemptions`. These are
append-only ledgers — the row *is* the record of the sale, written once per
transaction at the counter. Logging the INSERT doubles write volume to restate
what the table already says, and buries the after-the-fact edit, which is the
one event here worth an alert. Same reasoning `20260813000000` applied to
`user_film_passes`.

**Deliberately excluded:**

- `seats` — the pre-venue global seat map (no `venue_id`), superseded by
  `venue_seats` and no longer written by anything.
- `signing_keys` — service-role only, and its rows *are* key material.

### Change 3 — the guardrails

**Redaction is load-bearing here, not theoretical.** Two fields in the
newly-covered tables are live capability tokens:

- `rental_requests.invite_token` — whoever holds it can open a rental contract
  for signing.
- `film_pass_orders.checkout_idempotency_key` — a replay token.

Without redaction, turning on coverage would have started copying both into a
table 12,000 rows deep that every admin can read. `audit_redact()` matches by
**field name at any depth**, so a token nested inside `app_config.value` (free-form
jsonb) is caught too.

Matching by name rather than by value is deliberate: a name heuristic is stable,
whereas sniffing values for things that look like secrets is not. A false
positive costs one field of audit detail; a false negative writes a live
credential where every admin can read it.

**`entity_key`.** When `id` is absent or is not a uuid, the trigger records
`details.entity_key` from `id`/`key`/`code`/`slug`, and `AuditLog.tsx` shows it
where it would otherwise show a truncated uuid. This is what makes an
`app_config` entry say *which* setting changed.

**The uuid read is shape-checked before casting.** A raise inside an AFTER
trigger fails the write that triggered it — an audit log that can break the
thing it audits. A future table keyed by bigint now logs with a null
`entity_id` instead of raising. Verified: T7 below.

**Bulk suppression is a table, not a session GUC.** This is the one design
decision worth remembering. `square-catalog-sync` upserts one `concession_items`
row *per HTTP request*, and PostgREST gives each of those its own transaction —
so `SET LOCAL app.audit_suppress` would not survive from one row to the next.
`public.audit_suppression` (one row per paused table, with an `expires_at`) is
checked by the trigger and works regardless of transaction boundaries.

Cost: one primary-key probe per audited row, on a table holding zero or one
rows. Two properties make it safe:

- **It cannot silently blank the log.** `audit_bulk_begin` writes a `".started"`
  row *before* it suppresses anything. A gap in the log is always announced, by
  a named actor.
- **A crashed importer un-suppresses itself.** Every suppression carries
  `expires_at` (default 10 min). Verified: T6 below.

It is service-role only — no grant to `authenticated`, no RLS policy. Anything
reachable from the browser that can pause the audit trigger is a hole in the log
rather than a feature of it.

### Change 4 — non-table events

| Event | Where | Actor |
|---|---|---|
| Square catalog pull | `square-catalog-sync` (`withBulkAudit`) | the admin who clicked |
| Square item push / delete | `square-catalog-sync` | the admin who clicked |
| LGL donation sync | `lgl-sync-donation` | the admin who clicked |
| Mailchimp campaign created | `mailchimp-campaign` | the admin who clicked |
| Transactional email / SMS | `_shared/deliver.ts` (the one choke point) | system |
| Auth email (reset, magic link) | `send-auth-email` | system |
| Staff sign-in / sign-out | `src/lib/auth.tsx` → `auditClient.ts` | themselves |
| Failed staff sign-in | `log_failed_staff_login()` RPC | none (no session) |

**Why `mailchimp-campaign` and `lgl-sync-donation` get their own rows even
though `donations` is now trigger-audited:** both reach a system outside this
database. LGL has no sandbox and shares one API key with production; Mailchimp
shares one key and one audience. A campaign drafted from staging is a real
campaign against the real list, and *nothing in this database changes when that
happens*. The activity log is the only place the act is recorded at all.

**Addresses are masked** in email/SMS entries (`t***@example.com`), matching what
`send-auth-email` already wrote to its console. These fire for ticket buyers and
donors, not just staff; what an admin needs is that a receipt went out at 14:02
and whether it succeeded, not a readable dump of every customer's address.

**Members are not logged in.** This is an operations log about who ran the
theatre's systems, not a record of who watched a film.

#### Failed sign-ins: why an RPC, and why it is not a log-injection hole

A failed sign-in has no session, so the INSERT policy (`actor_id = auth.uid()`
AND a role) rejects it. `log_failed_staff_login(p_email)` is `SECURITY DEFINER`
and granted to `anon`, which would normally be a way for anyone on the internet
to push arbitrary rows into a table an admin has to read. Three constraints
close that:

1. It records **nothing** unless the address matches a real `auth.users` row.
2. It records nothing unless that user **holds `staff` or `admin`**. A member
   typo is not a security event.
3. It is **rate-limited to one entry per account per minute**, so a
   password-guessing run against a known staff address cannot itself become a
   way to flood the log.

The content is the email **from `auth.users`**, never caller-supplied text. It
returns void in every case, so it cannot be used to enumerate which addresses
are staff.

**Sign-ins are logged from `signIn()`, not from `onAuthStateChange`.** That
listener also fires `SIGNED_IN` on token refresh and on returning to the tab — a
listener would record "signed in" several times a shift for someone who signed
in once. `signIn()` is the only path in: `Auth.tsx` offers password sign-in and
a password reset, and no magic-link or OTP entry point exists. Sign-*out* is
logged **before** `supabase.auth.signOut()`, because the INSERT policy needs a
session and there is none a moment later.

### Retention — deliberately not built

Tom's call. ~12,280 rows on production today; the added coverage may double or
triple that, which is still small. `pg_cron` is **not enabled on either
project**, so a scheduled prune is its own piece of work with its own moving
parts. Revisit once there is a real growth rate to size it against — the
`.started`/summary rows from bulk syncs make that easy to measure.

## The one duplicated rule

`audit_is_secret_key()` (plpgsql) and `isSecretKey()` (`_shared/audit.ts`) are
two copies of the same redaction rule. This is a real cost and it is on purpose:
the trigger redacts row diffs, and the Deno copy redacts the hand-built
`details` an edge function passes to `logAudit` — a payload no trigger ever sees,
because no row changed. There is no shared execution context between plpgsql and
Deno.

**When they drift, the side that drifts loose writes a credential into a table
every admin can read, and nothing in the log looks wrong afterwards.** So they
are pinned against each other: `audit_test.ts` asserts the Deno rule over a list
of 24 field names, and **T10 runs the same 24 names through the SQL rule and
fails on any disagreement**. Change one, and the other test goes red.

`entity_key` is in an allowlist on both sides. It ends in `_key`, and the first
version of this redacted it — which would have blanked the one field that makes
an `app_config` entry legible. The Deno test caught it before the SQL side
shipped.

## Verification

### Migration — run for real, not just parsed

Per `test-migrations-in-throwaway-postgres`: `docker postgres:15` + stub tables +
the three Supabase roles. Scripts kept at
`scratchpad/{stub.sql,test.sql}` (regenerable — they are stubs, not fixtures).

| # | What it pins | Result |
|---|---|---|
| T1 | `app_config` logs `entity_key`, not a null uuid | ✅ `hiring_enabled` |
| T2 | `invite_token` never reaches the log; status still diffs | ✅ 0 rows contain the literal |
| T3 | Redaction reaches inside a jsonb column, nested | ✅ 0 rows contain the literal |
| T4 | `concession_sales` logs UPDATE/DELETE, not INSERT | ✅ |
| T5 | 500 writes under suppression → 0 per-row entries; `.started` + summary rows written; logging resumes | ✅ |
| T6 | Expired suppression self-heals | ✅ |
| T7 | A bigint-keyed table does not break the write it audits | ✅ row written, `entity_id` null |
| T8 | Failed logins: unknown → nothing, member → nothing, staff → 1 row, retry → rate-limited | ✅ exactly 1 row |
| T9 | `auth.uid()` actor resolution unchanged | ✅ |
| T10 | SQL and Deno redaction rules agree on 24 field names | ✅ 0 disagreements |
| T11 | Admin-triggered sync names the admin; webhook run stays "system" | ✅ |

### Application

- `npx tsc -p tsconfig.app.json --noEmit` — clean.
  (`tsc --noEmit` alone is a no-op here; solution-style tsconfig.)
- `npm run test` — 18 files, **149 passed**.
- `npm run build:staging` — clean.
- `deno check` on all six changed function files — clean.
- `deno test --allow-env` per shared module — **109 passed**, including the 6 new
  `audit_test.ts` cases.

**One pre-existing failure, not caused by this work:** `tickets_test.ts` cannot
resolve `npm:pngjs@7.0.0` in a fresh worktree (`deno install` territory).
`tickets.ts` and its test are untouched on this branch — `git diff origin/main`
on both files is empty.

## Deploying this

**Not yet deployed to either project.** Privileged SQL was blocked by the
permission classifier for this session, so the migration has been proven against
a throwaway postgres but not applied to staging or production, and nothing was
redeployed.

Order matters — **migration first, then functions, then the app**. The edge
functions call `audit_bulk_begin`/`audit_bulk_end`, which do not exist until the
migration lands; `logAudit` swallows its own errors, so a wrong order degrades to
missing log lines rather than broken syncs, but the pull would log nothing.

1. `supabase db push` — staging, then production. Check `supabase link` per
   checkout first (`LegacyDbConfigIpv6Error` means relink), and confirm the
   `20260815015037` prefix has not collided with another session's migration.
2. Redeploy the functions changed **directly**: `square-catalog-sync`,
   `lgl-sync-donation`, `mailchimp-campaign`, `send-auth-email`.
3. Redeploy everything that **bundles `_shared/deliver.ts`**, which gained an
   import and so drifts until redeployed: `send-ticket-confirmation`,
   `ticket-checkout`, `film-pass-checkout`, `square-donation` (and
   `lgl-sync-donation`, already in step 2).
   `curl` each one after deploying — a local check cannot detect a `BOOT_ERROR`.
   `audit.ts` has **zero imports** by design, precisely to keep that risk off
   this path.
4. `npm run build:staging` / `build:production` and deploy the app.

### Manual checks after deploy

- **Admin-only:** an admin sees the "Activity Log" button and the page loads. A
  staff user does not see the button, is redirected from `/admin/audit-log`, and
  a direct `select` on `admin_audit_log` with a staff JWT returns nothing. A
  staff member's own edit still creates a row.
- **Square pull:** writes **two** rows (`concession_items.bulk_sync.started` and
  `concession_items.bulk_sync`), naming the admin who clicked — not ~998 rows.
- **`app_config`:** change a setting; the entry names the key and carries no
  secret value.
- **Do not test the LGL path against staging.** It shares production's API key
  and has no sandbox — a test sync writes a real donor record with no reversal
  path. Same for Mailchimp: one key, one audience, shared with production.

## Follow-ups

- **`square-catalog-sync` still upserts row-by-row.** Suppression makes that
  safe for the *log*, but the loop itself is the over-pull's mechanism and is
  being fixed on `fix/square-pull-scoping` (another session). Once scoping lands,
  the loop is worth collapsing into a single bulk upsert — at which point
  suppression becomes belt-and-braces rather than load-bearing.
- **Retention**, when there is a growth rate to size it against.
- **`ENTITY_LABEL` in `AuditLog.tsx` needs a line per newly-audited table.** It
  falls back to the raw table name, which is legible but ugly. There is a comment
  in the file saying so.
