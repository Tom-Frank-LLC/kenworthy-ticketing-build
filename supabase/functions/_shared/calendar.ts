// "Add to calendar" for a ticket order.
//
// One builder for the ICS file and the Google Calendar link, used by the
// ticket-access endpoint (the .ics the page/email/SMS all point at) and by the
// email/SMS builders (the Google link).
//
// Times are emitted as the UTC instant (…Z), derived straight from the stored
// timestamptz. That is deliberately independent of VENUE_TIME_ZONE: a calendar
// client renders the instant in the viewer's own zone, so this stays correct
// regardless of how the showtime is *displayed* elsewhere — and immune to the
// display-offset bug tracked in BRIEF-listings-time-offset.

import { type Order } from './tickets.ts';

const VENUE_NAME = 'The Kenworthy Performing Arts Centre';
const VENUE_ADDRESS = '508 S Main St, Moscow, ID 83843';
/** Fallback event length when the production carries no duration (events, live). */
const DEFAULT_DURATION_MIN = 120;

/** ISO/date -> `YYYYMMDDTHHMMSSZ` (UTC), the compact form ICS and Google both take. */
function toCalUtc(iso: string, addMinutes = 0): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (addMinutes) d.setUTCMinutes(d.getUTCMinutes() + addMinutes);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Escape a value for an ICS TEXT field (RFC 5545 §3.3.11). */
function escIcs(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold lines to <=75 octets with CRLF + single leading space (RFC 5545 §3.1). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 73) {
    parts.push(' ' + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  if (rest.length) parts.push(' ' + rest);
  return parts.join('\r\n');
}

function durationMinutes(order: Order): number {
  const d = Number(order.duration_minutes);
  return Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION_MIN;
}

function locationLine(order: Order): string {
  const name = order.venue || VENUE_NAME;
  return `${name}, ${VENUE_ADDRESS}`;
}

function description(order: Order, ticketUrl: string): string {
  const n = order.tickets.length;
  return `Your ${n} ticket${n === 1 ? '' : 's'} for ${order.title}. View or show at the door: ${ticketUrl}`;
}

/**
 * A complete VCALENDAR for the order's showing. `stampIso` is the DTSTAMP; the
 * caller passes `new Date().toISOString()` (edge runtime) so this stays pure.
 */
export function buildIcs(order: Order, ticketUrl: string, stampIso: string): string {
  const start = toCalUtc(order.start_time);
  const end = toCalUtc(order.start_time, durationMinutes(order));
  const uid = `${order.order_token}@kenworthy.org`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Kenworthy Performing Arts Centre//Ticketing//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toCalUtc(stampIso)}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escIcs(order.title)}`,
    `LOCATION:${escIcs(locationLine(order))}`,
    `DESCRIPTION:${escIcs(description(order, ticketUrl))}`,
    `URL:${escIcs(ticketUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // CRLF line endings are required; fold each logical line first.
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** A one-tap "add to Google Calendar" template link. */
export function googleCalendarUrl(order: Order, ticketUrl: string): string {
  const dates = `${toCalUtc(order.start_time)}/${toCalUtc(order.start_time, durationMinutes(order))}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: order.title,
    dates,
    location: locationLine(order),
    details: description(order, ticketUrl),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Public URL of the order's .ics, served by ticket-access. */
export function ticketCalendarUrl(supabaseUrl: string, token: string): string {
  const base = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/ticket-access`;
  return `${base}?token=${encodeURIComponent(token)}&ics=1`;
}

export { VENUE_TIME_ZONE };
