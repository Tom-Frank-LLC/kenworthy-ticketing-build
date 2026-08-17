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
