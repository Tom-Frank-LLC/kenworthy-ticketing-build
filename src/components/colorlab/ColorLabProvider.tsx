import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from 'react';
import { lazyWithRecovery } from '@/lib/lazyWithRecovery';
import { COLOR_LAB_ENABLED } from '@/lib/flags';
import {
  applyLabState,
  isHex,
  OFF,
  readLabState,
  writeLabState,
  type LabState,
} from '@/lib/colorLab';

/**
 * The Color Lab's state, and the thing that puts it on the page.
 *
 * Mounted once, above `Layout`, so both entry points can reach it: the footer
 * link a signed-in staffer clicks, and the logo on the sign-in card a
 * logged-out reviewer clicks. See `src/lib/colorLab.ts` for what "enabled"
 * actually costs (a few inline custom properties on `<html>`, one tab, no
 * server).
 *
 * The panel itself is a separate chunk. A ticket buyer who never triggers the
 * Lab downloads the ~1kB of this provider and nothing else — the preset grids,
 * the pickers and the contrast readout only arrive if someone opens it.
 */

interface ColorLabApi {
  /** Build-time flag AND the session toggle — the panel is showing. */
  enabled: boolean;
  purple: string | null;
  green: string | null;
  /** Idempotent: clicking the trigger twice does not close the Lab. */
  open: () => void;
  close: () => void;
  setPurple: (hex: string) => void;
  setGreen: (hex: string) => void;
  /** Drop both overrides; the Lab stays open on the shipped theme. */
  reset: () => void;
}

const noop = () => {};
const ColorLabContext = createContext<ColorLabApi>({
  enabled: false,
  purple: null,
  green: null,
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

  // useLayoutEffect, not useEffect: it runs before the browser paints, so the
  // custom properties are in place for the first frame rather than one frame
  // late. Cheap — it is a handful of setProperty calls.
  useLayoutEffect(() => {
    if (!COLOR_LAB_ENABLED) return;
    applyLabState(state);
    writeLabState(state);
  }, [state]);

  // The flag can only ever turn things off, so a stale session from before it
  // was flipped cannot resurrect the Lab. Strip anything a previous bundle left
  // on the document.
  const stripped = useRef(false);
  useLayoutEffect(() => {
    if (COLOR_LAB_ENABLED || stripped.current) return;
    stripped.current = true;
    applyLabState(OFF);
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
      open,
      close,
      setPurple,
      setGreen,
      reset,
    }),
    [state, open, close, setPurple, setGreen, reset],
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
