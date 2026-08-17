import { supabase } from '@/integrations/supabase/client';
import { applyTokens, isHex, readLabState } from '@/lib/colorLab';

/**
 * The published site theme — the Color Lab's other half.
 *
 * The Lab proper is a per-tab audition: `sessionStorage`, no server, incapable
 * of affecting another visitor. This module is the deliberate opposite. A
 * superadmin who has settled on a purple and a green can publish them to
 * `app_config.site_theme`, and every visitor gets them on their next load.
 *
 * Three rules keep the two from becoming one thing by accident:
 *
 *  1. **Publishing is superadmin-only, and enforced in the database.** The RLS
 *     policies on `app_config` (20260701183947) are what actually refuse; the
 *     UI only declines to draw a button. See
 *     `supabase/migrations/20260816174512_site_theme_public_read.sql`.
 *
 *  2. **The session override always wins.** Someone auditioning colours must
 *     not have the page yanked out from under them because a colleague
 *     published. Precedence is session → published → `index.css`.
 *
 *  3. **This layer is NOT gated on `VITE_COLOR_LAB`.** The flag hides the
 *     *editor*; the published theme is site configuration. Turning the Lab off
 *     must not silently revert the site's colours to the code defaults — that
 *     would make the flag a theme change, which is exactly the kind of
 *     surprise flags are supposed to prevent.
 *
 * Reverting clears the row rather than writing the shipped values back, so
 * `index.css` stays the single source of truth.
 */

export interface PublishedTheme {
  purple: string | null;
  green: string | null;
}

export const NO_THEME: PublishedTheme = { purple: null, green: null };

const KEY = 'site_theme';
/** Boot cache. Not authority — just what we last saw, to avoid a colour flash. */
const CACHE_KEY = 'kenworthy.sitetheme.cache';

function coerce(value: unknown): PublishedTheme {
  const v = (value ?? {}) as Partial<Record<keyof PublishedTheme, unknown>>;
  const one = (x: unknown) => (typeof x === 'string' && isHex(x) ? x.toUpperCase() : null);
  return { purple: one(v.purple), green: one(v.green) };
}

export function isEmpty(t: PublishedTheme): boolean {
  return !t.purple && !t.green;
}

function readCache(): PublishedTheme {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? coerce(JSON.parse(raw)) : NO_THEME;
  } catch {
    return NO_THEME;
  }
}

function writeCache(theme: PublishedTheme): void {
  try {
    if (isEmpty(theme)) window.localStorage.removeItem(CACHE_KEY);
    else window.localStorage.setItem(CACHE_KEY, JSON.stringify(theme));
  } catch {
    /* private mode; we just lose flash-prevention, not correctness */
  }
}

/**
 * Resolve the two layers and paint. Session override wins per colour, not
 * wholesale — auditioning a green while keeping the published purple is a
 * normal thing to want.
 */
export function applyEffectiveTheme(published: PublishedTheme): void {
  const lab = readLabState();
  const session = lab.on ? lab : NO_THEME;
  applyTokens(session.purple ?? published.purple, session.green ?? published.green);
}

/**
 * Paint from cache before React mounts.
 *
 * Without this every page load would show the code's colours for as long as the
 * `app_config` round-trip takes and then snap to the published ones — a visible
 * flash on every navigation for every visitor. The cache is only ever a guess
 * at what the server will say; `loadSiteTheme` reconciles a moment later and is
 * the authority.
 */
export function applyBootTheme(): void {
  try {
    applyEffectiveTheme(readCache());
  } catch {
    /* never let theming break boot */
  }
}

let cached: Promise<PublishedTheme> | null = null;
const subscribers = new Set<(t: PublishedTheme) => void>();

async function fetchTheme(): Promise<PublishedTheme> {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', KEY)
    .maybeSingle();
  // A failed read leaves the site on whatever index.css ships. That is the
  // right failure: the shipped theme is always a coherent design, whereas a
  // half-applied override would not be.
  if (error) return readCache();
  const theme = coerce(data?.value);
  writeCache(theme);
  return theme;
}

/** Shared across consumers — the value changes about as often as a rebrand. */
export function loadSiteTheme(): Promise<PublishedTheme> {
  if (!cached) cached = fetchTheme();
  return cached;
}

function broadcast(theme: PublishedTheme) {
  subscribers.forEach(fn => fn(theme));
}

export function subscribeSiteTheme(fn: (t: PublishedTheme) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Drop the cache, refetch, and push to every mounted consumer. */
export async function refreshSiteTheme(): Promise<PublishedTheme> {
  cached = null;
  const next = await loadSiteTheme();
  broadcast(next);
  return next;
}

/**
 * Publish, or revert.
 *
 * The write is an upsert because the row may never have existed; RLS supplies
 * both the INSERT and UPDATE halves for superadmins only. Reverting writes an
 * empty object rather than deleting the row — there is no DELETE policy on
 * `app_config`, and an empty theme means the same thing as no row.
 *
 * `.select()` is not decoration. A blocked write returns success with zero rows
 * rather than an error, so an admin who is not a superadmin would otherwise see
 * "published" and no change. Counting the returned rows is the only way to know
 * it actually landed.
 */
export async function publishSiteTheme(theme: PublishedTheme): Promise<PublishedTheme> {
  const value = { purple: theme.purple, green: theme.green };
  const { data, error } = await supabase
    .from('app_config')
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select('value');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('The write was refused — publishing the site theme is superadmin-only.');
  }
  const saved = coerce(data[0].value);
  writeCache(saved);
  cached = Promise.resolve(saved);
  broadcast(saved);
  return saved;
}

export function revertSiteTheme(): Promise<PublishedTheme> {
  return publishSiteTheme(NO_THEME);
}
