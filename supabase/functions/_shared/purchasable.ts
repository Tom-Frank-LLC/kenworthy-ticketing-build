// Whether a showing can still be bought — the server's copy.
//
// This is the boundary. The browser hides the button; this refuses the sale.
// A stale tab left open across the end of a film, a cached page, a replayed
// fetch, or a direct POST to the function all arrive here and are turned away
// with the same sentence the page would have shown.
//
// Twin of src/lib/purchasable.ts (the browser's advisory copy) and of
// public.showing_ends_at(showings) / public.enforce_showing_not_past() in
// supabase/migrations/20260819143722_showing_end_and_past_sales_rules.sql,
// extended by 20260827113402_showings_no_ticket_required.sql (the trigger that
// catches the paths which never touch an edge function at all — the staff POS
// and the comp issuer both insert tickets straight from the browser). All
// three state the same rules; changing one means changing all three.
//
// Cutoff (Tom, 2026-08-19): sales stop when the show *ends*, not when it
// starts, so a 7:20 arrival at a 7:00 film is still a sale we want.
//
// No-ticket (Tom, 2026-08-26): a free showing may be marked as issuing no
// ticket at all — doors open, walk in, nothing reserved or scanned. That is a
// different state from a $0 showing, which still mints a free ticket and holds
// a seat, and the two cannot be told apart from the price. See
// NO_TICKET_REQUIRED_MESSAGE below.

/** See the note on the same constant in src/lib/purchasable.ts. */
export const DEFAULT_SHOWING_MINUTES = 120;

/** See the note on the same constant in src/lib/purchasable.ts. */
export const DOOR_GRACE_MINUTES = 240;

/**
 * What a past showing says, everywhere.
 *
 * The page and this error deliberately read identically. A buyer who submits a
 * stale tab should be told the same thing the page would have told them, not a
 * second, differently-worded fact to reconcile.
 */
export const SHOWING_PASSED_MESSAGE = 'This showing has passed.';

/**
 * What a walk-in showing says, everywhere.
 *
 * Same sentence as the page and as the trigger's PT409, for the same reason
 * the passed message is: a buyer who submits a stale tab, or a direct POST
 * from anywhere, is told the thing the page would have told them rather than a
 * second, differently-worded version of it.
 */
export const NO_TICKET_REQUIRED_MESSAGE = 'This showing does not require a ticket.';

/**
 * What a manually sold-out showing says when it carries no line of its own.
 *
 * Twin of the same constant in src/lib/purchasable.ts, and the sentence the
 * page shows — see the note there on why it promises nothing about seats
 * reopening.
 */
export const SOLD_OUT_MESSAGE = 'This showing is sold out.';

const MINUTE_MS = 60 * 1000;

export interface ShowingTiming {
  start_time: string | null | undefined;
  duration_minutes?: number | null;
  is_active?: boolean | null;
  /** See the note on the same field in src/lib/purchasable.ts. */
  manually_sold_out?: boolean | null;
  /** `showings.sold_out_message` — replaces the standard notice when set. */
  sold_out_message?: string | null;
  /** `showings.no_ticket_required`. Absent reads as false — see needsNoTicket. */
  no_ticket_required?: boolean | null;
}

export interface ProductionRuntime {
  duration_minutes?: number | null;
}

function positiveMinutes(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** showing override → film runtime → the two-hour default. */
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

/** The instant the showing is over. */
export function showingEndsAt(
  showing: ShowingTiming,
  production?: ProductionRuntime | null,
): number {
  const start = showing?.start_time ? new Date(showing.start_time).getTime() : NaN;
  return start + resolveDurationMinutes(showing, production) * MINUTE_MS;
}

/**
 * Has this showing already happened?
 *
 * A missing or unparseable start_time is not past — see the note on the same
 * decision in src/lib/purchasable.ts. Such a row fails pricing for its own
 * reasons; it should not be refused here with a sentence that misdescribes it.
 */
export function isPast(
  showing: ShowingTiming | null | undefined,
  production?: ProductionRuntime | null,
  now: number = Date.now(),
): boolean {
  if (!showing) return false;
  const end = showingEndsAt(showing, production);
  if (!Number.isFinite(end)) return false;
  return now >= end;
}

/**
 * Does this showing issue no ticket at all?
 *
 * Absent reads as false, deliberately. If this select ever loses the column —
 * a trimmed `.select(...)`, a PostgREST schema cache that has not reloaded
 * after the migration — the answer must be "this is an ordinary ticketed
 * showing", which fails towards refusing nothing rather than towards refusing
 * every sale on the site.
 *
 * The cost of that direction is bounded: the trigger on `tickets` reads the
 * column straight from the row and has no such gap, so a sale this misses is
 * still refused one layer down. The reverse default has no such backstop.
 */
export function needsNoTicket(showing: ShowingTiming | null | undefined): boolean {
  return showing?.no_ticket_required === true;
}

/**
 * Has an admin closed this showing to online sales by hand?
 *
 * The boundary's half of the rule an admin sets with one toggle. Unlike the
 * past-showing and walk-in rules beside it, this one is enforced *here and in
 * the browser only* — there is no trigger on `tickets` behind it, because the
 * box office must still be able to comp and sell in person on a night the
 * website correctly refuses. See the migration
 * 20260827154812_showings_manually_sold_out.sql for why that asymmetry is
 * deliberate rather than an omission.
 *
 * A walk-in showing is never sold out — nothing is issued, so nothing runs
 * out. Absent reads as open, which keeps a stale PostgREST schema cache from
 * being the thing that decides whether the theatre can sell tickets.
 */
export function isManuallySoldOut(showing: ShowingTiming | null | undefined): boolean {
  if (!showing) return false;
  if (needsNoTicket(showing)) return false;
  return showing.manually_sold_out === true;
}

/**
 * The sentence to refuse a sold-out showing with.
 *
 * Whitespace counts as unwritten, so an admin who opened the field and cleared
 * it gets the standard notice rather than an empty refusal.
 */
export function soldOutMessage(showing: ShowingTiming | null | undefined): string {
  const custom = showing?.sold_out_message;
  if (typeof custom === 'string' && custom.trim().length > 0) return custom.trim();
  return SOLD_OUT_MESSAGE;
}
