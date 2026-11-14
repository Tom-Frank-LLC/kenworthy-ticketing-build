import { describe, expect, it } from 'vitest';
import { formatYears, matchesQuery, rollUp, type ArchiveScreening, type FilmDetails } from './archiveFilms';

const row = (id: string, year: number, title: string, filmYear: number | null, movie?: string): ArchiveScreening => ({
  id, year, film_title_display: title, film_year: filmYear, matched_movie_id: movie ?? null,
});

const rows = [
  row('1', 1936, 'Secret Agent', 1936, 'm-secret'),
  row('2', 1975, 'Jaws', 1975, 'm-jaws'),
  row('3', 1976, 'Jaws', 1975, 'm-jaws'),
  row('4', 1975, 'One Flew Over the Cuckoo\'s Nest', 1975),
  row('5', 1980, 'Shadow of a Doubt', 1943, 'm-shadow'),
  row('6', 2001, 'Amélie', 2001),
  row('7', 1999, 'The Year 1975', 1998),
];
const details = new Map<string, FilmDetails>([
  ['m-secret', { genre: 'Thriller', rating: null, director: 'Alfred Hitchcock', cast_members: 'Madeleine Carroll, John Gielgud' }],
  ['m-shadow', { genre: 'Thriller, Film Noir', rating: 'PG', director: 'Alfred Hitchcock', cast_members: 'Teresa Wright, Joseph Cotten' }],
  ['m-jaws', { genre: 'Horror', rating: 'PG', director: 'Steven Spielberg', cast_members: null }],
]);
const films = rollUp(rows, details);
const search = (q: string) => films.filter((f) => matchesQuery(f, q)).map((f) => f.title);

describe('archive film search', () => {
  it('finds the films shown in a year, not just titles containing it', () => {
    // The reported bug: "1975" only found titles with 1975 in them.
    expect(search('1975')).toEqual(['Jaws', "One Flew Over the Cuckoo's Nest", 'The Year 1975']);
    expect(search('1980')).toEqual(['Shadow of a Doubt']);
  });

  it('matches the release year too, and a partial year as a decade', () => {
    expect(search('1943')).toEqual(['Shadow of a Doubt']);
    expect(search('193')).toEqual(['Secret Agent']);
  });

  it('searches director, cast and genre', () => {
    expect(search('hitchcock')).toEqual(['Secret Agent', 'Shadow of a Doubt']);
    expect(search('cotten')).toEqual(['Shadow of a Doubt']);
    expect(search('noir')).toEqual(['Shadow of a Doubt']);
  });

  it('needs every word, each from any field', () => {
    expect(search('hitchcock 1980')).toEqual(['Shadow of a Doubt']);
    expect(search('spielberg 1936')).toEqual([]);
  });

  it('matches a rating as a whole word, combined with anything else', () => {
    expect(search('pg')).toEqual(['Jaws', 'Shadow of a Doubt']);
    expect(search('pg 1943')).toEqual(['Shadow of a Doubt']);
  });

  it('ignores accents and case', () => {
    expect(search('AMELIE')).toEqual(['Amélie']);
  });
});

describe('rollUp', () => {
  it('collects years, screenings and the linked listing per film', () => {
    const jaws = films.find((f) => f.title === 'Jaws')!;
    expect(jaws).toMatchObject({ screenings: 2, years: [1975, 1976], movieId: 'm-jaws' });
    expect(jaws.details?.director).toBe('Steven Spielberg');
    expect(films.find((f) => f.title === 'Amélie')!.details).toBeNull();
  });

  it('formats runs of years', () => {
    expect(formatYears([1954, 1955, 1956, 1960])).toBe('1954–1956, 1960');
  });
});
