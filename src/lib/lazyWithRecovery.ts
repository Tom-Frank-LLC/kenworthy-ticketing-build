import { lazy, type ComponentType } from 'react';

/**
 * Recovery for route chunks that a deploy deleted out from under an open tab.
 *
 * Every build content-hashes its chunks, and a deploy removes the previous
 * build's files. A tab that was already open is still running the old shell,
 * so `import("./pages/Calendar")` asks for a filename the server no longer
 * has. The Worker's `not_found_handling: single-page-application` answers
 * that with index.html — HTTP 200, `text/html` — so the browser tries to
 * parse HTML as an ES module and the import rejects. Nothing catches it,
 * React unmounts, and the page goes blank until a hard refresh.
 *
 * This is NOT the same bug as the cache-first service-worker shell (fixed in
 * vite.config.ts). That one broke *navigations*; this one breaks client-side
 * route transitions, which never touch the service worker at all. Both
 * produce an identical blank page, which is why fixing the first did not
 * make the symptom go away.
 *
 * A reload is the only real recovery: the running shell is stale by
 * definition, and the current shell names chunks that exist. Because the
 * failure happens mid-transition, the reload is invisible — the user sees
 * the page they clicked, not a blank.
 */

/**
 * Guards against a reload loop. If the reload lands on a shell whose chunk is
 * *still* unfetchable — a genuinely missing file, a network fault, a broken
 * deploy — reloading again would spin forever, replacing a blank page with an
 * infinite one. So we reload at most once per tab and then let the error
 * through. sessionStorage, not localStorage: the budget is per-tab, and it
 * must not persist into a future session that has nothing to do with this
 * deploy.
 */
const RELOAD_KEY = 'kw:chunk-reload';

/** Exported for tests; not part of the public surface. */
export const CHUNK_RELOAD_KEY = RELOAD_KEY;

function isRecoverable(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_KEY) === null;
  } catch {
    // Private browsing / storage disabled. Without a way to record that we
    // already tried, a reload could loop, so decline to reload at all and let
    // the error surface.
    return false;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, '1');
  } catch {
    /* storage unavailable — isRecoverable() already returned false */
  }
}

function clearReloadMark(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* nothing to clear */
  }
}

function recover<T>(error: unknown): Promise<T> {
  if (!isRecoverable()) throw error;
  markReloaded();
  window.location.reload();
  // The document is being torn down. Never settling keeps Suspense showing
  // its fallback instead of flashing an error in the fraction of a second
  // before the reload takes effect.
  return new Promise<T>(() => {});
}

/**
 * Drop-in for `React.lazy` that reloads once when the chunk is missing
 * because of a deploy.
 *
 * On success the one-reload budget is released, so a tab left open across
 * several deploys recovers from each of them rather than only the first.
 *
 * Do NOT add a `vite:preloadError` listener that calls `preventDefault()`.
 * It reads like harmless console tidying and is actively harmful. Vite's
 * preload helper is:
 *
 *     function handlePreloadError(err) {
 *       const e = new Event("vite:preloadError", { cancelable: true });
 *       window.dispatchEvent(e);
 *       if (!e.defaultPrevented) throw err;
 *     }
 *     return baseModule().catch(handlePreloadError)
 *
 * so `preventDefault()` stops the rethrow, `.catch()` returns undefined, and
 * the import **resolves with `undefined`** instead of rejecting. React then
 * reads `undefined.default` and the page goes blank anyway — with the
 * rejection now impossible to catch. The uncaught console error is the
 * mechanism that makes recovery possible; leave it alone.
 */
export function lazyWithRecovery<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().then(
      (module) => {
        // Defensive: anything that hands back a module without a default
        // export is a stale/!mangled chunk, not a component. Treat it the
        // same as a rejection rather than letting React read `.default` off
        // it and unmount the tree.
        if (!module || typeof module !== 'object' || !('default' in module)) {
          return recover<{ default: T }>(
            new TypeError('Route chunk resolved without a default export'),
          );
        }
        clearReloadMark();
        return module;
      },
      (error: unknown) => recover<{ default: T }>(error),
    ),
  );
}
