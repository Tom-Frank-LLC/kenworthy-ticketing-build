// Whether a showing can still be bought — the server's copy.
//
// This is the boundary. The browser hides the button; this refuses the sale.
// A stale tab left open across the end of a film, a cached page, a replayed
// fetch, or a direct POST to the function all arrive here and are turned away
// with the same sentence the page would have shown.
//
// Twin of src/lib/purchasable.ts (the browser's advisory copy) and of
// public.showing_ends_at(showings) in
// supabase/migrations/20260819143722_showing_end_and_past_sales_rules.sql
// (the trigger that catches the paths which never touch an edge function at
// all — the staff POS and the comp issuer both insert tickets straight from
// the browser). All three state the same rule; changing one means changing
// all three.
//
// Cutoff (Tom, 2026-08-19): sales stop when the show *ends*, not when it
// starts, so a 7:20 arrival at a 7:00 film is still a sale we want.

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

const MINUTE_MS = 60 * 1000;

export interface ShowingTiming {
  start_time: string | null | undefined;
  duration_minutes?: number | null;
  is_active?: boolean | null;
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
