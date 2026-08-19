# Brief (for Claude Code): Fix the footer newsletter signup + switch ticket-checkout marketing to opt-OUT

**Status:** ✅ Shipped — confirmed by Tom, August 19 2026; the Mailchimp subscribe/webhook functions carry it.
**Date:** August 14, 2026
**Requested by:** Tom — (1) the footer "Subscribe" field currently errors; fix it. (2) On ticket purchase, change marketing consent from **opt-in** to **opt-out**: buyers are subscribed automatically unless they uncheck a box.

> **Approach note (do this, don't skip):** Part A is a *"mechanically correct, output wrong"* bug — the code runs but the subscribe fails. **Instrument first, then fix.** Reproduce the footer error, capture the **HTTP status + the edge-function log line**, and fix the actual cause below. Don't guess at a cause and patch a symptom.

---

## Part A — Fix the footer newsletter signup

### How it's wired (verified, file:line)
- Footer form `src/components/NewsletterSignup.tsx` → `subscribeToMailchimp({ email, tags:['newsletter'], source:'footer-form' })` (`src/lib/mailchimp.ts:27`) → **`supabase.functions.invoke('mailchimp-subscribe')`**.
- `subscribeToMailchimp` is fire-and-forget and **returns `false` on any error**, so the UI just shows the generic toast "We couldn't add you just now" (`NewsletterSignup.tsx:26`). The real reason is swallowed — it's in the function response/logs, not the UI.
- The function `supabase/functions/mailchimp-subscribe/index.ts` is written to support **anonymous** callers (a logged-out footer visitor): it forces `status:'pending'` (double opt-in) for anon and returns `{ ok:true }` on success (L86–97, L120–137).

### Diagnose (reproduce + read the log), then fix the matching cause
Submit the footer form on **staging** and capture the status + logs (`supabase functions logs mailchimp-subscribe`). Map to the cause:

1. **500 `"Mailchimp is not configured"`** (L41–46) → one or more secrets are unset on that project: **`MAILCHIMP_API_KEY`**, **`MAILCHIMP_SERVER_PREFIX`** (e.g. `us21` — the suffix after the dash in the API key), **`MAILCHIMP_AUDIENCE_ID`**. Set all three on **staging *and* prod** (`supabase secrets set …`), same as the LGL key was connected. *(This is the most likely cause given the platform's other integration keys were configured piecemeal.)*
2. **404 / "function not found"** → `mailchimp-subscribe` isn't deployed to that project → `supabase functions deploy mailchimp-subscribe` (both envs).
3. **502 `"Mailchimp upsert failed"` / `"tagging failed"`** with a detail body (L138–143) → read `detail`: a wrong **audience id** or **server prefix**, a member in a **compliance/cleaned** state, or the audience not permitting the pending/double-opt-in add. Fix per the Mailchimp error (correct the id/prefix secret, or adjust status handling).
4. **401 at the gateway** (function never runs; no log line) → then `mailchimp-subscribe` is rejecting the anon call. It is **not** in the `verify_jwt = false` list in `supabase/config.toml` (only `mailchimp-webhook`, `ticket-access`, `send-auth-email` are). *Note:* the anon/publishable key is itself a valid JWT, so `verify_jwt = true` usually still passes for logged-out callers — **confirm via the status before assuming this**. If (and only if) you observe a 401, add:
   ```toml
   [functions.mailchimp-subscribe]
   verify_jwt = false
   ```
   and redeploy. (Same for `mailchimp-ecommerce` if it's hit anonymously.)

### Also verify (don't over-fix)
- After the fix, a footer submit returns 200 and the address appears in the Mailchimp audience. Because anon submits are forced to **`pending`** (double opt-in — a deliberate anti-abuse choice, L62–65), the contact gets a **Mailchimp confirmation email** and only becomes `subscribed` after clicking. Confirm that's acceptable for the footer (recommended: keep double opt-in for the public form). If Tom wants footer signups to be single opt-in, that's a **Decision** (below), not a bug.
- Improve the UI signal a touch: on the `pending` path, the toast could say "Check your email to confirm" rather than only "You're on the list," so a user who must confirm isn't misled. (Optional, small.)

---

## Part B — Ticket checkout: opt-IN → opt-OUT (auto-subscribe unless they decline)

### Current state (verified — it's more broken than a flipped default)
- The checkout marketing sync in `src/pages/Showing.tsx` (~L347–357) runs **only `if (user)`** — but per `BRIEF-disable-member-login.md`, patrons are never signed in, so **this path is dead for real buyers** (exactly audit item #3 in that brief).
- It calls `syncMailchimpProfile` (`src/lib/mailchimp.ts:83`), which **also** requires `profiles.marketing_opt_in === true` (L100) and a signed-in `user.email` (L92). So it's gated twice on things that no longer happen at checkout.
- **`GuestCheckoutForm.tsx` has no opt-in/opt-out control at all** (fields are just name/email/phone, L88–119). `marketing_opt_in` is set today only by the old signup (`Auth.tsx:75`) and Profile (`Profile.tsx:32`). Net: **checkout subscribes essentially nobody right now.**

So this isn't "flip a checkbox default" — it's "add the control and wire the guest path that doesn't exist yet."

### What to build
1. **Add an opt-OUT checkbox to `GuestCheckoutForm.tsx`**, **checked by default**, near the contact fields. Copy e.g. *"Email me about upcoming films and events at the Kenworthy."* with the box pre-checked; leaving it checked = subscribed, unchecking = opt out. Track it in form state (`marketingOptIn`, default `true`) and include it in the payload the form submits.
2. **Carry the flag into the server checkout.** `ticket-checkout` reads the buyer via `readContact(body)` (`index.ts:133`); add a `marketing_opt_in` boolean to the body and read it there. Persist consent on the buyer's profile (extend `_shared/buyers.ts` `findOrCreateBuyer`, which already creates/updates the profile, to set `marketing_opt_in`). This gives an auditable consent record and works for anon buyers.
3. **Do the subscribe server-side** (recommended — the disable-member-login audit #3 says move buyer tagging to the server; the client `if (user)` path is dead). When `marketing_opt_in` is true, have the checkout function subscribe the buyer to Mailchimp with tags `['ticket-buyer','newsletter']` and the film-type interest (the existing `syncMailchimpProfile` used `Films`/`Live Performances`/`Special Events`). Two ways to reach Mailchimp:
   - **(Recommended, single opt-in / true "auto opt-in"):** call the Mailchimp API from the server with **`status:'subscribed'`**. Because `mailchimp-subscribe` forces anonymous callers to `pending`, either (a) give `mailchimp-subscribe` a **trusted internal path** — a shared-secret header that lets a server caller pass `status:'subscribed'` — and call it from `ticket-checkout`, or (b) call the Mailchimp members endpoint directly from the checkout function (it already has server env access). Prefer (a) so all Mailchimp logic stays in one function.
   - **(Alternative, double opt-in):** reuse the existing anon `mailchimp-subscribe` path, which sets `pending` and sends a confirmation email. Simpler, but "auto opt-in" becomes "auto opt-in *pending confirmation*" — the buyer still must click. Flag to Tom (Decision 1).
4. **Retire the dead client gate.** Remove or bypass the `if (user)` marketing block in `Showing.tsx` (L347) so checkout marketing no longer depends on a patron session. If any client-side subscribe is kept as a fallback, base it on the **guest email + the opt-out box**, not on `user`.
5. **Tax note (unrelated but adjacent):** don't touch pricing/tax here — this is consent + subscription only.

### Compliance / consent — flag, don't decide silently
Switching to opt-out means buyers are added unless they decline. In the US that's generally permissible, but (a) Mailchimp's own terms favor permission-based lists, and (b) **double opt-in (`pending`) partially defeats "auto opt-in"** since the person must still confirm. Surface this to Tom as Decision 1 rather than picking silently — his call on single vs double opt-in. Keep the copy honest ("uncheck to opt out") so consent is clear either way.

---

## Decisions for Tom
1. **Single vs double opt-in for auto-subscribed ticket buyers:** true auto opt-in (**`subscribed`**, no confirmation email — needs the trusted server call) vs. **`pending`** double opt-in (buyer must click a confirmation email; safer/compliant but not truly automatic). Same question optionally for the **footer** form (recommend keeping the footer double opt-in).
2. **Subscribe location:** server-side in `ticket-checkout`/`buyers.ts` (recommended, robust, works for anon) vs. client-side after checkout using the guest email.
3. **Default-checked copy:** confirm the exact opt-out label wording.
4. **Tags/interests:** `['ticket-buyer','newsletter']` + the film-type interest — confirm that's the segmentation you want.

## Test plan
**Footer:** submit a fresh email → 200; it appears in the Mailchimp audience (pending or subscribed per Decision 1); the toast matches the actual state; the previously-seen error is gone. Re-run on **staging and prod** (secrets set on both).
**Checkout opt-out:**
- Buy a ticket as a guest with the box **left checked** → the buyer's `profiles.marketing_opt_in = true`, and they're subscribed with `ticket-buyer`/`newsletter` tags (state per Decision 1).
- Buy a ticket with the box **unchecked** → **not** subscribed; `marketing_opt_in = false`; no Mailchimp add.
- Confirm the subscribe runs for a **logged-out** buyer (the common case), not just signed-in staff — i.e., the dead `if (user)` gate no longer blocks it.
- No double-charge / no checkout regression from the added field; `npm run build` and the checkout tests pass.
