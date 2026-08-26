import { cn } from '@/lib/utils';

/**
 * Frames its children in the ring of bulbs from the Kenworthy's marquee.
 *
 * Purely ornamental: the bulbs carry no meaning that the content does not
 * already carry, so the whole ring is drawn in CSS pseudo-elements and the one
 * real node it needs is `aria-hidden`. Nothing here enters the reading order,
 * and the frame adds no contrast requirement of its own.
 *
 * The geometry lives in `.marquee-frame` in index.css — including why this is
 * CSS and not the source SVG. Override the band with the `--mq-band` custom
 * property if a caller needs a heavier or lighter ring:
 *
 *   <MarqueeFrame style={{ '--mq-band': '2.25rem' } as CSSProperties}>
 */
export function MarqueeFrame({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('marquee-frame', className)} {...rest}>
      {/* Carries the left and right runs on its own pseudo-elements. The
          wrapper's ::before/::after are already spent on top and bottom, and
          four runs need four boxes. */}
      <span className="marquee-frame__sides" aria-hidden="true" />
      {children}
    </div>
  );
}
