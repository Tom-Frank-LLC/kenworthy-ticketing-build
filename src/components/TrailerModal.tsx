import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { resolveTrailer } from '@/lib/trailer';

/**
 * A trailer, centered, with the rest of the page darkened behind it.
 *
 * This replaces the route the listings used to take: "Watch trailer" opened
 * ProductionDetailDrawer, a right-hand sheet that put the clip in a 512px
 * column beside the synopsis and the showtimes. A trailer is the one piece of
 * this site that wants the whole screen and no neighbours, so it gets a
 * lightbox instead.
 *
 * **The trigger is a child, not a callback, and that is load-bearing.** An
 * earlier version took `open` / `onOpenChange` and let the caller render its
 * own button. That silently broke focus return: Radix's modal Content calls
 * `preventDefault()` on close-auto-focus and then focuses its own
 * `DialogTrigger`, so with no trigger mounted the close handed focus to
 * `<body>` and a keyboard reader lost their place in the list. Wrapping the
 * button in `DialogTrigger` is what makes Esc put focus back where it started.
 *
 * The rest of the accessibility contract comes from Radix for free and
 * correctly: focus trapped while open, Esc closes, a click outside closes.
 * The shadcn `DialogContent` wrapper is deliberately *not* used — it hard-codes
 * `max-w-lg`, a border, padding and its own close button, all of which fight a
 * full-bleed 16:9 frame.
 *
 * Renders nothing at all — trigger included — when there is no trailer, so the
 * caller does not need a guard of its own.
 */
export function TrailerModal({
  title,
  trailerUrl,
  posterUrl,
  children,
}: {
  title: string;
  trailerUrl: string | null | undefined;
  posterUrl?: string | null;
  /** The button that opens it. Wrapped in `DialogTrigger asChild`. */
  children: ReactNode;
}) {
  if (!trailerUrl) return null;

  // Sound on, controls on, no loop. Autoplay because the reader clicked a
  // button that says "Watch trailer" — this is the explicit request, not
  // ambient motion, which is why it is not gated on prefers-reduced-motion the
  // way the home marquee's background clips are.
  //
  // Browsers may still refuse *unmuted* autoplay on a site with low media
  // engagement. The controls are what make that a one-click recovery rather
  // than a dead frame.
  const trailer = resolveTrailer(trailerUrl, {
    autoplay: true,
    muted: false,
    controls: true,
    loop: false,
  });

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogPortal>
        {/* Darker and blurred, unlike the default overlay: the point of this
            modal is that nothing else on the page competes with the clip. */}
        <DialogOverlay className="bg-black/90 backdrop-blur-sm" />
        {/* The frame is a video and a close button; there is no prose for
            `aria-describedby` to point at, and saying so explicitly is what
            stops Radix warning about the missing description. */}
        <DialogPrimitive.Content
          aria-label={`${title} trailer`}
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 focus:outline-none motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95"
          // Capped on *both* axes: 92vw keeps a margin on a phone, and
          // 85vh × 16/9 is the widest a 16:9 box can be before it grows taller
          // than the viewport on a laptop. Whichever binds first wins.
          style={{ width: 'min(92vw, calc(85vh * 16 / 9))' }}
        >
          {/* Radix requires a title for the dialog's accessible name. The
              frame is a video and nothing else, so it is announced rather than
              drawn. */}
          <DialogTitle className="sr-only">{title} — trailer</DialogTitle>

          {/* Above the frame, not on top of it: a glyph over the first frame
              of a trailer is unreadable about as often as it is readable, and
              this keeps the tap target clear of the video's own controls. */}
          <div className="mb-2 flex justify-end">
            <DialogPrimitive.Close className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white">
              <X className="h-5 w-5" />
              <span className="sr-only">Close trailer</span>
            </DialogPrimitive.Close>
          </div>

          {/* Unmounted when closed, which is what stops the audio — and what
              keeps a page of listings from opening an embed per production. */}
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-black shadow-2xl">
            {trailer?.kind === 'file' ? (
              <video
                src={trailer.src}
                poster={posterUrl ?? undefined}
                autoPlay
                controls
                playsInline
                className="h-full w-full object-contain"
              />
            ) : (
              // An unrecognised URL still gets an iframe attempt, matching
              // ProductionMedia — an admin pasting a host we do not parse yet
              // should see their embed, not an empty box.
              <iframe
                src={trailer?.src ?? trailerUrl}
                title={`${title} trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
