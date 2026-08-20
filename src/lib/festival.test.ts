import { describe, it, expect } from 'vitest';
import { describeYear, groupProgramsByYear, selectFestivalLineup, slidePath, stripLeadingShowtime, type FestivalProgram } from '@/lib/festival';

const program = (over: Partial<FestivalProgram> & { id: string; year: number }): FestivalProgram => ({
  title: null, file_path: `${over.id}.pdf`, file_type: 'pdf', display_order: 0, ...over,
});

describe('groupProgramsByYear', () => {
  it('puts the newest festival first', () => {
    const years = groupProgramsByYear([
      program({ id: 'a', year: 2023 }),
      program({ id: 'b', year: 2026 }),
      program({ id: 'c', year: 2024 }),
    ]).map((g) => g.year);
    expect(years).toEqual([2026, 2024, 2023]);
  });

  it('orders a year by display_order, not upload order', () => {
    const [group] = groupProgramsByYear([
      program({ id: 'inside', year: 2026, display_order: 2 }),
      program({ id: 'cover', year: 2026, display_order: 1 }),
    ]);
    expect(group.programs.map((p) => p.id)).toEqual(['cover', 'inside']);
  });

  it('is stable when every file sits at the default order', () => {
    const input = [
      program({ id: 'z', year: 2026, title: 'Programme B' }),
      program({ id: 'y', year: 2026, title: 'Programme A' }),
    ];
    expect(groupProgramsByYear(input)[0].programs.map((p) => p.id)).toEqual(['y', 'z']);
    expect(groupProgramsByYear([...input].reverse())[0].programs.map((p) => p.id)).toEqual(['y', 'z']);
  });
});

describe('selectFestivalLineup', () => {
  // The real 2026 run: three Wednesdays, 7pm Pacific.
  const crowd   = { id: 'crowd',   start_time: '2026-09-03T02:00:00+00:00' };
  const chaplin = { id: 'chaplin', start_time: '2026-09-10T02:00:00+00:00' };
  const faust   = { id: 'faust',   start_time: '2026-09-17T02:00:00+00:00' };
  const lineup = [faust, crowd, chaplin];

  const at = (iso: string) => new Date(iso).getTime();

  it('lists the whole run in date order before it starts', () => {
    expect(selectFestivalLineup(lineup, at('2026-08-19T12:00:00Z')).map((s) => s.id))
      .toEqual(['crowd', 'chaplin', 'faust']);
  });

  it('keeps a screening that has already played while later ones remain', () => {
    // Mid-festival: The Crowd is over, two Wednesdays still to come.
    expect(selectFestivalLineup(lineup, at('2026-09-11T12:00:00Z')).map((s) => s.id))
      .toEqual(['crowd', 'chaplin', 'faust']);
  });

  it('empties once the last screening has ended', () => {
    expect(selectFestivalLineup(lineup, at('2026-09-20T12:00:00Z'))).toEqual([]);
  });

  it('shows only the edition being sold when a later year is already tagged', () => {
    const next = { id: 'next-year', start_time: '2027-09-02T02:00:00+00:00' };
    expect(selectFestivalLineup([...lineup, next], at('2026-08-19T12:00:00Z')).map((s) => s.id))
      .toEqual(['crowd', 'chaplin', 'faust']);
  });

  it('moves on to the next edition once this one is over', () => {
    const next = { id: 'next-year', start_time: '2027-09-02T02:00:00+00:00' };
    expect(selectFestivalLineup([...lineup, next], at('2026-10-01T12:00:00Z')).map((s) => s.id))
      .toEqual(['next-year']);
  });

  it('has nothing to show before a pass has been tagged', () => {
    expect(selectFestivalLineup([], at('2026-08-19T12:00:00Z'))).toEqual([]);
  });
});

describe('stripLeadingShowtime', () => {
  it('drops the showtime the card already prints above it', () => {
    expect(stripLeadingShowtime('Wednesday, September 2 at 7 PM The fourth annual Kenworthy Silent Film Festival begins…'))
      .toBe('The fourth annual Kenworthy Silent Film Festival begins…');
  });

  it('leaves a synopsis that never had one alone', () => {
    expect(stripLeadingShowtime('A 4k restoration from Blackhawk Films.'))
      .toBe('A 4k restoration from Blackhawk Films.');
  });

  it('keeps a bare date rather than emptying the synopsis', () => {
    expect(stripLeadingShowtime('Wednesday, September 2 at 7 PM'))
      .toBe('Wednesday, September 2 at 7 PM');
  });

  it('does not strip a date from the middle of the prose', () => {
    const s = 'Shot in 1928 and revived Wednesday, September 2 at 7 PM for one night.';
    expect(stripLeadingShowtime(s)).toBe(s);
  });

  it('handles a missing description', () => {
    expect(stripLeadingShowtime(null)).toBe('');
  });
});

describe('describeYear', () => {
  const page = (id: string, order: number) =>
    program({ id, year: 2024, display_order: order, file_type: 'image', title: `Page ${order}` });
  const pdf = (id: string, thumb: string | null) =>
    program({ id, year: 2024, display_order: 500, file_type: 'pdf', thumbnail_path: thumb });

  it('treats the image rows as the slides, in order', () => {
    const y = describeYear({ year: 2024, programs: [page('a', 1), page('b', 2), pdf('z', 'c.jpg')] });
    expect(y.pages.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('keeps the booklet as a download rather than a slide', () => {
    const y = describeYear({ year: 2024, programs: [page('a', 1), pdf('z', 'c.jpg')] });
    expect(y.booklet?.id).toBe('z');
    expect(y.pages.some(p => p.file_type === 'pdf')).toBe(false);
  });

  it('covers the year with its first page when there is one', () => {
    const y = describeYear({ year: 2024, programs: [page('a', 1), pdf('z', 'c.jpg')] });
    expect(y.coverPath).toBe('a.pdf');
  });

  it('falls back to the booklet cover when only a PDF was uploaded', () => {
    const y = describeYear({ year: 2024, programs: [pdf('z', 'cover.jpg')] });
    expect(y.coverPath).toBe('cover.jpg');
    expect(y.pages.map(p => p.id)).toEqual(['z']);
    expect(y.booklet?.id).toBe('z');
  });

  it('has no cover and no slides for a PDF with no cover', () => {
    const y = describeYear({ year: 2024, programs: [pdf('z', null)] });
    expect(y.coverPath).toBeNull();
    expect(y.pages).toEqual([]);
  });
});

describe('slidePath', () => {
  it('draws a page from its own file', () => {
    expect(slidePath(program({ id: 'a', year: 2024, file_type: 'image', file_path: 'p1.jpg' })))
      .toBe('p1.jpg');
  });

  it('draws a booklet from its cover, never from the PDF itself', () => {
    // Resizing a PDF through the image transform endpoint yields nothing
    // drawable, so file_path must not be used here.
    expect(slidePath(program({ id: 'z', year: 2024, file_type: 'pdf', file_path: 'book.pdf', thumbnail_path: 'cover.jpg' })))
      .toBe('cover.jpg');
  });

  it('has nothing to draw for a coverless booklet', () => {
    expect(slidePath(program({ id: 'z', year: 2024, file_type: 'pdf', file_path: 'book.pdf' })))
      .toBeNull();
  });
});
