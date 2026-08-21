/**
 * Which admin sections an operator keeps open.
 *
 * The dashboard is a working surface, not a page someone reads once: the box
 * office opens the same two sections every shift, and accounting opens a
 * different two. Collapsing everything is only an improvement if the choice
 * sticks — a section that re-collapses on every visit is a section you have to
 * re-open forever, which is worse than the wall of tables we started with.
 *
 * `localStorage`, not `sessionStorage`, for exactly that reason: the preference
 * is about how a person works, and it has to outlive the tab. Nothing here
 * leaves the browser and none of it is authoritative — a lost preference costs
 * one click, so every failure path falls back to the caller's default rather
 * than throwing.
 *
 * Kept out of the component because it is the one part of the section with a
 * rule in it, and a stored shape that outlives this layout is worth testing
 * rather than eyeballing once. (Same reasoning as `adminSections.ts`, which
 * guards the URL contract next door.)
 */

const STORAGE_KEY = 'kenworthy.admin.sections';

type OpenMap = Record<string, boolean>;

/**
 * Read the whole map.
 *
 * One key holding a map, rather than a key per section, so the preference can
 * be inspected and cleared in one move — a hundred `kenworthy.admin.section.*`
 * entries would be untraceable litter in a shared box-office browser.
 */
function readMap(): OpenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Anything that isn't a boolean was not written by us, or was written by an
    // older shape. Drop it rather than coercing: a truthy string would silently
    // pin a heavy section open.
    const clean: OpenMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') clean[key] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

/**
 * Whether `id` should start open.
 *
 * `defaultOpen` is the tab author's answer for a section nobody has touched;
 * a stored value always wins, including a stored `false` against a default of
 * `true`. That asymmetry is the whole point — deliberately closing the section
 * a tab opens by default is precisely the preference worth remembering.
 */
export function readSectionOpen(id: string, defaultOpen: boolean): boolean {
  const stored = readMap()[id];
  return typeof stored === 'boolean' ? stored : defaultOpen;
}

/** Remember `id`'s state. Best-effort: private-mode Safari throws on write. */
export function writeSectionOpen(id: string, open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readMap(), [id]: open };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* saving is a nicety, not a requirement */
  }
}

/** Forget every stored section state. Exported for tests and for a reset control. */
export function clearSectionState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}
