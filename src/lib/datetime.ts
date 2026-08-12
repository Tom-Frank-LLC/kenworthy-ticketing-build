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
