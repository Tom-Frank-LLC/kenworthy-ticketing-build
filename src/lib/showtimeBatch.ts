// Building a run of showtimes in one pass.
//
// The admin showing form has always created exactly one showing. Everything on
// it except the date is shared config — the title, the venue, the price and
// tiers, the runtime, the passes, the seating model — so scheduling a four-night
// run meant filling the same eight fields four times and getting them identical
// four times. This module holds the part of "several at once" that is pure: the
// row list, the wall-clock arithmetic, the checks that run before any write, and
// the summary that runs after.
//
// The writes themselves stay in ShowingForm, because the per-showing sequence
// there (insert → template RPC → seat pricing → eligibility → Square) is the
// thing a batch has to repeat rather than reimplement. What lives here is
// everything that can be decided without touching the network, which is also
// everything worth testing.

/**
 * One row of the showtime list.
 *
 * `value` is a naive `datetime-local` string — "2026-08-14T19:30" — carrying no
 * zone at all. It becomes an instant only at the point of writing, through
 * venueLocalToInstant(), exactly as the single-showtime field always did.
 *
 * `key` exists for React. Indexing the list by position makes removing a middle
 * row remount every row below it, which throws away focus mid-typing.
 */
export interface ShowtimeRow {
  key: string;
  value: string;
}

let rowCounter = 0;

export function makeShowtimeRow(value = ''): ShowtimeRow {
  rowCounter += 1;
  return { key: `showtime-${rowCounter}`, value };
}

/** A fresh list holding a single empty row — what a create form opens with. */
export function initialShowtimeRows(): ShowtimeRow[] {
  return [makeShowtimeRow()];
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Shift a `datetime-local` value by whole days, keeping the wall clock.
 *
 * Deliberately calendar arithmetic on the naive string rather than millisecond
 * arithmetic on an instant. "Same time next week" means 7:30 PM next week; a
 * run that crosses a DST boundary would come back as 6:30 or 8:30 if this
 * added 7 × 86,400,000 ms to a real timestamp, and the admin would have to
 * notice one wrong hour among four correct ones.
 *
 * The time-of-day is carried across as text and never converted, so it cannot
 * drift. The date rolls through a Date only to get month lengths and leap years
 * right, and it is built at *noon* so that a browser in a zone whose DST
 * transition happens at midnight cannot land on an hour that does not exist.
 */
export function shiftLocalInput(naive: string, days: number): string {
  const m = LOCAL_INPUT.exec(naive);
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m;
  const base = new Date(Number(y), Number(mo) - 1, Number(d), 12);
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${hh}:${mm}`;
}

/**
 * The value a "+1 day" / "+1 week" button should append.
 *
 * Offsets from the last row that has a datetime, not from the last row outright
 * — pressing it twice in a row would otherwise offset from the blank row the
 * first press created and produce nothing. Returns '' when there is nothing to
 * offset from, which the caller renders as a plain empty row.
 */
export function nextShowtimeValue(rows: ShowtimeRow[], days: number): string {
  for (let i = rows.length - 1; i >= 0; i--) {
    const shifted = shiftLocalInput(rows[i].value, days);
    if (shifted) return shifted;
  }
  return '';
}

/**
 * Which rows repeat a datetime already present earlier in the list.
 *
 * Returns the indexes of the *later* copies, so the first occurrence is never
 * flagged and the admin is pointed at the row to remove rather than at the pair.
 * Blank rows are not duplicates of each other — they are simply not filled in.
 */
export function findDuplicateRowIndexes(rows: ShowtimeRow[]): Set<number> {
  const seen = new Set<string>();
  const dupes = new Set<number>();
  rows.forEach((row, i) => {
    const v = row.value.trim();
    if (!v) return;
    if (seen.has(v)) dupes.add(i);
    else seen.add(v);
  });
  return dupes;
}

/**
 * Which rows land on a datetime the venue already has a showing at.
 *
 * A soft warning and never a block: a double feature in two rooms, a matinee
 * and an evening of the same title, or simply a second screen are all real, and
 * the form has never had an opinion about them. It says what it noticed and
 * lets the admin decide.
 *
 * `existing` holds the venue's showtimes already rendered as venue-local
 * `datetime-local` strings, so the comparison is between two wall clocks and
 * never between a wall clock and an instant.
 */
export function findCollidingRowIndexes(
  rows: ShowtimeRow[],
  existing: ReadonlySet<string>,
): Set<number> {
  const hits = new Set<number>();
  rows.forEach((row, i) => {
    const v = row.value.trim();
    if (v && existing.has(v)) hits.add(i);
  });
  return hits;
}

/** The rows that will actually be written, de-duplicated and in time order. */
export function plannedShowtimes(rows: ShowtimeRow[]): string[] {
  const values = rows.map(r => r.value.trim()).filter(v => LOCAL_INPUT.test(v));
  // `yyyy-MM-ddTHH:mm` sorts chronologically as plain text, so the batch is
  // created oldest-first regardless of the order it was typed in, and the
  // summary afterwards reads down the run rather than around it.
  return [...new Set(values)].sort();
}

/**
 * What happened to one showtime.
 *
 * There is no transaction here — this is a client-side loop over several
 * network round trips, and it can stop anywhere. Three outcomes rather than
 * two, because the middle one is the one that matters: 'incomplete' means the
 * showing exists and is sellable but something after the insert did not land,
 * and reporting that as either success or failure is a lie the admin acts on.
 */
export type ShowtimeStatus = 'created' | 'incomplete' | 'failed';

export interface ShowtimeOutcome {
  /** The `datetime-local` value as typed, so a failed row can be put back. */
  value: string;
  status: ShowtimeStatus;
  showingId?: string;
  /** Why it failed, or what about it is incomplete. A short phrase: it is read
   *  in a list next to the datetime it belongs to. */
  detail?: string;
  /** The same fact as a whole sentence, for the one-showtime case — which is
   *  still the old single-showing form and still says what it always said. */
  message?: string;
}

export interface BatchSummary {
  created: ShowtimeOutcome[];
  incomplete: ShowtimeOutcome[];
  failed: ShowtimeOutcome[];
  /**
   * Rows to leave in the form for another try. Never the incomplete ones —
   * those already created a showing, and retrying would create a second one at
   * the same time in the same room.
   */
  retryValues: string[];
  headline: string;
  tone: 'success' | 'warning' | 'error';
}

export function summarizeBatch(outcomes: ShowtimeOutcome[]): BatchSummary {
  const created = outcomes.filter(o => o.status === 'created');
  const incomplete = outcomes.filter(o => o.status === 'incomplete');
  const failed = outcomes.filter(o => o.status === 'failed');
  const total = outcomes.length;
  // An incomplete showing is still a showing that exists, so it counts toward
  // "created N of M" — the sentence answers "how many rows produced a showing",
  // and the detail lines below say which of them need finishing.
  const exists = created.length + incomplete.length;

  const noun = total === 1 ? 'showtime' : 'showtimes';
  const headline =
    failed.length === 0 && incomplete.length === 0
      ? `Created ${total} ${noun}.`
      : `Created ${exists} of ${total} ${noun}.`;

  return {
    created,
    incomplete,
    failed,
    retryValues: failed.map(o => o.value),
    headline,
    tone: failed.length > 0 ? 'error' : incomplete.length > 0 ? 'warning' : 'success',
  };
}

/**
 * How Square answered for one showing.
 *
 * Exactly what `squareSaveOutcome` returned for it — null when there was
 * nothing to say. The classification is not repeated here: squareLink.ts owns
 * which of the planner's eight statuses are worth a warning and how each is
 * worded, and a second copy of that judgement is how the old two-status check
 * came to disagree with the planner in the first place.
 */
export interface SquareBatchEntry {
  code: string;
  message: string;
}

/**
 * One sentence for the whole batch, or none when every showing got its items.
 *
 * The catalog write is best-effort and always has been: a showtime sells as an
 * ad-hoc line without it, and the batch job picks it up later. What changes for
 * a batch is the volume — the same warning fired once per showing buries the
 * screen under identical toasts and says nothing the first one did not.
 *
 * Grouped by code rather than concatenated, because a batch shares one title,
 * one price and one venue: whatever Square says about the first showtime it
 * almost always says about all of them, and the useful number is how many.
 */
export function summarizeSquareOutcomes(
  outcomes: Array<SquareBatchEntry | null>,
): string | null {
  const warned = outcomes.filter((o): o is SquareBatchEntry => !!o);
  if (warned.length === 0) return null;

  const byCode = new Map<string, { message: string; count: number }>();
  for (const o of warned) {
    const seen = byCode.get(o.code);
    if (seen) seen.count += 1;
    else byCode.set(o.code, { message: o.message, count: 1 });
  }

  // A single showing with a single thing wrong is the old single-showing form,
  // and it says exactly what it always said.
  if (warned.length === 1) return warned[0].message;

  return [...byCode.values()]
    .map(({ message, count }) => `${count} showtime${count === 1 ? '' : 's'}: ${message}`)
    .join(' ');
}
