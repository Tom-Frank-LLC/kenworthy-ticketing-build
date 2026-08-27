/**
 * Genres, and the one place that decides what a genre string means.
 *
 * A production carries more than one genre — "Drama, Comedy", "Sci-Fi,
 * Thriller" — and they live where the DVD library already puts them: comma
 * separated, in the single `TEXT` column the schema already has. That is not a
 * shortcut around a join table. It is the convention already shipping in this
 * codebase (`Dvds.tsx` splits `dvds.genre` on comma to build its facet list and
 * to filter), and 1,456 DVDs are stored that way today. Matching it means no
 * migration, no new `anon` grant, and every existing single-genre row is
 * already a valid one-element list.
 *
 * The cost of that convention is that "the genre" is a *string* everywhere it
 * is read, and every reader has to split it the same way. When they don't, the
 * failure is quiet: `genreCounts["Drama, Comedy"]++` invents a bucket that is
 * neither Drama nor Comedy, and an exact-match filter (`m.genre === 'Drama'`)
 * simply stops matching the moment a second genre is added. So the splitting
 * lives here, once, and everything that displays, filters or counts a genre
 * comes through these functions.
 */

/** A genre with the number of things that carried it. */
export interface GenreCount {
  genre: string;
  count: number;
}

/**
 * The genres in a stored string, in the order they were entered.
 *
 * Trims each one, drops empties (so `"Drama, ,"` is just `["Drama"]`), collapses
 * runs of internal whitespace, and removes duplicates case-insensitively while
 * keeping the first spelling — "Drama, drama" is one badge, not two.
 */
export function parseGenres(value: string | null | undefined): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  const genres: string[] = [];
  for (const part of String(value).split(',')) {
    const genre = part.trim().replace(/\s+/g, ' ');
    if (!genre) continue;
    const key = genre.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    genres.push(genre);
  }
  return genres;
}

/**
 * The string to store for a list of genres, or `null` when there are none.
 *
 * `null` rather than `''` because that is what the forms already write for an
 * empty optional column, and because an empty string would read as a genre
 * everywhere `genre &&` guards a render.
 *
 * Normalisation runs through `parseGenres`, so a caller cannot store `", ,"`
 * or the same genre twice however messy the input was.
 */
export function formatGenres(genres: Iterable<string> | null | undefined): string | null {
  if (!genres) return null;
  const normalised = parseGenres(Array.from(genres).join(','));
  return normalised.length ? normalised.join(', ') : null;
}

/** Whether a stored genre string contains a given genre, ignoring case. */
export function hasGenre(value: string | null | undefined, genre: string): boolean {
  const wanted = genre.trim().toLowerCase();
  if (!wanted) return false;
  return parseGenres(value).some((g) => g.toLowerCase() === wanted);
}

/**
 * Count how often each genre appears across a set of stored strings, most
 * frequent first.
 *
 * A two-genre film credits *both* of its genres, which is the whole point: the
 * Mailchimp favourite-genre field and the admin genre chart both want "how
 * often did this patron pick a comedy", not "how often did they pick something
 * labelled exactly 'Drama, Comedy'".
 *
 * Buckets are case-insensitive with the first-seen spelling kept, so a stray
 * "sci-fi" does not split the Sci-Fi bucket in two. Ties break alphabetically
 * rather than by insertion order, so the same data always produces the same
 * winner.
 */
export function tallyGenres(values: Iterable<string | null | undefined>): GenreCount[] {
  const counts = new Map<string, GenreCount>();
  for (const value of values) {
    for (const genre of parseGenres(value)) {
      const key = genre.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { genre, count: 1 });
    }
  }
  return Array.from(counts.values()).sort(
    (a, b) => b.count - a.count || a.genre.localeCompare(b.genre),
  );
}

/** The single most common genre across a set of stored strings, or `null`. */
export function topGenre(values: Iterable<string | null | undefined>): string | null {
  return tallyGenres(values)[0]?.genre ?? null;
}

/**
 * Every distinct genre across a set of stored strings, alphabetical — the
 * facet list for a "filter by genre" dropdown.
 */
export function collectGenres(values: Iterable<string | null | undefined>): string[] {
  return tallyGenres(values)
    .map((entry) => entry.genre)
    .sort((a, b) => a.localeCompare(b));
}

/** Which starter list a form should offer. */
export type GenreKind = 'film' | 'live';

/**
 * Genres offered as suggestions before the data has any of its own.
 *
 * Three of 1,089 movies and none of 198 events carried a genre when this was
 * built, so a suggestion list drawn only from what staff had already typed
 * would start empty and suggest nothing on the day it shipped. These seed it.
 * They are suggestions, never a closed vocabulary — the input always accepts a
 * genre that is not on the list, because the Kenworthy programmes things no
 * standard taxonomy has a word for.
 */
export const FILM_GENRE_SUGGESTIONS: readonly string[] = [
  'Action', 'Adventure', 'Animation', 'Classic', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Family', 'Fantasy', 'Film Noir', 'History',
  'Horror', 'International', 'Musical', 'Mystery', 'Romance', 'Sci-Fi',
  'Silent', 'Thriller', 'War', 'Western',
];

/** The same, for events and live performances, which are booked differently. */
export const LIVE_GENRE_SUGGESTIONS: readonly string[] = [
  'Benefit', 'Bluegrass', 'Blues', 'Classical', 'Comedy', 'Community',
  'Country', 'Dance', 'Folk', 'Gala', 'Jazz', 'Lecture', 'Opera', 'Rock',
  'Theatre', 'Workshop',
];

export function genreSuggestionsFor(kind: GenreKind): readonly string[] {
  return kind === 'film' ? FILM_GENRE_SUGGESTIONS : LIVE_GENRE_SUGGESTIONS;
}
