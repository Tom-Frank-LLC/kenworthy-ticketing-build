---
brief: capacitor-android-app
title: The app builds for Android from the same Capacitor project, with checkout, Turnstile and the scanner camera working in the WebView
status: built
track: feature
severity: P2
date: 2026-10-23
verified: false
findings: ../FINDINGS-android-webview.md
---

# Brief: Android build of the app for internal testing (Capacitor)

**Requested by:** Tom, 23 Oct 2026 — now that iOS is in TestFlight, build the
Android version for internal testing. Builds on `BRIEF-capacitor-ios-app.md`.
How to build, sign and distribute: `docs/RUNBOOK-android-app.md`. What was
measured: `docs/FINDINGS-android-webview.md`.

## Outcome (23 Oct 2026)

Built on `feat/capacitor-android`, stacked on `feat/capacitor-ios` (#392)
rather than committed to it, so #399 (stacked on #392) is not disturbed.

| Test-plan item | Result |
|---|---|
| `android:prep` + Gradle produce an installable app | ✅ debug APK, release AAB/APK |
| No white flash (`#0f0f0f`) on launch | ✅ after making the generated themes dark |
| No service worker | ✅ none registered |
| Session persists across restart | ✅ localStorage survives force-stop (sign-in itself not exercised) |
| Square card form on checkout / film pass / donation | ✅ film pass and donation; ticket checkout uses the same component |
| Turnstile on checkout and the rental form | ✅ both issued tokens |
| Camera scanner prompts | ✅ prompt + video track via `getUserMedia`; the signed-in scanner page not opened |
| Insets | ✅ header clears the status bar (Android 17) |
| Icons / splash | ✅ adaptive icon + Android 12 splash from the mark |
| Signed AAB/APK | ✅ signing config proven with a throwaway key; the real upload key is Tom's |
| Installs via Play Internal / Firebase | ⏳ Tom: account, upload key, upload |
| Web build + tests unaffected; iOS still builds | ✅ vitest, `build:production`, iOS simulator build |

Where the brief was incomplete:

- **"No config change needed"** — true. The origin is `https://localhost`.
- **Insets and theme:** the generated light theme put white system bars on
  screen before first paint (and permanently on WebViews older than 140). Fixed
  in `styles.xml`.
- **The back button was not in the brief.** Without `@capacitor/app` it quit the
  app from any page; with it alone, it did nothing on the first page. Added the
  plugin (it is also synced into iOS, where it does nothing) and a listener in
  `src/main.tsx`.
- `verify-native-sync.mjs` now takes the platform as its one argument
  (`ios:prep` passes `ios`); any other argument still fails.
- Backups are off (`allowBackup="false"` + data extraction rules): the
  WebView's localStorage carries the Supabase session, and restoring it onto
  another phone would sign that phone in as staff.

## Decision 1 (Tom): distribution

Google Play Internal testing (recommended; the TestFlight equivalent and the
path to a store listing) or Firebase App Distribution (no Play account).
Both are written up in the runbook.

---

## The original brief (as written, 23 Oct 2026)

**Status:** Parity work on the existing `feat/capacitor-ios` branch. iOS Phase 1
is in TestFlight; this adds the Android platform to the same Capacitor project
and gets a signed build out for internal testing (Google Play Internal track or
Firebase App Distribution). Same web bundle, same config, same
service-worker-off build — the net-new work is the Android platform,
icons/manifest/gradle, signing, and distribution.

### The change
1. Add `@capacitor/android@~8.5.3`, `npx cap add android`. Keep
   `capacitor.config.ts` as-is; do not add `server.url`.
2. `android:prep` = `build:native && cap sync android && stamp-android-build && verify-native-sync`.
3. `applicationId` `org.kenworthy.tickets`; versionName/versionCode (stamped);
   min/target SDK meet Play requirements.
4. Adaptive icons and splash from the Kenworthy mark; background `#0f0f0f`.
5. Manifest: `INTERNET`, `CAMERA` for the scanner; no Bluetooth/location until
   Phase 2; no cleartext; edge-to-edge insets handled.
6. Verify in the Android WebView that the Square card form renders on
   checkout/film-pass/donation and Turnstile loads on checkout and the rental
   form (`https://localhost` origin, "localhost" Turnstile entry).

### Signing and distribution (Tom)
Play App Signing with an upload keystore; distribute via Play Internal testing
($25 developer account), Firebase App Distribution, or APK sideload.

### Scope
Phase 1 shell only: browse, buy, donate, film passes, scanner, staff POS. The
POS card path stays on the Terminal API; the Square Stand reader is iPad
hardware and not driven by the Android app. Card-present on Android (Tap to
Pay / Mobile Payments SDK) is out of scope. Web app and its deploys unchanged.
