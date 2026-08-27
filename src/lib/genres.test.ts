import { describe, it, expect } from 'vitest';
import {
  collectGenres,
  formatGenres,
  hasGenre,
  parseGenres,
  tallyGenres,
  topGenre,
} from './genres';

describe('parseGenres', () => {
  it('reads a single genre as a one-element list', () => {
    // Every row in the database when this shipped was a single genre, and they
    // all have to keep working untouched.
    expect(parseGenres('Drama')).toEqual(['Drama']);
  });

  it('splits a comma-separated string', () => {
    expect(parseGenres('Drama, Comedy')).toEqual(['Drama', 'Comedy']);
  });

  it('tolerates missing and empty values', () => {
    expect(parseGenres(null)).toEqual([]);
    expect(parseGenres(undefined)).toEqual([]);
    expect(parseGenres('')).toEqual([]);
    expect(parseGenres('   ')).toEqual([]);
  });

  it('drops empties from a messy string rather than making blank genres', () => {
    expect(parseGenres(' Drama ,, , Comedy ,')).toEqual(['Drama', 'Comedy']);
  });

  it('collapses runs of internal whitespace', () => {
    expect(parseGenres('Film   Noir')).toEqual(['Film Noir']);
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseGenres('Drama, drama, DRAMA')).toEqual(['Drama']);
  });
});

describe('formatGenres', () => {
  it('joins with a comma and a space', () => {
    expect(formatGenres(['Drama', 'Comedy'])).toBe('Drama, Comedy');
  });

  it('stores null for nothing, so a render guard still works', () => {
    // `genre &&` guards a badge in several places; '' would render an empty one.
    expect(formatGenres([])).toBeNull();
    expect(formatGenres(null)).toBeNull();
    expect(formatGenres(['', '  '])).toBeNull();
  });

  it('normalises on the way in, so junk cannot reach the column', () => {
    expect(formatGenres([' Drama ', 'drama', '', 'Comedy'])).toBe('Drama, Comedy');
  });

  it('round-trips through parseGenres', () => {
    expect(parseGenres(formatGenres(['Sci-Fi', 'Thriller']))).toEqual(['Sci-Fi', 'Thriller']);
  });
});

describe('hasGenre', () => {
  it('matches one genre inside a multi-genre string', () => {
    // The bug this exists to prevent: `m.genre === 'Comedy'` is false here, so
    // an admin filtering by Comedy silently loses the film.
    expect(hasGenre('Drama, Comedy', 'Comedy')).toBe(true);
  });

  it('ignores case and surrounding space', () => {
    expect(hasGenre('Drama, Comedy', ' comedy ')).toBe(true);
  });

  it('does not match on a substring', () => {
    expect(hasGenre('Romance', 'Roman')).toBe(false);
  });

  it('is false for missing genres and empty queries', () => {
    expect(hasGenre(null, 'Drama')).toBe(false);
    expect(hasGenre('Drama', '')).toBe(false);
  });
});

describe('tallyGenres', () => {
  it('credits every genre of a multi-genre production', () => {
    expect(tallyGenres(['Drama, Comedy', 'Drama'])).toEqual([
      { genre: 'Drama', count: 2 },
      { genre: 'Comedy', count: 1 },
    ]);
  });

  it('does not invent a combined bucket', () => {
    const tally = tallyGenres(['Drama, Comedy']);
    expect(tally.map(e => e.genre)).not.toContain('Drama, Comedy');
  });

  it('merges spellings that differ only in case', () => {
    expect(tallyGenres(['Sci-Fi', 'sci-fi'])).toEqual([{ genre: 'Sci-Fi', count: 2 }]);
  });

  it('skips missing values', () => {
    expect(tallyGenres([null, undefined, '', 'Drama'])).toEqual([{ genre: 'Drama', count: 1 }]);
  });

  it('breaks ties alphabetically, so the same data always ranks the same', () => {
    expect(tallyGenres(['Western', 'Action']).map(e => e.genre)).toEqual(['Action', 'Western']);
  });
});

describe('topGenre', () => {
  it('picks the most-credited genre, not the most common string', () => {
    // Two Drama/Comedy tickets and three Drama ones: counting raw strings would
    // crown "Drama, Comedy", a genre nobody has ever programmed.
    const tickets = ['Drama, Comedy', 'Drama, Comedy', 'Drama', 'Drama', 'Drama'];
    expect(topGenre(tickets)).toBe('Drama');
  });

  it('is unchanged for single-genre data', () => {
    expect(topGenre(['Horror', 'Horror', 'Drama'])).toBe('Horror');
  });

  it('is null when nothing has a genre', () => {
    expect(topGenre([null, undefined, ''])).toBeNull();
  });
});

describe('collectGenres', () => {
  it('builds an alphabetical facet list out of multi-genre strings', () => {
    expect(collectGenres(['Drama, Comedy', 'Western', null])).toEqual(['Comedy', 'Drama', 'Western']);
  });

  it('lists a genre once however many productions carry it', () => {
    expect(collectGenres(['Drama', 'Drama, Comedy', 'drama'])).toEqual(['Comedy', 'Drama']);
  });
});
