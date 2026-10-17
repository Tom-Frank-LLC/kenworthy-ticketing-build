---
brief: capacitor-ios-app
title: The current site ships as an iOS app (Capacitor), with online checkout working inside it
status: built
track: feature
severity: P2
date: 2026-10-16
verified: false
findings: ../FINDINGS-ios-webview-origin.md
---

# Brief: the current build as an iOS app via Capacitor

**Requested by:** Tom, 16 Oct 2026: build the iOS app from the current build so
it can be published to the Kenworthy Apple Developer account, the Capacitor way
(as on the Centerview/Cleopatra app). The original brief had two phases:
Phase 1, a publishable Capacitor shell of the site; Phase 2, card-present
payments in the staff POS through Square's Mobile Payments SDK.

How to build and upload: `docs/RUNBOOK-ios-app.md`. What was measured in the
WebView: `docs/FINDINGS-ios-webview-origin.md`.

## Decisions

| # | Question | Decided |
|---|---|---|
| 1 | Bundle id, account | `org.kenworthy.app`, display name "Kenworthy", Apple account `tickets@kenworthy.org` |
| 2 | Router | `BrowserRouter` stays; deep routes measured working |
| 3 | Square plugin | Not needed (Phase 2 dropped). For the record: `@capawesome/capacitor-square-mobile-payments` is MIT and on public npm (0.1.6, Capacitor ≥8) — no license cost |
| 4 | Card capture | — (Phase 2 dropped) |
| 5 | Scope | the whole current site, public and staff, as one app |
| 6 | Cadence | Phase 1 to TestFlight |

### Phase 2 was dropped, and why

The brief assumed the box office owns a Square Stand or Reader. It owns **two
Square Terminals** (`BRIEF-pricing-rpc.md`, "Card readers"). A Terminal cannot
pair with the Mobile Payments SDK; it is driven only by the Terminal API —
which is exactly what `/staff/pos` uses today, through edge functions
(`square-terminal`), and which works from the app unchanged. So the app already
"runs cards through the platform". Phase 2 only adds something with new
hardware (Square Reader / Stand, 2nd gen) or Tap to Pay on iPhone (Apple
entitlement). Tom chose Phase 1 only (16 Oct).

## What was built

- **Capacitor 8.5.3 iOS project** (`ios/`), Swift Package Manager, UIScene
  delegate from the 8.5 template — so the iOS 27 launch crash Centerview hit
  (`BUG-ios27-uiscene-launch-crash` there) does not apply.
- **`npm run build:native`**: the production build without the service worker,
  into `dist-native/` (`vite.config.ts`, `KW_NATIVE_BUILD=1`). The website build
  is unchanged and still emits `sw.js`.
- **Guards** (lessons from the Centerview app, each one a real incident there):
  `verify-native-bundle.mjs` on every `cap copy`/`sync` (production backend
  only, no service worker); `verify-native-sync.mjs` (the app's copy matches the
  build); `stamp-ios-build.mjs` (generated build number; refuses a literal in the
  pbxproj). See the runbook.
- **`server.hostname: 'localhost'`**, forced by Square's Web Payments SDK — see
  below.
- **Links that leave the device** use `appBaseUrl()` (`src/lib/site.ts`)
  instead of `window.location.origin`: contract links, the rental form link,
  the patron-display QR and the password-reset redirect.
- **YouTube trailers** become a still with a play button that opens YouTube
  (`canEmbed`, `YouTubeLinkOut`); YouTube refuses embeds from the app (Error
  153). Vimeo and the website are unchanged.
- Status bar drawn light on the always-dark page; WebView background
  `#0f0f0f`; icon and launch image from `public/icons/icon.svg`
  (`scripts/ios-icons.sh`); `NSCameraUsageDescription` for the scanner;
  `ITSAppUsesNonExemptEncryption = false`.

## What the original brief got wrong, measured

- **"Disable the service worker or it will fight the WebView."** There is no
  service worker API in an iOS WKWebView on a custom scheme at all. Disabled
  anyway, for the reasons in the findings.
- **Nothing in it anticipated the origin.** At a `capacitor://` origin:
  Square's card form refuses to load unless the hostname ends in `localhost`;
  Turnstile refuses any hostname not on the widget's list; YouTube refuses
  every embed. Online checkout, film passes and donations would all have
  shipped with no card form. Details and evidence in the findings.

## Before the first TestFlight build — Tom

1. ~~Add `localhost` to the production Turnstile widget~~ — **done 17 Oct 2026**
   (Cloudflare API, at Tom's go-ahead; widget `0x4AAAAAAEW68p3qHIfD2p-o`, site key
   and secret unchanged). Verified in the app: a real checkout's Turnstile shows
   "Success!" and the button reads "Pay $8.48 — 1 Ticket(s)".
2. **Sign in to `tickets@kenworthy.org` in Xcode** and select the team
   (runbook). This repo has no `DEVELOPMENT_TEAM` yet; the first signed build
   writes it.
3. Create the App Store Connect record for `org.kenworthy.app`, then archive and
   upload per the runbook.

## Test plan status

| | |
|---|---|
| `ios:prep` → Xcode project builds (iOS 27 SDK, simulator) | ✅ |
| Launches, shows the live site, iPhone and iPad | ✅ |
| Deep routes cold-load; client navigation; back | ✅ |
| No service worker in the app | ✅ (no API; none built) |
| Safe areas, icon, launch image | ✅ simulator |
| Session persists across app kill | ✅ `localStorage` survives; real staff sign-in not tried |
| Square card form in the app | ✅ attaches and tokenises at `localhost` |
| Turnstile in the app | ✅ production widget, real checkout, after step 1 |
| Website build and PWA unchanged | ✅ `build:production` still emits `sw.js`; guard refuses it |
| Camera scanner on a device | ⏳ device only |
| A real purchase from the app | ⏳ on a device |
| Signed archive → TestFlight | ⏳ needs step 2 |
| Checks: vitest 1239 pass; `tsc -p tsconfig.app.json` 9 errors, all pre-existing on main (`NotificationsTab.test.tsx`); `check:worker` fails on main too (`worker-configuration.d.ts` out of date) | |

## Later, if wanted

- In-app YouTube playback via an `https://kenworthy.org` wrapper page (needs a
  `frame-ancestors` exception).
- Password autofill: would need the hostname to be `kenworthy.org`, which
  Square forbids; a native credential-save plugin like Centerview's could still
  offer to save on sign-in.
- Universal links (`applinks:`), so emailed ticket and contract links open the
  app — only after the app handles them (Centerview's
  `BUG-ios-universal-link-swallows-rsvp-invite`).
- Phase 2 card-present, if the theatre buys a Reader/Stand or wants Tap to Pay.
