import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from 'react';
import { lazyWithRecovery } from '@/lib/lazyWithRecovery';
import { COLOR_LAB_ENABLED } from '@/lib/flags';
import { isHex, OFF, readLabState, writeLabState, type LabState } from '@/lib/colorLab';
import {
  applyEffectiveTheme,
  loadSiteTheme,
  NO_THEME,
  sessionOverride,
  subscribeSiteTheme,
  type PublishedTheme,
} from '@/lib/siteTheme';

/**
 * The Color Lab's state, and the thing that puts colour on the page.
 *
 * Two layers meet here, and only here:
 *
 *   session override  (this tab, from the Lab)   — wins
 *   published theme   (app_config, every visitor)
 *   index.css                                    — the floor
 *
 * Precedence is per colour rather than wholesale, so auditioning a green
 * against the published purple works the way you would expect.
 *
 * Note what is *not* gated on `COLOR_LAB_ENABLED`: the published theme. The
 * flag hides the editor, not the site's configured colours — switching the Lab
 * off must not silently repaint the site back to the code defaults.
 *
 * The panel itself is a separate chunk. A ticket buyer who never opens the Lab
 * downloads this provider and nothing else.
 */

interface ColorLabApi {
  /** Build-time flag AND the session toggle — the panel is showing. */
  enabled: boolean;
  /** This tab's override. null per colour means "fall through". */
  purple: string | null;
  green: string | null;
  /** What every visitor currently gets. */
  published: PublishedTheme;
  open: () => void;
  close: () => void;
  setPurple: (hex: string) => void;
  setGreen: (hex: string) => void;
  /** Drop this tab's override; the Lab stays open on the published theme. */
  reset: () => void;
}

const noop = () => {};
const ColorLabContext = createContext<ColorLabApi>({
  enabled: false,
  purple: null,
  green: null,
  published: NO_THEME,
  open: noop,
  close: noop,
  setPurple: noop,
  setGreen: noop,
  reset: noop,
});

export function useColorLab(): ColorLabApi {
  return useContext(ColorLabContext);
}

const ColorLabPanel = lazyWithRecovery(() => import('./ColorLabPanel'));

export function ColorLabProvider({ children }: { children: React.ReactNode }) {
  // Read once, synchronously, so the first render already knows whether the Lab
  // was open earlier this session — a navigation must not flash the shipped
  // colours before the override lands.
  const [state, setState] = useState<LabState>(() => (COLOR_LAB_ENABLED ? readLabState() : OFF));
  const [published, setPublished] = useState<PublishedTheme>(NO_THEME);

  // The published theme arrives asynchronously; main.tsx has already painted
  // the cached guess, so this is the reconcile rather than the first paint.
  useEffect(() => {
    let alive = true;
    loadSiteTheme().then(t => {
      if (alive) setPublished(t);
    });
    const unsubscribe = subscribeSiteTheme(t => {
      if (alive) setPublished(t);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // useLayoutEffect, not useEffect: it runs before the browser paints, so the
  // custom properties are in place for the frame rather than one frame late.
  useLayoutEffect(() => {
    // React state is the authority for the session layer, not sessionStorage —
    // storage is only where it survives a reload, and it is written below.
    // Reading it back here is what made every swatch click paint the previous
    // click's colour.
    applyEffectiveTheme(published, sessionOverride(state));
    if (COLOR_LAB_ENABLED) writeLabState(state);
  }, [state, published]);

  // The flag can only ever turn the *editor* off, so a stale session from
  // before it was flipped cannot resurrect the Lab. The published theme is
  // untouched by this — it is site config, not the Lab.
  const stripped = useRef(false);
  useLayoutEffect(() => {
    if (COLOR_LAB_ENABLED || stripped.current) return;
    stripped.current = true;
    writeLabState(OFF);
  }, []);

  const open = useCallback(() => setState(s => ({ ...s, on: true })), []);
  const close = useCallback(() => setState(OFF), []);
  const setPurple = useCallback(
    (hex: string) => setState(s => (isHex(hex) ? { ...s, on: true, purple: hex } : s)),
    [],
  );
  const setGreen = useCallback(
    (hex: string) => setState(s => (isHex(hex) ? { ...s, on: true, green: hex } : s)),
    [],
  );
  const reset = useCallback(() => setState(s => ({ ...s, purple: null, green: null })), []);

  const api = useMemo<ColorLabApi>(
    () => ({
      enabled: COLOR_LAB_ENABLED && state.on,
      purple: state.purple,
      green: state.green,
      published,
      open,
      close,
      setPurple,
      setGreen,
      reset,
    }),
    [state, published, open, close, setPurple, setGreen, reset],
  );

  return (
    <ColorLabContext.Provider value={api}>
      {children}
      {api.enabled && (
        <Suspense fallback={null}>
          <ColorLabPanel />
        </Suspense>
      )}
    </ColorLabContext.Provider>
  );
}
