import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { History } from 'lucide-react';
import { formatPlainDate } from '@/lib/datetime';
import { normalizeTitle } from '@/lib/normalizeTitle';
import { summarizeScreenings, type ScreeningHistory } from '@/lib/screeningHistory';

/**
 * "From the Kenworthy archive" on a film's showing page: when it last played
 * here, how often, and — when it has been away for decades — that it is back.
 *
 * Reads the archive rows tied to this movie (historical_screenings.matched_movie_id,
 * set by import_archive_listings). A listing made *after* the import for a film
 * the archive already knew is not tied to it; for that case it also looks the
 * film up by title, but only when the listing carries a release year to match,
 * because by title alone a remake would claim the original's history.
 */
export function PreviouslyScreened({
  movieId,
  title,
  releaseYear,
  showingDay,
}: {
  movieId: string;
  title: string | null | undefined;
  releaseYear: number | null | undefined;
  /** This showing's date in the theatre's time zone, YYYY-MM-DD. */
  showingDay: string;
}) {
  const [history, setHistory] = useState<ScreeningHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    (async () => {
      const read = (q: any) =>
        q.eq('venue_name', 'Kenworthy').lt('screening_date', showingDay).order('screening_date').limit(1000);
      let { data } = await read(
        supabase.from('historical_screenings').select('screening_date').eq('matched_movie_id', movieId),
      );
      if (!data?.length && title && releaseYear) {
        ({ data } = await read(
          supabase
            .from('historical_screenings')
            .select('screening_date')
            .eq('film_title_normalized', normalizeTitle(title))
            .eq('film_year', releaseYear),
        ));
      }
      if (cancelled) return;
      setHistory(summarizeScreenings((data ?? []).map((r: any) => r.screening_date), showingDay));
    })();
    return () => { cancelled = true; };
  }, [movieId, title, releaseYear, showingDay]);

  if (!history) return null;

  const lastYear = Number(history.last.slice(0, 4));
  const firstYear = Number(history.first.slice(0, 4));

  return (
    <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
      <div className="flex items-center gap-2 text-accent">
        <History className="h-4 w-4" aria-hidden="true" />
        <p className="font-display text-sm uppercase tracking-wide">From the Kenworthy archive</p>
      </div>
      {history.longAbsence ? (
        <p className="mt-1 font-display text-lg">
          Back on our screen for the first time in {history.yearsSince} years.
        </p>
      ) : null}
      <p className="text-sm mt-1">
        Last played here on <strong>{formatPlainDate(history.last)}</strong>
        {history.yearsSince >= 1 ? ` — ${history.yearsSince} year${history.yearsSince === 1 ? '' : 's'} ago` : ''}.
        {firstYear !== lastYear
          ? ` First shown here in ${firstYear}; on the bill in ${history.years.length} different years.`
          : history.count > 1
            ? ` It played ${history.count} times that year.`
            : ''}
      </p>
      <p className="text-sm mt-1">
        <Link to="/history" className="underline underline-offset-2 hover:text-accent">
          A century of films at the Kenworthy
        </Link>
      </p>
    </div>
  );
}
