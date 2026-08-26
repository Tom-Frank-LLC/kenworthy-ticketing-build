/**
 * What the public /rentals calendar is allowed to say about a given day.
 *
 * Two sources feed it, and they are not equally trustworthy:
 *
 *  - **Programmed showings** carry `start_time` (a real instant) and
 *    `duration_minutes`, so their hour span is known exactly. They are already
 *    public — the same rows render on the listings page.
 *
 *  - **Approved rentals** carry `arrival_time` / `departure_time` as `text`.
 *    Every value written through /rental-request comes from an
 *    `<input type="time">`, so in practice it is `HH:MM` — but the column is
 *    text and nothing constrains it, so a value that does not parse has to be
 *    survivable rather than guessed at.
 *
 * That second case is the whole reason this file exists. An hour grid invites
 * the reader to trust it to the hour, so a booking whose times we cannot read
 * must NOT be flattened into either answer. Claiming those hours are booked
 * costs a rental that was actually available; claiming they are free books a
 * double. Both are worse than saying we do not know, so an unreadable time
 * yields `'unknown'` rows and the day still reads "Limited availability".
 *
 * A renter's name, contact details and — unless they ticked `is_public` — the
 * title of their event never reach this module. Redaction happens in the
 * database, in `get_public_availability`, so it cannot be undone by a mistake
 * in the page. See supabase/migrations/*_public_rental_availability.sql.
 */

/** First hour rendered in the day view (8 AM). */
export const DAY_VIEW_START_HOUR = 8;
/** Last hour rendered starts at 10 PM and runs to 11 PM. */
export const DAY_VIEW_END_HOUR = 23;

export type OccupiedKind = 'showing' | 'rental';

/**
 * One occupied block on one venue-local calendar day.
 *
 * `startMinutes` / `endMinutes` are minutes from midnight, or `null` when the
 * source could not give us a time we can stand behind.
 */
export type OccupiedBlock = {
  dayKey: string;
  startMinutes: number | null;
  endMinutes: number | null;
  isPublic: boolean;
  /** Only ever populated for a public booking. */
  title: string | null;
  kind: OccupiedKind;
};

export type HourStatus = 'available' | 'unavailable' | 'unknown';
export type DayStatus = 'available' | 'limited' | 'unavailable';

export type HourRow = {
  hour: number;
  label: string;
  status: HourStatus;
  detail: string | null;
};

export type DayView = {
  dayKey: string;
  status: DayStatus;
  /** Set only when the day is a black-out; carries the reason. */
  blackoutLabel: string | null;
  rows: HourRow[];
  /** Blocks we could not place on the hour grid, surfaced as a day-level note. */
  untimed: OccupiedBlock[];
};

/** What a block is called in front of a stranger. */
export function blockLabel(block: OccupiedBlock): string {
  if (block.isPublic && block.title) return block.title;
  return block.kind === 'showing' ? 'Programmed event' : 'Private event';
}

/**
 * Minutes from midnight for a stored clock time, or `null` if it cannot be
 * read confidently.
 *
 * Accepts what the form actually writes (`HH:MM`, and `HH:MM:SS` should the
 * column ever be fed from a `time` value) plus the 12-hour spellings a human
 * editing the row by hand would reach for. Anything else — a range, a word, a
 * half-typed value — is `null` rather than a guess.
 */
export function parseClockMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const match = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/.exec(text);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3];

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (minute > 59) return null;

  if (meridiem) {
    // 12-hour clock: 12am is midnight, 12pm is noon.
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === 'pm') hour += 12;
  } else {
    // A bare hour with no meridiem is only readable as 24-hour.
    if (hour > 23) return null;
    // "7:00" with no meridiem is ambiguous in principle, but every value this
    // app writes comes from an <input type="time">, which is always 24-hour.
    // Reading it as 24-hour is therefore the source's own meaning, not a guess.
  }

  return hour * 60 + minute;
}

/** `"8:00 AM"`, `"12:00 PM"`, `"10:00 PM"` — the venue's own clock. */
export function formatHourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${suffix}`;
}

/**
 * Does a block cover any part of the hour beginning at `hour`?
 *
 * Half-open on both sides: a booking that ends at 9:00 does not occupy the
 * 9 AM row, and one that starts at 8:59 does.
 */
function coversHour(block: OccupiedBlock, hour: number): boolean {
  if (block.startMinutes === null) return false;
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;
  // An end we could not read is treated as "until we know otherwise, one
  // hour" rather than "the rest of the day" — over-claiming the evening off
  // one unreadable field would quietly close the calendar.
  const end = block.endMinutes ?? block.startMinutes + 60;
  // An end at or before the start reads as a booking that crosses midnight or
  // as a typo. Neither justifies painting the rest of the day, so it gets the
  // same one-hour floor.
  const safeEnd = end > block.startMinutes ? end : block.startMinutes + 60;
  return block.startMinutes < hourEnd && safeEnd > hourStart;
}

/**
 * The right-hand pane for one clicked day.
 *
 * A black-out closes the day outright. Otherwise the day is "Limited
 * availability" the moment anything sits on it — never "Unavailable", because
 * a day with a 7 PM screening still has a free morning to rent.
 */
export function buildDayView(input: {
  dayKey: string;
  blocks: OccupiedBlock[];
  blackoutLabel?: string | null;
}): DayView {
  const { dayKey, blackoutLabel = null } = input;
  const blocks = input.blocks.filter(b => b.dayKey === dayKey);

  const hours: number[] = [];
  for (let h = DAY_VIEW_START_HOUR; h < DAY_VIEW_END_HOUR; h++) hours.push(h);

  if (blackoutLabel) {
    return {
      dayKey,
      status: 'unavailable',
      blackoutLabel,
      rows: hours.map(hour => ({
        hour,
        label: formatHourLabel(hour),
        status: 'unavailable' as const,
        detail: blackoutLabel,
      })),
      untimed: [],
    };
  }

  const untimed = blocks.filter(b => b.startMinutes === null);

  const rows: HourRow[] = hours.map(hour => {
    const hit = blocks.find(b => coversHour(b, hour));
    if (hit) {
      return { hour, label: formatHourLabel(hour), status: 'unavailable' as const, detail: blockLabel(hit) };
    }
    if (untimed.length > 0) {
      // Something holds this day but would not tell us when. Saying "available"
      // here would be a promise we cannot keep.
      return { hour, label: formatHourLabel(hour), status: 'unknown' as const, detail: blockLabel(untimed[0]) };
    }
    return { hour, label: formatHourLabel(hour), status: 'available' as const, detail: null };
  });

  return {
    dayKey,
    status: blocks.length > 0 ? 'limited' : 'available',
    blackoutLabel: null,
    rows,
    untimed,
  };
}

/** Day-level status for painting the calendar cells and their labels. */
export function dayStatus(
  dayKey: string,
  blocks: OccupiedBlock[],
  blackoutLabel?: string | null,
): DayStatus {
  if (blackoutLabel) return 'unavailable';
  return blocks.some(b => b.dayKey === dayKey) ? 'limited' : 'available';
}

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  available: 'Available',
  limited: 'Limited availability',
  unavailable: 'Unavailable',
};

export const HOUR_STATUS_LABEL: Record<HourStatus, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  unknown: 'Check with us',
};
