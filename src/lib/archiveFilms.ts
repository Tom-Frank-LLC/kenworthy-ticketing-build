/**
 * The screened-films archive as a list of films, and searching it.
 *
 * `historical_screenings` has one row per screening date. The "Every film"
 * table (public on /history, and in Admin › Pages › Film Archive) shows one row
 * per film: same title and release year = same film, with every year it played
 * rolled up.
 *
 * Search used to match the title only, so typing a year ("1975") found films
 * with 1975 in their name rather than films shown that year. It now matches
 * every field the table knows about; see `matchesQuery`.
 */

export type ArchiveScreening = {
  id: string;
  year: number;
  film_title_display: string;
  film_year: number | null;
  /** The movie listing this screening belongs to, once the import has run. */
  matched_movie_id?: string | null;
};

/** Public metadata of a linked movie (archive_film_details()). */
export type FilmDetails = {
  genre: string | null;
  rating: string | null;
  director: string | null;
  cast_members: string | null;
};

export type FilmEntry = {
  key: string;
  title: string;
  filmYear: number | null;
  screenings: number;
  /** Distinct calendar years it played here, ascending. */
  years: number[];
  movieId: string | null;
  details: FilmDetails | null;
};

/** Group screenings into distinct films. */
export function rollUp(rows: ArchiveScreening[], details?: Map<string, FilmDetails>): FilmEntry[] {
  const map = new Map<string, FilmEntry>();
  for (const r of rows) {
    const title = r.film_title_display?.trim();
    if (!title) continue;
    const key = `${title.toLowerCase()}|${r.film_year ?? ''}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { key, title, filmYear: r.film_year, screenings: 0, years: [], movieId: null, details: null };
      map.set(key, entry);
    }
    entry.screenings++;
    if (!entry.years.includes(r.year)) entry.years.push(r.year);
    if (!entry.movieId && r.matched_movie_id) entry.movieId = r.matched_movie_id;
  }
  const out = [...map.values()];
  for (const e of out) {
    e.years.sort((a, b) => a - b);
    e.details = (e.movieId && details?.get(e.movieId)) || null;
  }
  // Chronological by the year the film first played here, oldest first. Titles
  // break ties, which is what orders the list when a single year is shown.
  return out.sort((a, b) => a.years[0] - b.years[0] || a.title.localeCompare(b.title));
}

/** Lower-case, accents off: "Amélie" is found by "amelie". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Does the film match every word of the query? Each word may match a
 * different field: title, release year, any year it played here, director,
 * cast or genre. "hitchcock 1950" finds Hitchcock films that played here in
 * the 1950s or were released then, and "197" finds the 1970s. A word that is
 * exactly the rating ("pg-13") matches the rating. The rating is compared
 * whole rather than searched as text, so "g" does not count as a G rating
 * merely because some field contains the letter.
 */
export function matchesQuery(film: FilmEntry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const d = film.details;
  const haystack = fold(
    [
      film.title,
      film.filmYear ?? '',
      film.years.join(' '),
      d?.director ?? '',
      d?.cast_members ?? '',
      d?.genre ?? '',
    ].join(' \u0001 '),
  );
  const rating = d?.rating ? fold(d.rating) : null;
  return words.every((w) => haystack.includes(w) || w === rating);
}

/** Render a year list compactly: consecutive runs collapse to "1954–1957". */
export function formatYears(years: number[]): string {
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
