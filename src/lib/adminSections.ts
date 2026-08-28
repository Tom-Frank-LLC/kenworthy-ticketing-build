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

/**
 * Every sub-tab Pages has, legacy or not.
 *
 * The two lists are not the same list and collapsing them would be a bug.
 * `LEGACY_PAGE_SECTIONS` answers "was this once a top-level tab, so does an old
 * `?section=` link have to be redirected?" — a closed set that can only shrink.
 * This one answers "is this a sub-tab that exists?", and it grows every time a
 * page gets an editor. Backstage was born inside Pages, so it belongs here and
 * not there: `?section=backstage` was never a working link and should not start
 * being one.
 */
export const PAGES_SUB_TABS = [...LEGACY_PAGE_SECTIONS, 'backstage'] as const;

/**
 * The sub-tabs of Listings, which are the `?tab=` parameter.
 *
 * Here rather than in the component for the same reason as everything else in
 * this file: it is a set of values that appear in URLs, and the rule for what
 * happens to an unrecognised one has to hold in one place. Radix renders
 * nothing for a value with no TabsContent, so an unknown `?tab=` would open
 * Listings onto a blank panel with no error to search for.
 */
export const SCHEDULE_TABS = ['movies', 'live-events', 'venues', 'featured'] as const;

export type ScheduleTab = (typeof SCHEDULE_TABS)[number];

/** The sub-tab Listings opens on when nothing says otherwise. */
export const DEFAULT_SCHEDULE_TAB: ScheduleTab = 'movies';

export type LegacyPageSection = (typeof LEGACY_PAGE_SECTIONS)[number];

export type PagesSubTab = (typeof PAGES_SUB_TABS)[number];

/** The sub-tab Pages opens on when nothing says otherwise. */
export const DEFAULT_PAGES_TAB: PagesSubTab = 'festival';

export interface ResolvedSection {
  /** The top-level tab to select. */
  section: string;
  /** Which sub-tab Pages should open on. */
  pagesTab: string;
  /** Which sub-tab Listings should open on. */
  scheduleTab: string;
}

/**
 * Sub-tabs of Pages that have since moved somewhere else, and where they went.
 *
 * `home` — the curator's-pick editor — lived under Pages for about a day before
 * moving to Listings as **Featured**, which is where it belongs: it is about
 * what the listings promote, not about editing a page's copy the way Press and
 * Backstage are. A day is long enough for a link to exist, and this file's
 * whole premise is that a URL outlives the layout that produced it, so the old
 * one lands on the new tab rather than on the Pages default with the editor
 * nowhere in sight.
 *
 * Unlike LEGACY_PAGE_SECTIONS, which redirects an old *top-level* `?section=`,
 * this redirects an old *sub-tab* `?page=`. Both are the same promise kept in
 * two directions.
 */
const MOVED_PAGE_SUB_TABS: Record<string, ResolvedSection> = {
  home: { section: 'listings', pagesTab: DEFAULT_PAGES_TAB, scheduleTab: 'featured' },
};

function isLegacy(value: string): value is LegacyPageSection {
  return (LEGACY_PAGE_SECTIONS as readonly string[]).includes(value);
}

function isSubTab(value: string): value is PagesSubTab {
  return (PAGES_SUB_TABS as readonly string[]).includes(value);
}

function isScheduleTab(value: string): value is ScheduleTab {
  return (SCHEDULE_TABS as readonly string[]).includes(value);
}

/**
 * Resolve the `section`, `page` and `tab` query parameters into the three tab
 * states.
 *
 * `section` wins over `page` when it names a legacy tab: someone following an
 * old `?section=press` link means press, whatever a stale `page` alongside it
 * happens to say. A `page` naming a moved sub-tab wins over the rest of the
 * URL for the same reason in reverse — it is the only part of that link that
 * still says where the reader wanted to go.
 */
export function resolveAdminSection(
  section: string | null,
  page: string | null,
  tab: string | null = null,
): ResolvedSection {
  const current = section || 'listings';
  const scheduleTab = tab && isScheduleTab(tab) ? tab : DEFAULT_SCHEDULE_TAB;

  if (isLegacy(current)) {
    return { section: 'pages', pagesTab: current, scheduleTab };
  }

  // Only from Pages: `?section=analytics&page=home` is a stale `page` beside a
  // deliberate `section`, and the section is the one to believe.
  if (current === 'pages' && page && page in MOVED_PAGE_SUB_TABS) {
    return MOVED_PAGE_SUB_TABS[page];
  }

  return {
    section: current,
    // Any real sub-tab, not just a legacy one — otherwise a page added after
    // the reorganisation could never be linked to.
    pagesTab: page && isSubTab(page) ? page : DEFAULT_PAGES_TAB,
    scheduleTab,
  };
}
