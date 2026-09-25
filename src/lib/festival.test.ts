import { describe, it, expect } from 'vitest';
import {
  BOOKLET_DISPLAY_ORDER,
  chooseHeroYear,
  describeYear,
  groupProgramsByYear,
  pageRowsForPdf,
  previousGeneratedSet,
  selectFestivalLineup,
  slidePath,
  stripLeadingShowtime,
  type FestivalProgram,
  type ProgramYear,
} from '@/lib/festival';

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

  // The descriptions are written in the admin rich-text editor now, so the
  // showtime arrives wrapped. The regex is ^-anchored: without flattening
  // first, nothing matches and the festival card prints the date twice.
  it('still finds the showtime when the description is HTML', () => {
    expect(stripLeadingShowtime('<p>Wednesday, September 2 at 7 PM The fourth annual festival begins…</p>'))
      .toBe('The fourth annual festival begins…');
  });

  it('returns plain text, never markup', () => {
    expect(stripLeadingShowtime('<p>A <strong>4k</strong> restoration.</p>'))
      .toBe('A 4k restoration.');
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

describe('describeYear — trailers', () => {
  const pdf = (id: string) => program({ id, year: 2024, file_type: 'pdf', thumbnail_path: 'c.jpg' });

  it('has no trailer when nothing is recorded for the year', () => {
    expect(describeYear({ year: 2024, programs: [pdf('z')] }).trailerUrl).toBeNull();
  });

  it('carries the trailer recorded for that year', () => {
    const trailers = new Map([[2024, 'https://youtu.be/abc']]);
    expect(describeYear({ year: 2024, programs: [pdf('z')] }, trailers).trailerUrl)
      .toBe('https://youtu.be/abc');
  });

  it('does not borrow another year’s trailer', () => {
    const trailers = new Map([[2023, 'https://youtu.be/other']]);
    expect(describeYear({ year: 2024, programs: [pdf('z')] }, trailers).trailerUrl).toBeNull();
  });

  it('treats an explicitly null trailer as none', () => {
    const trailers = new Map<number, string | null>([[2024, null]]);
    expect(describeYear({ year: 2024, programs: [pdf('z')] }, trailers).trailerUrl).toBeNull();
  });
});

describe('chooseHeroYear — the year the top of the page speaks for', () => {
  it('is the year being sold when there is a lineup', () => {
    expect(chooseHeroYear({ lineupYear: 2026, writtenYears: [2024, 2025], betweenSeasons: false }))
      .toBe(2026);
  });

  it('falls back to the newest year anyone has written about', () => {
    expect(chooseHeroYear({ lineupYear: null, writtenYears: [2024, 2026, 2025], betweenSeasons: false }))
      .toBe(2026);
  });

  it('is nothing when nothing has been written and nothing is on', () => {
    expect(chooseHeroYear({ lineupYear: null, writtenYears: [], betweenSeasons: false })).toBeNull();
  });

  // The whole point of the switch: the day after the last screening the lineup
  // empties, and without this the finished year stays featured — its blurb at
  // the top, its programme above the archive — until next year's copy exists.
  it('features no year between seasons, even one that was written about', () => {
    expect(chooseHeroYear({ lineupYear: null, writtenYears: [2026], betweenSeasons: true })).toBeNull();
  });

  it('features no year between seasons, even with a lineup still tagged', () => {
    expect(chooseHeroYear({ lineupYear: 2026, writtenYears: [2026], betweenSeasons: true })).toBeNull();
  });

  it('returns the next year the moment the switch is off and its lineup exists', () => {
    expect(chooseHeroYear({ lineupYear: 2027, writtenYears: [2026], betweenSeasons: false })).toBe(2027);
  });
});

describe('the current-vs-archive split, between seasons', () => {
  // The page's own rule: currentEntry is the hero year's entry, pastYears is
  // everything else. Reproduced here rather than imported because it is two
  // lines in the component, and what matters is what they do with a null.
  const split = (archive: ProgramYear[], heroYear: number | null) => {
    const current = heroYear != null ? archive.find(a => a.year === heroYear) ?? null : null;
    return { current, past: archive.filter(a => a.year !== current?.year).map(a => a.year) };
  };
  const archive: ProgramYear[] = [2026, 2025, 2024].map(year => ({ year, programs: [] }));

  it('keeps the featured year out of the archive in season', () => {
    const heroYear = chooseHeroYear({ lineupYear: null, writtenYears: [2026], betweenSeasons: false });
    expect(split(archive, heroYear)).toEqual({ current: archive[0], past: [2025, 2024] });
  });

  it('puts every year, the finished one included, in the archive between seasons', () => {
    const heroYear = chooseHeroYear({ lineupYear: null, writtenYears: [2026], betweenSeasons: true });
    expect(split(archive, heroYear)).toEqual({ current: null, past: [2026, 2025, 2024] });
  });
});

describe('pageRowsForPdf — what a rendered booklet writes', () => {
  const rows = pageRowsForPdf({
    festivalSlug: 'silent-film-festival', year: 2026, pdfId: 'pdf-1',
    pagePaths: ['silent-film-festival/2026/001-1.jpg', 'silent-film-festival/2026/002-1.jpg', 'silent-film-festival/2026/003-1.jpg'],
    isPublished: false, uploadedBy: 'admin-1',
  });

  it('writes one image row per page, in page order, as the import script does', () => {
    expect(rows.map(r => [r.title, r.display_order, r.file_type]))
      .toEqual([['Page 1', 1, 'image'], ['Page 2', 2, 'image'], ['Page 3', 3, 'image']]);
  });

  it('marks every page as rendered from the booklet', () => {
    expect(rows.every(r => r.generated_from === 'pdf-1')).toBe(true);
  });

  it('follows the upload’s publish state and year', () => {
    expect(rows.every(r => r.is_published === false && r.year === 2026 && r.uploaded_by === 'admin-1')).toBe(true);
  });

  it('renders on the page as a flip-through with the booklet as the download', () => {
    const pdf = program({ id: 'pdf-1', year: 2026, file_type: 'pdf', display_order: BOOKLET_DISPLAY_ORDER, thumbnail_path: 'cover.jpg' });
    const pages = rows.map((r, i) => program({ ...r, id: `p${i}` }));
    const [group] = groupProgramsByYear([pdf, ...pages]);
    const year = describeYear(group);
    expect(year.pages.map(p => p.title)).toEqual(['Page 1', 'Page 2', 'Page 3']);
    expect(year.booklet?.id).toBe('pdf-1');
    expect(year.coverPath).toBe('silent-film-festival/2026/001-1.jpg');
  });
});

describe('previousGeneratedSet — what a re-upload replaces', () => {
  const row = (id: string, generated_from: string | null = null) => ({ id, generated_from });

  it('is the earlier booklet and the pages rendered from it', () => {
    const set = previousGeneratedSet([
      row('old-pdf'), row('old-p1', 'old-pdf'), row('old-p2', 'old-pdf'),
    ]);
    expect(set.map(r => r.id).sort()).toEqual(['old-p1', 'old-p2', 'old-pdf']);
  });

  it('leaves pages uploaded by hand or by the script alone', () => {
    const set = previousGeneratedSet([
      row('script-p1'), row('script-p2'), row('script-pdf'), row('hand-cover'),
    ]);
    expect(set).toEqual([]);
  });

  it('takes only the derived set out of a mixed year', () => {
    const set = previousGeneratedSet([
      row('script-p1'), row('old-pdf'), row('old-p1', 'old-pdf'), row('hand-cover'),
    ]);
    expect(set.map(r => r.id).sort()).toEqual(['old-p1', 'old-pdf']);
  });
});
