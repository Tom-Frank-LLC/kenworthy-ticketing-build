---
brief: pos-ticket-delivery
title: Send a ticket confirmation for box-office (StaffPOS) sales
status: shipped
track: feature
date: 2026-08-18
shipped_in: ["#91", "bb9a506"]
verified: true
---

# Brief (for Claude Code): Send a ticket confirmation for box-office (StaffPOS) sales

**Status:** ✅ Shipped — `bb9a506` (PR #91), "the box office sends the patron their tickets".
**Date:** August 18, 2026
**Found by:** Claude Code — StaffPOS collects a patron email "for delivery," inserts ticket rows, and stops. Nothing in `src/` or any trigger calls `send-ticket-confirmation`. The counter copy was made honest about it; this brief wires it up.

## Diagnosis (verified in repo)
- **Online works:** `ticket-checkout` calls `deliverConfirmation(admin, orderToken, …)` in-process (`index.ts:457`) → `_shared/deliver.ts` → email (Resend) / SMS (Twilio).
- **The HTTP entry point exists:** `send-ticket-confirmation` is a thin auth wrapper around the same `deliverConfirmation`. Two callers today: **service role** (operator; may redirect via `email`/`phone` overrides) and a **signed-in user for their own order** (overrides ignored).
- **POS never calls it.** `StaffPOS.createTickets` (`:276`) generates an `orderToken`, inserts ticket rows with **`userId: <staff member's id>`**, returns `{ ticketIds, orderToken }` — and no path dispatches a confirmation. The patron is charged (cash/card/free) and gets nothing.

## The catch that dictates the design
POS ticket rows are owned by the **staff** user, and the patron's email/phone are typed at the counter — they are **not** on any profile the delivery would fall back to. So delivery must go to those typed values as **overrides**, which `send-ticket-confirmation` currently honours for **service role only**. A staff member calling it as a signed-in user would pass the own-order check (rows are theirs) but the override would be **ignored**, sending the ticket to the *staff member*, not the patron. So two changes are needed.

## Change 1 — authorize the box office to deliver with overrides (`send-ticket-confirmation`)
Add a third trusted caller: a **signed-in admin** (`has_role(callerId, 'admin')` — the same role that gates StaffPOS). Treat them like the operator/service-role case: allowed to deliver **any** order and to use the `email`/`phone`/`name` **overrides**.
- Keep the existing paths unchanged: service role (full), and signed-in **non-admin** user (own order only, overrides ignored).
- Concretely: compute `isOperator = isServiceRole || (callerId && await has_role(callerId,'admin'))`; gate the order-ownership bypass and the override read on `isOperator` instead of `isServiceRole`.
- This reuses the existing `has_role` RPC; no new surface, and the endpoint stays closed to anon/regular users.

## Change 2 — dispatch after every POS sale (`src/pages/admin/StaffPOS.tsx`)
Add one helper and call it after each successful sale path (cash `handleCashSale`, card/terminal, and the free/$0 path) — after `createTickets` resolves and payment is confirmed:
```ts
const deliverPos = async (orderToken: string) => {
  try {
    await invokeFunction('send-ticket-confirmation', {
      order_token: orderToken,
      email: patronEmail.trim() || undefined,
      phone: patronPhone.trim() || undefined,
    });
  } catch (err) {
    // Money is already taken — a failed send is a resend note, not a rollback.
    toast.error('Sale complete, but the ticket confirmation did not send — resend from the order, or take the patron’s email again.', { duration: 12000 });
  }
};
```
Mirror the **`recordDonation` pattern** exactly: fire after the sale, never roll the sale back on a delivery failure, surface the failure to staff. Call `deliverPos(orderToken)` in the same place(s) `recordDonation(...)` is already called so all three tender paths are covered.

## Behaviour that already falls out correctly (confirm, don't rebuild)
- **No account/password link for walk-ins.** `deliver.ts` skips the set-password link when delivery is **redirected** (an override is present) — so a POS confirmation is a plain ticket receipt, which is right for a walk-in. Verify this holds.
- **Idempotent / no double-send.** `deliverConfirmation` guards on `confirmation_sent_at`, so a retry or a manual resend won't text/email twice. Preserve it.
- **Channel:** email delivers now; **phone-only** POS sales deliver once Twilio is live (`BRIEF-reactivate-phone-sms.md`). Until then, email is the reliable counter channel — the POS already requires email *or* phone; consider nudging staff toward email until SMS is confirmed live (Decision 2).

## Decisions for Tom
1. **Ticket ownership (optional, not required for delivery):** POS tickets are owned by the staff user, so the patron has no account link to them. Online guest checkout attaches a patron (guest) user instead. Leave as-is (delivery-only fix), or also attach/relocate the ticket to a patron identity for parity and future "my tickets" access? Recommend leave-as-is now; note as follow-up.
2. **Interim channel:** until SMS is verified live, prefer email at the counter (a hint/validation), or accept phone-only knowing it won't deliver yet?
3. **Resend affordance:** add a "Resend confirmation" button on the POS/recent-sales view (uses the same endpoint, admin-authorized by Change 1) so staff can recover a mistyped address — include now or as a fast follow?

## Test plan (acceptance = the patron actually receives it)
- A **cash** POS ticket sale to a test email → confirmation email arrives with the QR ticket; `tickets.confirmation_sent_at` is set.
- A **card/terminal** sale and a **free/$0** sale each dispatch the same confirmation.
- The confirmation goes to the **patron's** typed email, **not** the signed-in staff member's address (proves the override path).
- The email carries **no set-password link** (redirected delivery).
- Re-running the dispatch for the same order does **not** send twice.
- `send-ticket-confirmation` still rejects anon and non-admin non-owner callers (authorization unchanged for them); an admin can deliver any order with overrides.
- Phone-only sale: once Twilio is live, an SMS with the ticket link arrives; before then it fails gracefully with the staff toast, sale intact.
- `npm run build` + relevant tests pass.

---

# Outcome — August 18, 2026

**Built and pushed:** PR #91, branch `feat/pos-ticket-confirmation` (off `origin/main` @ 070efee).
**Status:** 🟡 Merged-ready, **unverified against a live function.** See "Not done" below.

## What the brief got wrong, and what was built instead

**The operator gate is `'staff'`, not `'admin'`.** The brief called admin "the same
role that gates StaffPOS." It is not: `StaffPOS.tsx:119` gates on `isStaff`, and
`src/lib/auth.tsx:38` defines that as `staff | admin | superadmin`. The
`20260812063211_has_role_hierarchy` migration makes `has_role(uid,'staff')` agree
exactly. `square-refund` — a strictly more dangerous operation — already gates on
`'staff'`.

Shipping the admin gate would have been **worse than a refusal**. A staff-role
counter worker calling the endpoint:

1. passes the own-order check, because POS rows are owned by them;
2. has the override dropped, because they are not an operator;
3. so `deliver.ts` falls back to the order's auth user — the staff member —
   and emails the patron's ticket to the box office;
4. and stamps `confirmation_sent_at`, so the correct resend is then refused
   as `already_sent`.

Misdelivered and unrepairable in one step, with a 200 on the wire. Tom chose
`'staff'`.

**A `has_role` lookup that errors returns 503**, rather than falling through to
`isStaff = false`. Falling through is precisely the misdelivery above, arrived at
by a transient DB error instead of a config mistake.

**`origin/main` was ahead of the brief.** PR #86 (`Re-enable phone capture…`)
landed dual-channel delivery: `deliver.ts` now attempts email *and* SMS rather
than email-then-fallback, and returns `partial_error` when one of the two fails.
The brief was written against the single-channel version. Consequence: every POS
sale with a phone number now returns `delivered: true` *plus* a partial error
until the A2P 10DLC campaign clears, so the POS surfaces that as a warning
toast rather than treating it as a failure.

## The three decisions

1. **Ticket ownership:** left as-is. POS tickets stay owned by the staff member;
   delivery-only fix. Attaching a patron identity for "my tickets" parity remains
   a follow-up, and is moot while `MEMBER_ACCOUNTS_ENABLED` is off.
2. **Interim channel:** phone-only sales are **accepted**, not blocked. Validation
   stays "email or phone" (matching the server rule). The form now carries a
   `!SMS_DELIVERY_LIVE` hint — "Texts are not sending yet — take an email if you
   can" — and a failed text surfaces the reason. Blocking at a busy window was
   judged worse than telling staff the truth.
3. **Resend:** included now. A mistyped address is otherwise unrecoverable from
   the counter, *and* the first send's `confirmation_sent_at` actively refuses the
   repair. The button passes `force`.

## Confirmed, not rebuilt

- **No set-password link on a POS confirmation.** The mechanism is not "redirected
  delivery" as the brief assumed — `deliver.ts` computes
  `isAccountHolder = authUser.email === override email`, which is never true for a
  walk-up, so the recovery link is skipped. Same outcome, different reason.
  (`memberAccountsEnabled()` is false anyway, which skips it a second time.)
- **Idempotency preserved.** `confirmation_sent_at` still guards retries;
  only the resend button sets `force`.

## Verified locally

`npm run build:staging` · `tsc -p tsconfig.app.json --noEmit` · vitest 201 passed ·
`deno check` on both touched functions · `deno test --allow-env --no-check`
175 passed, including 7 new in `_shared/confirmation_auth_test.ts`.

The authorization rule was extracted to `supabase/functions/_shared/confirmation_auth.ts`
so those 7 tests guard live code — `npm run build` and vitest cover only `src/`,
and this is the decision that misroutes a patron's ticket if it regresses.

## Verified on staging — August 18, 2026

Function deployed to `rpqzrpboyhshdrfdwayk` (version 31). Tested against a **real
POS order rung through the live staging POS**, signed in as `tickets@kenworthy.org`
(roles: `admin`, `regular_user`).

The gap reproduced first: the sale inserted `73c01a4f…` owned by the *staff
member*, with `confirmation_sent_at: null`. Exactly the brief's diagnosis, live.

| Check | Result |
|---|---|
| Function boots (unauth POST) | `401 UNAUTHORIZED_NO_AUTH_HEADER` — wired, not BOOT_ERROR |
| Anon key + order token + override | `401 {"error":"Not authorised"}` |
| Staff caller, POS order, patron override | `200 {"delivered":true,"channel":"email"}` |
| `tickets.confirmation_sent_at` | set, `channel: email`, `confirmation_error: null` |
| **Recipient** | `admin_audit_log` → `email.sent`, `to: "m***@gmail.com"` |
| Re-dispatch, no `force` | `200 {"delivered":false,"reason":"already_sent"}` — no second send |
| Resend with `force` | `200 {"delivered":true}`, `confirmation_sent_at` advanced |
| Unknown order token | `404 {"error":"Order not found"}` |

**The recipient row is the whole test.** The signed-in staff member is
`tickets@kenworthy.org`; the audit mask preserves first character and domain, so
a dropped override would have read `t***@kenworthy.org`. It read
`m***@gmail.com` — the counter-typed patron address. The override path works,
and the pre-change behaviour would have been visibly different.

**The gate decision is substantiated by data, not only by reading.** Staging
holds **1 staff-only account** (has `staff`, has neither `admin` nor
`superadmin`) alongside 6 admin/superadmin accounts. That account is a real
box-office worker for whom the brief's `'admin'` gate would have silently
mailed patrons' tickets to the counter and then refused the repair.

## Still not verified

- **The frontend is not on staging.** PR #91 is unmerged, so `deliverPos` and the
  Resend button have not run in a browser — only the endpoint they call has. The
  three tender paths are one-line calls to a now-proven endpoint, but they are
  untested as wired.
- **A signed-in non-staff user's override being dropped** is covered by
  `confirmation_auth_test.ts` and by the anon refusal above, but not by a live
  non-staff session — there was no such account to sign in as.
- ~~**The absent set-password link**~~ — **confirmed by Tom, 18 Aug**: both
  delivered emails (the original and the `force` resend) carry the scannable QR
  and **no login/set-password link**. Which is what the code predicts:
  `isAccountHolder` compares the override address to the order's auth user
  (`tickets@kenworthy.org` ≠ `mrtomfrank+kwpos@gmail.com` → false), and
  `memberAccountsEnabled()` is off besides. A walk-up gets a plain ticket
  receipt, as intended.

Two test emails were sent to `mrtomfrank+kwpos@gmail.com` (same order, the second
via `force`). One $0 test ticket remains on the Aug 19 Peter Rabbit matinee in
staging.

## Original blocker — resolved

## Not done — needs a hand

`supabase functions deploy send-ticket-confirmation --project-ref rpqzrpboyhshdrfdwayk`
was **refused by the sandbox classifier**. Nothing in this change has been
exercised against a live function, so the brief's acceptance tests are all
unrun:

- [ ] Cash POS sale to a test address → email arrives with the QR, `confirmation_sent_at` set
- [ ] Card/terminal sale and a $0 sale each dispatch (note: there is no separate
      "free" tender — `PaymentMethod` is `'cash' | 'card'`, so a $0 sale is the cash path)
- [ ] The email reaches the **patron's** typed address, not the signed-in staff member's
      — this is the whole point of Change 1 and the only test that proves it
- [ ] No set-password link in the delivered email
- [ ] Re-dispatching the same order does not send twice
- [ ] Anon and non-owner non-staff callers still refused
- [ ] Resend with a corrected address delivers to the corrected one

Run the deploy, then work the list. Until then this is code that type-checks,
not a confirmation anyone has received.

---

# Shipped to production — August 18, 2026, ~23:40 UTC

Merged as `bb9a506` (PR #91). Deployed in the order the hazard below requires.

## The ordering hazard (why the function had to go first)

At merge time, production's `send-ticket-confirmation` was **v35, deployed
22:39:53Z from the `twilio-sms` worktree** — the *old* authorization, overrides
for `service_role` only. Shipping the frontend against it would have made every
counter sale do this:

1. POS calls with a staff JWT and the patron's typed address.
2. Old function: not service role → own-order check → POS rows **are** owned by
   the staff member → passes.
3. Override dropped → `deliver.ts` falls back to the order's auth user →
   **the patron's ticket is emailed to the box office**.
4. `confirmation_sent_at` stamped → the correct resend refused as `already_sent`.

Exactly the failure this change exists to prevent, on every sale. The reverse
order is safe: with the new function up, the old frontend never calls it, and
online checkout is unaffected (a patron is not staff, so nothing changes).

## What actually happened

- **Function:** `supabase functions deploy send-ticket-confirmation
  --project-ref vlmslygnimfbamrtwvyo` returned **"No change found"**. That is a
  true negative, not a failed deploy: another session had pulled `main` after
  the merge and deployed this function to prod at **23:59:03Z (v37)** from the
  `twilio-sms` worktree. Confirmed by reading that tree — it contains the
  `confirmation_auth` / `sms_consent` / `isOperator` code — and by Supabase
  computing my bundle as identical to the deployed one.
  Live probes: unauthenticated → `401 UNAUTHORIZED_NO_AUTH_HEADER`; anon key
  with an override → `401 {"error":"Not authorised"}`.
- **Frontend:** built from `b3dfb97`, all runbook gates green (prod URL baked
  in, no `lovable`, no staging URL, no `lbgk`, prod `SITE_URL`).
  `npx wrangler deploy` → version **`7e1e6aa9-3959-4ef0-8fc7-0de072e9dff8`**.
  Previous version, for rollback: **`71281430-6b0e-4dd5-a7d1-c9220b251f6a`**.

## Verified against the live site, not the deploy output

`index-j81Ut2VO.js` is served and is byte-identical to the local build — but the
feature is **not** in it, because StaffPOS is lazily loaded into its own chunk.
Grepping the entry bundle alone would have read as a failed deploy. The real
check is `StaffPOS-e1Oqngv2.js`, fetched from the live origin: byte-identical to
the build and carrying `sms_consent`, `Tickets sent to`, `Resend Confirmation`,
`where the ticket is sent`, `cannot text yet`.

## Not done in production, deliberately

No test sale was rung against production — that would create a real ticket row
and send a real email from the live system. The first real counter sale is the
last confirmation. Watch for: the "Tickets sent to …" toast, and
`tickets.confirmation_sent_at` non-null with `confirmation_channel = 'email'`.

**Coordination note:** another session deployed a prod edge function at 23:59:03Z
while this work was in flight. Prod is being written by more than one session
today; re-read live state immediately before any further deploy.
