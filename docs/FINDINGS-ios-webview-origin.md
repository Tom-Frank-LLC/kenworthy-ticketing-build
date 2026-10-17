# FINDINGS: what the iOS app's WebView origin breaks, and what it does not

**Date:** 17 Oct 2026. **Context:** `BRIEF-capacitor-ios-app.md`, Phase 1.
**How measured:** the app built against production (`npm run ios:prep`), run in
the iOS 27.0 simulator (iPhone 18 Pro; iPad Pro 11-inch M5 for layout), with JS
evaluated inside the live WKWebView through `ios_webkit_debug_proxy`
(`brew install ios-webkit-debug-proxy`; the recipe is at the end). Every claim
below was observed, not inferred, unless it says otherwise.

The app serves the same web build from inside the binary, at
`capacitor://<server.hostname>`. Everything that keys on the page's origin,
protocol or Referer behaves differently there than on `https://kenworthy.org`.

## Summary

| Thing | At `capacitor://kenworthy.org` | At `capacitor://localhost` (shipped) |
|---|---|---|
| Square Web Payments card form | **refuses to load** | loads, tokenises |
| Turnstile, production widget as it was | token issued | **110200 (domain not allowed)** |
| Turnstile, widget listing `localhost` | — | accepted (staging widget, measured) |
| YouTube trailer embed | Error 153 | **Error 153** |
| Vimeo embed | — | plays |
| Service worker | `navigator.serviceWorker` absent | absent |
| Deep routes on cold load (`BrowserRouter`) | resolve | resolve |
| `localStorage` across app kill + relaunch | — | persists |
| Supabase edge functions (CORS `*`) | reachable | reachable |
| iOS password autofill for kenworthy.org | would match the host | **does not match** |

No hostname gets both Square and Turnstile. The shipped answer is `localhost`
plus `localhost` on the production Turnstile widget's domain list.

## Square Web Payments SDK: protocol, not secure context

At `capacitor://kenworthy.org`, `window.isSecureContext` is **true**, yet
`Square.payments(...).card()` throws:

> WebSdkEmbedError: Web Payments SDK can only be embedded on sites that use HTTPS and have a secure context

The check in `https://web.squarecdn.com/v1/square.js` (read, Oct 2026) is
separate from the secure-context one:

```js
if (!(r = a.windowLocation).hostname.endsWith("localhost") && "https:" !== r.protocol) throw new _n;
```

A WKWebView cannot serve bundled assets over `https:` (WebKit handles that
scheme itself; Capacitor's `iosScheme` cannot be set to it). So inside the app
the only way past this check is a hostname ending in `localhost`. At
`capacitor://localhost` and `capacitor://kenworthy.localhost` the card form
attaches and `tokenize()` on empty fields returns field validation errors
("Credit card number is not valid"): it is working, not refusing.

Online ticket checkout, film-pass purchase and donations all use this form
(`src/components/SquareCardForm.tsx`). The box-office POS does not: it drives
the Square Terminals through the Terminal API from edge functions, which are
plain HTTPS calls and do not care about the page's origin.

## Turnstile: the widget's domain list

Turnstile validates the page hostname against the widget's configured domains.
Scheme does not matter: at `capacitor://kenworthy.org` the production widget
issued a token, because `kenworthy.org` is on its list.

The widgets, read from the Cloudflare API on 17 Oct 2026:

| widget | sitekey | domains |
|---|---|---|
| Kenworthy Rentals - production | `0x4AAAAAAEW68p3qHIfD2p-o` | `kenworthy-ticketing-build.mrtomfrank.workers.dev`, `kenworthy.org`, `www.kenworthy.org` |
| Kenworthy Rentals - staging | `0x4AAAAAAEW68bMyORHZDp1C` | `kenworthy-ticketing-staging.mrtomfrank.workers.dev`, `localhost` |

At `capacitor://localhost` the production widget fails with error code
`110200` (domain not allowed); the checkout's pay button sits at "Checking your
browser…" with the "could not run" message. The staging widget, which lists
`localhost`, rendered its interactive challenge at `capacitor://kenworthy.localhost`
instead of 110200 — so a `localhost` entry is accepted and covers subdomains.
(It showed a checkbox rather than passing silently; that is Turnstile's managed
mode deciding to challenge a simulator, and a tap clears it.)

The server side (`supabase/functions/_shared/turnstile.ts`) checks only
siteverify's `success`, not its `hostname`, so a token from the app verifies
like one from the site. Not exercised end to end: that takes a real purchase or
rental submission against production.

## YouTube refuses the embed; Vimeo does not

Every YouTube trailer showed "Video player configuration error · Error 153".
YouTube requires an HTTP Referer (or API client identity) on embeds, and a
`capacitor://` page sends none to an `https:` frame. Tried on the live iframe,
none of which helped:

- `referrerpolicy="strict-origin-when-cross-origin"`
- `&origin=https://kenworthy.org&widget_referrer=https://kenworthy.org`
- the same on `www.youtube-nocookie.com`

A Vimeo embed in the same iframe played. Production's 788 trailers are all
YouTube or Vimeo (comment in `src/lib/trailer.ts`).

The fix shipped: `canEmbed()` in `src/lib/trailer.ts` is false for YouTube in
the app. The showing page and trailer modal show the video's still with a play
button (`src/components/YouTubeLinkOut.tsx`), and a tap opens YouTube or Safari.
That hand-off is Capacitor's: `WebViewDelegationHandler` sends any top-level
navigation off the app's origin to `UIApplication.shared.open`. The home
marquee, which is ambient, shows the poster instead.

The road not taken: an `https://kenworthy.org` wrapper page that embeds the
player, so the Referer is real. It needs a page on the site and an exception to
`frame-ancestors 'none'` in `public/_headers`. Worth it only if in-app playback
matters.

## Service worker: the brief's concern does not arise on iOS

`navigator.serviceWorker` is **undefined** in the app. WKWebView offers service
workers only to app-bound domains, never to a custom scheme. So the workbox
worker could not have fought the WebView. `npm run build:native` still builds
without it (`VitePWA({ disable })`), because otherwise the bundle ships
`registerSW.js` for an API that is not there, and a future Android build — where
the scheme is `https` and workers do run — would inherit the problem for real.

## What works unchanged

- **Routing.** Cold full loads of `/calendar`, `/staff/pos` (redirects to
  `/auth` signed out, as on the web), `/contract/blank`, `/film-passes` and an
  unknown path (the app's own 404) all render. Capacitor serves `index.html` for
  any path without a file. Client-side link navigation and `history.back()`
  work. **`BrowserRouter` stays; no `HashRouter` (Decision 2).**
- **Session storage.** A `localStorage` key set before `simctl terminate`
  was there after relaunch. Supabase's session lives there
  (`src/integrations/supabase/client.ts`), so sign-in persists. Not tested with
  a real staff sign-in (no credentials in this session).
- **Safe areas.** The sticky header pads by `env(safe-area-inset-top)`, the
  showing page's checkout bar by `env(safe-area-inset-bottom)`; both clear the
  Dynamic Island and home indicator. `index.html` already had
  `viewport-fit=cover` for the PWA.
- **Camera.** Capacitor grants WKWebView media capture itself
  (`decisionHandler(.grant)`); iOS asks the user once, using
  `NSCameraUsageDescription`. The simulator has no camera, so the scanner
  itself is untested here.
- **Launch.** Warm relaunch: first contentful paint ~100 ms. A first launch on
  a freshly booted simulator was blank for ~15 s before painting (iPad); not
  seen on warm launches.

## Links that leave the device

At `capacitor://localhost`, `window.location.origin` is not a URL anyone else
can open. Five call sites built shareable links from it — the renter's contract
link (two places), the public rental form link, the patron-display pairing QR,
and the password-reset email's `redirectTo`. They now use `appBaseUrl()`
(`src/lib/site.ts`): the page origin on the web, `SITE_URL` in the app. Any new
shareable link must do the same.

## Recipe: evaluating JS inside the simulator's WebView

1. Build Debug for the simulator (Capacitor makes the WebView inspectable in
   Debug), install, launch.
2. Find the simulator's inspector socket:
   `lsof -U | grep webinspectord_sim` — use the path `launchd_sim` holds; a
   stale one under `/private/tmp` refuses connections.
3. `ios_webkit_debug_proxy -s unix:<that path>`; `curl localhost:9222/json`
   lists pages and their `webSocketDebuggerUrl`.
4. Send `Runtime.evaluate` over that websocket. WebKit ignores `awaitPromise`,
   so for async work store the result on `window` and poll it. Do not call
   `.click()` synchronously inside an evaluate: a navigation mid-evaluate wedges
   the connection. Wrap it in `setTimeout`.
