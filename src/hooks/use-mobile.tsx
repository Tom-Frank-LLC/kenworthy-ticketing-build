import * as React from "react";

/**
 * The one place "how wide is the viewport" gets answered.
 *
 * These constants are Tailwind's own breakpoints, and the coupling is
 * deliberate: `useIsMobile() === true` is exactly the range where `md:`
 * utilities are NOT applied, and `useIsSplitLayout() === true` is exactly
 * where `lg:` utilities ARE. If either number changes, the matching prefixes
 * across the app change meaning with it.
 *
 * Prefer a `md:`/`lg:` utility where CSS can do the job — reach for these
 * hooks only when the two viewports need genuinely different markup or
 * behaviour (a drawer vs. an inline pane), not different styling.
 */
export const MOBILE_BREAKPOINT = 768; // Tailwind `md`
export const SPLIT_BREAKPOINT = 1024; // Tailwind `lg`

function useMediaQuery(query: string) {
  // Resolved synchronously on first render. Deferring to an effect leaves one
  // frame reporting "desktop", which is long enough for a fast tap to take the
  // wrong branch.
  const [matches, setMatches] = React.useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** True below Tailwind's `md` — phone-sized viewports. */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/**
 * True at Tailwind's `lg` and up, where there is room for a two-column
 * list + preview split. Below it, a preview pane stacks underneath the whole
 * list and is effectively unreachable — use a drawer instead.
 */
export function useIsSplitLayout() {
  return useMediaQuery(`(min-width: ${SPLIT_BREAKPOINT}px)`);
}
