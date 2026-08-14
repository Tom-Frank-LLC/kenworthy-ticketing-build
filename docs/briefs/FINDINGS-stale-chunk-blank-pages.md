# Findings: blank pages after deploy, part 2 — stale route chunks

**Date:** August 13, 2026
**Follows:** `FINDINGS-pwa-shell-networkfirst.md`
**Status:** ✅ Fixed and verified on staging by reproducing the failure, then the recovery
**Reported by:** Tom — "I am still getting pages that load blank until I hard refresh," *after* the NetworkFirst shell fix shipped to production.

## The headline

**There were two independent causes of the identical symptom.** Fixing the
service-worker shell was correct and is still needed, but it only ever
addressed *navigations*. This second cause breaks *client-side route
transitions*, which never touch the service worker at all. That is why the
symptom survived a verified fix, and why "it's still broken" did not mean the
first fix was wrong.

| | Cause 1 (shipped earlier) | Cause 2 (this document) |
|---|---|---|
| Trigger | Reload / fresh navigation after deploy | Clicking an in-app link in an already-open tab |
| Mechanism | SW served a cache-first shell naming dead asset hashes | Route chunk deleted by deploy; dynamic import fails |
| Involves the SW? | Yes | **No** |
| Fix | `vite.config.ts` NetworkFirst shell | `src/lib/lazyWithRecovery.ts` |

## Cause

`src/App.tsx` lazy-loads ~32 routes, and the codebase had **no** chunk-load
error handling — no error boundary, no `vite:preloadError` listener.

1. A tab is open, running build A's shell.
2. A deploy ships build B. Every chunk is content-hashed, so build A's files
   are deleted from the Worker.
3. The user clicks an in-app link. React Router does a client-side
   transition — **no document request, so the service worker's NetworkFirst
   shell rule is never consulted.**
4. `import("./pages/Calendar")` requests `/assets/Calendar-<oldhash>.js`.
5. The Worker's `not_found_handling: single-page-application` answers with
   `index.html` — **HTTP 200, `text/html`** — not a 404.
6. The browser tries to parse HTML as an ES module. The import rejects.
   Nothing catches it. React unmounts. **Blank page.**

A hard refresh works because it re-fetches the shell, which then names chunks
that exist.

Reproduced on staging before writing any fix:

```
rootChildren: 0, bodyTextLen: 0
vite:preloadError
Uncaught TypeError: Failed to fetch dynamically imported module:
  …/assets/Calendar-BiM7G8SZ.js
```

And the dead chunk really is served as HTML:

```
curl -o /dev/null -w "%{http_code} %{content_type}" …/assets/Calendar-BiM7G8SZ.js
→ 200 text/html
```

## Fix

`src/lib/lazyWithRecovery.ts` — a drop-in for `React.lazy` that reloads once
when a route chunk cannot be fetched. The running shell is stale by
definition; the current shell names chunks that exist, so a reload is the only
real recovery. Because it happens mid-transition the reload is invisible: the
user lands on the page they clicked.

Guard rails:

- **One reload per tab**, tracked in `sessionStorage`. A genuinely missing
  chunk (bad deploy, network fault) must not reload-loop, trading a blank page
  for an infinite one.
- **Budget released on success**, so a tab left open across several deploys
  recovers from each, not just the first.
- **`sessionStorage` unavailable** (private browsing) ⇒ decline to reload,
  because without a record of having tried, a loop is possible.
- **Defensive guard** for a module that resolves *without* a default export —
  see the trap below.

All 32 lazy routes were converted, including three that do not use the
`lazy(() => import(...))` shape (the shared `ComingSoon` module).

## Two traps this walked into — both worth remembering

### 1. `vite:preloadError` + `preventDefault()` makes it strictly worse

The first attempt added, purely to tidy the console:

```js
window.addEventListener('vite:preloadError', (e) => e.preventDefault());
```

That **broke the recovery it was meant to accompany.** Vite's preload helper
is:

```js
function handlePreloadError(err) {
  const e = new Event("vite:preloadError", { cancelable: true });
  e.payload = err;
  window.dispatchEvent(e);
  if (!e.defaultPrevented) throw err;      // ← preventDefault stops the rethrow
}
return baseModule().catch(handlePreloadError)
```

With `preventDefault()`, `handlePreloadError` returns normally, so `.catch()`
resolves — the dynamic import **resolves with `undefined`** instead of
rejecting. React's `lazy` then reads `undefined.default`:

```
TypeError: Cannot read properties of undefined (reading 'default')
```

Still a blank page, but now the failure is *uncatchable* — there is no
rejection to handle. The uncaught console error is the mechanism that makes
recovery possible. Do not silence it. There is a regression test for the
resolves-as-undefined case, and a prominent warning in the module.

### 2. `npx tsc --noEmit` type-checks NOTHING in this repo

The `preventDefault` bug shipped to staging alongside a second, cruder bug —
three `lazy(...)` calls left un-migrated after their import was removed — which
`tsc --noEmit` reported as clean. It was not clean:

```
ReferenceError: lazy is not defined      # in the browser, blank page
```

`tsconfig.json` is a **solution-style config**: `"files": []` plus
`references` to `tsconfig.app.json` / `tsconfig.node.json`. Plain `tsc` with
no `-p`/`-b` therefore checks an empty file list and exits 0. Verified: with
the bug reintroduced,

- `npx tsc --noEmit` → exit 0, silent
- `npx tsc -p tsconfig.app.json --noEmit` → `src/App.tsx(62,19): error TS2304: Cannot find name 'lazy'.`

**Use `npx tsc -p tsconfig.app.json --noEmit` (or `tsc -b`).** Every prior
"typecheck clean" in this repo that used bare `tsc --noEmit` proved nothing.

## Verification

Reproduced and then re-tested the *same* scenario end to end on staging —
deploy A, open tab, deploy B with new hashes, click an in-app link to a route
whose chunk was never cached:

| | Before fix | After fix |
|---|---|---|
| `rootChildren` | **0** | 3 |
| `bodyTextLen` | **0** | 18,083 |
| `navType` | `navigate` (no reload) | **`reload`** |
| shell running | old `index-EFbtfYUP.js` | new `index-BR9-O3CZ.js` |
| result | blank until hard refresh | Calendar renders, URL still `/calendar` |
| `kw:chunk-reload` after | — | `null` (budget released for next deploy) |

Also: real typecheck (`tsc -p tsconfig.app.json`) clean; `vitest run` 104
passed / 15 files, including 5 tests covering reload-once, no-loop,
budget-release, resolves-as-undefined, and the normal path.

## Not done

The Worker still answers dead `/assets/*` requests with `index.html` (200,
HTML) rather than a 404. Fixing that would make the failure honest and is
worth considering, but it does not remove the need for this recovery — a
404 fails the import just the same. Left alone deliberately: changing
`not_found_handling` risks breaking SPA deep links, which is a bigger blast
radius than the problem it solves.
