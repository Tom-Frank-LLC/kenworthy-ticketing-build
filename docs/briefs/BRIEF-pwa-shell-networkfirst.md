---
brief: pwa-shell-networkfirst
title: Stop blank pages after deploy — serve the app shell NetworkFirst
status: shipped
track: ops
date: 2026-08-13
evidence: NetworkFirst shell strategy in vite.config.ts
verified: true
findings: FINDINGS-pwa-shell-networkfirst.md
---

# Brief (for Claude Code): Stop blank pages after deploy — serve the app shell NetworkFirst

**Status:** 🟢 Ready — pre-launch hardening (affects real patrons once live)
**Date:** August 13, 2026
**Reported by:** Tom — after recent deploys, most pages load **blank** and require a **hard refresh** to render.

## Symptom & cause
The PWA service worker serves the HTML **app shell cache-first** (`navigateFallback: '/index.html'` in `vite.config.ts`). Each build content-hashes the JS/CSS (`index-ABC.js` → `index-XYZ.js`). A browser that already has the app cached serves the **old** shell from the service worker, which references asset filenames that no longer exist on the server → the scripts fail to load → blank page. A hard refresh bypasses the service worker, fetches the current shell, and works. Because it's triggered per-deploy, it recurs every time we ship.

Two aggravating factors:
- The Worker uses `not_found_handling: single-page-application`, so a request for a now-deleted hashed chunk returns `index.html` (HTTP 200 HTML) instead of a 404 — the browser gets HTML where it expected JS, which is what actually breaks the render.
- `registerType: 'autoUpdate'` + `skipWaiting` + `clientsClaim` update the *worker* in the background, but the navigation that's happening **right now** already received the stale shell before the update activates — hence exactly one blank load per deploy until refreshed.

## Goal
A normal reload (or navigation) of an already-open tab after a new deploy must load the **new** build with **no hard refresh and no blank page**, while the app still works **offline**. Asset caching (fast repeat loads) must be preserved.

## Fix — NetworkFirst app shell
In `vite.config.ts` → `VitePWA({ workbox: {...} })`, make **navigation/document** requests NetworkFirst so an online client always gets the current `index.html` (and therefore the current asset hashes); keep a cached shell only as the offline fallback. Leave the asset strategy alone (hashed `/assets/*` are immutable — `CacheFirst` is correct; images stay `StaleWhileRevalidate`). Keep `registerType: 'autoUpdate'`, `skipWaiting`, `clientsClaim`, `cleanupOutdatedCaches`.

Recommended shape (verify empirically — see the route-precedence note):
```js
workbox: {
  globPatterns: ['**/*.{css,html,svg,woff,woff2}'],
  globIgnores: ['**/backstage-logo-*.svg'],
  navigationPreload: true,                 // faster NetworkFirst navigations
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  navigateFallbackDenylist: [/^\/api\//],
  runtimeCaching: [
    {
      // App shell / SPA navigations: always try the network first so the served
      // HTML references assets that actually exist; fall back to the last-good
      // cached shell only when the network fails (offline / slow).
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'kenworthy-shell',
        networkTimeoutSeconds: 3,          // slow net → cached shell, not a hang
        expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
        cacheableResponse: { statuses: [200] },
      },
    },
    // …existing /assets/ CacheFirst ('kenworthy-assets') and image SWR rules, unchanged…
  ],
}
```

**Route-precedence caveat to test:** `navigateFallback: '/index.html'` registers workbox's own `NavigationRoute` bound to the **precached** (cache-first) index. If that route still shadows the NetworkFirst navigation rule above (i.e. the shell is still served stale), **drop `navigateFallback`** and rely on the NetworkFirst rule for online, with offline handled by that rule's cache (ensure `/index.html` is cached under `kenworthy-shell` so an offline navigation still resolves — a small `handlerDidError`/fallback to the precached `/index.html` is fine). Decide based on the deploy test below, not theory.

## Verify (must actually reproduce the deploy cycle — this is the whole point)
1. Build + deploy **build A** to staging; open the site in a normal tab so the SW installs.
2. Make a trivial change; build + deploy **build B** (new asset hashes).
3. In the **same already-open tab**, do a **normal** reload (⌘R, not ⌘⇧R). It must render **build B** with no blank and no hard refresh.
4. In DevTools → Network: the **document** request is served from the network (not a stale "(ServiceWorker)" response) and references the **new** `index-*.js` hash.
5. **Offline:** DevTools → Network → Offline → reload → the app still renders from the cached shell.
6. **Assets still cached:** a second online reload is fast; `/assets/*` come from `kenworthy-assets`.

Optional belt-and-suspenders (nice, not required): a small "new version available — reloading" toast via the vite-plugin-pwa `onNeedRefresh` register hook, so an open tab refreshes itself when a new SW activates.

## Notes
- No change needed to the Cloudflare Worker; the NetworkFirst shell simply stops requesting dead hashes, which sidesteps the SPA-fallback-returns-HTML problem.
- This is the "a bad deploy strands users on a cached broken shell" risk flagged when the PWA first landed — worth fixing before real patrons are on production.
