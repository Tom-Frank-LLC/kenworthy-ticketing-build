---
id: BUG-ea-lifecycle-crm-only-multi-principal-cluster
title: "EA lifecycle cluster (CRM-only EA → multiple principals → account): EA not shown in Contacts Type column; invite-the-EA is per-principal not per-EA; emailless principal's EA gets no invite; post-account EA has no principal access; and 'Grant from Teams' errors 'no attendee matches this email yet' after an access request"
track: Bug
severity: high
status: queued
related:
  - FEATURE-ea-access-request
  - FEATURE-ea-access-request-phase2
  - FEATURE-contact-ea-inverse-view
  - FEATURE-ea-lifecycle-notification-refresh
  - FEATURE-ea-set-password
  - BUG-ea-cc-not-delivered-suppressed-principal-end-to-end
supersedes: []
# DIAGNOSE-FIRST: several symptoms may be expected (CRM-only principal has no profile to access;
# login-as-principal correctly fails). Establish the fixture's real EA-row state before fixing.
# Frontend + possibly small RPC/trigger fixes. No large schema. Baseline: tsc -p tsconfig.app.json = 30.
# NOTE: verify field names against docs/briefs/.frontmatter-schema.md before `bun run catalogue`.
---

# EA lifecycle cluster — CRM-only EA, multiple principals, account transition

## Summary

Testing YvTestEA (created as a **contact**, then assigned as EA to several principals, no account
yet) surfaced five distinct EA-lifecycle issues. They share one setup — a **CRM-only EA keyed by
`assistant_email`, assigned to multiple principals, later getting an account**, with an
**emailless principal** in an invited group. Diagnose the fixture's actual EA-row state first
(some symptoms may be expected, not bugs), then fix the real defects.

## The EA model (grounded — so diagnosis doesn't re-derive it)

- `executive_assistants`: **assistant side = `assistant_email`** (+ optional `assistant_profile_id`;
  **no `assistant_contact_id`**); **principal = XOR** (`principal_profile_id` OR
  `principal_contact_id`). `guard_ea_profile_email_match()` requires `assistant_email` == the
  assistant profile's email once linked.
- `link_ea_on_profile_create` (trigger): on new profile/account, auto-links pending EA rows
  matching the email → `active`, sets `assistant_profile_id`.
- `is_assistant_of(uid, principal)`: flat single-hop `EXISTS` — the acting-as / access gate.
- Assign via `assign_executive_assistant` (XOR-aware, auth-linked→active else pending); pending
  rows get a Send-invite button (`FEATURE-contact-ea-inverse-view`). Max 3 active per principal.
- Access-request path: `create_ea_access_request` → `approve_ea_access_request` /
  `staff_resolve_ea_access_request` → canonical active row via the shared RPC.
- EA auto-CC: bulk emails CC the EA when a contact has an active/pending EA link — **but the CC
  piggybacks the principal's own send**, and **invite sends carry a deliberate no-EA-CC** rule
  (the invite-signup token-TTL mitigation). An `activation-required` route for EA-backed
  principals exists as an **untracked, unapplied** migration
  (`20260804130000_invite_route_activation_required_for_ea_backed.sql`).

## Phase 0 — establish the fixture state (do this first; it decides bug vs expected)

Read the live `executive_assistants` rows for YvTestEA (by `assistant_email`) and answer:
1. Are the assigned **principals contacts or profiles** (`principal_contact_id` vs
   `principal_profile_id`)? (If CRM-only contacts, there is **no principal profile to access** —
   W4 may be expected, not a bug.)
2. Row `status` per principal (active/pending/revoked); is `assistant_profile_id` **NULL before**
   account creation and **set after** (did `link_ea_on_profile_create` fire and match the email)?
3. Does YvTestEA's contact email exactly match the account email created later (the
   `guard_ea_profile_email_match` axis)?
Written as `docs/audits/2026-08-ea-cluster-fixture-state.md`. Baseline `tsc -p tsconfig.app.json` = 30.

## W1 — EA not shown in the Contacts Type column

**Symptom:** YvTestEA shows correctly as EA *for* the principals, but the **Type column** doesn't
say "EA" (contact has no account). **Likely cause:** "EA" is a **relationship**
(`executive_assistants.assistant_email`), **not** a stored `contact_type`; the Type column renders
the contact's own `contact_type`, which is unset for a plain contact. So there's no bug in the
data — the Type column just doesn't derive EA-ness. **Fix (STOP-1):** derive an **"EA" indicator**
for the Type column when the contact's email is an `assistant_email` on an active/pending EA link
(a derived badge alongside `contact_type`), consistent with how the contact already shows as "EA
for" in its card. Confirm whether EA should be a Type value or a separate stacked badge.

## W2 — inviting the EA is per-principal, not per-EA

**Symptom:** to invite the EA, Tom had to click Send next to **one** principal; with 3 principals
assigned at once there are 3 pending rows / send buttons and it's unclear. **Cause:** the EA is
**one person/email**; an invite to the EA covers all their principals, but the UI exposes a
per-assignment send. **Fix:** a single, obvious **"Invite this EA"** action (one send per EA
email, not per principal), and dedupe the per-principal Send buttons so the same EA isn't invited
N times. Confirm the invite is idempotent across the EA's multiple pending rows (one email; all
rows move together on accept).

## W3 — emailless principal's EA receives no invite

**Symptom:** group invite → EA got emails for principals **with** email, but **not** for
YvTestNoEmail (no email, EA = YvTestEA). **Cause:** the EA-CC **piggybacks the principal's send**;
an emailless principal has **no primary send**, so the CC never fires — the EA gets nothing for
that principal. For an emailless principal, **the EA is the deliverable path**. **Fix:** when a
principal has no email but has an active/pending EA, **route that principal's invite to the EA
directly** (EA as primary recipient), rather than dropping the principal silently. This is the
emailless-principal → EA delivery gap (sibling of
`BUG-ea-cc-not-delivered-suppressed-principal` and the emailless-contact surfacing in
`FEATURE-attendee-user-provisioning` C1). Confirm the RSVP/invite send path and where the
emailless principal is dropped.

## W4 — post-account, EA has no access to principals

**Symptom:** after YvTestEA creates an account, the EA has no access to the principals' profiles.
**Diagnose (Phase 0 decides):**
- If the principals are **CRM-only contacts** (no profile), there is **nothing to "act as"** —
  acting-as needs a principal **account/profile**. That's **expected**, and the fix is a **clear
  UI message** ("this principal has no account yet"), not access.
- If the principals **are profiles** and access still fails, then either
  `link_ea_on_profile_create` didn't set `assistant_profile_id` (email-match failure), or the
  acting-as surface (`useActingAs` / `is_assistant_of`) isn't picking up the newly-linked rows.
  Trace which, and fix the link/acting-as resolution so a freshly-created EA account gains its
  principals. **STOP-2:** confirm whether the test intends contact-principals (expected: no
  access) or profile-principals (bug).

## W5 — access request → 'Grant from Teams' errors "no attendee matches this email yet"

**Symptom:** the EA (post-account) couldn't respond to a received invite, **requested access**
(the `ea_access_requests` flow), and then **Granting from the Teams page** errored **"no attendee
matches this email yet."** **Diagnose:** identify what "Grant from Teams" actually calls — it
should be `approve_ea_access_request` (principal) or `staff_resolve_ea_access_request` (staff),
which create the canonical EA link by **email**, **not** by attendee membership. The error string
"no attendee matches this email" means that grant affordance is (wrongly) resolving the EA/principal
**against `event_attendees`** instead of the EA-access-request/EA-assignment path. Find the mismatched
grant surface and repoint it at the correct approve/resolve RPC (or fix its lookup so it doesn't
require an attendee row). Also confirm the **EA-respond path**: responding to an invite on a
principal's behalf needs the `activation-required` route (the untracked
`20260804130000_..._activation_required_for_ea_backed.sql`) — decide whether that migration is
part of this fix or a dependency to land first (STOP-3).

## Confirmed working (not bugs — record so they're not "fixed")

- Trying to **log in as the EA of the principal before creating an account** correctly fails.
- An EA **without an account** cannot reply to an invite — expected until account + link exist.
(Per Tom's notes.)

## STOP gates

- **STOP-1 (W1):** EA as a Type value vs a separate derived badge in the Type column.
- **STOP-2 (W4):** the fixture's principals — contact (expected: no acting-as) vs profile (bug);
  fix = clear messaging vs link/acting-as repair.
- **STOP-3 (W5):** whether the `activation-required` EA-respond migration lands in this fix or is a
  prerequisite; and confirm the correct "Grant" surface/RPC.
- **STOP-4 (W3):** emailless-principal invite routes to the EA as primary (recommended) — confirm.

## Acceptance criteria

- **W1:** a CRM-only contact who is an active/pending EA shows an "EA" indicator in the Type
  column (derived), consistent with the card's "EA for" view.
- **W2:** one clear "Invite this EA" action sends a single invite covering all the EA's principals;
  no per-principal duplication.
- **W3:** inviting a group containing an emailless principal-with-EA delivers the invite to the EA
  (the deliverable path); no principal is silently dropped.
- **W4:** either the EA gains acting-as access to **profile** principals after account creation, or
  (for CRM-only principals) the UI clearly states there's no account to act as — no silent
  no-access.
- **W5:** after an EA access request, the correct Grant/approve path (principal or staff) creates
  the EA link **without** an "attendee matches this email" requirement; the EA can then respond to
  the invite on the principal's behalf.
- Confirmed-working paths unchanged; `tsc -p tsconfig.app.json` 0 new (baseline 30); `bun run
  build` clean; any RPC/trigger change staging→prod per `publish-checklist.md`; EA guards
  (self, XOR, max-3, email-match, enumeration-resistance) intact.

## Verification plan

- Staging, rebuild the fixture: CRM-only EA → 3 principals (test both contact- and profile-principals) →
  emailless principal in a group. Type column shows EA; one invite reaches the EA; the emailless
  principal's EA is emailed; create the EA account → link fires (`assistant_profile_id` set) →
  acting-as lists profile-principals; request access → staff/principal Grant succeeds (no attendee
  error) → EA responds to the invite.
- EA guard suite (self/XOR/max-3/email-match) still passes; auto-CC on normal bulk sends unchanged.
- Tom's staging pass on the exact reported sequence.

## Open decisions for Tom

1. **STOP-1:** EA as Type value vs derived badge.
2. **STOP-2:** contact- vs profile-principals in the fixture (decides W4 = message vs fix).
3. **STOP-3:** land the activation-required EA-respond migration here vs as a prerequisite; confirm
   the Grant surface.
4. **STOP-4:** emailless-principal invite → EA as primary recipient.
