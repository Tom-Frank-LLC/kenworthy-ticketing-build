/**
 * Where an `?section=` in an admin URL actually lands.
 *
 * The dashboard's top tab is a URL parameter, which means every one of its
 * values is a link somebody may have bookmarked, pasted into a message, or
 * written down in a runbook. Collapsing three tabs into one therefore cannot
 * just delete those values: `?section=press` has to keep opening the press
 * editor, or the reorganisation quietly turns working links into a blank panel
 * with no error and nothing to search for.
 *
 * Kept out of the component because it is the one part of the tab state with a
 * rule in it, and a rule about links that will outlive this layout is worth
 * testing rather than eyeballing once.
 */

/** Sections that used to be top-level tabs and are now sub-tabs of Pages. */
export const LEGACY_PAGE_SECTIONS = ['festival', 'hiring', 'press'] as const;

export type PagesSubTab = (typeof LEGACY_PAGE_SECTIONS)[number];

/** The sub-tab Pages opens on when nothing says otherwise. */
export const DEFAULT_PAGES_TAB: PagesSubTab = 'festival';

export interface ResolvedSection {
  /** The top-level tab to select. */
  section: string;
  /** Which sub-tab Pages should open on. */
  pagesTab: string;
}

function isLegacy(value: string): value is PagesSubTab {
  return (LEGACY_PAGE_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve the `section` and `page` query parameters into the two tab states.
 *
 * `section` wins over `page` when it names a legacy tab: someone following an
 * old `?section=press` link means press, whatever a stale `page` alongside it
 * happens to say.
 */
export function resolveAdminSection(
  section: string | null,
  page: string | null,
): ResolvedSection {
  const current = section || 'listings';

  if (isLegacy(current)) {
    return { section: 'pages', pagesTab: current };
  }

  return {
    section: current,
    pagesTab: page && isLegacy(page) ? page : DEFAULT_PAGES_TAB,
  };
}
