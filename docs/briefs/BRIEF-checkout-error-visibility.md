---
brief: checkout-error-visibility
title: A failed purchase or donation shows a persistent, high-contrast, icon-and-text error, not a vanishing toast
status: shipped
track: ux
severity: P1
date: 2026-11-23
shipped_in: ["#428"]
shipped_at: 2026-11-24
verified: true
findings: FINDINGS-ticket-declines-2026-11.md
---

# Checkout error visibility

**Why:** a failed pay attempt (declined card, incomplete bot check, server
refusal) was reported only by a Sonner toast that disappeared in seconds,
and sometimes also by red text with nothing else marking it as an error. The
person who reported it is red-deficient. Buyers decided the site was broken and
gave up on mistakes they could have fixed.

**Status:** shipped in #428 (squash `7f82579`), deployed to production
2026-11-24 as Worker version `25a7831b` (rollback `6a3a0546`). It was
verified first on staging (`6051f797`) with sandbox CVV declines on the
donation page and ticket checkout.

## Phase 1 — tickets (`d580806`)

- `src/components/CheckoutError.tsx`: a banner that stays until the next
  attempt. Its message is in `text-foreground` with a warning icon, it has
  `role="alert"`, and it focuses and scrolls into view when it appears.
- `Showing.tsx`: `purchaseError`, signed-in and guest (`GuestCheckoutForm`
  `serverError`), plus the quote error.

## Phase 2 — donation page + error-text sweep

- `Donate.tsx`: `donateError` is cleared at the top of `handleSubmit` and set on
  every path that stops a gift: pre-submit validation, card tokenise failure,
  `success: false`, and the outer catch. The banner sits between the Turnstile
  widget and the Donate button. Each failure also fires a toast (Decision 1:
  both).
  - The outer catch's fallback deliberately does **not** say "your card was
    not charged". `square-donation` reports declines as a 400 with
    `publicDeclineMessage`, which `invokeFunction` throws with the server's own
    sentence. A dropped connection after Square took the payment lands in the
    same catch, so "not charged" could be false there. Only the tokenise
    failure claims it, because nothing has reached the server at that point.
- `ui/field.tsx`: a shared `FieldError` (icon + text) used by `Field`,
  GuestCheckoutForm's four field errors and SquareCardForm's load error
  (Decision 2: one shared style). `FormErrorSummary` now uses foreground text
  with a red border and icon, like `CheckoutError`.
- Scope (Decision 3): the pay path only. The app-wide `text-destructive` audit
  stays with the ADA work.

## The contrast premise was out of date (measured)

The original brief assumed `text-destructive` on near-black fails WCAG 1.4.3.
That was true of the old `0 72% 51%` red. The current `--destructive`
(`0 70% 66%`, see `src/index.css`) passes. Ratios were computed with WCAG
relative luminance and with Machado 2009 severity-1.0 simulation matrices:

| text on | normal | protanopia | deuteranopia |
|---|---|---|---|
| red on `--background` | 6.08 | 4.94 | 6.83 |
| red on `--card` | 5.70 | 4.63 | 6.41 |
| red on `bg-card/40` (Donate form) | 5.94 | 4.82 | 6.67 |
| red on `destructive/10` over card (old summary box) | 5.03 | **4.16** | 5.60 |
| foreground on `destructive/10` over card (new summary/banner) | 14.05 | 14.22 | 13.95 |
| *old red `0 72% 51%` on card, for comparison* | 3.74 | 2.57 | 4.51 |

So the fix that was actually needed is 1.4.1 (an error shown by colour alone):
the icon on every field error, plus foreground text in the one tinted box
that falls below 4.5:1 under protanopia. The field-error text stays red.

## Not in scope (checked)

- `DonationPrompt.tsx` has no checkout of its own. It sets the cart's gift,
  which goes through the Showing checkout.
- `FilmPassDetail.tsx` has no online card checkout. Passes are redeemed at
  the door.

## Tests

`CheckoutError.test.tsx`, `GuestCheckoutForm.test.tsx`, and
`Donate.test.tsx` (new "failure banner" block: a refused charge shows a
persistent alert with an icon, it clears on the next attempt, and a success
still reaches the receipt). The new Donate tests fail against the pre-change
`Donate.tsx`.
