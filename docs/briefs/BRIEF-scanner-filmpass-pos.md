# Brief (for Claude Code): Scanner + film-pass redemption refinements, purchase type, POS scanner

**Status:** ✅ Built — August 14, 2026
**Date:** August 13, 2026
**Requested by:** Tom — refinements to the door scanner and film-pass redemption.

## Outcome

Built as specified, with three corrections to the brief's premises found while
implementing. Decisions 1 and 2 were answered: shortened `qr_code`, full-screen
button.

**1. `tickets.pass_id` does not exist, and was not added.** The brief assumed
migration `20260813000000` added it; it did not, and neither production nor
staging has the column. But the link the column was wanted *for* already
exists: `admit_with_film_pass` writes `film_pass_redemptions (pass_id,
ticket_id, showing_id, amount_deducted, redeemed_by)` on every admission, which
is the record Tom saw when testing. `AttendeeSheet` therefore reads the pass
through the redemption row rather than from a new column on `tickets` — adding
one would have been a second home for a fact the redemption row already owns,
and a second place for it to go wrong.

**2. The `already_admitted` guard was in the database, not the edge function.**
`film-pass-checkout` only relays the verdict; the check and the unique index
both lived in `admit_with_film_pass`. So the edge function needed no change at
all, and the fix is entirely in migration `20260814020000`.

**3. The exhausted-pass verdict is `not_active`/`depleted`, not
`insufficient`.** The brief expected `insufficient` at the end of a pass. In
practice the tenth admission takes the balance to zero and flips the status to
`depleted` in the same transaction, and the status check runs before the
balance check — so the eleventh scan returns `not_active` with
`status: depleted`, which the scanner already renders as "This pass is used up
— no admissions left." `insufficient` is still reachable and still correct for
a pass stranded with a partial balance (e.g. $3 left against a $6 redemption).
Both paths were exercised against a real Postgres before shipping.

Item 6 (tap-to-pay) was an answer, not a change: nothing was scoped or built
for it. It stays flagged for the native-app phase.

## Context
The physical film-pass system is already built: migration `20260813000000_film_passes_physical.sql` (adds `tickets.pass_id`, `film_pass_redemptions.showing_id`, `redemption_price`, etc.), the `film-pass-checkout` edge function (scan → admit + deduct), and `TicketScanner.tsx` (showing selector, verdicts, beeps). These are **amendments** to that.

---

## 1. Record & show purchase type + which pass was used
`tickets` already has `payment_method` (card / cash / film_pass / online / comp / free) and `pass_id` (→ `user_film_passes`). Ensure a film-pass admission writes `payment_method = 'film_pass'` **and** `pass_id` (the `film-pass-checkout` path should already set `pass_id`; confirm `payment_method` is set too).

**Add "purchase type" to the per-showing attendee/sales listing** — `src/components/admin/AttendeeSheet.tsx` (the list of a showing's tickets). Add a **Purchase Type** column showing each ticket's `payment_method`, and for `film_pass` rows show **which pass** was used — join `pass_id → user_film_passes` and display its pass number/identifier.

**Decision — pass number:** the pass identity today is `qr_code = 'PASS:<uuid>'`, not a friendly number. Either (a) display a shortened form (e.g. last 6 of the uuid), or (b) add a human-friendly sequential `pass_number` to `user_film_passes` (assigned at batch creation) and show that. Recommend (b) for legibility on printed passes and reports — confirm.

## 2. Do NOT limit a pass to one admission per showing
A pass holder can bring friends — each scan admits one person and deducts `redemption_price`, bounded only by the balance. Today a **UNIQUE INDEX `(pass_id, showing_id)`** and an `already_admitted` verdict block a second admission for the same showing. Remove that limit:
- **Migration:** drop `film_pass_redemptions_pass_showing_key` (the partial unique index on `(pass_id, showing_id)`).
- **`film-pass-checkout`:** remove the `already_admitted` guard/branch. Each scan of an active, eligible pass with sufficient balance admits one and deducts `redemption_price`; when `remaining_balance < redemption_price`, return `insufficient` (and `depleted` when it hits zero). Keep all other checks: eligibility (`film_pass_eligible` + movie), expiry, void, showing-full.
- **`TicketScanner.tsx`:** remove the `already_admitted` result handling (it can't occur anymore).
- Keep `film_pass_redemptions.showing_id` populated (still useful for reporting "how many admits this pass bought for this screening") — just not unique.

## 3. Confirmation checkmark on a pass scan (prevent accidental multi-scan)
Because repeat scans are now allowed, guard against *accidental* double counting: show the **same success confirmation** for a film-pass admission as for a ticket check-in — a clear green **checkmark** card + success beep — and require it to register/clear before the next scan.
- After a successful admission, show the success state (checkmark, "Admitted — $X deducted, $Y left") and **debounce the same QR**: ignore a re-read of the *identical* code within a short cooldown (e.g. 2.5–3s) so one physical pass held to the camera isn't counted several times. A *different* code (the next friend's, or a deliberate re-scan after the cooldown) scans normally.
- Mirror the ticket-scan UX exactly so staff read one consistent "it worked" signal.

## 4. Add the Scanner to the POS page
Staff shouldn't have to leave `/admin/pos` and come back. In `src/pages/admin/StaffPOS.tsx` (tabs: Tickets / Concessions / Film Passes), add a **Scanner** entry — either a 4th tab that mounts the scanner, or a prominent "Open Scanner" button in the POS toolbar. Recommend a button that opens the scanner **full-screen** (see #5) with a clear "Back to POS" exit, so the camera gets the whole screen rather than being boxed inside a tab.

## 5. Full-screen camera on load
When the scanner's camera starts, render it **full-screen** (a `fixed inset-0 z-50` overlay) rather than a small embedded region — the video fills the screen, with the showing selector, the result/confirmation card, manual-entry, and a close/exit control overlaid. This is the default on load (camera up, full-screen), for fast, unambiguous scanning at the door.

## 6. Tap-to-pay on the scanning phone? (answer)
**Not from the current web app.** Square's **Tap to Pay on iPhone / Android** is delivered through the **Mobile Payments SDK — a native iOS/Android SDK**, not a browser API. Our scanner is a web PWA, so it cannot invoke Tap to Pay directly. To make one phone both scan QR and accept contactless cards, either:
- run the **Square POS app** for the tap-to-pay charge alongside our web scanner (two apps, no dev work), or
- **wrap our app natively** (Capacitor) and integrate Square's Mobile Payments SDK so Tap to Pay lives in-app — this belongs with the native-app phase (the mobile-optimization / app foundation), not a quick change.

So: technically yes (the phone hardware + Square support it), but only via a native build or the Square app — flag it for the app phase, don't scope it here.

## Acceptance
- A film-pass admission records `payment_method='film_pass'` + `pass_id`; `AttendeeSheet` shows a Purchase Type column and the pass number for pass admissions.
- One pass scans multiple times for the same showing (each deducts `redemption_price`) until the balance can't cover another — no `already_admitted` block; the unique index is gone.
- Each successful pass scan shows the same green checkmark confirmation + beep as a ticket; the same code re-read within the cooldown is ignored.
- A Scanner entry on the POS opens the scanner without leaving the page; the camera is full-screen on load.
- `npm run build` and scanner tests pass (update `TicketScanner.test.tsx` for the removed `already_admitted` path).

## Decisions for Tom
1. Pass number: shortened uuid vs. a real sequential `pass_number` (recommended) shown on passes and in reports.
2. POS scanner: full-screen button (recommended) vs. an in-tab embed.
