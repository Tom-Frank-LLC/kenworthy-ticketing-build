// Whether a showing can still be bought.
//
// Two rules of the system, not pieces of page logic:
//
//   * You cannot buy a ticket to something that has already happened.
//   * You cannot buy a ticket to something that issues no tickets.
//
// They are written down once here so that every purchase surface asks the same
// question instead of scattering `new Date(...) < new Date()` comparisons that
// drift apart, and so that adding a new surface means calling `isPurchasable`
// rather than remembering a convention.
//
// This copy is advisory. It decides what the browser *renders* — a hidden
// button, a "passed" notice — and nothing more. The authority is the server:
//
//   * supabase/functions/_shared/purchasable.ts  — the same rule, in Deno,
//     which is what `ticket-checkout` refuses a stale tab with.
//   * public.showing_ends_at(showings) and public.enforce_showing_not_past()
//     in supabase/migrations/20260819143722_showing_end_and_past_sales_rules.sql,
//     extended by 20260827113402_showings_no_ticket_required.sql — the same
//     rules again, in SQL, enforced by a BEFORE INSERT trigger on `tickets`
//     that no client can route around.
//
// All three must agree. If you change either rule, change all three.
//
// Cutoff (Tom, 2026-08-19): sales stop when the *show ends*, not when it
// starts. A patron arriving at 7:20 for a 7:00 film is still a patron.
//
// No-ticket (Tom, 2026-08-26): a free showing may be marked as issuing no
// ticket at all. See NO_TICKET_REQUIRED_MESSAGE and needsNoTicket() below.

/**
 * How long a showing runs when nothing says otherwise.
 *
 * The chain is: the showing's own `duration_minutes` (set per showing in the
 * admin form) → the film's `movies.duration_minutes` → this. Events and live
 * performances have no duration column of their own at all, so without a
 * per-showing value they land here. Two hours is deliberately generous: the
 * cost of being too long is a few extra minutes of a purchasable page, and the
 * cost of being too short is refusing a real sale during a real show.
 */
export const DEFAULT_SHOWING_MINUTES = 120;

/**
 * How long past the start staff can still admit at the door.
 *
 * Redeeming a film pass and comping a walk-up are in-person acts that happen
 * *during* the show, so they are bounded by a wider window than online sales.
 * Four hours is the same span the scanner already uses to decide what counts
 * as "tonight" (SHOWING_WINDOW_BEFORE_MS in TicketScanner.tsx) — long enough
 * for a latecomer to a marathon, short enough that a mis-picked showing from
 * last month is refused.
 */
export const DOOR_GRACE_MINUTES = 240;

/** What a past showing says, everywhere — page, drawer, and server error. */
export const SHOWING_PASSED_MESSAGE = 'This showing has passed.';

/**
 * What a walk-in showing says, everywhere — page, server error, and trigger.
 *
 * A free showing comes in two kinds and only one of them is this. `ticket_price
 * = 0` with the flag clear is still a ticket: the buyer reserves, a row is
 * written, a seat is held and capacity counts down. This is the other kind —
 * doors open, walk in, nothing is issued, reserved or scanned.
 *
 * The two are indistinguishable from the price alone, which is why the flag
 * exists rather than being inferred.
 */
export const NO_TICKET_REQUIRED_MESSAGE = 'This showing does not require a ticket.';

const MINUTE_MS = 60 * 1000;

export interface ShowingTiming {
  start_time: string | Date | null | undefined;
  /** Per-showing override, in minutes. Null on every showing created before this rule existed. */
  duration_minutes?: number | null;
  is_active?: boolean | null;
  /**
   * `showings.no_ticket_required`. Optional because most callers pass a bare
   * `{ start_time }` to ask the timing question alone, and absent has to mean
   * "ticketed" — the answer for every showing that existed before the column
   * did, and the column's own default.
   */
  no_ticket_required?: boolean | null;
}

export interface ProductionRuntime {
  /** `movies.duration_minutes`. Events and live performances have none. */
  duration_minutes?: number | null;
}

function startMs(showing: ShowingTiming): number {
  const raw = showing?.start_time;
  if (!raw) return NaN;
  const d = raw instanceof Date ? raw : new Date(raw);
  return d.getTime();
}

function positiveMinutes(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * How many minutes this showing is expected to run.
 *
 * Kept separate from `showingEndsAt` because the admin form wants to show the
 * resolved number as a placeholder — "leave blank and we'll assume 118" is a
 * more useful field than an empty box.
 */
export function resolveDurationMinutes(
  showing: ShowingTiming,
  production?: ProductionRuntime | null,
): number {
  return (
    positiveMinutes(showing?.duration_minutes) ??
    positiveMinutes(production?.duration_minutes) ??
    DEFAULT_SHOWING_MINUTES
  );
}

/** The instant the showing is over, and with it the last moment it can be sold. */
export function showingEndsAt(
  showing: ShowingTiming,
  production?: ProductionRuntime | null,
): Date {
  return new Date(startMs(showing) + resolveDurationMinutes(showing, production) * MINUTE_MS);
}

/** The instant staff can no longer admit at the door. See DOOR_GRACE_MINUTES. */
export function doorClosesAt(showing: ShowingTiming): Date {
  return new Date(startMs(showing) + DOOR_GRACE_MINUTES * MINUTE_MS);
}

/**
 * Has this showing already happened?
 *
 * An unparseable or missing start_time is *not* past. A showing we cannot date
 * should render its normal page and be refused by the server if it is somehow
 * broken — silently hiding the buy button on a bad row would look like the
 * showing sold out and would be invisible to whoever has to fix it.
 */
export function isPast(
  showing: ShowingTiming | null | undefined,
  production?: ProductionRuntime | null,
  now: number = Date.now(),
): boolean {
  if (!showing) return false;
  const end = showingEndsAt(showing, production).getTime();
  if (!Number.isFinite(end)) return false;
  return now >= end;
}

/**
 * Does this showing issue no ticket at all?
 *
 * The question is about the showing's *kind*, not its price and not the clock,
 * so unlike `isPast` it takes no `now` and unlike a free-price check it cannot
 * be answered by arithmetic. A $0 showing with this false is still ticketed —
 * see NO_TICKET_REQUIRED_MESSAGE.
 *
 * Absent reads as false. Every showing created before the column existed is
 * ticketed, and so is every row PostgREST returns before it reloads its schema
 * cache — a state that would otherwise turn every showing on the site into a
 * walk-in for as long as it lasted.
 */
export function needsNoTicket(showing: ShowingTiming | null | undefined): boolean {
  return showing?.no_ticket_required === true;
}

/**
 * The one question every purchase surface should ask.
 *
 * Deliberately *not* a capacity check: sold-out is a different state with its
 * own notice, and a showing can be both. Callers that care about capacity
 * check it alongside this, as Showing.tsx does.
 *
 * A walk-in showing is not purchasable, but it is also not *closed* — the page
 * still has a date, a venue and a trailer to show, and the listings still want
 * to link to it. So surfaces that render something different for a walk-in ask
 * `needsNoTicket` directly rather than reading `false` from here and hiding
 * everything; this answers only "can money change hands", which is what the
 * buy button and the server both need.
 */
export function isPurchasable(
  showing: ShowingTiming | null | undefined,
  production?: ProductionRuntime | null,
  now: number = Date.now(),
): boolean {
  if (!showing) return false;
  if (showing.is_active === false) return false;
  if (needsNoTicket(showing)) return false;
  return !isPast(showing, production, now);
}
