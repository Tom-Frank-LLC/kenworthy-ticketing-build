import * as React from "react";

/**
 * The one place a "is this a phone-sized viewport" question gets answered.
 *
 * 768px is Tailwind's `md` breakpoint, so `useIsMobile() === true` is exactly
 * the range where `md:` utilities are NOT applied. Keep them in step: if this
 * number ever changes, the `md:` prefixes across the app change meaning with
 * it. Prefer a `md:` utility where CSS can do the job — reach for this hook
 * only when the two viewports need genuinely different markup or behaviour
 * (a Sheet vs. a Dialog, a different component tree), not different styling.
 */
export const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
