import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEO } from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, Ticket } from 'lucide-react';
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
        .select('id, year, title, file_path, file_type, display_order')
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
  const festivalYear = lineup.length
    ? new Date(lineup[0].start_time).getFullYear()
    : null;

  const publicUrl = (path: string) =>
    supabase.storage.from('festival-programs').getPublicUrl(path).data.publicUrl;

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
            <div className="space-y-10">
              {archive.map((group) => (
                <div key={group.year}>
                  <h3 className="font-display uppercase tracking-[0.25em] text-sm text-primary mb-4">
                    {group.year}
                  </h3>
                  <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {group.programs.map((program) => {
                      const href = publicUrl(program.file_path);
                      const label = program.title
                        ? `${program.title} — ${group.year} Silent Film Festival program`
                        : `${group.year} Silent Film Festival program`;
                      return (
                        <li key={program.id}>
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded border border-border hover:border-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors overflow-hidden bg-card"
                          >
                            {program.file_type === 'image' ? (
                              <img
                                src={href}
                                alt={label}
                                loading="lazy"
                                decoding="async"
                                className="w-full aspect-[3/4] object-cover"
                              />
                            ) : (
                              <span className="flex flex-col items-center justify-center gap-2 w-full aspect-[3/4] text-muted-foreground">
                                <FileText className="h-8 w-8" aria-hidden="true" />
                                <span className="font-display uppercase tracking-[0.15em] text-xs">
                                  PDF
                                </span>
                                <span className="sr-only">{label}</span>
                              </span>
                            )}
                            <span className="block px-3 py-2 font-serif text-sm text-foreground truncate">
                              {program.title ?? `${group.year} program`}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
