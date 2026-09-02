import kenworthyStandardLogo from '@/assets/kenworthy-logo.svg';
import kenworthyMark from '@/assets/kenworthy-k.svg';
import kenworthyKLetter from '@/assets/kenworthy-k-letter.svg';
import kenworthyKArch from '@/assets/kenworthy-k-arch.svg';
import kenworthyKRays from '@/assets/kenworthy-k-rays.svg';
import kenworthyCentenaryLogo from '@/assets/KPAC-100-logo-white.svg';
import { isCentenary } from '@/lib/centenary';
import { cn } from '@/lib/utils';

/**
 * The Kenworthy lockup.
 *
 * Two pieces of artwork, chosen by date: the "Celebrating 100 Years" lockup
 * through the end of 2026, the standard wordmark from 2027. See
 * `src/lib/centenary.ts`. The email templates make the same switch on the same
 * date (`supabase/functions/_shared/brand.ts`), so the site and the mail a
 * patron receives never disagree about which lockup is current.
 *
 * The two files are opposite colours, which is why `TONE_CLASS` is keyed on
 * both tone *and* lockup rather than tone alone:
 *
 *   standard  — black on transparent, so it must be inverted to read on dark
 *   centenary — already white, so it must be inverted to read on *light*
 *
 * Getting that backwards renders the logo invisible rather than wrong-looking,
 * which is the kind of failure nobody notices in review.
 */
type LogoTone = 'on-dark' | 'on-light' | 'auto';
type LogoSize = 'header' | 'footer' | 'hero' | 'inline' | 'custom';

interface KenworthyLogoProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  tone?: LogoTone;
  alt?: string;
  /**
   * Responsive size preset. Each preset declares mobile-first heights
   * with sm/md/lg step-ups so the logo reads crisply at every breakpoint
   * without callers having to remember the scale.
   * Use `'custom'` and pass your own height classes via `className`.
   */
  size?: LogoSize;
}

const INVERT = '[filter:invert(1)_brightness(0.95)]';

const TONE_CLASS: Record<'standard' | 'centenary', Record<LogoTone, string>> = {
  // Black artwork: invert it on dark surfaces, leave it alone on light ones.
  standard: {
    'on-dark': INVERT,
    'on-light': '',
    auto: `dark:${INVERT}`,
  },
  // White artwork: the reverse.
  centenary: {
    'on-dark': '',
    'on-light': INVERT,
    auto: `[filter:invert(1)] dark:[filter:none]`,
  },
};

const SIZE_CLASS: Record<'standard' | 'centenary', Record<LogoSize, string>> = {
  standard: {
    // Sticky header — must clear the bar with breathing room.
    header: 'h-8 sm:h-9 md:h-10 lg:h-11',
    // Footer brand block — slightly larger, anchors the column.
    footer: 'h-12 sm:h-14 md:h-16',
    // Hero / splash placements — dominant but not overwhelming on phones.
    hero: 'h-16 sm:h-20 md:h-28 lg:h-36',
    // Inline w/ body copy — receipts, emails, small cards.
    inline: 'h-6 sm:h-7',
    custom: '',
  },
  // The centenary lockup fits a third line ("Celebrating 100 Years") into the
  // same artwork, so at a given height its wordmark is ~25% smaller than the
  // standard one's. Every preset is scaled up to compensate: the wordmark stays
  // the size a reader is used to and the extra line stays legible instead of
  // collapsing into a grey smudge. The header bar in Layout.tsx grows to match.
  centenary: {
    header: 'h-10 sm:h-11 md:h-12 lg:h-14',
    footer: 'h-14 sm:h-16 md:h-20',
    hero: 'h-20 sm:h-24 md:h-32 lg:h-44',
    inline: 'h-7 sm:h-9',
    custom: '',
  },
};

/** Intrinsic dimensions, so the browser reserves the right box before load. */
const INTRINSIC = {
  standard: { src: kenworthyStandardLogo, width: 2699, height: 551 },
  centenary: { src: kenworthyCentenaryLogo, width: 3072, height: 812 },
} as const;

export function KenworthyLogo({
  tone = 'on-dark',
  size = 'custom',
  className,
  alt = 'Kenworthy Performing Arts Centre',
  ...rest
}: KenworthyLogoProps) {
  const lockup = isCentenary() ? 'centenary' : 'standard';
  const art = INTRINSIC[lockup];

  return (
    <img
      src={art.src}
      alt={alt}
      width={art.width}
      height={art.height}
      loading="lazy"
      decoding="async"
      className={cn(
        'w-auto object-contain',
        SIZE_CLASS[lockup][size],
        TONE_CLASS[lockup][tone],
        className,
      )}
      {...rest}
    />
  );
}

/**
 * How the mark is painted.
 *
 * `filter` — today's treatment. Inverts the dark artwork so it reads on a dark
 * bar. It is also why the mark looks dusty: #414042 inverted and dimmed lands
 * on #B4B5B4, a neutral grey at 52% the luminance of the warm near-white
 * (#F4F1EB) it sits beside. The colour is *derived* from the artwork rather
 * than chosen, so it cannot match anything.
 *
 * The other three paint the glyph with a token instead, by using the SVG as a
 * mask rather than drawing it. That is the difference that matters: the fill
 * is then exactly `--foreground` or `--accent`, and it follows a re-theme
 * instead of drifting from one.
 *
 *   white    the warm near-white the body copy already uses, unlit
 *   gold     the brand gold, with the halo
 *   backlit  the glyph painted in the page's own black so it reads as a
 *            silhouette, with the light spilling round it
 *   marquee  backlit, but with the letter lit rather than cut out — the sign
 *            on Main Street, where the K is the bright thing and the housing
 *            around it is dark
 *   sunburst marquee with the rays lit too, so the housing is the only dark
 *            part of the mark
 *
 * `mask` and `WebkitMask` are both set: Safari still wants the prefix.
 */
export type MarkTreatment =
  | 'filter' | 'white' | 'gold' | 'backlit' | 'marquee' | 'sunburst';

/**
 * Each painted treatment is a stack of masked layers, back to front.
 *
 * Written as data rather than as branches because the mark decomposes into
 * exactly three pieces — rays, arch housing, letter — and every treatment is
 * some choice of which of them is lit. `sunburst` is the one that needs all
 * three; the rest are the same machinery with a shorter list.
 *
 * The arch layer uses the *solid* arch, not the artwork's arch-with-the-letter-
 * knocked-out, so a lit letter can simply sit on top of it. Painting the full
 * mark light and then covering the housing in dark would reach the same picture
 * with one fewer file, and was rejected: the two edges coincide exactly, so
 * antialiasing would blend a light fringe out from under a dark shape, which on
 * a 54px glyph reads as a defect rather than as a design.
 */
const INK = {
  lit: 'bg-foreground',
  gold: 'bg-accent',
  // Not pure `--background`: against the glass bar (card at 80% over the page)
  // the two are close enough that the glyph loses its edge and the halo reads
  // as a smudge. A touch darker than the bar keeps the silhouette.
  dark: 'bg-[hsl(0_0%_4%)]',
} as const;

const ART = {
  whole: kenworthyMark,
  rays: kenworthyKRays,
  arch: kenworthyKArch,
  letter: kenworthyKLetter,
} as const;

type Layer = { art: keyof typeof ART; ink: keyof typeof INK };

const MASK_LAYERS: Record<Exclude<MarkTreatment, 'filter'>, Layer[]> = {
  white: [{ art: 'whole', ink: 'lit' }],
  gold: [{ art: 'whole', ink: 'gold' }],
  backlit: [{ art: 'whole', ink: 'dark' }],
  marquee: [
    { art: 'whole', ink: 'dark' },
    { art: 'letter', ink: 'lit' },
  ],
  sunburst: [
    { art: 'rays', ink: 'lit' },
    { art: 'arch', ink: 'dark' },
    { art: 'letter', ink: 'lit' },
  ],
};

const MASK_GLOW: Record<Exclude<MarkTreatment, 'filter'>, string> = {
  white: '',
  gold: '[filter:var(--mark-glow)]',
  backlit: '[filter:var(--mark-backlight)]',
  marquee: '[filter:var(--mark-backlight)]',
  sunburst: '[filter:var(--mark-backlight)]',
};

const maskStyle = (src: string) => ({
  maskImage: `url("${src}")`,
  WebkitMaskImage: `url("${src}")`,
  maskRepeat: 'no-repeat' as const,
  WebkitMaskRepeat: 'no-repeat' as const,
  maskPosition: 'center' as const,
  WebkitMaskPosition: 'center' as const,
  maskSize: 'contain' as const,
  WebkitMaskSize: 'contain' as const,
});

/**
 * The mark's filter, tone by tone, with and without the halo.
 *
 * Eight whole class strings rather than one built from `INVERT` and a glow
 * fragment, because Tailwind cannot see a class name that is assembled at
 * runtime — the same constraint that makes Layout.tsx write out both header
 * heights. Keep the `invert(1) brightness(0.95)` here in step with `INVERT`
 * above; they are the same rule and the compiler cannot tell you when they
 * drift apart.
 *
 * `var(--mark-glow)` is defined in index.css so the halo's colour follows
 * `--accent` through a re-theme. It goes *after* the invert on purpose: put it
 * first and `invert(1)` turns the gold halo blue.
 */
const MARK_FILTER: Record<LogoTone, { plain: string; glow: string }> = {
  // Dark grey artwork: invert it on dark surfaces, leave it alone on light.
  'on-dark': {
    plain: '[filter:invert(1)_brightness(0.95)]',
    glow: '[filter:invert(1)_brightness(0.95)_var(--mark-glow)]',
  },
  'on-light': {
    plain: '',
    glow: '[filter:var(--mark-glow)]',
  },
  auto: {
    plain: 'dark:[filter:invert(1)_brightness(0.95)]',
    glow: '[filter:var(--mark-glow)] dark:[filter:invert(1)_brightness(0.95)_var(--mark-glow)]',
  },
};

/**
 * The "K" mark on its own — the letter inside its sunburst, without the
 * wordmark.
 *
 * A separate export rather than another `size` on the lockup, because it is a
 * different piece of artwork with different rules: there is no centenary
 * variant of it (the "Celebrating 100 Years" line only exists in the lockup),
 * and it is square-ish rather than a wide banner, so none of `SIZE_CLASS`
 * applies. What it *does* share is the inversion problem, which is why it lives
 * in this file and reuses `INVERT` rather than restating the filter somewhere
 * else and drifting.
 *
 * The artwork is dark grey (#414042) on transparent, so it follows the same
 * rule as the standard wordmark: invert it on dark surfaces, leave it alone on
 * light ones.
 *
 * `alt` defaults to empty because every placement so far sits next to the name
 * in text. Pass one where it is the only identification.
 *
 * `glow` lights it with the accent halo — see `--mark-glow` in index.css. Off
 * by default: it is for the phone header, where the mark is the only branding
 * on the bar and carries it alone. The sign-in card sits under a heading that
 * already says the name, and does not need it.
 */
export function KenworthyMark({
  tone = 'on-dark',
  glow = false,
  treatment = 'filter',
  className,
  alt = '',
  ...rest
}: Omit<KenworthyLogoProps, 'size'> & { glow?: boolean; treatment?: MarkTreatment }) {
  if (treatment !== 'filter') {
    const layers = MASK_LAYERS[treatment];
    // Every layer is a sibling, never nested. A mask clips its descendants too,
    // so a lit letter placed inside the masked housing would be trimmed to the
    // very hole it exists to fill and vanish completely. They all share the
    // wrapper's box and the one viewBox, so they register with no transform.
    //
    // The glow lives on the wrapper, which carries no mask of its own. CSS
    // applies `filter` before `mask`, so a drop-shadow on any masked element is
    // computed on the un-masked box and then clipped back to the glyph by the
    // mask it was meant to escape — it does not vanish, it comes out as a
    // faintly soft edge, which is the kind of wrong that survives review.
    //
    // Neither span carries an accessible name: every placement wraps this in a
    // link that already has one.
    return (
      <span
        aria-hidden
        className={cn('relative inline-flex', MASK_GLOW[treatment], className)}
      >
        {layers.map((layer, i) => (
          <span
            key={layer.art}
            className={cn(
              'block aspect-[212/190]',
              i === 0 ? 'h-full' : 'absolute inset-0',
              INK[layer.ink],
            )}
            style={maskStyle(ART[layer.art])}
          />
        ))}
      </span>
    );
  }

  return (
    <img
      src={kenworthyMark}
      alt={alt}
      width={212}
      height={190}
      loading="lazy"
      decoding="async"
      className={cn(
        'w-auto object-contain',
        MARK_FILTER[tone][glow ? 'glow' : 'plain'],
        className,
      )}
      {...rest}
    />
  );
}
