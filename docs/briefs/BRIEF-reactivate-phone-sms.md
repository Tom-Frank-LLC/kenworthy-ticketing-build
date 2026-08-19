# Brief (for Claude Code + Tom): Re-activate phone capture and connect Twilio SMS

**Status:** ✅ Shipped — `070efee` (PR #86); consent made an explicit checkbox in `dd1dc71` (PR #90).
**Date:** August 18, 2026
**Requested by:** Tom — the Twilio business account (A2P 10DLC) is approved, so re-enable the phone fields disabled by `BRIEF-disable-phone-until-sms.md` and wire delivery to Twilio.

## What already exists (verified in the repo — don't rebuild it)
- **SMS delivery is code-complete.** `_shared/deliver.ts` has `sendViaTwilio()`; `_shared/notify.ts` has `toE164()` (phone → E.164) and `buildSmsBody()`; there are passing tests (`tickets_test.ts`, `twilio_auth_test.ts`). It reads standard Twilio env vars, **prefers a scoped API key** over the master auth token, and supports a **Messaging Service SID** or a single from-number.
- **It fails safe when unconfigured.** With no `TWILIO_ACCOUNT_SID` (or no number/messaging service), the SMS attempt returns a clean error rather than crashing — which is why phone-only buyers currently get nothing, the reason phone was hidden.
- **Delivery is email-OR-SMS today** (`deliver.ts` `deliverConfirmation`): if the order has an **email**, it sends the email ticket; **SMS is the fallback for phone-only** buyers. It does not currently send both. (See Decision 1.)

## Note on repo state
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

## Decision 1 — how far "SMS notifications" should go
- **A. Restore-only (minimal):** re-enable phone; delivery stays **email-or-SMS** (phone-only buyers get SMS). No `deliver.ts` change. Recommended to ship first — it's the exact reversal and lowest risk/cost.
- **B. SMS *alongside* email:** if you want everyone who gives a phone to also get a text notification (not just phone-only buyers), `deliverConfirmation` needs to send **both** channels when both contacts exist. This is a small, deliberate change (and more Twilio spend). Say the word and it's a follow-up.

## Other decisions
2. **Sender:** Messaging Service SID (recommended) vs single From number.
3. **Consent copy:** confirm the exact opt-in wording at the phone field (Part A step 5).

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
