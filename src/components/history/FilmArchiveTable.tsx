import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Film, Search, X } from 'lucide-react';

export type ArchiveScreening = {
  id: string;
  year: number;
  film_title_display: string;
  film_year: number | null;
};

/** One distinct film, with every year it played rolled up. */
type FilmEntry = {
  key: string;
  title: string;
  filmYear: number | null;
  screenings: number;
  years: number[];
};

const PAGE_SIZE = 25;

/** Group screenings into distinct films. Same title + release year = same film. */
function rollUp(rows: ArchiveScreening[]): FilmEntry[] {
  const map = new Map<string, FilmEntry>();
  for (const r of rows) {
    const title = r.film_title_display?.trim();
    if (!title) continue;
    const key = `${title.toLowerCase()}|${r.film_year ?? ''}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { key, title, filmYear: r.film_year, screenings: 0, years: [] };
      map.set(key, entry);
    }
    entry.screenings++;
    if (!entry.years.includes(r.year)) entry.years.push(r.year);
  }
  const out = [...map.values()];
  for (const e of out) e.years.sort((a, b) => a - b);
  // Chronological by the year the film first played here, oldest first. Titles break ties,
  // which is what orders the list when a single year is being shown.
  return out.sort((a, b) => a.years[0] - b.years[0] || a.title.localeCompare(b.title));
}

/** Render a year list compactly: consecutive runs collapse to "1954–1957". */
function formatYears(years: number[]): string {
  if (!years.length) return '';
  const runs: string[] = [];
  let start = years[0];
  let prev = years[0];
  for (let i = 1; i <= years.length; i++) {
    const y = years[i];
    if (y === prev + 1) {
      prev = y;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = y;
    prev = y;
  }
  return runs.join(', ');
}

export function FilmArchiveTable({
  rows,
  yearFilter,
  onClearYearFilter,
  query,
  onQueryChange,
}: {
  rows: ArchiveScreening[];
  yearFilter: number | null;
  onClearYearFilter: () => void;
  /** Controlled so the page-wide search can drop a title in here. This box still
   *  only ever filters the table — it never moves the timeline. */
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const [page, setPage] = useState(0);

  const films = useMemo(
    () => rollUp(yearFilter ? rows.filter((r) => r.year === yearFilter) : rows),
    [rows, yearFilter],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return films;
    return films.filter((f) => f.title.toLowerCase().includes(q));
  }, [films, query]);

  // Any change to the result set puts you back on the first page.
  useEffect(() => setPage(0), [query, yearFilter]);

  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = matches.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <section id="film-archive" className="scroll-mt-24">
      <div className="flex items-center gap-2 text-accent">
        <Film className="h-5 w-5" />
        <h2 className="font-display text-3xl md:text-4xl">Every film, 1926&ndash;2025</h2>
      </div>
      <p className="font-serif text-muted-foreground mt-2 max-w-2xl">
        Every title the Kenworthy is recorded as having screened, drawn from a century of
        newspaper listings and theater records. Search by title, or pick a year from the
        timeline above.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search films&hellip;"
            className="pl-9"
            aria-label="Search films in the Kenworthy archive"
          />
        </div>
        {yearFilter && (
          <Badge variant="secondary" className="gap-1.5 py-1.5 pl-3 pr-1.5">
            Showing {yearFilter}
            <button
              type="button"
              onClick={onClearYearFilter}
              className="rounded-full hover:bg-background/60 p-0.5"
              aria-label={`Clear the ${yearFilter} filter`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}
        <p className="text-sm text-muted-foreground">
          {matches.length.toLocaleString()} film{matches.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="mt-4 glass border border-border/60 rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Film</TableHead>
              <TableHead className="w-24">Released</TableHead>
              <TableHead className="w-28 text-right">Screenings</TableHead>
              <TableHead className="w-48">Years shown</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((f) => (
              <TableRow key={f.key}>
                <TableCell className="font-medium">{f.title}</TableCell>
                <TableCell className="text-muted-foreground">{f.filmYear ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{f.screenings}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatYears(f.years)}
                </TableCell>
              </TableRow>
            ))}
            {!visible.length && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                  {rows.length
                    ? 'No films match that search.'
                    : 'The film archive is still loading…'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {current + 1} of {pageCount.toLocaleString()}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
