import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatPlainDate } from '@/lib/datetime';

type Screening = { date: string; showingId: string | null };

/** Dates listed before "Show all". A handful of films played here 100+ times. */
const CAP = 30;

/**
 * Every time this film played at the Kenworthy, on an archival showing page.
 *
 * Each archive screening has its own archival showing, so each date is a link
 * to that date's page, and the one being viewed is marked. This is what makes
 * the page a listing for the film rather than for one night: whichever date a
 * visitor lands on, the film's whole run here is one click away.
 *
 * In place of PreviouslyScreened on archival pages, whose "last played here"
 * counts only the screenings before this one.
 */
export function ArchiveRun({ movieId, currentShowingId }: { movieId: string; currentShowingId: string }) {
  const [rows, setRows] = useState<Screening[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setShowAll(false);
    (async () => {
      // showings(id): the archival showing made for each row (one-to-one through
      // showings.historical_screening_id). The generated types predate that FK.
      const { data } = await (supabase.from('historical_screenings') as any)
        .select('screening_date, showings(id)')
        .eq('matched_movie_id', movieId)
        .eq('venue_name', 'Kenworthy')
        .order('screening_date')
        .limit(1000);
      if (cancelled) return;
      setRows(
        ((data ?? []) as { screening_date: string | null; showings: { id: string } | null }[])
          .filter((r) => r.screening_date)
          .map((r) => ({ date: r.screening_date as string, showingId: r.showings?.id ?? null })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  if (!rows?.length) return null;

  const first = rows[0].date.slice(0, 4);
  const last = rows[rows.length - 1].date.slice(0, 4);
  const shown = showAll ? rows : rows.slice(0, CAP);

  return (
    <section aria-labelledby="archive-run-heading" className="mt-4 rounded-lg border border-accent/40 bg-archive-band px-4 py-3">
      <h2 id="archive-run-heading" className="font-display text-sm uppercase tracking-wide text-accent">
        {rows.length === 1
          ? 'Played at the Kenworthy once'
          : `Played at the Kenworthy ${rows.length} times${first !== last ? `, ${first}–${last}` : ''}`}
      </h2>
      {rows.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((r, i) => {
            const label = formatPlainDate(r.date, 'MMM d, yyyy');
            const current = r.showingId === currentShowingId;
            return (
              <li key={`${r.date}-${i}`}>
                {current ? (
                  <span
                    aria-current="page"
                    className="inline-block rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground"
                  >
                    {label}
                  </span>
                ) : r.showingId ? (
                  <Link
                    to={`/showing/${r.showingId}`}
                    className="inline-block rounded-full border border-accent/40 px-2.5 py-0.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    {label}
                  </Link>
                ) : (
                  <span className="inline-block rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                    {label}
                  </span>
                )}
              </li>
            );
          })}
          {!showAll && rows.length > CAP && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="rounded-full px-2.5 py-0.5 text-xs text-accent underline underline-offset-2"
              >
                Show all {rows.length}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
