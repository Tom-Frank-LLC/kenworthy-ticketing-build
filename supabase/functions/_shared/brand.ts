// The brand palette, for email.
//
// THESE MIRROR THE DESIGN TOKENS IN `src/index.css`. When the site palette
// changes, update here — this file is the only place the emails get a colour.
//
// Why a copy rather than a reference: email clients do not support CSS custom
// properties (Gmail and Outlook both strip them), and there is no runtime link
// between the site's stylesheet and these Deno modules. `var(--primary)` in an
// email is simply a colour that does not render. So the structural equivalent of
// "one source of truth" is one shared module every template imports, which is
// what this is. A build step could generate this file from the CSS tokens for a
// literal single source; that is deliberately not done yet.
//
// The tokens in `src/index.css` are HSL triples. The hex here is the resolved
// value of each — e.g. `--primary: 278 58% 64%` resolves to #B16ED8. If you
// change a token, re-resolve it rather than eyeballing a near-enough hex.
//
// NOTE: the site palette is still being finalised (the Color Lab purple/green
// study). `primary` tracks whatever `--primary` resolves to and should be
// revisited when the final accent is chosen.

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The theatre's name.
 *
 * There is no leading "The" — it is "Kenworthy Performing Arts Centre", and
 * short-form it is "Kenworthy". Both forms live here so nothing has to remember
 * which one it wanted, and so the wrong one cannot creep back in one file at a
 * time. Anything patron-facing that names the theatre should import these:
 * emails, the .ics feed, SMS.
 */
export const VENUE_NAME = 'Kenworthy Performing Arts Centre';
export const VENUE_SHORT = 'Kenworthy';
export const BOX_OFFICE_ADDRESS = '508 S Main St, Moscow, ID 83843';

// ---------------------------------------------------------------------------
// Site origin — where email assets and patron links are served from
// ---------------------------------------------------------------------------

/**
 * The public origin. Lives here because the email logo has to be an absolute
 * URL and this is the module that owns brand assets; `deliver.ts` imports it so
 * there is only ever one default to go stale.
 */
export const SITE_URL =
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.env.get('SITE_URL') ||
  'https://kenworthy-ticketing-build.mrtomfrank.workers.dev';

/**
 * The wordmark, cream on transparent, 360px wide (displayed at 180px).
 *
 * Served from `public/` rather than `src/assets` because Vite content-hashes
 * everything under src, and an email sent last month must still resolve its
 * images today. Regenerate with `node scripts/make-email-logo.mjs`.
 */
export function logoUrl(siteUrl: string = SITE_URL): string {
  return `${siteUrl.replace(/\/$/, '')}/email-logo.png`;
}

/** Displayed width of the logo in the email header, in CSS pixels. */
export const LOGO_WIDTH = 180;
export const LOGO_HEIGHT = 43;

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

/**
 * Blend two hex colours. `t` is how far to travel from `a` to `b`.
 *
 * Here so the shades below are *derived* from the tokens rather than picked by
 * eye: changing `paper` moves every surface built on it, which is the whole
 * point of this module. sRGB blending, which is what a designer means by "a bit
 * lighter" and what the old hand-picked values approximated anyway.
 */
export function mix(a: string, b: string, t: number): string {
  const parse = (h: string) => {
    const v = parseInt(h.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Tokens — resolved 1:1 from src/index.css
// ---------------------------------------------------------------------------

const WHITE = '#FFFFFF';

/** `--background: 0 0% 6%` — the deep marquee black. */
const bg = '#0F0F0F';
/** `--foreground: 38 30% 94%` — cream, the text that sits on the black. */
const cream = '#F4F1EB';
/** `--card: 0 0% 9%` */
const card = '#171717';
/** `--primary: 278 58% 64%` — amethyst, the primary action colour. */
const primary = '#B16ED8';
/** `--primary-foreground: 0 0% 6%` — text on an amethyst button. */
const onPrimary = '#0F0F0F';
/** `--accent: 41 65% 56%` — century gold, for accents and dividers. */
const gold = '#D8AA46';
/** `--muted: 0 0% 14%` */
const mutedSurface = '#242424';
/** `--muted-foreground: 38 10% 65%` */
const mutedText = '#AFA89D';
/** `--border: 0 0% 16%` */
const borderDark = '#292929';
/** `--paper: 38 30% 92%` — the paper-program cream surface. */
const paper = '#F1ECE4';
/** `--paper-foreground: 0 0% 10%` — ink on paper. */
const ink = '#1A1A1A';

export const brand = {
  // --- Dark surfaces (the header band, matching the site's own background) ---
  bg,
  card,
  cream,
  mutedSurface,
  mutedText,
  borderDark,

  // --- Action colours -----------------------------------------------------
  primary,
  onPrimary,
  gold,

  // --- Paper surfaces -----------------------------------------------------
  //
  // The email body is the site's `--paper` surface rather than its black
  // background: a receipt is a document, QR codes need a light quiet zone to
  // scan, and every client's dark-mode heuristic mangles a dark email far more
  // readily than a light one. Paper is a real site token, not a compromise —
  // it is the same surface the site uses for editorial columns.
  paper,
  /** The card the message sits on, floating above `paper`. */
  surface: WHITE,
  /** Inset panels inside the card — callouts, the tax-receipt box. */
  panel: mix(paper, WHITE, 0.45),
  /** The footer band at the bottom of the card. */
  footerBand: mix(paper, WHITE, 0.72),
  /** Hairline rules between sections. */
  rule: mix(paper, ink, 0.06),
  /** Outline for secondary buttons on paper. */
  outline: mix(paper, ink, 0.2),

  // --- Ink on paper -------------------------------------------------------
  /** Headings and emphasis. */
  ink,
  /** Running body copy. */
  body: mix(ink, paper, 0.25),
  /** Secondary copy — labels, captions. */
  soft: mix(ink, paper, 0.45),
  /** Faint copy — legal lines, ticket codes. */
  faint: mix(ink, paper, 0.62),
} as const;

// ---------------------------------------------------------------------------
// Type faces
// ---------------------------------------------------------------------------
//
// Web fonts are not reliably available in email (Outlook ignores @font-face
// entirely), so these are the stacks the site's Fraunces/Inter pairing degrades
// to, stated once so every template degrades the same way.

export const serif = `Georgia,'Times New Roman',serif`;
export const sans = `Helvetica,Arial,sans-serif`;
export const mono = `'SFMono-Regular',Consolas,monospace`;
