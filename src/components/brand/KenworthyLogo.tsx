import kenworthyStandardLogo from '@/assets/kenworthy-logo.svg';
import kenworthyMark from '@/assets/kenworthy-k.svg';
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
 *            silhouette, with the light spilling round it — the marquee
 *
 * `mask` and `WebkitMask` are both set: Safari still wants the prefix.
 */
export type MarkTreatment = 'filter' | 'white' | 'gold' | 'backlit';

const MASK_FILL: Record<Exclude<MarkTreatment, 'filter'>, string> = {
  white: 'bg-foreground',
  gold: 'bg-accent',
  // Not pure `--background`: against the glass bar (card at 80% over the page)
  // the two are close enough that the glyph loses its edge and the halo reads
  // as a smudge. A touch darker than the bar keeps the silhouette.
  backlit: 'bg-[hsl(0_0%_4%)]',
};

const MASK_GLOW: Record<Exclude<MarkTreatment, 'filter'>, string> = {
  white: '',
  gold: '[filter:var(--mark-glow)]',
  backlit: '[filter:var(--mark-backlight)]',
};

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
    // Painted, not drawn: the SVG is the mask and the token is the ink. Neither
    // span carries an accessible name — every placement wraps this in a link
    // that already has one.
    //
    // Two elements, and it has to be two: CSS applies `filter` *before* `mask`,
    // so a drop-shadow on the masked element is computed on the un-masked box
    // and then clipped back to the glyph by the very mask it was meant to
    // escape. The halo disappears, and it disappears quietly — it renders as a
    // slightly soft edge rather than as nothing, which is exactly the kind of
    // wrong that survives review. So the mask goes on the inner span and the
    // glow on the outer one, which has no mask to clip it.
    return (
      <span
        aria-hidden
        className={cn('inline-flex', MASK_GLOW[treatment], className)}
      >
        <span
          className={cn('block h-full aspect-[212/190]', MASK_FILL[treatment])}
          style={{
            maskImage: `url("${kenworthyMark}")`,
            WebkitMaskImage: `url("${kenworthyMark}")`,
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
          }}
        />
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
