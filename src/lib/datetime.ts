// Showtime rendering, pinned to the venue's clock.
//
// `showings.start_time` is TIMESTAMPTZ — a true UTC instant. That is the right
// storage, but it means every human-facing rendering has to name a timezone,
// and every wall-clock the admin types has to be interpreted in one.
//
// The default `format(new Date(iso))` from date-fns does neither: it silently
// uses whatever zone the viewer's OS is set to. A staff member on a
// Mountain-set laptop then reads every Pacific showtime an hour late, and a
// customer travelling sees the wrong time on their own ticket. Late shows can
// even land on the wrong calendar day.
//
// So: never `format(new Date(start_time))` for a showtime. Use the helpers
// below, which pin the conversion to the venue's zone the same way the ticket
// email already does (supabase/functions/_shared/tickets.ts).

import { format } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * The Kenworthy is in Moscow, Idaho.
 *
 * Northern Idaho keeps *Pacific* time, not Mountain — the state is split, and
 * the Idaho/Boise association makes `America/Boise` a tempting and wrong
 * choice. It is Mountain, which runs exactly one hour ahead of Pacific
 * year-round (both observe DST), so picking it produces a constant one-hour
 * error that no amount of DST reasoning will reveal. It is how every imported
 * showtime came to be stored an hour early.
 *
 * This must stay in agreement with VENUE_TIME_ZONE in
 * supabase/functions/_shared/tickets.ts, which is what the confirmation email
 * renders with. If the two disagree, the emailed time and the on-site time
 * disagree.
 */
export const VENUE_TIME_ZONE = 'America/Los_Angeles';

/** Format a stored showtime instant in the venue's zone. */
export function formatShowtime(
  value: string | Date | null | undefined,
  pattern: string,
): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return formatInTimeZone(d, VENUE_TIME_ZONE, pattern);
}

/**
 * The venue-local calendar day of an instant, as `yyyy-MM-dd`.
 *
 * Use this for grouping showings into days. Grouping on the viewer's local day
 * puts a 7 PM Pacific show on the following date for anyone east of us.
 */
export function venueDayKey(value: string | Date): string {
  return formatShowtime(value, 'yyyy-MM-dd');
}

/**
 * The venue-local day containing `at`, as a pair of real instants.
 *
 * Use this for any "today" that will be compared against a TIMESTAMPTZ column.
 * `new Date(); setHours(0,0,0,0)` is the tempting version and it is wrong: it
 * builds midnight in the *viewer's* zone, so a staff laptop set to Mountain
 * starts the theatre's day an hour early and sweeps in the previous night's
 * late show. The venue's day is the only one the box office means.
 *
 * The day arithmetic runs on calendar components rather than by adding 24h,
 * because the two DST days are 23 and 25 hours long.
 */
export function venueDayBounds(at: Date = new Date()): { dayKey: string; start: Date; end: Date } {
  const dayKey = venueDayKey(at);
  const [y, m, d] = dayKey.split('-').map(Number);
  const nextKey = format(new Date(y, m - 1, d + 1), 'yyyy-MM-dd');
  return {
    dayKey,
    start: venueLocalToInstant(`${dayKey}T00:00`),
    end: venueLocalToInstant(`${nextKey}T00:00`),
  };
}

/**
 * An instant shifted so that its *viewer-local* fields read as the venue's
 * wall clock.
 *
 * Only for APIs that insist on a Date and will read `.getDate()`/`.getMonth()`
 * off it themselves — calendar grids, date pickers. The result is a lie about
 * the instant, so never use it for arithmetic against a real timestamp, and
 * never send it back to the database.
 */
export function toVenueWallClock(value: string | Date): Date {
  return toZonedTime(typeof value === 'string' ? new Date(value) : value, VENUE_TIME_ZONE);
}

/**
 * Interpret a naive `datetime-local` string ("2026-08-14T19:30") as the
 * venue's wall clock and return the real instant.
 *
 * `new Date(naive).toISOString()` interprets it in the *browser's* zone, so an
 * admin on a Mountain-set machine would save 7:30 PM as 6:30 PM Pacific.
 */
export function venueLocalToInstant(naive: string): Date {
  return fromZonedTime(naive, VENUE_TIME_ZONE);
}

/** Format an instant as the `datetime-local` value the admin should see. */
export function instantToVenueLocalInput(value: string | Date): string {
  return formatShowtime(value, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Format a bare `yyyy-MM-dd` from a Postgres DATE column.
 *
 * A DATE has no instant and no zone — it is a calendar day, and it should
 * render as that same day everywhere. `new Date('2026-08-14')` does not do
 * that: the ISO date-only form is parsed as *UTC* midnight, which is 5 PM the
 * previous day in Pacific, so the value prints as August 13 to anyone west of
 * Greenwich. Splitting the components and building a local-midnight Date
 * sidesteps the conversion entirely.
 *
 * Do not use this on a TIMESTAMPTZ — those are instants; use formatShowtime.
 */
export function formatPlainDate(
  value: string | null | undefined,
  pattern = 'MMMM d, yyyy',
): string {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return format(new Date(y, m - 1, d), pattern);
}

/**
 * Two `yyyy-MM-dd` days as one phrase: "Aug 14, 2026", "Aug 14–16, 2026",
 * "Aug 30 – Sep 2, 2026", "Dec 30, 2026 – Jan 2, 2027".
 *
 * A multi-day rental is stored as a start (`proposed_date`) and an optional
 * end (`end_date`); a single-day one has no end. Printing the pair as
 * "Aug 14, 2026 – Aug 16, 2026" repeats the month and year at every reader,
 * so the shared parts are said once.
 *
 * The server's twin is `formatDateSpan` in
 * supabase/functions/_shared/rental_invoice.ts, which writes the same phrase
 * onto the Square invoice. If the two disagree, the invoice and the contract
 * describe different bookings.
 */
export function formatPlainDateRange(
  start: string | null | undefined,
  end?: string | null,
  { month = 'short' }: { month?: 'short' | 'long' } = {},
): string {
  const M = month === 'long' ? 'MMMM' : 'MMM';
  const single = formatPlainDate(start, `${M} d, yyyy`);
  if (!single) return '';

  const a = start!.slice(0, 10);
  const b = end?.slice(0, 10);
  if (!b || b === a || !formatPlainDate(b)) return single;

  const [ay, am] = a.split('-');
  const [by, bm] = b.split('-');
  if (ay === by && am === bm) {
    return `${formatPlainDate(a, `${M} d`)}–${formatPlainDate(b, 'd')}, ${ay}`;
  }
  if (ay === by) {
    return `${formatPlainDate(a, `${M} d`)} – ${formatPlainDate(b, `${M} d`)}, ${ay}`;
  }
  return `${single} – ${formatPlainDate(b, `${M} d, yyyy`)}`;
}

/**
 * Normalise a stored `duration_minutes` to a whole, positive count of minutes.
 *
 * The column is a nullable integer, but the runtime formatters are handed
 * whatever a query returned — including `null` for every event and live
 * performance, which carry no runtime anywhere in the schema. Anything that
 * isn't a real, positive duration formats as the empty string, which is what
 * lets a caller write `{formatRuntime(x)}` without also guarding the render.
 */
function wholeMinutes(minutes: number | null | undefined): number | null {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.round(n);
}

/**
 * A run time for reading: `"1h 30m"`, `"2h"`, `"45m"`.
 *
 * Staff enter — and the database stores — a total minute count, because that is
 * the one representation that survives arithmetic (`showingEndsAt`, the `.ics`
 * duration). But "128 min" is a number the reader has to divide before it means
 * anything, and the patron base skews older. So the storage stays in minutes
 * and only the reading changes.
 *
 * The compact form is the streaming/Letterboxd/Google convention rather than
 * Fandango's "2 hr 8 min": this sits in a badge row beside the rating and
 * genre, where width is the scarce thing.
 *
 * An exact hour drops the minutes entirely — "2h", never "2h 0m".
 *
 * Screen readers say this badly ("one-h thirty-m"), so anything rendering it
 * should carry `runtimeLabel()` as an `aria-label`. Returns `''` when there is
 * no runtime to show.
 */
export function formatRuntime(minutes: number | null | undefined): string {
  const total = wholeMinutes(minutes);
  if (total === null) return '';

  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * The same run time spelled out: `"1 hour 30 minutes"`, `"2 hours"`,
 * `"45 minutes"`.
 *
 * The compact form is an abbreviation, and a screen reader has no way to know
 * that — VoiceOver reads "1h 30m" as letters. This is the `aria-label` twin, so
 * the visual stays compact while the announced version stays a sentence.
 * Returns `''` when there is no runtime to show.
 */
export function runtimeLabel(minutes: number | null | undefined): string {
  const total = wholeMinutes(minutes);
  if (total === null) return '';

  const h = Math.floor(total / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}
