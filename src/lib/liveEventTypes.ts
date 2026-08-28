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

export const TICKETING_MODES: { value: TicketingMode; label: string; help: string }[] = [
  { value: 'ticketed', label: 'Ticketed', help: 'Sold here. Add shows to give it dates.' },
  { value: 'rsvp', label: 'RSVP', help: 'Booked somewhere else, through the link below.' },
  { value: 'info_only', label: 'Info only', help: 'Listed for information. Nothing to book.' },
];

/** Human label for a stored type, for badges and lists. Falls back to the raw value. */
export function liveEventTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return LIVE_EVENT_TYPES.find(t => t.value === value)?.label
    ?? value.replace(/_/g, ' ');
}

/** Human label for a stored ticketing mode. */
export function ticketingLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return TICKETING_MODES.find(t => t.value === value)?.label
    ?? value.replace(/_/g, ' ');
}
