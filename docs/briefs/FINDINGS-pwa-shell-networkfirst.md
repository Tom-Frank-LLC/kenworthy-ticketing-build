# Findings: blank pages after deploy — NetworkFirst app shell

**Date:** August 13, 2026
**Brief:** `BRIEF-pwa-shell-networkfirst.md`
**Status:** ✅ Fixed and verified on staging (three real deploy cycles)
**Changed:** `vite.config.ts` (PWA workbox config only — no app code, no Worker change)

## Summary

The brief's diagnosis was right about the mechanism (the app shell was served
cache-first, so it named asset hashes that no longer existed) but named only
one of the **two** routes that were doing it. Removing `navigateFallback` alone
does not fix the bug. There were three separate things to change, and only the
first was in the brief.

## Root cause — two cache-first navigation routes, not one

Workbox's router is **first-match-wins in registration order**. The generated
`dist/sw.js` registered, in order:

1. `precacheAndRoute([...])` — the precache route
2. `registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")))`
3. …then every `runtimeCaching` route

So a `NetworkFirst` navigation rule added to `runtimeCaching` sits at position 3
and is shadowed by **both** routes above it.

### Cause 1 — `navigateFallback` (in the brief)

`navigateFallback: '/index.html'` is what emits route 2, bound to the
**precached** (cache-first) index.html.

Non-obvious detail: **it is not enough to delete the line.** `vite-plugin-pwa`
injects its own default:

```js
// node_modules/vite-plugin-pwa/dist/index.js
const defaultWorkbox = { /* … */ navigateFallback: "index.html" };
const workbox = Object.assign({}, defaultWorkbox, options.workbox || {});
```

Because it merges with `Object.assign`, only an **explicit `navigateFallback:
undefined`** clears it. Deleting our line silently restored the plugin default —
and *worse*, the reinstated default carried no `navigateFallbackDenylist`, so
`/api/` lost its exclusion too. Confirmed by grepping the emitted `sw.js`:
`NavigationRoute` was still present after the line was removed.

### Cause 2 — the precache route's `directoryIndex` (NOT in the brief)

With `navigateFallback` gone, `/` was *still* served cache-first. Measured in
the browser on a controlled load:

```js
performance.getEntriesByType('navigation')[0]
// → deliveryType: "cache-storage", transferSize: 0, workerStart: 1.7
```

`transferSize: 0` — the document never touched the network, and no
`kenworthy-shell` cache had been created at all.

The reason: workbox's `PrecacheRoute` defaults to **`directoryIndex:
'index.html'`**. A navigation to `/` is resolved against the precache manifest
as `/index.html`, matches (we precache `**/*.html`), and is served cache-first
from route 1 — before the shell rule is ever consulted.

This is the actual bug the brief attributed entirely to `navigateFallback`. It
would have survived the brief's fix as written, and the "verify empirically"
caveat is what caught it.

Fix: `directoryIndex: null`. Workbox only applies its default when the value is
`undefined`, so `null` disables the lookup and `/` falls through to the
NetworkFirst shell rule.

### Cause 3 — `/colorlab` was being served the app shell

Fallout discovered while fixing the above: `/colorlab` is a real standalone
static page in `public/`, but it is a top-level navigation, so the old
`NavigationRoute` was answering it with **the SPA shell**. This is the
"stale SW serves the app shell on the first hit" behavior seen with static
pages — it was this route all along, not a stale worker.

`cleanURLs` (default `true`, and *not* exposed by `generateSW`, so it stays on)
maps `/colorlab` → the precached `colorlab.html`. That is correct and desirable:
it is a separately revisioned document, so cache-first is safe, and it still
works offline. It is therefore excluded from the NetworkFirst shell rule.

## The offline regression this created, and the fix

`navigateFallback` had one genuinely useful property: it answered *any*
navigation with the precached shell, so an offline user could open a route they
had never visited. A plain NetworkFirst rule loses that — it caches per-URL, so
offline `/tickets` misses unless `/tickets` had been loaded online before.

Fixed with a `cacheKeyWillBeUsed` plugin that normalizes every SPA navigation to
a single key:

```js
plugins: [{ cacheKeyWillBeUsed: async () => '/index.html' }]
```

One shell, one entry, answers every route — real SPA semantics. This is also
exactly why `/colorlab` had to be excluded from the rule: without the exclusion,
navigating to Color Lab would have written *its* HTML under `/index.html` and
poisoned the offline shell for the whole app.

Deliberately **no `ExpirationPlugin`** on this rule: a single entry cannot grow,
and a `maxAgeSeconds` would expire the offline fallback out from under a user
who is still offline.

Note: `plugins` with an inline function **does** survive `workbox-build`'s
serialization in `generateSW` mode — verified in the emitted `sw.js`:
`{cacheKeyWillBeUsed:async()=>"/index.html"}`.

## Verification (staging, three real deploy cycles)

Build A deployed → SW installed from a cleared state → build B deployed with
genuinely different asset hashes → **normal** reload (`location.reload()`, not a
hard refresh) in the same already-open tab.

| Check | Result |
|---|---|
| Emitted `sw.js` has no `NavigationRoute` | ✅ count 0 |
| Shell rule registered first | ✅ before assets/images rules |
| `precacheAndRoute(…, {directoryIndex:null})` | ✅ emitted |
| Normal reload after deploy loads new hash | ✅ `index-ChpUkt5W.js` (was `index-CUGmXh5p.js`) |
| Document served from network, via SW | ✅ `deliveryType: ""`, `transferSize: 4125`, `workerStart > 0` |
| Page renders, no blank | ✅ root populated, 3375 chars, h1 present |
| Offline fallback is **fresh** | ✅ cached shell references the new hash, not the old |
| Deep route `/tickets` | ✅ renders; writes to the *same* shell key (still 1 entry) |
| `/colorlab` gets its own page | ✅ `title: "Kenworthy — Color Lab"`, no `#root`, from precache |
| `/colorlab` does not poison the shell | ✅ shell cache still 1 entry |
| Assets still cached | ✅ 11 entries in `kenworthy-assets`, new bundle included |

Repeated a third time on the final clean redeploy — build C (`index-Bta7ZRvW.js`)
picked up on a normal reload.

The aggravating factor from the brief was confirmed live: the now-dead chunk
returns HTML, not a 404 —

```
curl -o /dev/null -w "%{http_code} %{content_type}" …/assets/index-CUGmXh5p.js
→ 200 text/html
```

…which is exactly why a stale shell produced a blank page rather than a
console error. No Worker change was needed: the NetworkFirst shell simply stops
requesting dead hashes.

### What was NOT tested

Offline was verified **at the cache layer**, not by toggling the network stack:
the fallback entry exists, contains the current build's shell, and is keyed to
answer every navigation path. The remaining step — DevTools → Network → Offline
→ reload — was not performed. Residual risk is low (NetworkFirst falling back to
its cache on a rejected fetch is core Workbox behavior), but it is unverified
here.

## Known one-time cost

Clients already carrying the **old** cache-first SW get one more stale load
before the new worker activates (`skipWaiting` + `clientsClaim` update the
worker, but the navigation already in flight has been served). From the next
navigation on, they are on NetworkFirst. This is inherent to replacing a
cache-first SW and cannot be avoided from the new build's side.

## Trade-off accepted

`networkTimeoutSeconds: 3` means a *very slow but working* connection falls back
to the cached shell, which can reintroduce the stale-hash blank page in that
narrow case. Mitigated in practice because `kenworthy-assets` is CacheFirst with
a 30-day expiry, so the previous build's chunks are usually still present and
the old shell still renders. Kept per the brief.

## Not done

Production was **not** deployed — staging only. The optional `onNeedRefresh`
"new version available" toast was not implemented.
