import kenworthyFullLogoAsset from '@/assets/kpac100-white.png.asset.json';
import { cn } from '@/lib/utils';

/**
 * Source artwork is black-on-transparent. The site's default surface is
 * the deep marquee black, so we invert the artwork to read as cream/white.
 * Pass `tone="on-light"` anywhere the logo sits on a pale surface
 * (e.g. printed receipts, light-themed emails, future light cards) so it
 * renders in its natural black form. `tone="auto"` follows the `.dark`
 * class on <html> for sites that toggle themes.
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

const TONE_CLASS: Record<LogoTone, string> = {
  // The KPAC100 artwork is already white-on-transparent, so no inversion
  // is needed on dark surfaces. On light surfaces we invert to black.
  'on-dark': '',
  'on-light': '[filter:invert(1)_brightness(0.95)]',
  auto: 'dark:[filter:invert(0)] [filter:invert(1)_brightness(0.95)]',
};

const SIZE_CLASS: Record<LogoSize, string> = {
  // Sticky header — must clear the 68px bar with breathing room.
  header: 'h-8 sm:h-9 md:h-10 lg:h-11',
  // Footer brand block — slightly larger, anchors the column.
  footer: 'h-12 sm:h-14 md:h-16',
  // Hero / splash placements — dominant but not overwhelming on phones.
  hero: 'h-16 sm:h-20 md:h-28 lg:h-36',
  // Inline w/ body copy — receipts, emails, small cards.
  inline: 'h-6 sm:h-7',
  // Caller controls height entirely.
  custom: '',
};

export function KenworthyLogo({
  tone = 'on-dark',
  size = 'custom',
  className,
  alt = 'The Kenworthy Performing Arts Centre',
  ...rest
}: KenworthyLogoProps) {
  return (
    <img
      src={kenworthyFullLogoAsset.url}
      alt={alt}
      width={768}
      height={203}
      loading="lazy"
      decoding="async"
      className={cn('w-auto object-contain', SIZE_CLASS[size], TONE_CLASS[tone], className)}
      {...rest}
    />
  );
}