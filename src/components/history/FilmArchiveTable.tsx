import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatYears, matchesQuery, rollUp, type ArchiveScreening, type FilmDetails } from '@/lib/archiveFilms';
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

export type { ArchiveScreening } from '@/lib/archiveFilms';

const PAGE_SIZE = 25;

export function FilmArchiveTable({
  rows,
  details,
  filmHref,
  intro,
  loaded,
  yearFilter,
  onClearYearFilter,
  query,
  onQueryChange,
}: {
  rows: ArchiveScreening[];
  /** Genre, rating, director and cast by movie id (archive_film_details()). */
  details?: Map<string, FilmDetails>;
  /** When set, each linked film's title links here (the admin table opens the movie form). */
  filmHref?: (movieId: string) => string;
  /** Replaces the public introduction under the heading. */
  intro?: ReactNode;
  /** False while the archive is still being fetched; an empty table then means "loading", not "none". */
  loaded: boolean;
  yearFilter?: number | null;
  onClearYearFilter?: () => void;
  /** Controlled so the page-wide search can drop a title in here. This box only
   *  ever filters the table — it never moves the timeline. */
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const [page, setPage] = useState(0);

  const films = useMemo(
    () => rollUp(yearFilter ? rows.filter((r) => r.year === yearFilter) : rows, details),
    [rows, yearFilter, details],
  );

  const matches = useMemo(() => {
    if (!query.trim()) return films;
    return films.filter((f) => matchesQuery(f, query));
  }, [films, query]);

  // Any change to the result set puts you back on the first page.
  useEffect(() => setPage(0), [query, yearFilter]);

  // The span the archive actually covers, rather than a heading that goes stale.
  const span = useMemo(() => {
    if (!rows.length) return null;
    let lo = rows[0].year;
    let hi = rows[0].year;
    for (const r of rows) {
      if (r.year < lo) lo = r.year;
      if (r.year > hi) hi = r.year;
    }
    return { lo, hi };
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = matches.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <section id="film-archive" className="scroll-mt-24">
      <div className="flex items-center gap-2 text-accent">
        <Film className="h-5 w-5" />
        <h2 className="font-display text-3xl md:text-4xl">
          Every film{span ? <>, {span.lo}&ndash;{span.hi}</> : null}
        </h2>
      </div>
      <p className="font-serif text-muted-foreground mt-2 max-w-2xl">
        {intro ?? (
          <>
            Every title the Kenworthy is recorded as having screened, drawn from a century of
            newspaper listings and theater records. Search by title, year, director, cast or
            genre, or pick a year from the timeline above.
          </>
        )}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Title, year, director, cast, genre…"
            className="pl-9"
            aria-label="Search the Kenworthy film archive by title, year, director, cast or genre"
          />
        </div>
        {yearFilter && onClearYearFilter && (
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
                <TableCell>
                  {filmHref && f.movieId ? (
                    <Link to={filmHref(f.movieId)} className="font-medium underline hover:text-accent">
                      {f.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{f.title}</span>
                  )}
                  {f.details && <FilmCredits d={f.details} />}
                </TableCell>
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
                  {!loaded
                    ? 'The film archive is still loading…'
                    : rows.length
                      ? yearFilter
                        ? `No film shown in ${yearFilter} matches that search. Clear the ${yearFilter} filter to search every year.`
                        : 'No films match that search.'
                      : 'The film archive could not be loaded.'}
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

/** Director, cast and genre under the title, when anyone has filled them in. */
function FilmCredits({ d }: { d: FilmDetails }) {
  const parts = [
    d.director && `Directed by ${d.director}`,
    d.cast_members && `Starring ${d.cast_members}`,
    d.genre,
    d.rating,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="text-sm text-muted-foreground mt-0.5">{parts.join(' · ')}</p>;
}
