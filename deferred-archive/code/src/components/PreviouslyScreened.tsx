import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { History } from 'lucide-react';
import { format, parseISO } from 'date-fns';

/**
 * Renders a small "Previously at the Kenworthy" block under a Showing header
 * when the matched movie has historical screenings on record at the Kenworthy.
 */
export function PreviouslyScreened({ movieId }: { movieId: string | null | undefined }) {
  const [dates, setDates] = useState<string[]>([]);

  useEffect(() => {
    if (!movieId) { setDates([]); return; }
    (async () => {
      const { data } = await supabase
        .from('historical_screenings')
        .select('screening_date')
        .eq('matched_movie_id', movieId)
        .eq('venue_name', 'Kenworthy')
        .order('screening_date', { ascending: true });
      setDates((data ?? []).map((r: any) => r.screening_date));
    })();
  }, [movieId]);

  if (!dates.length) return null;

  const first = dates[0];
  const count = dates.length;
  // Group by year for compact display
  const byYear = new Map<number, string[]>();
  for (const d of dates) {
    const y = parseInt(d.slice(0, 4), 10);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(d);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);

  return (
    <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
      <div className="flex items-center gap-2 text-accent">
        <History className="h-4 w-4" />
        <p className="font-display text-sm uppercase tracking-wide">From the Kenworthy archive</p>
      </div>
      <p className="text-sm text-foreground/90 mt-1">
        Last played here on <strong>{format(parseISO(first), 'MMMM d, yyyy')}</strong>.{' '}
        {count > 1 ? `Screened ${count} times across ${years.length} year${years.length > 1 ? 's' : ''}: ${years.join(', ')}.` : ''}
      </p>
    </div>
  );
}