---
brief: ios-stand-reader
title: The box-office iPad takes cards through its Square Stand, from the Staff POS in the iOS app
status: in-progress
track: feature
severity: P1
date: 2026-10-21
verified: false
---

# Brief: the Square Stand's reader drives the Staff POS (iOS app, Phase 2)

> **Setup corrected 28 Oct 2026:** the iPad in the Stand is the
> **patron-facing display** outside the glass, not the till — see
> `BRIEF-stand-at-patron-display.md`. What this brief built (the till itself on
> the Stand iPad, "Square Stand (this iPad)") stays as the alternative setup,
> for a special event with no display; it is no longer the default.

**Requested by:** Tom. This was the purpose of the iOS app from the start: the
box-office iPad sits in a **Square Stand (2nd generation, USB-C)**, and card
sales rung up in `/staff/pos` should be taken by that Stand, with the
patron-facing display (`/pos/display`) paired to the same station.

## Correction to the Phase 1 brief

`BRIEF-capacitor-ios-app.md` dropped this as "Phase 2" on the claim that the
box office owns only Square Terminals. That claim came from
`BRIEF-pricing-rpc.md` and was never checked against the counter. The
Terminals exist, but the box-office iPad is in a Stand. A Terminal is driven by
the Terminal API from a server and needs no app. A Stand's reader is reachable
only from a native app on the iPad it holds, through Square's Mobile Payments
SDK. The website alone cannot do this; that is why the app exists.

## What Square requires (read 21 Oct 2026)

From developer.squareup.com/docs/mobile-payments-sdk and its iOS pages:

- **Hardware:** every Square Stand and Square Reader generation is supported.
  Stand 2nd gen (S155/S176) reads chip and contactless and supports offline
  payments. A Stand is not paired: the SDK detects it when the iPad is docked
  (`connectionType .embedded`).
- **Info.plist:** `UISupportedExternalAccessoryProtocols` = `com.squareup.s020`,
  `com.squareup.s025`, `com.squareup.s089`, `com.squareup.protocol.stand`;
  `NSBluetoothAlwaysUsageDescription`; `NSLocationWhenInUseUsageDescription`
  (Square checks the country on every payment); `NSMicrophoneUsageDescription`
  (magstripe readers only).
- **Build:** SDK 2.6.0 by Swift Package Manager; a last Run Script phase calling
  the framework's `setup`; User Script Sandboxing off. Initialised in
  `AppDelegate` with the Square application ID before any other SDK call.
- **Authorization:** an **OAuth access token** plus a location ID. A personal
  access token is allowed only in the sandbox. Production uses a personal
  access token today, so OAuth is new: scopes `MERCHANT_PROFILE_READ`,
  `PAYMENTS_WRITE`, `PAYMENTS_WRITE_IN_PERSON`. Access tokens expire after 30
  days; Square recommends refreshing every 7.
- **Application signature:** SDK 2.1+ takes no production payment until the
  app's bundle ID and team ID are registered in the Developer Console
  (Mobile Payments SDK → Add Signature).
- **App Store only:** Square must tell Apple the app is cleared for the Stand
  (Square's "Stand MFi approval form"; a forum report from July 2026 took about
  8 days). Square's forum says it is not needed outside the App Store, so
  internal TestFlight should not wait on it. **Unverified until a TestFlight
  build takes a card on the Stand.**
- Attended use only (no kiosks), US/CA/UK/AU accounts.

Plugin: `@capawesome/capacitor-square-mobile-payments` 0.1.6, MIT, Capacitor ≥
8, ships `Package.swift`. Its `startPayment` takes `amountMoney`,
`paymentAttemptId`, `processingMode`, `referenceId`, `note`, `orderId`.

## Square applications

| | application id | location |
|---|---|---|
| production | `sq0idp-gimxBVaATLLQetsP7qa_7g` | `LT3WAR885FA1J` |
| sandbox (staging) | `sandbox-sq0idb-pfgKPmMAtOyj0qj4bALh9g` | `LRWDNGD4FX73S` |

Read from each environment's public `ticket-checkout` `get_config`. OAuth must
use this same application, so the Square Order the server creates and the
payment the Stand takes come from one app.

## Design

The counter flow stays the one `square-terminal` already runs: **rows first
(pending), then the reader, then confirm**, with the server reading the amount
from the rows and never from the browser.

1. **`start_sale` with `reader: "stand"`.** Same as today up to and including
   the Square Order; instead of creating a Terminal checkout it returns
   `amount_cents`, `square_order_id` and the order token as the reference.
2. **The app takes the card** with `startPayment({ amountMoney, orderId,
   referenceId: order token, paymentAttemptId, processingMode: ONLINE_ONLY })`.
   Online only: an offline payment has no id until it syncs, and confirm needs
   the id.
3. **`confirm_sale` with `payment_id`.** The server reads the payment from
   Square's Payments API and confirms the rows only if it is `COMPLETED`, its
   `reference_id` is this order token, its location is ours, and its amount
   covers the rows. These are the same bindings the Terminal path checks
   (`binding.ts`, security audit L1), plus the one-payment-one-order check.
4. **The token.** A new `square-mobile-auth` function, staff only, returns
   `{ access_token, location_id, environment }`. Production: the OAuth token,
   refreshed on demand when it is within 7 days of expiry. Sandbox: the sandbox
   personal token, which Square allows there. Tokens live in a table with RLS
   on and no policies (service role only).
5. **OAuth, once.** `square-oauth`: an admin starts it, Square redirects back
   with a code, the function exchanges it with the application secret and
   stores the tokens. The state parameter is a server-issued single-use value.
6. **The POS.** In the app, the reader picker gains "Square Stand (this iPad)".
   Choosing it routes card sales through steps 1–3. On the web nothing changes.

Film-pass and other counter card sales (`create_checkout`) follow once ticket
sales work.

## Tom's steps

1. developer.squareup.com/apps → the Kenworthy application → **Production** →
   **OAuth**: set the Redirect URL (given at build time); copy the
   **Application secret** and set it yourself:
   `supabase secrets set SQUARE_OAUTH_CLIENT_SECRET=… --project-ref vlmslygnimfbamrtwvyo`.
   Never paste it into a chat or a file.
2. Same application → **Mobile Payments SDK** → **Add Signature**: iOS, bundle
   ID `org.kenworthy.tickets`, team ID `26H64FNAKG`.
3. Submit Square's Stand MFi approval form (needed before the App Store, not
   before TestFlight).
4. Once the build is up: sign in to the POS on the Stand iPad as an admin,
   press "Connect Square" once, and approve as the Kenworthy Square account.

## Measured in the sandbox (21 Oct 2026)

iOS 27 iPad simulator, staging bundle, Square sandbox, Square's mock reader
(contactless & chip), signed in as a throwaway staging staff account.

- SDK 2.6.0 initialises in the app; `authorize` with the sandbox token sets
  location `LRWDNGD4FX73S`. The POS defaults the app to "Square Stand (this
  iPad)".
- **A Stand payment pays the server's Square Order.** Square's docs do not say
  whether a payment taken on the device can carry an order created by the
  server. It can: payment `8b53bTL29tukecN4XeGrC0cyyTTZY` is COMPLETED for 848,
  `reference_id` = the order token, `order_id` = the order `start_sale` made,
  and that order is COMPLETED with the line "Adult - Tuesday, December 15 at
  7:30 PM" and this payment as its tender. The ticket row is confirmed with the
  payment id. (Same Square application on both sides; production must use the
  same application for OAuth, as designed.)
- **An abandoned payment releases the seat.** Square times out an idle prompt
  ("timed out due to inactivity", about a minute); cancelling returns no
  payment id, and the pending row went to `failed` with the reason. Square's
  message for it is written for developers, so `standFailureMessage` says it
  plainly.
- Driving the simulator needs taps in Square's own UI: `axe` (Homebrew
  `cameroncooke/axe/axe`) taps by point; WebView element centres in CSS px are
  points on the iPad simulator. The mock reader's floating button sits at the
  screen centre and catches taps meant for the page; hide it while setting up.

## Test plan

| | |
|---|---|
| SDK initialises, mock reader takes a sandbox payment in the simulator against staging | ✅ |
| A payment taken with `orderId` attaches to the server's Square Order | ✅ |
| Abandoned payment releases the pending rows | ✅ |
| `confirm_sale` refuses a payment for another order, another amount, another location | ✅ deno tests (`stand_test.ts`) |
| OAuth connect + refresh in production | ⏳ needs Tom's secret |
| A real card on the Stand from TestFlight | ⏳ device |
| Film-pass sales on the Stand | ⏳ not built; the POS refuses with a sentence |
| Web POS unchanged | ✅ Stand option exists only in the app (`standAvailable`) |
