import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// `?raw` rather than node:fs — the app tsconfig has no node types, and a
// `node:fs` import fails `tsc -p tsconfig.app.json` even though vitest runs it.
import INDEX_HTML from '../../index.html?raw';

/**
 * The boot watchdog is inline in index.html, because it has to run when the
 * module bundle does not. That makes it the one piece of shipped code a normal
 * unit test cannot import — so this test extracts and evaluates the real script
 * out of the real file. If someone edits or deletes it, these fail.
 *
 * The bug it guards: a deploy content-hashes assets and deletes the old ones.
 * A stale service-worker shell asks for `index-OLDHASH.js`; the Worker's SPA
 * fallback answers HTTP 200 with index.html; the browser refuses to run HTML as
 * a module; React never mounts; the tab sits blank until a hard refresh.
 * lazyWithRecovery cannot help — it is inside the bundle that never arrived.
 */

function inlineWatchdogSource(): string {
  const match = INDEX_HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/);
  if (!match) throw new Error('boot watchdog not found in index.html');
  return match[1];
}

/** Run the real script against the current jsdom document. */
function bootWatchdog() {
  // eslint-disable-next-line no-new-func
  new Function(inlineWatchdogSource())();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  // No service worker by default — the simplest path.
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Simulate the SPA fallback: a script element that fails to execute. */
function failAsset(tagName = 'SCRIPT') {
  const el = document.createElement(tagName === 'SCRIPT' ? 'script' : 'link');
  document.head.appendChild(el);
  const ev = new Event('error');
  Object.defineProperty(ev, 'target', { value: el });
  window.dispatchEvent(ev);
}

describe('the boot watchdog is present in index.html', () => {
  it('sits inside <head>, or the build hoists the entry above it', () => {
    // Source order is NOT build order: Vite hoists the bundled entry script
    // into <head>. When this lived in <body> the built html had the module tag
    // at byte 2861 and the watchdog at 5593 — the error listener would have
    // been registered after the script it exists to catch.
    const watchdogAt = INDEX_HTML.indexOf('kw:boot-reload');
    const headEndsAt = INDEX_HTML.indexOf('</head>');
    expect(watchdogAt).toBeGreaterThan(-1);
    expect(watchdogAt).toBeLessThan(headEndsAt);
  });

  it('is registered before the ld+json blob, so it is as early as practical', () => {
    expect(INDEX_HTML.indexOf('kw:boot-reload'))
      .toBeLessThan(INDEX_HTML.indexOf('application/ld+json'));
  });

  it('is not loaded from a file, which could 404 the same way', () => {
    expect(inlineWatchdogSource()).toContain('kw:boot-reload');
  });
});

describe('a failed entry asset', () => {
  it('reloads once', async () => {
    bootWatchdog();
    failAsset();
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('records the attempt so a second tab load does not loop', async () => {
    bootWatchdog();
    failAsset();
    await flush();
    expect(sessionStorage.getItem('kw:boot-reload')).toBe('asset');
  });

  it('does NOT reload again if the reload landed on a still-broken shell', async () => {
    sessionStorage.setItem('kw:boot-reload', 'asset');
    bootWatchdog();
    failAsset();
    await flush();
    // Better a blank page than an infinite reload loop.
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads only once even when several assets fail', async () => {
    bootWatchdog();
    failAsset('SCRIPT');
    failAsset('LINK');
    failAsset('SCRIPT');
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores errors that are not asset loads', async () => {
    bootWatchdog();
    window.dispatchEvent(new Event('error')); // target === window
    const img = document.createElement('img');
    const ev = new Event('error');
    Object.defineProperty(ev, 'target', { value: img });
    window.dispatchEvent(ev);
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('the timeout safety net', () => {
  it('reloads when #root is still empty long after load', async () => {
    bootWatchdog();
    window.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(8000);
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a slow but working boot alone', async () => {
    bootWatchdog();
    window.dispatchEvent(new Event('load'));
    // React mounts late, but it does mount.
    document.getElementById('root')!.appendChild(document.createElement('div'));
    vi.advanceTimersByTime(8000);
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it('releases the budget on a successful boot, so the next deploy recovers too', async () => {
    sessionStorage.setItem('kw:boot-reload', 'asset');
    bootWatchdog();
    window.dispatchEvent(new Event('load'));
    document.getElementById('root')!.appendChild(document.createElement('div'));
    vi.advanceTimersByTime(8000);
    await flush();
    expect(sessionStorage.getItem('kw:boot-reload')).toBeNull();
  });

  it('does not fire before the timeout elapses', async () => {
    bootWatchdog();
    window.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(7000);
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('the stale service worker', () => {
  it('is unregistered and its caches dropped before reloading', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const cacheDelete = vi.fn().mockResolvedValue(true);
    (navigator as any).serviceWorker = {
      getRegistrations: vi.fn().mockResolvedValue([{ unregister }]),
    };
    (window as any).caches = {
      keys: vi.fn().mockResolvedValue(['kenworthy-shell', 'workbox-precache']),
      delete: cacheDelete,
    };

    bootWatchdog();
    failAsset();
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());

    // Without this the reload can be served the same stale shell again.
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(cacheDelete).toHaveBeenCalledWith('kenworthy-shell');
    expect(cacheDelete).toHaveBeenCalledWith('workbox-precache');

    delete (window as any).caches;
  });

  it('still reloads if unregistering throws', async () => {
    (navigator as any).serviceWorker = {
      getRegistrations: vi.fn().mockRejectedValue(new Error('nope')),
    };
    bootWatchdog();
    failAsset();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});

describe('storage being unavailable', () => {
  it('declines to reload rather than risk a loop', async () => {
    // Replace the whole object rather than spying on Storage.prototype: under
    // this Node/jsdom combination `sessionStorage` is Node's own experimental
    // global and is not a jsdom `Storage` instance, so a prototype spy never
    // fires. Same trap the setup file documents for `localStorage`.
    const real = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem() { throw new Error('storage blocked'); },
        setItem() { throw new Error('storage blocked'); },
        removeItem() { throw new Error('storage blocked'); },
      },
    });

    bootWatchdog();
    failAsset();
    await flush();

    // Private-mode Safari throws on storage. With no way to record that we
    // already tried, reloading could loop forever — a blank page is the
    // better failure.
    expect(reload).not.toHaveBeenCalled();

    if (real) Object.defineProperty(globalThis, 'sessionStorage', real);
  });
});
