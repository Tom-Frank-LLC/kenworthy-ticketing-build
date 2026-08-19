---
brief: donations
title: Donation wiring — verify, fix the missing email, add checkout donations (tax-free)
status: shipped
track: ops
date: 2026-08-13
evidence: square-donation and lgl-sync-donation functions
verified: true
---

# Brief (for Claude Code): Donation wiring — verify, fix the missing email, add checkout donations (tax-free)

**Status:** 🟢 Draft for review · LGL `LGL_API_KEY` set on staging + prod (Aug 13, 2026)
**Date:** August 13, 2026
**Reported by:** Tom — verify donations are correctly wired (incl. the Little Green Light API connection); a sandbox donation sent **no email** to the donor or the notified person; add a donation prompt ($1/$5/$10) to ticket checkout; any donation added to a purchase must be **tax-free**; and: can the Square reader show a donation button during a transaction?

## Scope (five parts)
A. Verify the donation → payment → LGL pipeline and the `LGL_API_KEY` secret.
B. **Fix the bug:** donations send no confirmation email and no tribute-notification email.
C. Keep donations **tax-free** (standalone already is; enforce it for bundled donations).
D. Add a **donation prompt** to the ticket purchase flow ($1/$5/$10 + custom).
E. In-person / Square reader donations.

## Current state (file:line)
- **`src/pages/Donate.tsx`** — standalone donation page: amount tiers + custom, donor name/email, dedication (`in_honor` / `in_memory` + `dedicateTo`), and `notifyName`/`notifyEmail`. Calls `square-donation`. On success shows "A receipt is on its way to {email}" and a "View your Square receipt" link (`receiptUrl`).
- **`supabase/functions/square-donation/index.ts`** — validates + charges via Square, inserts a `donations` row (`amount_cents`, `donor_email`, `notify_name`, `notify_email`, dedication, `status`), then fire-and-forgets **mailchimp-subscribe**, **mailchimp-ecommerce**, and **lgl-sync-donation**. Charges `amountCents` directly — **no tax** (correct). Returns Square's `receiptUrl`. **Sends no email itself.**
- **`supabase/functions/lgl-sync-donation/index.ts`** — finds/creates the LGL constituent by email and posts the gift; idempotent via `donations.lgl_gift_id`. Auth: `LGL_API_KEY` **edge-function secret**, `Bearer`, base `https://api.littlegreenlight.com/api/v1`. Honors an `app_config.lgl_sync_paused` kill switch.
- **`src/components/admin/LglTab.tsx`** — admin pause/resume toggle + manual backfill.
- **`_shared/pricing.ts`** — `TAX_RATE = 0.06`, tax computed **per ticket row**. No donation concept.
- **`ticket-checkout`** — **no donation awareness at all.**

---

## A. Verify the pipeline + the LGL credential

Checklist (run against staging `rpqzrpboyhshdrfdwayk`, then prod `vlmslygnimfbamrtwvyo`):
1. `square-donation` and `lgl-sync-donation` are **deployed** to the project.
2. A completed donation inserts a `donations` row with `status = 'completed'`.
3. `lgl-sync-donation` runs and sets `donations.lgl_gift_id` (and clears `lgl_sync_error`). If it errors "LGL not configured", the secret is missing.
4. `app_config.lgl_sync_paused` is **off** for live syncing (LglTab toggle).

**LGL API token — ✅ DONE (Aug 13, 2026).** `LGL_API_KEY` has been set on **both** staging (`rpqzrpboyhshdrfdwayk`) and prod (`vlmslygnimfbamrtwvyo`). So step 3's "LGL not configured" error should no longer occur; verify the sync actually posts a gift (`lgl_gift_id` gets set). Steps kept for reference: the token is generated in Little Green Light at **Settings → Integration Settings → LGL API** (LGL flips API access on for trial accounts from that page), then set per project via `npx supabase secrets set LGL_API_KEY="<token>" --project-ref <ref>`.

**⚠️ Still to decide (staging safety):** the same key on staging means **test donations from staging will post real gifts to the live LGL donor database.** Either use a separate LGL sandbox/test key on staging, or keep `app_config.lgl_sync_paused = true` on staging (LglTab toggle) so test runs don't pollute the live donor list. Confirm which before testing donations on staging.

---

## B. Fix the missing email (the reported bug)

**Root cause.** `square-donation` sends **no transactional email**. The "receipt" Donate.tsx promises is **Square's own receipt email**, which **Square sandbox does not send** — so in sandbox the donor gets nothing. And `notify_email` (the tribute notification) is stored but **never emailed to anyone** — that feature was never implemented. Both need our own send.

**Fix.**
1. **Donor receipt email** — after a successful charge, send the donor (`donor_email`) a confirmation via **Resend** (already configured; reuse `sendViaResend` from `_shared/deliver.ts` or a shared mailer). Include: amount, a tax-deductible acknowledgment (the Kenworthy is a 501(c)(3) — include EIN if available), the dedication line if present, and the Square `receiptUrl` when available. This must not depend on Square's receipt, so it works in sandbox and prod.
2. **Tribute notification email** — when `notify_email` is present (an `in_honor` / `in_memory` gift), send that person a short note: "{donor name} made a donation to The Kenworthy in {honor/memory} of {dedicateTo}." Never include the amount unless you decide to (typically tribute notifications omit it).
3. Keep both fire-and-forget and record a per-donation `confirmation_error` (mirror the ticket `deliver.ts` bookkeeping) so a failed send is visible, not silent.

**Test:** a sandbox donation with a `notify_email` → donor receipt **and** the tribute email both arrive, regardless of Square sandbox receipt behavior.

---

## C. Tax-free donations
- **Standalone donations are already tax-free** — `square-donation` charges the exact `amountCents`, no `TAX_RATE`. Keep it that way.
- For **bundled** donations (Part D), the donation amount is added to the charge **without tax**: `TAX_RATE` applies only to ticket rows; the donation is recorded as contribution income, not taxable ticket revenue.

---

## D. Donation prompt in the ticket purchase flow (online)

**UI (`src/pages/Showing.tsx` checkout).** Before the pay button, add an optional "Add a donation to support the Kenworthy?" block with preset buttons **$1 / $5 / $10** (+ a custom field and a clear "no thanks"/zero default), and a line noting the donation is tax-deductible and **not taxed**. The chosen donation adds to the displayed order total.

**Server (`ticket-checkout`).** Accept an optional `donation_cents`:
- Charge **tickets + ticket tax + donation** in the single existing Square payment (one card charge — don't split).
- Compute tax on **tickets only** (unchanged `priceTicketOrder`); add `donation_cents` to the charged amount **after** tax, untaxed.
- Record the donation as a **`donations` row** (status `completed`, `donor_email` = the buyer's email, linked to the order/showing for reconciliation) — so it flows to LGL and QBO as a *gift*, not ticket sales.
- Trigger the same **lgl-sync-donation** and the **donor receipt email** from Part B (or fold a "and thank you for your $X donation" acknowledgment into the ticket confirmation email — pick one, don't double-email).
- Free ($0) ticket orders may still carry a donation — the `$0`-skips-Square rule must not apply if `donation_cents > 0` (there's a real amount to charge).

**Accounting:** confirm the donation maps in the QBO export (`AccountMappingsTab` / `QboExportTab`) to contribution income, separate from ticket revenue, and carries no tax.

---

## E. In-person / Square reader donation

**Answer to "can the Square reader include a donation button during a transaction":** not on the reader itself. A Square Terminal/reader runs Square's own app; we hand it an amount to charge (via `square-terminal`) and can't inject a custom "Donate" button into Square's on-device checkout UI. The way to prompt in person is in **our** box-office UI: add the same **$1/$5/$10 donation prompt to `StaffPOS`** before the staffer charges, so the donation is added to the order, the **combined** amount is sent to the terminal, and the donation is recorded tax-free + synced to LGL — identical handling to the online path in Part D. (A Square **tip** prompt is the only donation-like thing the reader shows natively, and a tip isn't a tax-deductible gift, so don't use it for this.)

## Test plan
- **Verify:** a completed sandbox donation → `donations` row, LGL gift posted (or `lgl_sync_error` explains why), donor receipt + tribute emails delivered.
- **Tax-free:** a ticket order with a $5 donation → tax equals the tickets-only tax; the $5 is added untaxed; a `donations` row is created; totals reconcile.
- **In-person:** a StaffPOS sale with a donation → combined charge to the terminal, tax on tickets only, donation recorded and synced.
- **Accounting:** the donation appears as contribution income (not ticket sales), no tax, in the QBO mapping.

## What Tom needs to do
- ✅ **Done** — `LGL_API_KEY` set on both staging and prod (Part A).
- **Still open:** decide staging safety — a separate LGL test key for staging, or keep staging's `lgl_sync_paused = true` — so test donations from staging don't post real gifts to the live LGL donor list.
