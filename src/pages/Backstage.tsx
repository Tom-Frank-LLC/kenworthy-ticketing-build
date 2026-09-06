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
  orderBackstagePhotos,
  type BackstagePhoto,
} from '@/lib/backstage';
import { RichText } from '@/components/RichText';
import { isRichTextEmpty } from '@/lib/richText';

/** Widths the site's other heroes are cut at; see heroSrcSet below. */
const HERO_WIDTHS = [768, 1280, 1920] as const;

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

  /**
   * The hero at the same three widths the home, rentals and calendar heroes
   * ship, so a phone pulls a 768px copy rather than the 1800px one this page
   * used to send to everything. Those three cut their variants at build time
   * from a file in src/assets/; this photograph lives in the bucket so an
   * admin can replace it without a deploy, so the widths are cut on request
   * by the render endpoint instead. There is no <picture> with a webp source
   * because none is needed: the endpoint already answers in webp to any
   * browser that accepts it (verified against the live URL).
   */
  const heroSrcSet = (path: string) =>
    HERO_WIDTHS.map(w => `${thumbUrl(path, w)} ${w}w`).join(', ');

  const step = useCallback((delta: number) => {
    setLightbox(current => {
      if (current === null || photos.length === 0) return current;
      // Wraps: a gallery viewer that dead-ends at the last photograph makes
      // the reader close it and start again to see the first one.
      return (current + delta + photos.length) % photos.length;
    });
  }, [photos.length]);

  const open = lightbox !== null ? photos[lightbox] ?? null : null;
  const hasBody = !isRichTextEmpty(body);

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
      <p className="font-display uppercase tracking-[0.3em] text-xs sm:text-sm text-accent drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
        Welcome to
      </p>
      {/* Sizes, leading and shadows are CalendarHero's, so the two mastheads
          read as the same family — the drop-shadows are what keep the line
          legible over whatever photograph an admin uploads next, and they cost
          nothing over the drawn sign's plain background. */}
      <h1 className="mt-2 font-display uppercase tracking-wide text-[1.75rem] sm:text-3xl md:text-4xl lg:text-5xl leading-[1] sm:leading-[0.95] text-foreground drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
        The room <span className="text-primary">behind the room</span>
      </h1>
      <p className="mt-3 font-serif italic text-foreground/90 text-sm sm:text-base max-w-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
        Kenworthy's after-hours room for private events, live music and late nights.
      </p>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Backstage — The Kenworthy"
        description="Backstage is Kenworthy's after-hours speakeasy in Moscow, Idaho — a room behind the room for private events, live music and late nights."
        path="/backstage"
        noindex
      />

      {/* ----------------------------------------------------- The sign */}
      {heroPath || loading ? (
        /* The room, full of people, with the page's line laid over the foot of
           it. Built the way CalendarHero is built — same band heights, same
           object-cover fill, same bottom-weighted scrim, same gold hairline,
           same bottom-aligned copy — because three heroes built three
           different ways drift apart the first time any one of them is
           touched, and this one had already drifted: container width, rounded
           corners, a shorter band, its own scrim.

           It also renders while the row is still loading. The old layout
           showed the drawn sign until the fetch returned and then swapped in
           the photograph at a different height, which jolted the whole page
           on every visit. An empty band at the final height, that the
           photograph then fills, does not. The drawn sign is now only for the
           case it was meant for: a row with no photograph in it. */
        <section
          aria-label="Backstage at the Kenworthy"
          className="relative overflow-hidden border-b border-accent/25 bg-background min-h-[50vh] lg:min-h-[56vh] flex"
        >
          <div className="absolute inset-0">
            {heroPath && (
              <img
                src={thumbUrl(heroPath, 1280)}
                srcSet={heroSrcSet(heroPath)}
                sizes="100vw"
                /* Describes the photograph in the bucket today. The column has
                   no alt of its own (see the hero_path migration), so this line
                   is coupled to the upload and has to change with it. */
                alt="A full house in Backstage: the audience under the neon sign, a performer lit in red and blue on the small stage"
                /* The hero is the content, not something below the fold. Every
                   other image on this page is lazy for exactly the opposite
                   reason. */
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="h-full w-full object-cover"
                // Derived, as in CalendarHero. object-cover scales the picture
                // to the band's width, so on a laptop roughly a third of its
                // height has to be trimmed. The two things worth keeping — the
                // neon sign, just above the middle, and the performer, low on
                // the right — both sit in the lower half, and the top third is
                // ceiling. Anchoring well below centre takes most of the trim
                // off the ceiling: at 1280 the band shows roughly the 36%–88%
                // slice of the frame, which keeps the sign, the performer's
                // feet, and the crowd the copy sits over. Tuned by eye with
                // Tom: 62% still showed a band of rafters, 78% lost the
                // fringe of the drapes; 75% keeps a sliver of ceiling.
                style={{ objectPosition: 'center 75%' }}
              />
            )}
            {/* Bottom-weighted, like the calendar and home heroes: the crowd
                fills the bottom of the frame, which is where the copy sits,
                and the sign and the stage lights are up top, which stays
                nearly clear. */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, hsl(var(--background) / 0.3) 0%, hsl(var(--background) / 0.08) 28%, hsl(var(--background) / 0.4) 62%, hsl(var(--background) / 0.82) 85%, hsl(var(--background) / 0.95) 100%)',
              }}
            />
          </div>

          {/* gold hairline at the very top, like a marquee filament */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

          {/* Bottom-aligned: `mt-auto` on the copy pushes it into the crowd. */}
          <div className="container relative w-full flex flex-col py-8 sm:py-10 md:py-12">
            <div className="mt-auto max-w-2xl">{titleBlock}</div>
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
                    'radial-gradient(circle, hsl(var(--accent) / 0.25), transparent 70%)',
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
      {hasBody && (
        <section className="container max-w-5xl pt-16 md:pt-20" aria-labelledby="backstage-experience">
          <h2
            id="backstage-experience"
            className="font-display uppercase tracking-[0.2em] text-sm text-primary"
          >
            The Backstage experience
          </h2>
          <RichText
            html={body}
            className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-muted-foreground"
          />

          {/* Backstage has been a rental option all along — `venue_area` on the
              request form has carried 'backstage_speakeasy' since before this
              page existed. This is the first place that says so out loud.

              It used to point at /rental-request, which asked about projection,
              seating and Blu-ray players and read as a form for the auditorium
              somebody had landed on by mistake. Same form, same queue, scoped
              to this room: see the mode comment in RentalRequest. */}
          <Button asChild variant="outline" className="mt-8">
            <Link to="/backstage-enquiry">Enquire about booking Backstage</Link>
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
          The Backstage archive
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
