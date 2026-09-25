import { isPast, type ShowingTiming } from '@/lib/purchasable';
import { htmlToPlainText } from '@/lib/richText';

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
  /** The PDF row this page was rendered from by the admin upload, or null. */
  generated_from?: string | null;
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
 *
 * The regex is anchored at the start of the string, so it has to run on plain
 * text: descriptions are HTML now, and `<p>Wednesday, June 4 at 7 PM…` does not
 * match `^\s*(?:Wednes)day`. Flattening happens *inside* this function rather
 * than at its one call site so that a future caller cannot quietly reintroduce
 * the duplicated showtime. The result is plain text by design — the festival
 * card clamps it to three lines, and `line-clamp` does not survive block
 * elements anyway.
 */
const LEADING_SHOWTIME =
  /^\s*(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s+at\s+\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)\s*[.—-]?\s*/;

export function stripLeadingShowtime(description: string | null | undefined): string {
  if (!description) return '';
  const trimmed = htmlToPlainText(description);
  const stripped = trimmed.replace(LEADING_SHOWTIME, '').trim();
  return stripped.length > 0 ? stripped : trimmed;
}

export interface FestivalYear {
  year: number;
  /** Whatever an admin pasted for this year, or null. Parsed at render time. */
  trailerUrl: string | null;
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
/**
 * The image to draw for a slide.
 *
 * A page row is its own picture. A booklet row standing in as the only slide is
 * a PDF, and asking the image transform endpoint to resize a PDF returns
 * nothing a browser will draw — so it points at the cover instead.
 */
export function slidePath(program: FestivalProgram): string | null {
  if (program.file_type === 'image') return program.file_path;
  return program.thumbnail_path ?? null;
}

export function describeYear(
  group: ProgramYear,
  /** year -> trailer url, from festival_years. Absent years simply have none. */
  trailers: ReadonlyMap<number, string | null> = new Map(),
): FestivalYear {
  const pages = group.programs.filter(p => p.file_type === 'image');
  const booklet = group.programs.find(p => p.file_type === 'pdf') ?? null;
  const coverPath =
    pages[0]?.file_path ?? booklet?.thumbnail_path ?? null;

  return {
    year: group.year,
    trailerUrl: trailers.get(group.year) ?? null,
    // Without pages the cover is the only thing to show, and showing it beats
    // showing nothing. It is already a FestivalProgram row, so no shim needed.
    pages: pages.length > 0 ? pages : (booklet?.thumbnail_path ? [booklet] : []),
    booklet,
    coverPath,
  };
}

// ---------------------------------------------------------------------------
// The festival itself, as opposed to any one of its years.
// ---------------------------------------------------------------------------

export interface FestivalSettings {
  name: string;
  /** The standing description, HTML from the admin editor. */
  about: string | null;
  /** Nothing is on: feature no year, put every year in the archive. */
  betweenSeasons: boolean;
  /** One line shown in place of the lineup while between seasons. */
  offSeasonNote: string | null;
}

/**
 * The year the top of the festival page speaks for, or null for none.
 *
 * Normally the year being sold. But copy and a trailer get written before the
 * lineup is tagged — that is the whole point of writing them early — and
 * keying the hero to the lineup alone would silently withhold both until the
 * screenings were linked to a pass. So it falls back to the newest year anyone
 * has actually written something about.
 *
 * Which is exactly wrong once that festival is over. The lineup empties the
 * day after the last screening (selectFestivalLineup), and from then until
 * next year's copy exists the fallback keeps featuring the finished year: its
 * blurb at the top, its programme under "This Year's Programme", the archive
 * below missing the one year a reader most expects to find there. The
 * `betweenSeasons` switch is the admin saying "nothing is on", and it wins
 * over both sources — a lineup tagged while the switch is still on is an
 * admin who has not flipped it yet, not a festival the page should sell.
 */
export function chooseHeroYear(input: {
  /** The year of the lineup being sold, if any. */
  lineupYear: number | null;
  /** Every year with a blurb or a trailer written for it. */
  writtenYears: Iterable<number>;
  betweenSeasons: boolean;
}): number | null {
  if (input.betweenSeasons) return null;
  if (input.lineupYear != null) return input.lineupYear;
  const written = [...input.writtenYears];
  return written.length ? Math.max(...written) : null;
}

/**
 * The newest year that has a value in `byYear`, or null.
 *
 * Between seasons no year is featured, and the hero photograph is per year,
 * so the page opened at its bare title — which read as a regression rather
 * than a rest. The most recent festival's photograph is the honest choice:
 * it is a picture of this festival, taken the last time it happened, and it
 * is replaced the moment a newer year has one of its own.
 */
export function newestYearWith<T>(byYear: ReadonlyMap<number, T | null | undefined>): number | null {
  let newest: number | null = null;
  for (const [year, value] of byYear) {
    if (value && (newest === null || year > newest)) newest = year;
  }
  return newest;
}

/**
 * The rows to insert for a PDF's rendered pages, in page order.
 *
 * The shape matches what scripts/import-festival-programs.mjs writes for a
 * booklet — `Page N` at display_order N, the PDF last at 500 — so a year
 * uploaded from the admin and a year imported from the archive folder are
 * indistinguishable on the page. The only addition is `generated_from`, which
 * is what lets a second upload of the same booklet replace these rows rather
 * than sit beside them.
 */
export function pageRowsForPdf(input: {
  festivalSlug: string;
  year: number;
  /** The inserted PDF row's id. */
  pdfId: string;
  /** Storage paths of the rendered pages, page 1 first. */
  pagePaths: string[];
  isPublished: boolean;
  uploadedBy: string | null;
}) {
  return input.pagePaths.map((file_path, i) => ({
    festival_slug: input.festivalSlug,
    year: input.year,
    title: `Page ${i + 1}`,
    file_path,
    file_type: 'image' as const,
    display_order: i + 1,
    is_published: input.isPublished,
    uploaded_by: input.uploadedBy,
    thumbnail_path: null,
    generated_from: input.pdfId,
  }));
}

/** display_order the import script gives a booklet, so it lists last. */
export const BOOKLET_DISPLAY_ORDER = 500;

/**
 * Which of a year's rows an earlier PDF upload produced, and so which a new
 * upload of that year's PDF replaces.
 *
 * The set is the rendered pages (they carry `generated_from`) together with
 * the PDF rows they were rendered from. Nothing else: a page uploaded by hand
 * or by the import script has no marker and is left exactly where it is, so a
 * replacement can never delete work that was not derived in the first place.
 */
export function previousGeneratedSet<T extends Pick<FestivalProgram, 'id' | 'generated_from'>>(
  rows: T[],
): T[] {
  const sources = new Set(rows.map(r => r.generated_from).filter((id): id is string => !!id));
  return rows.filter(r => r.generated_from || sources.has(r.id));
}
