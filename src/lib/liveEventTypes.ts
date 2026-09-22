/**
 * What a live event is, and how people get in — the two things the admin used
 * to answer by choosing between two buttons.
 *
 * "Add Event" and "Add Performance" wrote to `events` and `live_performances`
 * respectively, and each table could express only half of this: an event
 * carried a ticketing mode with no idea what kind of thing it was, and a
 * performance carried its art form but was silently always ticketed. The two
 * are independent — an RSVP concert is an ordinary thing to want — so they are
 * two fields now, and one form asks both.
 *
 * The tables still exist. New live events are written to `events`, which can
 * hold the whole shape; `live_performances` is kept for the rows already in it.
 */

export type LiveEventType =
  | 'concert'
  | 'stand_up_comedy'
  | 'theatre'
  | 'dance'
  | 'film_screening'
  | 'community_event';

export const LIVE_EVENT_TYPES: { value: LiveEventType; label: string }[] = [
  { value: 'concert', label: 'Concert' },
  { value: 'stand_up_comedy', label: 'Stand-up comedy' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'dance', label: 'Dance' },
  { value: 'film_screening', label: 'Film screening' },
  { value: 'community_event', label: 'Community event' },
];

/**
 * The four an existing `live_performances` row can hold.
 *
 * That table's enum predates the unified one and was never extended, so
 * editing one of its rows must not offer a type it cannot store — the write
 * would fail at the database rather than in the form.
 */
export const LEGACY_PERFORMANCE_TYPES: LiveEventType[] = [
  'concert',
  'stand_up_comedy',
  'theatre',
  'dance',
];

export type TicketingMode = 'ticketed' | 'rsvp' | 'info_only';

/**
 * Which vocabulary a production uses for the `rsvp` mode.
 *
 * The column value is `rsvp` on every table, because it was born on events
 * and a concert people RSVP to is what it meant. A film is not RSVP'd to —
 * it is ticketed by somebody else — so the same stored value is called
 * "External" wherever a film is being talked about (Tom, 2026-09-22). One
 * value, two words; nothing about the data or the rules differs.
 */
export type TicketingKind = 'film' | 'live';

export const TICKETING_MODES: { value: TicketingMode; label: string; help: string }[] = [
  { value: 'ticketed', label: 'Ticketed', help: 'Sold here. Add shows to give it dates.' },
  { value: 'rsvp', label: 'RSVP', help: 'Booked somewhere else, through the link below.' },
  { value: 'info_only', label: 'Info only', help: 'Listed for information. Nothing to book.' },
];

const FILM_TICKETING_MODES: typeof TICKETING_MODES = [
  { value: 'ticketed', label: 'Ticketed', help: 'Sold here. Add showings to give it dates.' },
  { value: 'rsvp', label: 'External', help: 'Sold somewhere else, through the link below. Showings still list the dates.' },
  { value: 'info_only', label: 'Info only', help: 'Listed for information. Nothing to book.' },
];

/** The three modes, worded for the kind of production being edited. */
export function ticketingModesFor(kind: TicketingKind): typeof TICKETING_MODES {
  return kind === 'film' ? FILM_TICKETING_MODES : TICKETING_MODES;
}

/** What the outside-link field is called on the form. */
export function rsvpUrlFieldLabel(kind: TicketingKind): string {
  return kind === 'film' ? 'External ticket URL' : 'RSVP URL';
}

/**
 * Why an outside link cannot be saved, or null when it can.
 *
 * Required, and https only. A production in `rsvp` mode with no link renders
 * as if it were ticketed here — every reader of the flag checks
 * `rsvp && rsvp_url` before offering the outside link and falls through to
 * the internal path otherwise — so a blank is not "no link yet", it is a film
 * that silently sells nothing. Any other mode ignores the field entirely; the
 * forms clear it.
 */
export function rsvpUrlError(mode: TicketingMode, url: string, kind: TicketingKind = 'live'): string | null {
  if (mode !== 'rsvp') return null;
  const noun = kind === 'film' ? 'external ticket link' : 'RSVP link';
  const trimmed = url.trim();
  if (!trimmed) return `An ${noun} is needed — that is where people will be sent for tickets.`;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return `The ${noun} is not a valid URL. It should start with https://`;
  }
  if (parsed.protocol !== 'https:') return `The ${noun} must start with https://`;
  return null;
}

/** Human label for a stored type, for badges and lists. Falls back to the raw value. */
export function liveEventTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return LIVE_EVENT_TYPES.find(t => t.value === value)?.label
    ?? value.replace(/_/g, ' ');
}

/** Human label for a stored ticketing mode, in the kind's own words. */
export function ticketingLabel(value: string | null | undefined, kind: TicketingKind = 'live'): string | null {
  if (!value) return null;
  return ticketingModesFor(kind).find(t => t.value === value)?.label
    ?? value.replace(/_/g, ' ');
}
