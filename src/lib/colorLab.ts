/**
 * Color Lab — the colour maths and the session store.
 *
 * This is a **decision tool, not the theming mechanism.** The real theme is the
 * HSL custom properties in `src/index.css`; the Lab only layers *inline*
 * overrides onto `document.documentElement` for the current tab, so the team can
 * audition a purple and a green against the whole real site before anyone
 * commits one. Nothing here is ever written back to `index.css`, to the DB, or
 * to the server.
 *
 * Blast radius, deliberately: `sessionStorage`. Per-tab, cleared when the tab
 * closes, never sent anywhere. A second browser — or an incognito window on the
 * same live URL — sees the shipped theme. Another visitor cannot be affected by
 * a choice made here, which is what makes it safe to leave switched on in
 * production while the colour story is being settled.
 *
 * The exit: once a purple and a green are chosen, someone pastes the rounded
 * `H S% L%` triplets the panel prints into `src/index.css` by hand, and the Lab
 * is switched off with `VITE_COLOR_LAB=false`. The session override never
 * silently becomes the real theme.
 *
 * The maths below is ported from `public/colorlab.html`, the standalone Lab this
 * replaces, with one deliberate change — see `pickForeground`.
 */

/**
 * Ratios are measured against the real page background, not pure black.
 * `--background: 0 0% 6%` is #0F0F0F, and using #000 here would flatter every
 * swatch by about 4%.
 */
export const LAB_BG = '#0F0F0F';

/** Off-black and cream, the only two text colours a filled control ever uses. */
const INK = { dark: '0 0% 6%', light: '38 30% 94%' } as const;
const INK_HEX = { dark: '#0F0F0F', light: '#F4F1EB' } as const;

export type Tier = 'pass' | 'large' | 'low';

export interface Swatch {
  name: string;
  hex: string;
  note: string;
  /** Contrast against LAB_BG, one decimal — the swatch used as *text*. */
  c: number;
  tier: Tier;
  /**
   * Contrast against the ink `pickForeground` would lay on it — the swatch used
   * as a *filled button*. A separate number from `c` because they answer
   * different questions, and a colour can pass one and fail the other:
   * Heritage Grape reads fine as a link (4.5:1 on black) but only manages
   * 4.2:1 carrying button text. Both matter now that purple and green are both
   * filled CTAs.
   */
  cInk: number;
  tierInk: Tier;
  /** Rounded triplet — the thing you paste into index.css. */
  hsl: string;
  /** Full-precision triplet — what we actually set, so the pixels match the hex. */
  hslCss: string;
}

// ---- contrast + colour maths (ported verbatim from public/colorlab.html) ----

export function lum(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const BG_L = lum(LAB_BG);

function contrast(aL: number, bL: number): number {
  const hi = Math.max(aL, bL);
  const lo = Math.min(aL, bL);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG contrast against the actual page background. */
export function contrastVsBg(hex: string): number {
  return contrast(lum(hex), BG_L);
}

export function tierFromC(c: number): Tier {
  return c >= 4.5 ? 'pass' : c >= 3 ? 'large' : 'low';
}

export function isHex(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

function toHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

/**
 * Two renderings of the same colour, for two different jobs:
 *  - `hslCss` keeps enough precision that the site paints the EXACT hex you
 *    picked, so the contrast number and the pixels never disagree.
 *  - `hsl` is the rounded triplet you would paste into index.css.
 * Both are derived; neither is typed by hand.
 */
export function hexToHslCss(hex: string): string {
  const { h, s, l } = toHsl(hex);
  return `${+h.toFixed(2)} ${+s.toFixed(2)}% ${+l.toFixed(2)}%`;
}

export function hexToHslToken(hex: string): string {
  const { h, s, l } = toHsl(hex);
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

/**
 * Which of the two inks to lay on a filled control.
 *
 * The standalone Lab used a luminance threshold (`lum > 0.4 ? dark : light`).
 * That was fine when it only tinted a mock; here it repaints real buttons, and
 * the threshold gets the shipped amethyst wrong — it picks cream (3.1:1) over
 * the off-black the theme actually ships (5.6:1), so merely *opening* the Lab
 * would have made every primary button harder to read than before anyone
 * touched a swatch. Comparing the two candidates by real contrast is derived
 * rather than tuned, and agrees with the shipped theme on the shipped colours.
 */
export function pickForeground(hex: string): string {
  const l = lum(hex);
  return contrast(l, lum(INK_HEX.dark)) >= contrast(l, lum(INK_HEX.light))
    ? INK.dark
    : INK.light;
}

/** The same choice as `pickForeground`, as a hex — for anything not a CSS var. */
export function pickForegroundHex(hex: string): string {
  return pickForeground(hex) === INK.dark ? INK_HEX.dark : INK_HEX.light;
}

/** How legible text on a *filled* control of this colour is. */
export function contrastVsInk(hex: string): number {
  return contrast(lum(hex), lum(pickForegroundHex(hex)));
}

/** Editorial fields are authored; every metric is derived. */
function withMetrics(d: { name: string; hex: string; note: string }): Swatch {
  const c = +contrastVsBg(d.hex).toFixed(1);
  const cInk = +contrastVsInk(d.hex).toFixed(1);
  return {
    ...d,
    c,
    tier: tierFromC(c),
    cInk,
    tierInk: tierFromC(cInk),
    hsl: hexToHslToken(d.hex),
    hslCss: hexToHslCss(d.hex),
  };
}

export function makeCustom(hex: string): Swatch {
  return withMetrics({ name: 'Custom', hex: hex.toUpperCase(), note: 'custom pick' });
}

// ---- the palettes ----------------------------------------------------------

/**
 * `SHIPPED_PURPLE` and `SHIPPED_GREEN` are the hex forms of what `index.css`
 * ships today (`--primary: 278 58% 64%`, `--success: 142 60% 42%`). They are the
 * initial selection, so opening the Lab changes nothing until a swatch is
 * clicked, and they are what Reset returns you to.
 *
 * Note for anyone reading the brief alongside this: the brief calls the current
 * `--success` "≈ #73A94C". It is not — it is the emerald below. #73A94C is the
 * olive *candidate* ("Antique Green"), one of the things being auditioned.
 */
export const SHIPPED_PURPLE = '#B16ED8';
export const SHIPPED_GREEN = '#2BAB5A';

export const PURPLES: Swatch[] = [
  { name: 'Amethyst', hex: SHIPPED_PURPLE, note: 'current --primary' },
  { name: 'Regal Violet', hex: '#9D61D1', note: 'core purple, matched to gold lightness' },
  { name: 'Marquee Purple', hex: '#B262DA', note: "closest to magenta's energy" },
  { name: 'Deep Orchid', hex: '#B654D4', note: 'warmest, purple/magenta border' },
  { name: 'Heritage Grape', hex: '#8D60C7', note: 'muted, sophisticated' },
  { name: 'Muted Plum', hex: '#8443B1', note: 'dark — large fills only' },
  { name: 'Old Magenta', hex: '#E42D8C', note: 'the previous colour, for reference' },
].map(withMetrics);

export const GREENS: Swatch[] = [
  { name: 'Current Emerald', hex: SHIPPED_GREEN, note: 'current --success' },
  { name: 'Antique Green', hex: '#73A94C', note: 'olive — best gold pairing' },
  { name: 'Sage Heritage', hex: '#81AF6A', note: 'muted olive-sage, analogous' },
  { name: 'Viridian', hex: '#39AC8F', note: 'deep teal, curtain-like' },
  { name: 'Emerald Marquee', hex: '#39C68B', note: 'richer emerald, not neon' },
  { name: 'Deep Fir', hex: '#388A6E', note: 'dark, for large fills' },
  // Carries cream text at 7.2:1, but is itself only 2.4:1 against the page —
  // as a CTA fill it reads as a dark shape rather than something that pops.
  // Offered, not shipped; the panel's two ratios show exactly this split.
  { name: 'Deep Pine', hex: '#125A51', note: 'very dark teal — quiet against black' },
  { name: 'Forest', hex: '#24604A', note: 'dark — needs white text' },
  { name: 'Bottle', hex: '#195738', note: 'darkest — needs white text' },
].map(withMetrics);

/** Shown beside the two adjustable colours: these are settled and never change. */
export const FIXED_SWATCHES = [
  { name: 'Gold', hex: '#D6A94A', token: '--accent' },
  { name: 'Cream', hex: '#F4F1EB', token: '--foreground' },
  { name: 'Off-black', hex: LAB_BG, token: '--background' },
] as const;

/** The prose under the swatches, ported from the standalone Lab. */
export function recommendation(purple: Swatch, green: Swatch): string {
  let msg = `${purple.name} (${purple.hex}, ${purple.c}:1) with ${green.name} (${green.hex}, ${green.c}:1). `;
  msg +=
    purple.c < 4.5
      ? '⚠️ This purple is below the 4.5:1 text floor — fine for large headlines and fills, but avoid it for buttons and small text. '
      : 'This purple clears the readability floor for text. ';
  if (purple.hex === '#E42D8C') msg += 'This is the old colour, shown for direct comparison. ';
  const greenHue = parseInt(green.hsl, 10);
  msg +=
    greenHue >= 70 && greenHue <= 135
      ? 'The olive/sage green shares the warm axis with the gold, so it blends into the heritage feel. '
      : 'The teal/emerald green contrasts the gold as a jewel tone — bolder, more "velvet curtain." ';
  if (green.c < 3)
    msg +=
      '⚠️ This green is very dark against the background — it works as a fill carrying white text, not as a colour for text or small badges. ';
  return msg;
}

// ---- the session store -----------------------------------------------------

const KEY = 'kenworthy.colorlab';

export interface LabState {
  /** Whether the floating panel is available at all this session. */
  on: boolean;
  /** null means "no override" — the stylesheet's own value stands. */
  purple: string | null;
  green: string | null;
}

export const OFF: LabState = { on: false, purple: null, green: null };

/**
 * Every custom property the purple drives, and every one the green drives.
 * `applyLabState` both sets and clears from these lists, so an override can
 * never be left behind on a token that Reset forgot about.
 */
const PURPLE_TOKENS = ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring', '--chart-1'];
const PURPLE_INK_TOKENS = ['--primary-foreground', '--sidebar-primary-foreground'];
const GREEN_TOKENS = ['--success', '--chart-3'];
const GREEN_INK_TOKENS = ['--success-foreground'];

export function readLabState(): LabState {
  if (typeof window === 'undefined') return OFF;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return OFF;
    const parsed = JSON.parse(raw) as Partial<LabState>;
    return {
      on: parsed.on === true,
      purple: typeof parsed.purple === 'string' && isHex(parsed.purple) ? parsed.purple : null,
      green: typeof parsed.green === 'string' && isHex(parsed.green) ? parsed.green : null,
    };
  } catch {
    // Private-mode Safari throws on sessionStorage; the Lab is a nicety, so it
    // simply stays shut rather than taking the page down with it.
    return OFF;
  }
}

export function writeLabState(state: LabState): void {
  try {
    if (!state.on) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* see readLabState */
  }
}

/**
 * Push a purple and a green onto the document, or take them off again.
 *
 * Deliberately knows nothing about *where* the colours came from. There are two
 * sources now — the per-tab Lab override and the superadmin-published site
 * theme (`src/lib/siteTheme.ts`) — and the precedence between them is resolved
 * by the caller before it gets here. Keeping that decision out of this function
 * is what stops the two layers from having to know about each other.
 *
 * Either argument may be null, meaning "no override for that colour". Clearing
 * removes the inline property rather than writing the shipped value back, so
 * `index.css` stays the single source of truth — reverting cannot drift away
 * from what the stylesheet says, because it never records what it said.
 */
export function applyTokens(purple: string | null, green: string | null): void {
  const s = document.documentElement.style;
  const paint = (tokens: string[], inks: string[], hex: string | null) => {
    if (hex && isHex(hex)) {
      const value = hexToHslCss(hex);
      const ink = pickForeground(hex);
      tokens.forEach(t => s.setProperty(t, value));
      inks.forEach(t => s.setProperty(t, ink));
    } else {
      [...tokens, ...inks].forEach(t => s.removeProperty(t));
    }
  };
  paint(PURPLE_TOKENS, PURPLE_INK_TOKENS, purple);
  paint(GREEN_TOKENS, GREEN_INK_TOKENS, green);
}

// ---- saved custom swatches -------------------------------------------------

/**
 * Custom picks the team wants to keep.
 *
 * `localStorage`, not `sessionStorage` — and the distinction is the point. The
 * *theme override* is per-tab and disposable on purpose; a saved swatch is a
 * scratchpad of candidate colours, and losing it every time a tab closes would
 * make it useless for a decision that takes days. It is still purely local:
 * nothing here is sent anywhere, and it changes no one else's site.
 */
const SAVED_KEY = 'kenworthy.colorlab.saved';
export type Channel = 'purple' | 'green';

type SavedMap = Record<Channel, string[]>;
const EMPTY_SAVED: SavedMap = { purple: [], green: [] };

export function readSaved(): SavedMap {
  if (typeof window === 'undefined') return EMPTY_SAVED;
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    if (!raw) return EMPTY_SAVED;
    const parsed = JSON.parse(raw) as Partial<Record<Channel, unknown>>;
    const clean = (v: unknown) =>
      Array.isArray(v) ? v.filter((h): h is string => typeof h === 'string' && isHex(h)) : [];
    return { purple: clean(parsed.purple), green: clean(parsed.green) };
  } catch {
    return EMPTY_SAVED;
  }
}

function writeSaved(next: SavedMap): void {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  } catch {
    /* private-mode Safari; saving is a nicety, not a requirement */
  }
}

/** Add a hex to a channel's saved list. Idempotent, newest last. */
export function saveSwatch(channel: Channel, hex: string): SavedMap {
  const current = readSaved();
  const up = hex.toUpperCase();
  if (!isHex(up) || current[channel].includes(up)) return current;
  const next = { ...current, [channel]: [...current[channel], up] };
  writeSaved(next);
  return next;
}

export function forgetSwatch(channel: Channel, hex: string): SavedMap {
  const current = readSaved();
  const next = { ...current, [channel]: current[channel].filter(h => h !== hex.toUpperCase()) };
  writeSaved(next);
  return next;
}

/** A saved hex rendered as a full Swatch, so it carries the same metrics. */
export function savedSwatch(hex: string): Swatch {
  return withMetrics({ name: 'Saved', hex: hex.toUpperCase(), note: 'saved custom pick' });
}
