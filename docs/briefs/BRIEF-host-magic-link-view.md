---
brief: host-magic-link-view
title: A one-off event host signs in by emailed link and sees their own production's sales, read-only
status: built
track: feature
severity: P2
date: 2026-11-05
verified: false
evidence: supabase/migrations/20261105025356_host_view_at_aal1.sql; supabase/tests/admin_mfa (97 cases)
---

# Brief (for Claude Code): Magic-link, view-only sales window for one-off event hosts

**Requested by:** Tom. Hosts are one-off external renters. Chosen over (a) a
shared "event code" (an unauthenticated shared secret over sales and PII) and
(b) full password + MFA host logins (forces a one-off renter to install an
authenticator app, since MFA is on and TOTP is the only counted factor).
Decision: the magic-link session is **view-only**, which is what makes skipping
MFA defensible — assurance matches authority.

## The design, as briefed

1. **Split host RLS:** reads tolerate aal1, writes still require aal2. Do not
   weaken the writes. Staff/admin/superadmin unchanged.
2. **Don't force a host-only session through MFA.** `MfaGate` lets a host-only
   account (holds `host`, none of staff/admin/superadmin) through at aal1;
   `my_mfa_required()` reports "not required" for it. An account holding `host`
   *and* a privileged role still needs aal2, for the gate and for writes.
3. **Passwordless sign-in** at an unadvertised `/host/login`:
   `signInWithOtp({ shouldCreateUser: false })`, magic link or 6-digit code,
   non-enumerating, abuse-guarded.
4. **Invite a host by email** from `HostManagementTab`: create the account if
   absent with no password, grant `host`, assign the production, optionally send
   the first link.
5. **The host view is view-only.** No add/delete/hide showing, no comps, no
   production or `pass_processing_fee` edit, no Export Contacts. Attendee list
   is name · ticket type · checked-in; no email or phone.

Decisions as built (Tom's recommended defaults): (1) name · ticket type ·
checked-in, no contacts, no export; (2) link **and** code; (3) invite by email,
no password ever set; (4) see "Session lifetime" below.

Deferred, as briefed: a host write tier behind MFA; SMS as a second factor; the
comp-delivery fix (`BRIEF-comp-ticket-delivery.md`).

## What the build established

**An aal1 host was refused in three places, not one.** The brief named the aal2
guard in `is_host_of`. There were two more:

- the **restrictive** `"Signed-in sessions need their code"` policies
  (`session_ok()`, `FOR ALL`) on `tickets`, `host_event_assignments` and
  `profiles`, which veto every permissive policy, including the host ticket
  policy that has no guard of its own;
- `showing_attendees()`, which returned email and phone to hosts, so the
  "no contacts" decision had to be enforced in SQL as well, not just in the UI.

**A host's ticket reads cannot be column-limited on the table.** RLS works per
row, and column grants are per role (`authenticated`), not per kind of session.
So a host never reads `tickets` directly at aal1. The restrictive policy there is
**untouched**, and two narrow functions answer instead.

**The send-email hook already did half of part 3.** `send-auth-email` delivers a
magic link only to an account holding a sign-in role, and answers 200 either
way. So a buyer's account never gets a link, and the endpoint does not reveal
which addresses are hosts. That was already true of the public
`/auth/v1/otp` endpoint before this work.

## What was built

**Migration `20261105025356_host_view_at_aal1.sql`:**

- `is_host_of` / `is_host_of_showing` are **unchanged**. Every write policy,
  `check_in_ticket` (the door scanner) and comps in `create_ticket_order` keep
  the aal2 guard through them. This departs from the brief's suggested shape
  ("remove the guard from `is_host_of` and add it to each write policy"). The
  read allowance lives in two **new** predicates instead, `can_host_read` /
  `can_host_read_showing`, used only at the read sites below. If a read site is
  missed, the result is an empty view. Under the suggested shape, a missed
  write policy would have become an unguarded write.
- The new predicates are `is_host_of`'s body plus one way past the guard: the
  caller holds `host` and no staff/admin/superadmin role. The guard is inlined,
  following the per-row perf rule from `20261009003240`.
- Read sites opened, all scoped by assignment: `showings` ("Hosts can view
  assigned showings", rewritten); **new** host SELECT policies on `events`,
  `live_performances` and `movies`. Before this, an *inactive* production was
  invisible to its own host at any aal, and new events default to inactive.
  On `host_event_assignments`, the restrictive policy is split by command:
  SELECT allows `session_ok() OR host_view_session()`, and
  INSERT/UPDATE/DELETE keep `session_ok()` unchanged.
- `host_ticket_counts(showing_ids)` → sold / comps / checked in, confirmed only.
  `host_attendees(showing_id)` → name, ticket type, comp, checked in, purchased
  at. No contact columns. Callable by staff, or by a host of that showing.
- `showing_attendees()` (contacts, used by the export) is **staff only** now.
- `my_mfa_required()` is false for a host-only account.

**Client:** `/host/login` (`src/pages/HostSignIn.tsx`, `src/lib/hostSignIn.ts`);
`useAuth().isHostOnly`; `MfaGate` passes host-only sessions. `HostDashboard`
shows controls only to staff; a host gets Showings (per-showing sold / comps /
checked in) and Attendees, read-only. A signed-out visit to `/host` goes to
`/host/login`. The door scanner link is hidden from an aal1 host-only session,
because the database refuses a check-in there.

**Two existing bugs fixed on the way, because the host view depended on them:**
- `HostDashboard` read **every** visible showing and filtered client-side.
  Past showings are visible to everyone (~1,800), so PostgREST's silent
  1,000-row cap could drop a host's own showings. It now filters by production
  on the server.
- `HostManagementTab` named assignees from an unpaged `profiles` read, which
  hits the same cap (every guest buyer has a profile). An invited host would
  have shown as "Unknown User". Assignee names are now read by id, with email as
  a fallback.

**Onboarding:** `invite-staff` takes `host_assignment: { kind, id }` and
`send_sign_in_link`. With them, a new account is made with `createUser`
(confirmed, no password, no invitation email), granted `host`, assigned (with a
check first, because the table has no unique constraint) and sent a magic link
through GoTrue's ordinary `/otp`. The tier and target checks are the existing
ones. If the target already holds a privileged role, no link is sent and the
admin is told they use the staff sign-in. Audited as `host.invite`.

**Email:** the magic-link email now carries the code under the button, so a
host can open it on a phone and type the code on a laptop.

## Departures from the brief, and why

- **No Turnstile widget on `/host/login`.** Auth captcha is off on both
  projects, and the form is a thin client over the public `/auth/v1/otp`
  endpoint. A widget the server never verifies guards nothing: anyone can call
  the endpoint directly with the publishable key, today and after this change.
  The real guards are the ones already in place: the hook mails only role
  holders, and Supabase's per-address and per-IP email limits apply. Real
  Turnstile here means enabling GoTrue captcha **project-wide**. That would put
  a widget on staff password sign-in, forgot-password and the native apps too,
  so it is Tom's decision. `hostSignIn.ts` already reports a captcha refusal
  instead of a false "sent".
- **Hosts at aal2 get the read-only view too.** The brief removes the controls
  from "the host-only/aal1 session". Here they are shown to staff only, at any
  aal, because the host write tier is deferred. The database still honours a
  host's aal2 writes, as before; only the buttons are gone.
- **Revenue is not shown.** "Ticket-sales figures" is built as counts. A dollar
  figure that ignored tax, discounts, fees and refunds would disagree with the
  rental settlement. Add it once someone defines which figure a renter should
  see.

## Session lifetime (Decision 4)

Left at the Supabase default. Session settings are project-wide, so shortening
them for hosts would shorten them for staff too. Revocation does not depend on
session length anyway: every host read checks the assignment, and on the aal1
path the `host` role, live. Removing either empties the view on the next load.
Removing the role also stops token refreshes (`refuse_roleless_access_token`).

## Tests

- `supabase/tests/admin_mfa` (97 cases, full migration replay): aal1 host-only
  reads its assignment, the hidden showing, the inactive production, counts and
  attendees; reads **no** ticket rows and **no** contacts; is refused adding,
  changing or deleting a showing, editing the production / fee, issuing a comp,
  checking a ticket in, and adding or removing an assignment. Host + staff at
  aal1 gets nothing. An ex-host (assignment left, role removed) gets nothing.
  A patron gets nothing. Anon can call none of the new functions. aal2 host
  writes still work; contacts are staff only. Structural checks extended to the
  new predicates.
- `src/components/mfaGate.test.tsx`: host-only passes at aal1 with the switch
  on, even with an enrolled factor; host + staff is still asked for the code or
  sent to enrol.
- `src/lib/hostSignIn.test.ts`: the same answer for a host, an unknown address
  and a rate-limited repeat; transport and captcha failures reported.
- `auth_email_test.ts`: a magic link carries the code; a recovery email never
  does. `invite-staff/host_assignment_test.ts`: only the three production tables.

**Not yet exercised:** a real magic-link / code round trip on staging. It needs
an inbox, and `/host` has to be in Auth → URL Configuration → Redirect URLs (or
covered by a wildcard), or the link lands on the home page instead.
