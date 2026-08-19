# Brief (for Claude Code): Temporarily hide phone fields on purchases; require email (until SMS is wired)

**Status:** ✅ Shipped — `3f186ad` (PR #84). Superseded by `BRIEF-reactivate-phone-sms.md`, which turned phone capture back on.
**Date:** August 15, 2026
**Requested by:** Tom — SMS isn't wired yet, so a phone number can't actually be used to deliver tickets/passes. Temporarily **remove the phone field** from the public ticket and film‑pass purchase forms and make **email required**. Re‑enable phone easily once SMS is live.

## Why (the real reason, not just cosmetics)
Delivery goes out by email (Resend) and/or SMS (Twilio); SMS isn't configured yet. Today the ticket form accepts **email *or* phone** — so a buyer who enters only a phone would get **no ticket at all** (the SMS never sends). Requiring email guarantees every online buyer can actually receive their tickets. This is a temporary safety measure, so build it to flip back cleanly — don't rip the phone plumbing out.

## Make it reversible — one flag
Add a single switch (default off) and gate all the changes below on it, so re‑enabling phone is a one‑line flip that restores the exact prior behavior:
- Add to `src/lib/site.ts` (the existing shared module): `export const COLLECT_PHONE = false;` *(when SMS is live, set `true`)*.

## Change 1 — Ticket checkout (`src/components/GuestCheckoutForm.tsx`)
- **Hide the Phone field** (the `<Label htmlFor="guest-phone">…</Label>` + its `<Input>`, ~L112–124) behind `{COLLECT_PHONE && ( … )}`.
- **Require email** when phone is hidden. Current validation (~L41) is `if (!email.trim() && !phone.trim()) … 'Email or phone is required'`. Change so that when `!COLLECT_PHONE`, email is required: `if (!email.trim()) newErrors.email = 'Email is required so we can send your tickets'`. Keep the existing email‑format check (~L43). (When `COLLECT_PHONE` is true, keep the original email‑or‑phone rule.)
- **Update the helper copy** (~L127) — currently "Provide email or phone so we can send your tickets…" → "Enter your email so we can send your tickets." (Restore the original when the flag flips back.)
- **Payload:** keep passing phone but empty when off — `onPurchase({ name, email, phone: COLLECT_PHONE ? phone.trim() : '' }, …)` (~L27/L41) — so the server contract is unchanged.

## Change 2 — Film‑pass checkout (`src/pages/FilmPasses.tsx`)
- Email is **already required** here (~L100) — no change to that.
- **Hide the Phone field** (`<Label htmlFor="pass-phone">Phone (optional)</Label>` + its `type="tel"` input, ~L437–440) behind `{COLLECT_PHONE && ( … )}`.
- **Payload:** `phone: COLLECT_PHONE ? (phone.trim() || undefined) : undefined` (~L144).
- (Mailing‑address fields for physical passes are unrelated — leave them.)

## Change 3 — Server validation: leave lenient (don't break other flows)
- **Do not** tighten `ticket-checkout` / `film-pass-checkout` to email‑only. They currently accept **email or phone** (`ticket-checkout/index.ts:145`), and the **box‑office POS** and any in‑person/comp flow still legitimately pass a phone or minimal contact. Since the public forms now always send email, online purchases satisfy the existing rule without a server change. Keeping the server lenient preserves POS and makes re‑enabling phone trivial.

## Decision — the box‑office POS (`src/pages/admin/StaffPOS.tsx`)
The staff POS has its own patron **Email** (~L671) and **Phone (optional)** (~L681) fields and its own "email or phone" check (~L450). It's an **in‑person, staff‑run** flow (walk‑ups, comps), not a public purchase. **Decision for Tom:** also hide the POS phone field for now (consistent — SMS is off everywhere), or leave it so staff can still capture a phone for their records? *(Recommend: leave POS as‑is — it's staff‑controlled and not the public purchase path Tom described — but relabel the POS hint to "Email required for digital delivery" so staff don't rely on phone delivery. Quick to also hide it if you prefer.)*

## Reversal (when SMS is live)
Flip `COLLECT_PHONE = true` → phone fields reappear on both forms, ticket validation returns to email‑or‑phone, and the helper copy reverts. No other code changes needed. (Pairs with the Twilio/SMS wiring work.)

## Test plan
- **Tickets:** the checkout form shows **no phone field**; submitting with a valid email works and the ticket email arrives; submitting with a **blank email** is blocked with "Email is required…"; an invalid email is rejected.
- **Film passes:** no phone field; email still required; pickup and mail fulfillment both complete; confirmation email arrives.
- **Server:** a purchase with email and no phone succeeds (no regression); POS still functions.
- **Reversibility:** setting `COLLECT_PHONE = true` restores the phone fields and the email‑or‑phone rule on both forms.
- `npm run build` passes.
