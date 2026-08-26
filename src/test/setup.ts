import "@testing-library/jest-dom";

/**
 * `window.localStorage` is undefined under this Node/jsdom combination — Node
 * ships its own experimental global `localStorage` that needs
 * `--localstorage-file`, and it wins over jsdom's. `sessionStorage` is
 * unaffected, which makes the gap easy to miss until a test touches the other
 * one. Real browsers have both, so this restores the environment rather than
 * changing behaviour; production code still guards its own storage access,
 * because private-mode Safari throws on it for entirely different reasons.
 */
if (typeof window.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

/**
 * jsdom implements neither `IntersectionObserver` nor `ResizeObserver`, and
 * embla constructs both during init — one to track slides in view, one to
 * remeasure on resize. So *rendering* a carousel throws before a test can
 * assert anything about it. Same category as the two above: real browser APIs
 * the environment is missing, restored rather than mocked away.
 *
 * Both stubs report nothing, which is correct here — these tests assert on
 * markup, and jsdom has no layout for a real observer to measure. A test that
 * wants to assert embla actually *moved* needs a browser, not a better stub:
 * the transform is driven by requestAnimationFrame against measured widths,
 * and jsdom reports every element as 0x0.
 */
if (typeof window.IntersectionObserver === "undefined") {
  class StubIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(window, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: StubIntersectionObserver,
  });
  Object.defineProperty(globalThis, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: StubIntersectionObserver,
  });
}

if (typeof window.ResizeObserver === "undefined") {
  class StubResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: StubResizeObserver,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: StubResizeObserver,
  });
}
