---
brief: reactivate-phone-sms
title: Re-activate phone capture and connect Twilio SMS
status: shipped
track: ops
date: 2026-08-18
shipped_in: ["#86", "#90", "#96", "#98", "#104", "#105", "#118", "070efee", "dd1dc71", "b3dfb97", "62c6559", "4354dbc", "ba2d03c", "1f63153"]
verified: true
verified_on: 2026-08-20
---

# Brief (for Claude Code + Tom): Re-activate phone capture and connect Twilio SMS

**Status:** ✅ Shipped and **verified in production on August 20, 2026**, when a
ticket confirmation arrived by text. Seven PRs, not one: #86 (re-enable phone,
send on both channels), #90 (consent as an explicit checkbox), #96 (a static
opt-in page a crawler can read), #98 (name optional, phone sufficient), #104 and
#105 (opt-in wording and a screenshot of the live form), #118 (go-live record).

The code was merged on August 18. Everything between that and August 20 was
Twilio configuration and two rejected campaign submissions — see **Results**,
including the three things this brief got wrong.
**Date:** August 18, 2026 · shipped August 18 · verified August 20
**Requested by:** Tom — the Twilio business account (A2P 10DLC) is approved, so re-enable the phone fields disabled by `BRIEF-disable-phone-until-sms.md` and wire delivery to Twilio.

> **This premise was wrong, and it cost most of the fortnight.** What was
> approved was the **brand**. A2P 10DLC is two registrations — brand *and*
> campaign — and no campaign existed. Until one does, US carriers reject every
> long-code send with error 30034 no matter how the credentials are set. See
> **Results**.

## What already exists (verified in the repo — don't rebuild it)
- **SMS delivery is code-complete.** `_shared/deliver.ts` has `sendViaTwilio()`; `_shared/notify.ts` has `toE164()` (phone → E.164) and `buildSmsBody()`; there are passing tests (`tickets_test.ts`, `twilio_auth_test.ts`). It reads standard Twilio env vars, **prefers a scoped API key** over the master auth token, and supports a **Messaging Service SID** or a single from-number.
- **It fails safe when unconfigured.** With no `TWILIO_ACCOUNT_SID` (or no number/messaging service), the SMS attempt returns a clean error rather than crashing — which is why phone-only buyers currently get nothing, the reason phone was hidden.
- **Delivery is email-OR-SMS today** (`deliver.ts` `deliverConfirmation`): if the order has an **email**, it sends the email ticket; **SMS is the fallback for phone-only** buyers. It does not currently send both. (See Decision 1.) — **No longer true:** Decision 1(B) was taken, and it now sends on every channel the buyer gave.

## Note on repo state
> **Also wrong.** The disable *was* merged to `origin/main` as PR #84, cleanly,
> behind `COLLECT_PHONE` in `src/lib/flags.ts` — not `src/lib/site.ts`. The
> reversal was the one-line flip the disable brief promised. The checkout this
> was written from was 96 commits behind.

`origin/main` (the clone) still shows the phone field present and the "email or phone" rule — the disable change from `BRIEF-disable-phone-until-sms.md` was applied to the **live/prod** worktree, not merged to `main` (same pattern as the recent Square edge-function work). So **first locate how phone was actually disabled in the running app** (the flag/conditional that brief added — e.g. `COLLECT_PHONE` in `src/lib/site.ts`) and reverse *that*, rather than assuming the clone reflects production.

## Part A — Re-enable phone capture (Claude Code)
Reverse the disable brief precisely (it was built to flip back cleanly):
1. **Flip the flag on.** If the disable used `COLLECT_PHONE = false` in `src/lib/site.ts`, set it `true`. Whatever the actual gate, enable it.
2. **Ticket checkout** (`src/components/GuestCheckoutForm.tsx`): phone field visible again; validation returns to **email-or-phone** (`if (!email.trim() && !phone.trim()) → 'Email or phone is required'`); helper copy back to "Provide email or phone so we can send your tickets and QR codes"; payload sends the real `phone`.
3. **Film-pass checkout** (`src/pages/FilmPasses.tsx`): phone field visible again (email stays required here as before); payload sends `phone`.
4. **Box-office POS** (`src/pages/admin/StaffPOS.tsx`): if its phone field was hidden by that brief's optional decision, restore it for consistency (SMS is now on everywhere).
5. **Add a short SMS consent line** at each phone field — e.g. "We'll text your ticket/booking updates to this number. Msg & data rates may apply. Reply STOP to opt out." (A2P best practice; the Messaging Service handles STOP automatically — see Part B.)
6. Confirm `toE164()` runs on captured numbers before they reach Twilio (it already does in the send path; just don't pre-mangle the input).

## Part B — Connect Twilio (Tom's manual steps; the code reads these exact env vars)
The edge functions read these secrets (`deliver.ts:50–57`). Set them in Supabase and delivery goes live — no code change for the wiring itself.

**1. Get credentials in the Twilio Console**
- **Account SID** — Console home → *Account Info* → copy **Account SID** (starts `AC…`).
- **API Key (preferred over the auth token — scoped & revocable):** *Account → API keys & tokens → Create API key* → **Standard** → copy the **SID** (`SK…`) and the **Secret** (shown once). *(If you skip this, the master Auth Token works as a fallback, but the API key is safer.)*
- **Messaging Service SID (recommended, since your A2P 10DLC campaign attaches to one):** *Messaging → Services* → open your approved service → copy the **Service SID** (`MG…`). Make sure your sending number(s) are in that service's sender pool and the number has SMS enabled. *(Alternatively, a single* **From number** *in E.164, e.g. `+12088929752`, but the Messaging Service is the right choice for an approved campaign — it handles STOP/HELP and number pooling.)*

**2. Set the secrets in Supabase** (Dashboard → Project → *Edge Functions → Secrets*, or CLI). Set:
```
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...           # the "shown once" secret
TWILIO_MESSAGING_SERVICE_SID=MG...  # preferred; OR set TWILIO_FROM_NUMBER=+1208...
```
CLI form:
```
supabase secrets set TWILIO_ACCOUNT_SID=AC... TWILIO_API_KEY_SID=SK... \
  TWILIO_API_KEY_SECRET=... TWILIO_MESSAGING_SERVICE_SID=MG... \
  --project-ref <your-project-ref>
```
*(If you use the auth-token fallback instead of an API key, set `TWILIO_AUTH_TOKEN=...` and omit the two API-key vars.)*

**3. Make sure the functions pick them up** — redeploy the ticket/pass delivery functions (or the shared bundle) after setting secrets so the new env is live, then confirm in the Supabase logs that the SMS branch no longer reports "TWILIO_ACCOUNT_SID is not configured."

**4. Verify end-to-end (before real customers):** do a **phone-only** test purchase to *your own* mobile — the SMS with the ticket link should arrive; check the **Twilio Console → Monitor → Messaging logs** for a `delivered` status. Confirm a messy input like `(208) 892-9752` is normalized to `+12088929752` (that's `toE164`).

## Decision 1 — how far "SMS notifications" should go — **TAKEN: B**
- **A. Restore-only (minimal):** re-enable phone; delivery stays **email-or-SMS** (phone-only buyers get SMS). No `deliver.ts` change. Recommended to ship first — it's the exact reversal and lowest risk/cost.
- **B. SMS *alongside* email:** if you want everyone who gives a phone to also get a text notification (not just phone-only buyers), `deliverConfirmation` needs to send **both** channels when both contacts exist. This is a small, deliberate change (and more Twilio spend). Say the word and it's a follow-up.

**B, in `f1d9731` (PR #86).** Both channels are attempted independently and
neither suppresses the other. One getting through is a delivery: it stamps
`confirmation_sent_at` — the guard against texting someone twice — and the
channel that failed goes to `confirmation_error` *beside* it, not instead of it.
`status: 'failed'` now means nothing reached the buyer at all.

It needed a migration nobody predicted. The new `'email+sms'` value violated the
CHECK on `tickets.confirmation_channel`, and that write only logs on failure —
so without `20260818214726_confirmation_channel_email_and_sms.sql` the stamp
would never land and the double-send guard would have come apart silently.
Verified in a throwaway postgres: `'email+sms'` accepted, `'sms+email'` and
`'both'` still refused.

Cost: one Twilio message per order carrying a phone number, not just phone-only
ones.

## Other decisions — **TAKEN**
2. **Sender:** Messaging Service SID (recommended) vs single From number.
   → **Messaging Service.** It is what the approved campaign attaches to, and
   its Advanced Opt-Out is what answers STOP and HELP. Nothing in this repo
   answers an inbound text — there is no webhook here — so a bare from-number
   would have made that handling ours to build, while the consent copy already
   promised it worked.
3. **Consent copy:** confirm the exact opt-in wording at the phone field (Part A step 5).
   → **Not a line of copy in the end, but a checkbox** (`dd1dc71`, PR #90). The
   wording this brief proposed was missing two of the four disclosures A2P
   review requires, and a bare line next to a field is not an opt-in at all. See
   **Results**.

## Guardrails / compliance
- **Never bulk-test against real customer numbers** — only your own during verification. SMS costs money and texts real people.
- **A2P/opt-out:** a Twilio **Messaging Service** auto-handles STOP/UNSUBSCRIBE and HELP; if you use a bare From number instead, opt-out handling is your responsibility.
- Secrets are **secrets** — set only in Supabase's secret store, never committed. The API-key route means a leak is revocable without rotating the whole account.
- Delivery already **guards against double-send** (`confirmation_sent_at`), so a retry won't text someone twice — preserve that.

## Test plan
- Ticket form shows the phone field again; a valid **email-only** purchase still emails the ticket; a **phone-only** purchase now delivers an **SMS** with the ticket link (Twilio log = delivered); an **email+phone** purchase behaves per Decision 1.
- Film-pass form shows phone again; email still required; confirmation delivered.
- `toE164` normalizes assorted input formats; an unreachable/invalid number fails gracefully and is logged, without breaking the purchase (payment already captured).
- With secrets unset in a staging project, SMS still no-ops cleanly (no crash) — confirms the gate.
- `npm run build` and the `notify`/`twilio` tests pass.

---

## Results

Shipped August 18, verified August 20. The send path never changed:
`sendViaTwilio` was complete on 2026-08-12 and gated entirely on its
environment. Everything below is what stood between "the code is finished" and
"a text arrived".

### What this brief got wrong

1. **Brand approval is not campaign approval.** The brief opens by saying the
   A2P 10DLC account "is approved". The *brand* was. A2P 10DLC is two
   registrations, and no campaign existed — so carriers rejected every send
   with error 30034 regardless of credentials. This was the single largest
   cost, and it was stated as settled fact in the first paragraph.
2. **The disable was already on `main`.** PR #84, behind `COLLECT_PHONE` in
   `src/lib/flags.ts` — not the unmerged prod-worktree change in
   `src/lib/site.ts` the brief describes. The reversal was the clean flip the
   disable brief promised.
3. **The proposed consent line was not a compliant opt-in.** It carried message
   type, rates and STOP; A2P review requires four disclosures and rejects a
   submission missing any. Frequency and HELP were absent, and a line of copy
   beside a field is not consent — review wants a separate box, unchecked, that
   the purchase does not depend on.

### What actually took the time

- **Secrets set twice under names the code does not read.** `TWILIO_API_KEY`
  (`deliver.ts` reads `TWILIO_API_KEY_SID`), then `TWILIO_MESSAGING_SERVICE` on
  staging (reads `..._SID`). Both appeared in `secrets list` looking correct,
  so `twilioAuth()` reported no credential and `sendViaTwilio()` no sender. **A
  digest proves a value is set, never that it is set under the right key.**
- **The opt-in was invisible to the vetting crawler.** A plain fetch of any
  page returns a ~4KB SPA shell with zero `<input>` elements, and checkout's
  contact step only renders after a ticket is added. The checker reported no
  checkbox and no disclosures — correctly — twice, while the live form had
  both. `public/sms.html` exists for this: plain HTML, no scripts, the consent
  language quoted verbatim and a screenshot of the live form embedded. It is
  linked from the footer and listed in `sitemap.xml`, because vetting also asks
  whether the opt-in is publicly findable.
- **The submission described a flow we do not have.** The campaign's opt-in
  *keywords* field was filled with START/YES/UNSTOP — resubscribe keywords that
  Advanced Opt-Out answers — which reads as a text-in opt-in. The reviewer
  asked for proof of a keyword flow that does not exist. Opt-in type is web
  form; that field belongs empty.

### Beyond the brief

- **Consent is a field, not an inference.** `sms_consent` travels with the
  order rather than being read off a non-empty phone box. An explicit `false`
  skips the SMS outright — *including* a number `deliverConfirmation` would
  otherwise recover from auth or `profiles`, which is the leak a form-only
  check would have left: a returning buyer whose number we already hold has not
  consented by having bought before.
- **One flag became two.** `COLLECT_PHONE` (is the field on the form) and
  `SMS_DELIVERY_LIVE` (is a phone number deliverable) stopped having the same
  answer, because the campaign submission needed the opt-in live before the
  texts could be.
- **Name is no longer required** (`62c6559`, PR #98). It was enforced on the
  form *and* in `ticket-checkout`, so changing one produced a server 400.
- **The box office was not on the delivery pipeline at all** when this started —
  it demanded a patron email and dispatched nothing. `deliverPos` has since
  been built by other work, and sends `sms_consent: false`.

### Test plan outcome

Ticket form shows the phone field; email-only, phone-only and email+phone all
deliver per Decision 1(B); `toE164` is unit-tested across the formats customers
type; an unsendable number fails as a 400 without reaching Twilio; unconfigured
secrets no-op cleanly. `deliverConfirmation` had **no test at all** before this
and now has eleven, all about what gets recorded — delivery is fire-and-forget,
so those columns are the only evidence there is.

### Open, and deliberately not closed here

- **The 18–20 August window.** `SMS_DELIVERY_LIVE` was flipped two days before
  approval, as a decision taken with the trade stated: a phone-only buyer who
  ticked the box in that window was charged and delivered nothing. Query in
  `TICKET-DELIVERY.md`.
- **No admin view of delivery failures.** `confirmation_error` is the only
  record of a failed send and nothing surfaces it, so "watch
  `confirmation_error`" is advice that currently requires SQL.
- **Consent is per-request, not stored.** An operator resend carries no consent
  field and can still text a number on file. Closing it means an `sms_consent`
  column on `tickets`, read back through `loadOrder`.
- **A stale `TWILIO_API_KEY`** remains on production. Unread, but it makes the
  misnaming look live.
