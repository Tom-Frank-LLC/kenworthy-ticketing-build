import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEO } from '@/components/SEO';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import backstageLogo from '@/assets/backstage-logo.svg';
import {
  BACKSTAGE_BUCKET,
  backstageAltText,
  backstageParagraphs,
  orderBackstagePhotos,
  type BackstagePhoto,
} from '@/lib/backstage';

/**
 * Backstage — the room behind the room.
 *
 * An UNLISTED page, not a private one. There is exactly one link to it in the
 * whole site: the neon sign at the bottom of the home page. Anyone who has the
 * URL can read it, nothing here checks a session, and `noindex` on the SEO tag
 * is what keeps a door found by scrolling from becoming a search result. If
 * this ever needs to be genuinely gated, that is a different build — an RLS
 * change and an auth check, not a stronger secret.
 *
 * Visually it continues the teaser rather than restating it: same sign, same
 * warm lamp glow, same dim vignette, so clicking through feels like walking
 * into the room the sign was hanging outside of rather than landing on a
 * different site.
 *
 * The prose is a database row (backstage_page_content), not a string in this
 * file. The wording is Tom's and it will change; a paragraph that needs a
 * deploy to fix is a paragraph that stays wrong.
 */
export default function Backstage() {
  const [photos, setPhotos] = useState<BackstagePhoto[]>([]);
  const [body, setBody] = useState<string | null>(null);
  /** Photograph of the real sign. Null falls back to the drawn logo. */
  const [heroPath, setHeroPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Index into `photos` of the photograph open full size, or null. */
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Fetched together: neither half is worth a spinner of its own, and the
      // page has to settle into its final height in one step rather than
      // shuffling as each arrives.
      // Neither table is in the generated Supabase types yet, so both go
      // through the same `as any` that press_page_content and job_postings
      // already use. Regenerating types needs a live database connection this
      // build does not have.
      const [photoRes, copyRes] = await Promise.all([
        (supabase as any)
          .from('backstage_photos')
          .select('id, caption, file_path, display_order, created_at')
          .eq('is_published', true),
        (supabase as any)
          .from('backstage_page_content')
          .select('body_text, hero_path')
          .maybeSingle(),
      ]);

      if (cancelled) return;
      // A failure here is an empty gallery, not an error page. The room still
      // exists and the address at the bottom is still worth having.
      setPhotos(orderBackstagePhotos((photoRes.data ?? []) as BackstagePhoto[]));
      const copy = copyRes.data as { body_text: string | null; hero_path: string | null } | null;
      setBody(copy?.body_text ?? null);
      setHeroPath(copy?.hero_path ?? null);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const publicUrl = (path: string) =>
    supabase.storage.from(BACKSTAGE_BUCKET).getPublicUrl(path).data.publicUrl;

  /**
   * A resized copy, not the original.
   *
   * `resize: 'contain'` is load-bearing: Supabase defaults to 'cover', and
   * cover given only a width does not scale the image, it squashes it to that
   * width and keeps the original height. The festival archive shipped
   * horizontally compressed programmes before this was understood.
   */
  const thumbUrl = (path: string, width: number) =>
    supabase.storage.from(BACKSTAGE_BUCKET).getPublicUrl(path, {
      transform: { width, resize: 'contain', quality: 70 },
    }).data.publicUrl;

  const step = useCallback((delta: number) => {
    setLightbox(current => {
      if (current === null || photos.length === 0) return current;
      // Wraps: a gallery viewer that dead-ends at the last photograph makes
      // the reader close it and start again to see the first one.
      return (current + delta + photos.length) % photos.length;
    });
  }, [photos.length]);

  const open = lightbox !== null ? photos[lightbox] ?? null : null;
  const paragraphs = backstageParagraphs(body);

  /**
   * The page's own line, and its heading.
   *
   * Defined once because it appears in one of two places and never both: laid
   * over the foot of the photograph when there is one, and under the drawn sign
   * when there is not. Two copies of a page's <h1> is the kind of duplication
   * that ends with the two disagreeing.
   *
   * "behind the room" carries the primary token because that half is the whole
   * idea — the room is not the point, the fact that it is behind another one is.
   */
  const titleBlock = (
    <>
      {/* The gold eyebrow, in the slot the old "You found the door" had. It
          reads into the heading rather than standing alone — "Welcome to" /
          "The room behind the room." — so the two are one sentence and the
          smaller line is doing work rather than decorating. Kept a <p>: the
          global heading rule would uppercase an <h*> anyway, but this is not a
          heading and putting it in the outline would give the page two. */}
      <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent mb-3">
        Welcome to
      </p>
      <h1 className="font-display text-3xl md:text-5xl text-foreground">
        The room <span className="text-primary">behind the room</span>.
      </h1>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Backstage — The Kenworthy"
        description="Backstage is the Kenworthy's after-hours speakeasy in Moscow, Idaho — a room behind the room for private events, live music and late nights."
        path="/backstage"
        noindex
      />

      {/* ----------------------------------------------------- The sign */}
      {heroPath ? (
        /* The room, with the page's line laid over the foot of it — the same
           treatment as the festival page, and for the same reasons.

           It runs flush to the header: there is no top padding above it,
           because a band of empty page above a photograph that is meant to be
           the first thing there reads as a mistake. Full-bleed on a phone,
           container width from md up, and only the bottom corners rounded —
           the top edge has nothing left to be rounded against.

           The scrim is not decoration. The bottom of the neon photograph is
           dark but not uniformly so, and a title set straight onto it would be
           legible in this image and illegible in whichever one replaces it. */
        <section className="container max-w-5xl px-4">
          {/* No bottom margin: the section below brings its own top padding,
              and stacking the two left a band of empty page under the
              photograph almost as tall as the copy it was separating. */}
          <div className="relative -mx-4 md:mx-0 md:rounded-b-lg overflow-hidden">
            <img
              src={thumbUrl(heroPath, 1800)}
              /* Described rather than decorative: unlike the festival's shot of
                 the auditorium, this photograph is of the sign itself, and the
                 heading laid over it does not say the room's name. Without this
                 alt the name "Backstage" appears nowhere in the page's content. */
              alt="The Backstage neon sign, lit, above the bar"
              /* The hero is the content, not something below the fold. Every
                 other image on this page is lazy for exactly the opposite
                 reason. */
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="w-full h-[46vh] md:h-[56vh] object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/85 to-transparent pt-20 pb-8 md:pb-12 px-4 md:px-8">
              {titleBlock}
            </div>
          </div>
        </section>
      ) : (
        <section className="relative overflow-hidden border-b border-accent/20">
          {/* The teaser's lighting, carried through the door. Decorative, so it
              is inert to the pointer and invisible to a screen reader. Only the
              drawn sign needs it — a photograph brings its own light. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(ellipse at 78% 30%, hsl(var(--accent) / 0.18), transparent 55%), radial-gradient(ellipse at 20% 80%, hsl(var(--primary) / 0.10), transparent 60%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 40%, hsl(var(--background) / 0.85) 100%)',
            }}
          />

          <div className="relative container max-w-4xl py-20 md:py-28 text-center">
            {/* max-width rather than a fixed width: the sign is the widest thing
                on the page and a fixed 300px overflows a 320px phone once the
                container's own padding is taken out. */}
            <div className="relative mx-auto w-full max-w-[300px] md:max-w-[420px]">
              <div
                aria-hidden
                className="absolute -inset-8 rounded-full blur-3xl"
                style={{
                  background:
                    'radial-gradient(circle, hsl(41 65% 56% / 0.25), transparent 70%)',
                }}
              />
              <img
                src={backstageLogo}
                alt="Backstage"
                width={3012}
                height={1388}
                className="relative w-full [filter:drop-shadow(0_0_6px_hsl(333_90%_60%/0.85))_drop-shadow(0_0_18px_hsl(333_85%_55%/0.6))_drop-shadow(0_0_38px_hsl(333_80%_50%/0.45))_drop-shadow(0_8px_30px_rgba(0,0,0,0.6))]"
                decoding="async"
              />
            </div>

            <div className="mt-10">{titleBlock}</div>
          </div>
        </section>
      )}

      {/* -------------------------------------------- How it gets used */}
      {/* Both sections below sit in the same container so their headings share
          a left edge. The prose is narrowed inside it rather than by a tighter
          container, because a measure wide enough for a three-column grid is
          too wide to read a paragraph across. */}
      {paragraphs.length > 0 && (
        <section className="container max-w-5xl pt-16 md:pt-20" aria-labelledby="how-its-used">
          <h2
            id="how-its-used"
            className="font-display uppercase tracking-[0.2em] text-sm text-primary"
          >
            How the room gets used
          </h2>
          <div className="mt-6 max-w-2xl space-y-5">
            {paragraphs.map((paragraph, i) => (
              <p key={i} className="font-serif text-lg leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>

          {/* Backstage has been a rental option all along — `venue_area` on the
              request form has carried 'backstage_speakeasy' since before this
              page existed. This is the first place that says so out loud. */}
          <Button asChild variant="outline" className="mt-8">
            <Link to="/rental-request">Enquire about booking Backstage</Link>
          </Button>
        </section>
      )}

      {/* --------------------------------------------------- The gallery */}
      {/* Its own top padding rather than the section above's bottom padding,
          so the gallery is spaced correctly whether or not there is any copy
          above it — the copy can be cleared from the admin tab. */}
      <section
        className="container max-w-5xl pt-16 md:pt-20 pb-20 md:pb-28"
        aria-labelledby="past-events"
      >
        <h2
          id="past-events"
          className="font-display uppercase tracking-[0.2em] text-sm text-primary"
        >
          Nights that already happened
        </h2>

        {loading ? (
          <p className="font-serif text-muted-foreground mt-6" aria-busy="true">Loading…</p>
        ) : photos.length === 0 ? (
          // The page is reached by clicking a sign, so somebody is standing
          // here regardless of whether there are photographs yet.
          <p className="font-serif text-lg leading-relaxed text-muted-foreground mt-6 max-w-2xl">
            No photographs up yet. Come and see it in person instead — or ask us
            what it looks like with forty people in it.
          </p>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo, i) => (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => setLightbox(i)}
                  className="group block w-full overflow-hidden rounded-lg border border-accent/20 bg-card/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block aspect-[4/3] overflow-hidden">
                    <img
                      src={thumbUrl(photo.file_path, 800)}
                      alt={backstageAltText(photo)}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  </span>
                  {photo.caption && (
                    <span className="block px-4 py-3 text-left font-serif text-sm text-muted-foreground">
                      {photo.caption}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------- The address */}
      <footer className="border-t border-accent/20">
        <div className="container max-w-4xl py-10 text-center">
          <p className="font-serif italic text-muted-foreground inline-flex items-center gap-2">
            <MapPin className="h-4 w-4 text-accent" aria-hidden="true" />
            508 S Main St · Moscow, Idaho
          </p>
        </div>
      </footer>

      {/* ------------------------------------------------------- Lightbox */}
      <Dialog open={open !== null} onOpenChange={o => !o && setLightbox(null)}>
        <DialogContent
          className="max-w-5xl border-accent/20 bg-background/95 p-4 sm:p-6"
          onKeyDown={e => {
            if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
          }}
        >
          {/* Radix warns without both, and a lightbox has no visible heading —
              the photograph is the content. Its caption is the title, read out
              on open and hidden from sight because it is printed below anyway. */}
          <DialogTitle className="sr-only">
            {open ? backstageAltText(open) : 'Photograph'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {photos.length > 1
              ? `Photograph ${(lightbox ?? 0) + 1} of ${photos.length}. Use the left and right arrow keys to move between them.`
              : 'A photograph of an event in the Backstage speakeasy.'}
          </DialogDescription>

          {open && (
            <div className="relative">
              <img
                /* Full size, not the grid's 800px copy: this is the point of
                   opening it. Deliberately no key, so stepping through swaps
                   the src on one element rather than tearing down the <img>
                   and blanking the pane between photographs. */
                src={publicUrl(open.file_path)}
                alt={backstageAltText(open)}
                decoding="async"
                className="mx-auto max-h-[75vh] w-auto max-w-full rounded object-contain"
              />

              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous photograph"
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-border bg-background/80 p-2 text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next photograph"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-border bg-background/80 p-2 text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          )}

          {open?.caption && (
            <p className="text-center font-serif text-muted-foreground">{open.caption}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
