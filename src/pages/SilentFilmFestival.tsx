import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEO } from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronRight, Download, FileText, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GREEN_CTA } from '@/lib/greenCta';
import { formatShowtime } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import {
  FESTIVAL_SLUG,
  groupProgramsByYear,
  selectFestivalLineup,
  stripLeadingShowtime,
  type FestivalProgram,
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
}

/** A screening's production, whichever of the three tables it lives in. */
function productionOf(screening: Screening): Production | null {
  return screening.movies ?? screening.events ?? screening.live_performances ?? null;
}

export default function SilentFilmFestival() {
  const [pass, setPass] = useState<FestivalPass | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [programs, setPrograms] = useState<FestivalProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // The archive does not depend on the pass, so it is fetched alongside
      // rather than after — a festival with no pass configured still has years
      // of programs to show.
      const passQuery = supabase
        .from('film_pass_types')
        .select('id, name, price, initial_balance, redemption_price')
        .eq('festival_slug', FESTIVAL_SLUG)
        .eq('is_active', true)
        .maybeSingle();

      const programQuery = supabase
        .from('festival_programs')
        .select('id, year, title, file_path, file_type, display_order, thumbnail_path')
        .eq('festival_slug', FESTIVAL_SLUG)
        .eq('is_published', true);

      const [{ data: passRow }, { data: programRows }] = await Promise.all([
        passQuery,
        programQuery,
      ]);
      if (cancelled) return;

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
  const archive = useMemo(() => groupProgramsByYear(programs), [programs]);

  // The newest year's first page, so the pane is never an empty box on arrival.
  const firstProgram = archive[0]?.programs[0] ?? null;
  useEffect(() => {
    if (!selectedId && firstProgram) setSelectedId(firstProgram.id);
  }, [selectedId, firstProgram]);

  const selected = useMemo(
    () => programs.find(p => p.id === selectedId) ?? null,
    [programs, selectedId],
  );
  const festivalYear = lineup.length
    ? new Date(lineup[0].start_time).getFullYear()
    : null;

  // The stored page is a ~2000px-wide scan, because a reader who clicks a
  // thumbnail wants a page they can actually read. The grid must not fetch that
  // — thirty of them is tens of megabytes — so the tile asks Supabase's image
  // transform endpoint for a thumbnail off the same object. One stored file
  // serves both sizes; nothing is uploaded twice.
  const publicUrl = (path: string) =>
    supabase.storage.from('festival-programs').getPublicUrl(path).data.publicUrl;

  const thumbUrl = (path: string, width: number) =>
    supabase.storage.from('festival-programs').getPublicUrl(path, {
      transform: { width, quality: 70 },
    }).data.publicUrl;

  /**
   * The little image on a row. An image program is its own thumbnail; a PDF
   * borrows the cover rendered for it at import. A PDF with no cover returns
   * null and the row draws a glyph instead — a missing cover must not cost the
   * reader the row.
   */
  const tileUrl = (program: FestivalProgram): string | null => {
    if (program.file_type === 'image') return thumbUrl(program.file_path, 160);
    return program.thumbnail_path ? thumbUrl(program.thumbnail_path, 160) : null;
  };

  /** The preview pane. Renders in place — nothing here opens a new tab. */
  const ProgramPreview = ({ program }: { program: FestivalProgram }) => {
    const label = program.title ?? `${program.year} program`;
    const alt = `${program.title ? `${program.title} — ` : ''}${program.year} Silent Film Festival program`;
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {program.file_type === 'image' ? (
            <img
              src={thumbUrl(program.file_path, 1200)}
              alt={alt}
              loading="lazy"
              decoding="async"
              className="w-full max-h-[70vh] object-contain bg-background"
            />
          ) : (
            /* The booklet, readable where it sits. The browser's own PDF
               viewer already gives page turning and zoom, so embedding it
               beats sending the reader somewhere else to get the same thing. */
            <iframe
              src={`${publicUrl(program.file_path)}#view=FitH`}
              title={alt}
              className="w-full h-[70vh] bg-background border-0"
            />
          )}
          <div className="flex items-center justify-between gap-3 p-4 border-t border-border">
            <div className="min-w-0">
              <p className="font-display uppercase tracking-[0.15em] text-xs text-primary">
                {program.year}
              </p>
              <p className="font-serif text-foreground truncate">{label}</p>
            </div>
            {/* The one link that still leaves the page, because saving a file
                is the thing a new tab is actually for. */}
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a href={publicUrl(program.file_path)} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-1" aria-hidden="true" />
                {program.file_type === 'pdf' ? 'Download PDF' : 'Full size'}
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

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
          <p className="font-serif text-lg md:text-xl text-muted-foreground leading-relaxed mt-5 max-w-2xl">
            {FESTIVAL_BLURB}
          </p>
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
                <Ticket className="h-8 w-8 text-success shrink-0" aria-hidden="true" />
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
              <div className="min-w-0 space-y-6 lg:max-h-[620px] lg:overflow-y-auto lg:pr-2">
                {archive.map((group) => (
                  <div key={group.year}>
                    <h3 className="font-display uppercase tracking-[0.25em] text-sm text-primary mb-3">
                      {group.year}
                    </h3>
                    <ul className="space-y-2">
                      {group.programs.map((program) => {
                        const isSelected = selected?.id === program.id;
                        const thumb = tileUrl(program);
                        return (
                          <li key={program.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(program.id)}
                              aria-current={isSelected ? 'true' : undefined}
                              className={cn(
                                'w-full text-left rounded-md border p-3 transition-colors flex items-center gap-3 group',
                                isSelected
                                  ? 'border-primary bg-primary/10'
                                  : 'border-accent/20 bg-card hover:border-primary/60 hover:bg-primary/5',
                              )}
                            >
                              {thumb ? (
                                <img
                                  src={thumb}
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
                                    'block font-serif text-base leading-snug truncate',
                                    isSelected ? 'text-primary' : 'group-hover:text-primary',
                                  )}
                                >
                                  {program.title ?? `${group.year} program`}
                                </span>
                                <span className="block text-xs uppercase tracking-widest text-muted-foreground mt-0.5">
                                  {program.file_type === 'pdf' ? 'Full programme · PDF' : 'Page'}
                                </span>
                              </span>
                              <ChevronRight
                                className="h-5 w-5 shrink-0 text-muted-foreground lg:hidden"
                                aria-hidden="true"
                              />
                            </button>

                            {/* Below lg the preview belongs with the row that
                                opened it, not in a column that is not there. */}
                            {isSelected && (
                              <div className="lg:hidden mt-3">
                                <ProgramPreview program={program} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              {selected && (
                <div className="hidden min-w-0 lg:block lg:sticky lg:top-4 lg:self-start">
                  <ProgramPreview program={selected} />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
