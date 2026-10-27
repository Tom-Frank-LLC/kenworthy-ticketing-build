# FINDINGS: the Kenworthy app in the Android WebView

**Date:** 23 Oct 2026. **Context:** `docs/briefs/BRIEF-capacitor-android-app.md`.
**How measured:** debug build of `npm run android:prep` (production bundle,
production Supabase), Android 17 emulator (`Medium_Phone_API_37.0`, WebView
Chrome 145), JS evaluated in the live WebView over the DevTools protocol (the
recipe is in `docs/RUNBOOK-android-app.md`). Every row was observed. Real
devices, older Android versions and older WebViews were not tested.

| Thing | Result |
|---|---|
| Page origin | `https://localhost` — Capacitor Android's default `https` scheme plus `server.hostname: 'localhost'`. No config change from iOS. |
| Square Web Payments card form | attaches on `/donate` and `/film-pass/:id` (Square's iframes load with the production application id; no `WebSdkEmbedError`) |
| Turnstile, production widget | token issued on `/rental-request` silently; on the film-pass checkout it showed the managed checkbox, and one tap issued a token and enabled "Pay $12.72" (same as the iOS simulator) |
| Service worker | `navigator.serviceWorker` **exists** here (unlike WKWebView), and `getRegistrations()` is empty: the native build has none to register |
| Deep route on cold load | `https://localhost/donate` loaded directly resolves |
| `localStorage` across force-stop + relaunch | persists |
| Camera | `getUserMedia({video:true})` raises Android's own permission prompt (from the `CAMERA` manifest entry; Capacitor relays the WebView's request); granting returns a video track |
| Status / navigation bars | the page draws under them (edge-to-edge, enforced at targetSdk 35+); `env(safe-area-inset-top)` = 24px, so the header clears the clock |
| Cold start | dark throughout once the window theme was made dark (below) |
| Hardware back | needs `@capacitor/app` (below) |

## Two things the generated project got wrong

**White system bars before the first paint.** `cap add android` generates a
light `DayNight` app theme. Until the WebView paints, the status and navigation
bars show the window background, so the first second of every launch had white
bars with white icons. The same area shows the window background permanently on
WebViews older than 140: Capacitor 8's `SystemBars` then pads the WebView clear
of the bars instead of passing the insets through (`SystemBars.java`,
`WEBVIEW_VERSION_WITH_SAFE_AREA_FIX`). The themes in `res/values/styles.xml` are
now dark with a `#0f0f0f` window background, which covers both.

**The back button.** With no handler, Android's back closes the app from any
page. With `@capacitor/app` installed and no listener, the plugin goes back
through WebView history but does nothing on the first page, so the app cannot
be left with back. `src/main.tsx` listens on Android only: back while there is
history, `minimizeApp()` on the first page (relaunch afterwards was a hot start).

Testing trap: navigation fired by a scripted `click()` over DevTools has no user
activation, and Chrome's history intervention makes such entries skippable, so
`canGoBack` was false and back appeared broken. Real taps (`adb shell input tap`)
behave correctly.

## Not tested

- A real phone; Android versions before 17; WebViews before 140 (the padded
  inset path).
- A completed card payment in the app (the form attaches; nothing was charged).
- The staff routes (`/staff/pos`, `/staff/scanner`) signed in: no staff account
  was used on production. The scanner's camera path was exercised through
  `getUserMedia` directly.
- The Square Stand reader (#399) is iOS-only: its plugin declares no Android
  source, so `standAvailable()` is false on Android and the POS never offers it.
