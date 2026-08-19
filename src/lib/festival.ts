import { isPast, type ShowingTiming } from '@/lib/purchasable';

/**
 * The festival pages, and the two questions they cannot answer from a query
 * alone: which screenings count as "this year", and how the archive stacks up.
 *
 * Both are here rather than in the page because both are rules rather than
 * fetches — they decide what a reader is shown, they have edge cases that only
 * appear on three days of the year, and a page component is the one place those
 * cases cannot be tested.
 */

/** The festival this build has a page for. Matches the route and both slugs. */
export const FESTIVAL_SLUG = 'silent-film-festival';

export interface FestivalProgram {
  id: string;
  year: number;
  title: string | null;
  file_path: string;
  file_type: string;
  display_order: number;
  /** Cover image for a PDF, which cannot be its own thumbnail. */
  thumbnail_path?: string | null;
}

export interface ProgramYear {
  year: number;
  programs: FestivalProgram[];
}

/**
 * The archive, newest festival first.
 *
 * Within a year the admin's display_order wins, because the order of a scanned
 * booklet is a physical fact — cover, then inside spread — that nothing in the
 * row itself encodes. Ties fall back to title and then id so that two files
 * uploaded at order 0 (the default, and therefore the common case) do not
 * reshuffle between renders.
 */
export function groupProgramsByYear(programs: FestivalProgram[]): ProgramYear[] {
  const byYear = new Map<number, FestivalProgram[]>();
  for (const program of programs) {
    const bucket = byYear.get(program.year);
    if (bucket) bucket.push(program);
    else byYear.set(program.year, [program]);
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({
      year,
      programs: [...list].sort(
        (a, b) =>
          a.display_order - b.display_order ||
          (a.title ?? '').localeCompare(b.title ?? '') ||
          a.id.localeCompare(b.id),
      ),
    }));
}

export interface FestivalScreening extends ShowingTiming {
  id: string;
  start_time: string;
}

/**
 * Which of the pass's screenings are *this year's festival*.
 *
 * The pass type is durable and its pass_type_showings rows accumulate: tag the
 * 2027 run against the same pass and the 2026 run is still sitting there. So
 * "this year" cannot mean "every screening the pass covers", and it cannot mean
 * the current calendar year either — a January festival tagged the previous
 * December would disappear from its own page.
 *
 * The anchor is instead the next screening that has not happened yet. Whatever
 * year that one falls in is the edition currently being sold, and the lineup is
 * every tagged screening sharing that year.
 *
 * Two consequences, both deliberate:
 *
 *   A screening that has already played stays in the list while later ones are
 *   still to come. During a three-week festival the middle Wednesday should
 *   still show a full programme rather than a shrinking one; the card marks it
 *   as passed and drops its ticket link, which is the honest rendering and the
 *   rule in src/lib/purchasable.ts.
 *
 *   Once the final screening ends the list goes empty rather than falling back
 *   to the year just finished. A page headed "This year" showing a festival
 *   that is over reads as a listing a patron can still buy into. The archive
 *   below is where a finished festival belongs.
 */
export function selectFestivalLineup<T extends FestivalScreening>(
  screenings: T[],
  now: number = Date.now(),
): T[] {
  const upcoming = screenings
    .filter((s) => !isPast(s, null, now))
    .sort((a, b) => festivalTime(a) - festivalTime(b));

  const anchor = upcoming[0];
  if (!anchor) return [];

  const year = new Date(anchor.start_time).getFullYear();
  if (!Number.isFinite(year)) return [];

  return screenings
    .filter((s) => {
      const t = festivalTime(s);
      return Number.isFinite(t) && new Date(s.start_time).getFullYear() === year;
    })
    .sort((a, b) => festivalTime(a) - festivalTime(b));
}

function festivalTime(screening: FestivalScreening): number {
  return new Date(screening.start_time).getTime();
}

/**
 * A synopsis with its opening showtime removed.
 *
 * These descriptions came across from the WordPress site, where the date was
 * part of the blurb because nothing else on the page carried it. Here the card
 * prints the date itself, directly above, so leaving it in the prose shows the
 * reader the same Wednesday twice.
 *
 * Only a leading, complete showtime is taken, and only when what follows still
 * has prose in it — a description that is *nothing but* a date is left intact,
 * because an empty synopsis is a worse outcome than a repeated one.
 */
const LEADING_SHOWTIME =
  /^\s*(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s+at\s+\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)\s*[.—-]?\s*/;

export function stripLeadingShowtime(description: string | null | undefined): string {
  if (!description) return '';
  const trimmed = description.trim();
  const stripped = trimmed.replace(LEADING_SHOWTIME, '').trim();
  return stripped.length > 0 ? stripped : trimmed;
}

export interface FestivalYear {
  year: number;
  /** The slides, in reading order. */
  pages: FestivalProgram[];
  /** The whole booklet as a single file, offered for download. */
  booklet: FestivalProgram | null;
  /** Storage path of the image to represent this year in the list. */
  coverPath: string | null;
}

/**
 * A year's worth of rows, arranged the way the archive presents it.
 *
 * The table stores one row per file because that is what was uploaded. The page
 * shows one entry per *festival*, because "the 2024 programme" is the thing a
 * reader came for — a list of thirteen rows, twelve of them called "Page N", is
 * a filesystem rather than an archive.
 *
 * The booklet PDF stops being something to display and becomes something to
 * download. Embedding it meant handing the reader the browser's PDF viewer,
 * complete with a toolbar offering to rotate, annotate and summarise a museum
 * piece. The pages are images, so the slideshow that shows them is read-only by
 * construction rather than by suppressing someone else's controls.
 *
 * A year with no page images falls back to its cover as a single slide. That
 * happens when a PDF was uploaded by hand rather than imported, and it is
 * deliberately not treated as an error: one slide and a download still beats an
 * empty pane.
 */
export function describeYear(group: ProgramYear): FestivalYear {
  const pages = group.programs.filter(p => p.file_type === 'image');
  const booklet = group.programs.find(p => p.file_type === 'pdf') ?? null;
  const coverPath =
    pages[0]?.file_path ?? booklet?.thumbnail_path ?? null;

  return {
    year: group.year,
    // Without pages the cover is the only thing to show, and showing it beats
    // showing nothing. It is already a FestivalProgram row, so no shim needed.
    pages: pages.length > 0 ? pages : (booklet?.thumbnail_path ? [booklet] : []),
    booklet,
    coverPath,
  };
}
