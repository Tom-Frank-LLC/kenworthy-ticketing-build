import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEO } from '@/components/SEO';
import { ProductionMedia } from '@/components/ProductionMedia';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, ChevronRight, Download, FileText, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GREEN_CTA } from '@/lib/greenCta';
import { passImageUrl } from '@/lib/passImage';
import { formatShowtime } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import { useIsSplitLayout } from '@/hooks/use-mobile';
import {
  FESTIVAL_SLUG,
  describeYear,
  groupProgramsByYear,
  selectFestivalLineup,
  slidePath,
  stripLeadingShowtime,
  type FestivalProgram,
  type FestivalYear,
} from '@/lib/festival';

/**
 * The Silent Film Festival's own page.
 *
 * Three sections that fail independently, which is the whole design constraint:
 * on the day this ships the archive is empty, the pass type does not exist in
 * film_pass_types yet, and only the screenings are real. Each section therefore
 * renders its own empty state and none of them can take the page down.
 *
 * The screenings are deliberately redundant with the calendar. A patron who
 * arrives looking for the festival should not have to reconstruct it out of a
 * month view, and the lineup here is not a second copy of that listing — it is
 * derived from pass_type_showings, so what the page advertises and what the
 * pass actually admits to are the same rows by construction.
 *
 * The pass is sold on /film-passes, not here. It is an ordinary row in
 * film_pass_types, so that page already lists it with no code that knows about
 * festivals; this page links across with the pass preselected. Rebuilding the
 * Square card form here would fork a working checkout to save one click.
 */

// ---------------------------------------------------------------------------
// EDITABLE COPY — Tom supplies the final wording.
// Nothing below this block reads these values; change them freely.
// ---------------------------------------------------------------------------
const FESTIVAL_NAME = 'The Kenworthy Silent Film Festival';
const FESTIVAL_BLURB =
  'Silent cinema as it was meant to be seen — on a big screen, in a full room, ' +
  'with live music. Each night pairs a restored classic with an original score ' +
  'performed in the auditorium.';
const ARCHIVE_BLURB =
  'Programs from previous festivals, scanned from the printed originals.';
// ---------------------------------------------------------------------------

interface Production {
  title: string;
  description?: string | null;
  poster_url?: string | null;
  duration_minutes?: number | null;
}

interface Screening {
  id: string;
  start_time: string;
  duration_minutes: number | null;
  is_active: boolean | null;
  movies: Production | null;
  events: Production | null;
  live_performances: Production | null;
}

interface FestivalPass {
  id: string;
  name: string;
  price: number;
  initial_balance: number;
  redemption_price: number;
  image_path: string | null;
}

const publicUrl = (path: string) =>
  supabase.storage.from('festival-programs').getPublicUrl(path).data.publicUrl;

const thumbUrl = (path: string, width: number) =>
  supabase.storage.from('festival-programs').getPublicUrl(path, {
    // `resize: 'contain'` is not decoration. Supabase defaults to 'cover', and
    // cover given only a width does not scale the image — it squashes it to
    // that width and keeps the original height. A 1980x3060 page came back
    // 1400x3060, so every programme rendered horizontally compressed.
    transform: { width, resize: 'contain', quality: 70 },
  }).data.publicUrl;

/** What a slide is actually fetched at. Kept here so preloading asks for the
 *  identical URL the <img> will ask for — a different width is a different
 *  object and the preload would warm the wrong one. */
const SLIDE_WIDTH = 1400;

/** A screening's production, whichever of the three tables it lives in. */
function productionOf(screening: Screening): Production | null {
  return screening.movies ?? screening.events ?? screening.live_performances ?? null;
}

/**
 * A year's programme, one page at a time.
 *
 * Images rather than an embedded PDF, and that is the whole point. The
 * browser's PDF viewer arrives with a toolbar offering to rotate, annotate,
 * download and summarise, none of which belongs on a scanned programme, and it
 * cannot be reliably suppressed — `#toolbar=0` is an Adobe convention Chrome
 * happens to honour and Firefox ignores. A slideshow of images has no controls
 * except the ones written here, so it is read-only because of what it is rather
 * than because something was hidden.
 *
 * Declared at module scope, not inside the page component. A component defined
 * inside another is a new function on every parent render, which React reads as
 * a different component type — it unmounts the old tree and mounts a fresh one,
 * so the slideshow would silently lose its page and reload its image any time
 * anything else on the page changed.
 */
function YearSlideshow({ entry }: { entry: FestivalYear }) {
  const [page, setPage] = useState(0);
  const total = entry.pages.length;

  // A new year opens at its cover, not at whatever page the last one reached.
  useEffect(() => { setPage(0); }, [entry.year]);

  const index = Math.min(page, Math.max(0, total - 1));

  // Warm the neighbours. Without this every click blanked the pane while the
  // next scan downloaded, which reads as the page reloading rather than as a
  // page turning. Browser cache does the rest: by the time the src changes the
  // bytes are already there, so the swap is immediate.
  useEffect(() => {
    if (total === 0) return;
    for (const offset of [1, -1]) {
      const neighbour = entry.pages[index + offset];
      const path = neighbour ? slidePath(neighbour) : null;
      if (path) {
        const img = new Image();
        img.src = thumbUrl(path, SLIDE_WIDTH);
      }
    }
  }, [entry, index, total]);

  const currentPage = total > 0 ? entry.pages[index] : null;
  // A booklet standing in as the only slide draws from its cover, not from the
  // PDF — see slidePath. No drawable image means the empty state, not a broken
  // <img>.
  const currentSrc = currentPage ? slidePath(currentPage) : null;
  const current = currentSrc ? currentPage : null;
  const go = (delta: number) =>
    setPage(p => Math.min(total - 1, Math.max(0, p + delta)));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* The year's own trailer, above its pages. Only when there is one: an
            empty 16:9 well above every programme would be worse than none. */}
        {entry.trailerUrl && (
          <div className="border-b border-border">
            <ProductionMedia
              title={`Silent Film Festival ${entry.year}`}
              type="event"
              trailerUrl={entry.trailerUrl}
              fallback="none"
            />
          </div>
        )}

        {/* A year with no scanned pages still has a booklet to hand over, so
            the footer below is outside this branch rather than inside it.
            Returning early here is what made the one programme in production
            unreachable: the message replaced the download alongside it. */}
        {!current ? (
          <div className="h-[60vh] lg:h-[72vh] flex flex-col items-center justify-center text-center px-6">
            <FileText className="h-10 w-10 mb-3 text-muted-foreground opacity-50" aria-hidden="true" />
            <p className="font-serif text-muted-foreground">
              This programme has not been scanned page by page yet.
            </p>
            {entry.booklet && (
              <p className="font-serif text-sm text-muted-foreground mt-2">
                The full booklet is available below.
              </p>
            )}
          </div>
        ) : (
        <div
          className="relative bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="group"
          aria-roledescription="carousel"
          aria-label={`${entry.year} Silent Film Festival programme`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
          }}
        >
          {/* The box keeps its height whatever the page is doing. Sizing to the
              image instead let the pane collapse for the moment between one
              scan going and the next arriving, and a pane that jumps is the
              other half of why this looked like a reload. */}
          <div className="h-[60vh] lg:h-[72vh] flex items-center justify-center">
            <img
              /* Deliberately no key: a key per page throws the element away and
                 builds a new one, so the browser starts from nothing every
                 click. Reusing one <img> and changing src lets a preloaded page
                 appear at once. */
              src={thumbUrl(currentSrc!, SLIDE_WIDTH)}
              alt={`Page ${index + 1} of the ${entry.year} Silent Film Festival programme`}
              /* The slide is the content, not something below the fold. */
              loading="eager"
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
          </div>

          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={index === 0}
                aria-label="Previous page"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 border border-border p-2 text-foreground disabled:opacity-30 disabled:cursor-not-allowed hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={index >= total - 1}
                aria-label="Next page"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 border border-border p-2 text-foreground disabled:opacity-30 disabled:cursor-not-allowed hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        )}

        <div className="flex items-center justify-between gap-3 p-4 border-t border-border">
          <div className="min-w-0">
            <p className="font-display uppercase tracking-[0.15em] text-xs text-primary">
              {entry.year}
            </p>
            <p className="font-serif text-foreground" aria-live="polite">
              {total > 1 ? `Page ${index + 1} of ${total}` : 'Programme'}
            </p>

          </div>
          {entry.booklet && (
            /* The one link that still leaves the page, because saving a file
               is what a new tab is actually for. */
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a
                href={publicUrl(entry.booklet.file_path)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="h-4 w-4 mr-1" aria-hidden="true" />
                Download PDF
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SilentFilmFestival() {
  const [pass, setPass] = useState<FestivalPass | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [programs, setPrograms] = useState<FestivalProgram[]>([]);
  const [trailers, setTrailers] = useState<ReadonlyMap<number, string | null>>(new Map());
  const [blurbs, setBlurbs] = useState<ReadonlyMap<number, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  // Which side of the split we are on decides where the slideshow *mounts*,
  // not just where it shows. Rendering both and hiding one with `lg:hidden`
  // put two copies in the DOM, and each one fetched its own page images.
  const isSplitLayout = useIsSplitLayout();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // The archive does not depend on the pass, so it is fetched alongside
      // rather than after — a festival with no pass configured still has years
      // of programs to show.
      const passQuery = supabase
        .from('film_pass_types')
        .select('id, name, price, initial_balance, redemption_price, image_path')
        .eq('festival_slug', FESTIVAL_SLUG)
        .eq('is_active', true)
        .maybeSingle();

      const programQuery = supabase
        .from('festival_programs')
        .select('id, year, title, file_path, file_type, display_order, thumbnail_path')
        .eq('festival_slug', FESTIVAL_SLUG)
        .eq('is_published', true);

      const yearQuery = supabase
        .from('festival_years')
        .select('year, trailer_url, blurb')
        .eq('festival_slug', FESTIVAL_SLUG);

      const [{ data: passRow }, { data: programRows }, { data: yearRows }] = await Promise.all([
        passQuery,
        programQuery,
        yearQuery,
      ]);
      if (cancelled) return;

      const years = (yearRows ?? []) as Array<{
        year: number; trailer_url: string | null; blurb: string | null;
      }>;
      setTrailers(new Map(years.map(r => [r.year, r.trailer_url] as const)));
      setBlurbs(new Map(years.map(r => [r.year, r.blurb] as const)));

      setPass((passRow as FestivalPass) ?? null);
      setPrograms((programRows as FestivalProgram[]) ?? []);

      // The lineup *is* what the pass admits to, so with no pass there is
      // nothing to list — not an error, just a year not set up yet.
      if (passRow?.id) {
        const { data: tagged } = await supabase
          .from('pass_type_showings')
          .select(
            'showings(id, start_time, duration_minutes, is_active, ' +
              'movies(title, description, poster_url, duration_minutes), ' +
              'events(title, description), ' +
              'live_performances(title, description))',
          )
          .eq('pass_type_id', passRow.id);

        if (!cancelled) {
          const rows = ((tagged ?? []) as unknown as Array<{ showings: Screening | null }>)
            .map((row) => row.showings)
            .filter((s): s is Screening => !!s && s.is_active !== false);
          setScreenings(rows);
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const lineup = useMemo(() => selectFestivalLineup(screenings), [screenings]);
  // One entry per festival rather than one per file: "the 2024 programme" is
  // what a reader came for, not twelve rows called Page N.
  const archive = useMemo(() => {
    const grouped = groupProgramsByYear(programs);
    // A year may have a trailer and no scans yet. Grouping only over programme
    // files would drop that year entirely, so years carrying a trailer are
    // folded in as empty groups; the slideshow then shows its "not scanned
    // yet" state beneath the trailer.
    const seen = new Set(grouped.map(g => g.year));
    const extra = [...trailers.entries()]
      .filter(([year, url]) => url && !seen.has(year))
      .map(([year]) => ({ year, programs: [] as FestivalProgram[] }));
    return [...grouped, ...extra]
      .sort((a, b) => b.year - a.year)
      .map(g => describeYear(g, trailers));
  }, [programs, trailers]);

  // The newest festival, so the pane is never an empty box on arrival.
  const newestYear = archive[0]?.year ?? null;
  useEffect(() => {
    if (selectedYear === null && newestYear !== null) setSelectedYear(newestYear);
  }, [selectedYear, newestYear]);

  const selected = useMemo(
    () => archive.find(a => a.year === selectedYear) ?? null,
    [archive, selectedYear],
  );
  const festivalYear = lineup.length
    ? new Date(lineup[0].start_time).getFullYear()
    : null;

  /**
   * The year the top of the page speaks for.
   *
   * Normally the year being sold. But copy and a trailer get written before the
   * lineup is tagged — that is the whole point of writing them early — and
   * keying the hero to the lineup alone would silently withhold both until the
   * screenings were linked to a pass. So it falls back to the newest year
   * anyone has actually written something about.
   */
  const heroYear = festivalYear ?? (() => {
    const written = [...blurbs.entries()]
      .filter(([, v]) => v)
      .map(([y]) => y)
      .concat([...trailers.entries()].filter(([, v]) => v).map(([y]) => y));
    return written.length ? Math.max(...written) : null;
  })();

  /** Resolved once, so the grid and the render cannot disagree about it. */
  const heroTrailer = heroYear ? trailers.get(heroYear) ?? null : null;

  // The stored page is a ~2000px-wide scan, because a reader who clicks a
  // thumbnail wants a page they can actually read. The grid must not fetch that
  // — thirty of them is tens of megabytes — so the tile asks Supabase's image
  // transform endpoint for a thumbnail off the same object. One stored file
  // serves both sizes; nothing is uploaded twice.


  return (
    <>
      <SEO
        title={`${FESTIVAL_NAME} | Kenworthy Performing Arts Centre`}
        description={FESTIVAL_BLURB}
        path="/silent-film-festival"
      />

      <div className="container mx-auto px-4 py-10 md:py-16 max-w-5xl">
        {/* ---------------------------------------------- Hero / about */}
        <header className="mb-12 md:mb-16">
          <h1 className="font-display uppercase text-3xl md:text-5xl tracking-[0.1em] text-foreground">
            {FESTIVAL_NAME}
          </h1>
          {festivalYear && (
            <p className="font-display uppercase tracking-[0.25em] text-sm text-primary mt-3">
              {festivalYear}
            </p>
          )}
          {/* Words and trailer side by side once there is room for both, and only
              then: the two-column grid is conditional on a trailer existing,
              because splitting the row when nothing fills the other half would
              leave the paragraph at half measure beside a void. Without one it
              keeps its full reading width. */}
          <div
            className={cn(
              'mt-5',
              heroTrailer && 'grid gap-6 lg:gap-10 lg:grid-cols-2 lg:items-center',
            )}
          >
            {/* This year's own words when someone has written them, the standing
                description when nobody has. A year with nothing written about it
                still reads as a finished page rather than as a gap. */}
            <p className="font-serif text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl whitespace-pre-line">
              {(heroYear && blurbs.get(heroYear)) || FESTIVAL_BLURB}
            </p>

            {/* Rendered by the block the production drawer and ticketing page
                already use, so a pasted YouTube or Vimeo link behaves here exactly
                as it does everywhere else. */}
            {heroTrailer && (
              <ProductionMedia
                title={`${FESTIVAL_NAME} ${heroYear}`}
                type="event"
                trailerUrl={heroTrailer}
                fallback="none"
              />
            )}
          </div>
        </header>

        {/* ------------------------------------------------- This year */}
        <section className="mb-14 md:mb-20" aria-labelledby="this-year">
          <h2
            id="this-year"
            className="font-display uppercase text-2xl md:text-3xl tracking-[0.15em] text-foreground mb-6"
          >
            This Year
          </h2>

          {/* The pass. Present only once someone has created the pass type and
              marked it with this festival's slug; until then the page simply
              does not advertise a pass, which is better than advertising one
              that cannot be bought. */}
          {pass && (
            <Card className="mb-8 border-success/40">
              <CardContent className="p-5 md:p-6 flex flex-col sm:flex-row sm:items-center gap-5">
                {pass.image_path ? (
                  <img
                    src={passImageUrl(pass.image_path)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-16 h-20 shrink-0 rounded object-cover border border-border bg-background"
                  />
                ) : (
                  <Ticket className="h-8 w-8 text-success shrink-0" aria-hidden="true" />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-display uppercase text-xl tracking-[0.1em]">
                    {pass.name}
                  </h3>
                  <p className="font-serif text-muted-foreground mt-1">
                    ${Number(pass.price).toFixed(2)} — good at every screening below.
                  </p>
                </div>
                <Button asChild className={cn('h-11 shrink-0', GREEN_CTA)}>
                  <Link to={`/film-passes?pass=${pass.id}`}>Buy the festival pass</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* The lineup. */}
          {loading ? (
            <p className="font-serif text-muted-foreground py-8">Loading…</p>
          ) : lineup.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="font-serif text-lg text-muted-foreground">
                  This year&rsquo;s lineup is coming soon.
                </p>
                <Button asChild variant="outline" className="mt-5">
                  <Link to="/calendar">See what&rsquo;s on now</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ul className="grid gap-4">
              {lineup.map((screening) => {
                const production = productionOf(screening);
                const passed = isPast(screening, production);
                const synopsis = stripLeadingShowtime(production?.description);
                return (
                  <li key={screening.id}>
                    <Card className={passed ? 'opacity-60' : undefined}>
                      <CardContent className="p-4 md:p-5 flex flex-col sm:flex-row gap-4 md:gap-5">
                        {production?.poster_url && (
                          <img
                            src={production.poster_url}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="w-full sm:w-24 h-40 sm:h-36 object-cover rounded border border-border shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-display uppercase tracking-[0.2em] text-xs text-primary">
                            {formatShowtime(screening.start_time, 'EEEE, MMMM d')}
                            {' · '}
                            {formatShowtime(screening.start_time, 'h:mm a')}
                          </p>
                          <h3 className="font-display uppercase text-lg md:text-xl mt-1.5">
                            {production?.title ?? 'Screening'}
                          </h3>
                          {synopsis && (
                            <p className="font-serif text-muted-foreground leading-relaxed mt-2 line-clamp-3">
                              {synopsis}
                            </p>
                          )}
                          <div className="mt-4">
                            {/* The rule is src/lib/purchasable.ts — a screening
                                that has finished keeps its place in the
                                programme but stops offering a seat. */}
                            {passed ? (
                              <p className="font-display uppercase tracking-[0.15em] text-xs text-muted-foreground">
                                This screening has passed
                              </p>
                            ) : (
                              <Button asChild className={cn('h-11', GREEN_CTA)}>
                                <Link to={`/showing/${screening.id}`}>
                                  Get Tickets
                                </Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* --------------------------------------------------- Archive */}
        <section aria-labelledby="archive">
          <h2
            id="archive"
            className="font-display uppercase text-2xl md:text-3xl tracking-[0.15em] text-foreground"
          >
            Past Programs
          </h2>
          <p className="font-serif text-muted-foreground mt-2 mb-6">{ARCHIVE_BLURB}</p>

          {loading ? (
            <p className="font-serif text-muted-foreground py-8">Loading…</p>
          ) : archive.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" aria-hidden="true" />
                <p className="font-serif text-lg text-muted-foreground">
                  Programs from past festivals will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            /* Same instrument the home page uses for showings: a list you pick
               from and a pane that fills in beside it. Below lg the pane moves
               under the selected row instead, because a sticky column with no
               room to sit is just a page you have to scroll past. */
            <div className="grid lg:grid-cols-[1fr_1.8fr] gap-6 lg:gap-10">
              <ul className="min-w-0 space-y-2 lg:max-h-[620px] lg:overflow-y-auto lg:pr-2">
                {archive.map((entry) => {
                  const isSelected = selected?.year === entry.year;
                  const cover = entry.coverPath ? thumbUrl(entry.coverPath, 160) : null;
                  return (
                    <li key={entry.year}>
                      <button
                        type="button"
                        onClick={() => setSelectedYear(entry.year)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={cn(
                          'w-full text-left rounded-md border p-3 transition-colors flex items-center gap-3 group',
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : 'border-accent/20 bg-card hover:border-primary/60 hover:bg-primary/5',
                        )}
                      >
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="w-12 h-16 object-cover rounded border border-border shrink-0 bg-background"
                          />
                        ) : (
                          <span className="w-12 h-16 shrink-0 rounded border border-border flex items-center justify-center text-muted-foreground">
                            <FileText className="h-5 w-5" aria-hidden="true" />
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span
                            className={cn(
                              'block font-display uppercase tracking-[0.15em] text-base',
                              isSelected ? 'text-primary' : 'group-hover:text-primary',
                            )}
                          >
                            {entry.year}
                          </span>
                          <span className="block text-xs uppercase tracking-widest text-muted-foreground mt-0.5">
                            {entry.pages.length > 1 ? `${entry.pages.length} pages` : 'Programme'}
                          </span>
                        </span>
                        <ChevronRight
                          className="h-5 w-5 shrink-0 text-muted-foreground lg:hidden"
                          aria-hidden="true"
                        />
                      </button>

                      {/* Below lg the slideshow belongs with the year that
                          opened it, not in a column that is not there. */}
                      {!isSplitLayout && isSelected && (
                        <div className="mt-3">
                          <YearSlideshow entry={entry} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {isSplitLayout && selected && (
                <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
                  <YearSlideshow entry={selected} />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
