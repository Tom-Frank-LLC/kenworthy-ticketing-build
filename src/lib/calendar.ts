// Client-side "add to calendar" helpers for the public ticket page.
//
// The .ics file is served by the ticket-access endpoint (one source of truth,
// shared with the confirmation email — see ticketCalendarUrl in ./tickets).
// The Google Calendar link is a plain template URL, safe to build here from the
// order the page already has.
//
// Times use the UTC instant (…Z) straight from start_time, so the calendar
// renders it in the viewer's own zone — correct regardless of how the showtime
// is displayed elsewhere.

import type { PublicOrder } from './tickets';

const VENUE_NAME = 'The Kenworthy Performing Arts Centre';
const VENUE_ADDRESS = '508 S Main St, Moscow, ID 83843';
const DEFAULT_DURATION_MIN = 120;

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

function durationMinutes(order: PublicOrder): number {
  const d = Number(order.duration_minutes);
  return Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION_MIN;
}

/** One-tap "add to Google Calendar" template link for the order's showing. */
export function googleCalendarUrl(order: PublicOrder): string {
  const location = `${order.venue || VENUE_NAME}, ${VENUE_ADDRESS}`;
  const n = order.tickets.length;
  const details = `Your ${n} ticket${n === 1 ? '' : 's'} for ${order.title}. View or show at the door: ${window.location.href}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: order.title,
    dates: `${toCalUtc(order.start_time)}/${toCalUtc(order.start_time, durationMinutes(order))}`,
    location,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
