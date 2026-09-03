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
 * How the mark is coloured.
 *
 *   filter  the original inversion, still used by the sign-in card
 *   white   the glyph painted with `--foreground` through a mask — the phone
 *           header
 *
 * Five further painted treatments (gold, backlit, marquee, sunburst and
 * sunburst-gold — silhouettes and lit letterforms built from the artwork split
 * into rays, housing and letter) were built and compared on staging before
 * `white` was chosen. They are gone rather than left switched off: each needed
 * a derived SVG carrying a "regenerate me if the original is redrawn" warning,
 * and unused artwork with a maintenance obligation is the kind of thing that
 * rots quietly. They are in this branch's history if the question reopens.
 */
export type MarkTreatment = 'filter' | 'white';

/**
 * `white` paints the glyph instead of deriving its colour from the artwork.
 *
 * The artwork is #414042. Inverting it to read on a dark bar lands on #BEBFBD,
 * and dimming that to #B4B5B4 — a neutral grey at 52% the relative luminance of
 * the warm near-white (#F4F1EB) it sits beside. That is why the filtered mark
 * looks dusty, and why no amount of tuning the filter was going to fix it: the
 * colour was a by-product of the artwork rather than a choice.
 *
 * So use the SVG as a mask and let the token be the ink. The fill is then
 * exactly `--foreground` — the same near-white as the body copy — and it
 * follows a re-theme instead of drifting out of one, which is the reason
 * `.glow-primary` reads `var(--primary)` rather than the magenta it once
 * hardcoded.
 *
 * `mask` and `WebkitMask` are both set: Safari still wants the prefix.
 */
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
 * The mark's filter, tone by tone — the `filter` treatment.
 *
 * Whole class strings rather than one built from `INVERT`, because Tailwind
 * cannot see a class name that is assembled at runtime — the same constraint
 * that makes Layout.tsx write out both header heights. Keep the
 * `invert(1) brightness(0.95)` here in step with `INVERT` above; they are the
 * same rule and the compiler cannot tell you when they drift apart.
 */
const MARK_FILTER: Record<LogoTone, string> = {
  // Dark grey artwork: invert it on dark surfaces, leave it alone on light.
  'on-dark': '[filter:invert(1)_brightness(0.95)]',
  'on-light': '',
  auto: 'dark:[filter:invert(1)_brightness(0.95)]',
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
 * `treatment` picks how it is coloured. `filter` is the original inversion and
 * is still the default, because the sign-in card uses it. `white` paints the
 * glyph with `--foreground` through a mask, and is what the phone header uses
 * — see the note on `maskStyle` for why the two differ.
 */
export function KenworthyMark({
  tone = 'on-dark',
  treatment = 'filter',
  className,
  alt = '',
  ...rest
}: Omit<KenworthyLogoProps, 'size'> & { treatment?: MarkTreatment }) {
  if (treatment === 'white') {
    // Painted, not drawn: the SVG is the mask and the token is the ink. It
    // carries no accessible name — every placement wraps it in a link that
    // already has one.
    return (
      <span
        aria-hidden
        className={cn('block aspect-[212/190] bg-foreground', className)}
        style={maskStyle(kenworthyMark)}
      />
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
        MARK_FILTER[tone],
        className,
      )}
      {...rest}
    />
  );
}
