import { supabase } from '@/integrations/supabase/client';

export type ShowingAvailability = {
  totalSeats: number;
  requiresSeatSelection: boolean;
  /** Tickets occupying space: confirmed sales plus unexpired pending holds. */
  held: number;
  /** Capacity left, floored at zero. */
  available: number;
  takenSeatIds: Set<string>;
  /**
   * Each live tier's ticket limit and what is left of it, by tier id.
   * `available` is null for a tier with no limit of its own. General admission
   * only: a seated tier is bounded by its seats, and its `held` is always 0.
   */
  tiers: Map<string, TierAvailability>;
};

export type TierAvailability = {
  maxTickets: number | null;
  held: number;
  /** Left under the tier's own limit, floored at zero; null when unlimited. */
  available: number | null;
};

/**
 * How many tickets of `tierId` are left under the tier's own limit; Infinity
 * when it has none, or the lookup did not mention it. Callers still apply the
 * showing's capacity as well — the tier limit is the tighter of the two only
 * some of the time (Preferred can have 10 left in a house with 3 left).
 */
export function tierRoomLeft(
  tiers: Map<string, TierAvailability> | undefined,
  tierId: string,
): number {
  const t = tiers?.get(tierId);
  return t?.available ?? Infinity;
}

/**
 * How many tickets are left for a showing, and which seats are gone.
 *
 * This goes through the `showing_availability` RPC rather than querying
 * `tickets`, and that is not a stylistic preference — it is the only way a
 * client can get the answer. `tickets` has RLS enabled with a single SELECT
 * policy:
 *
 *     USING (user_id = auth.uid() OR public.is_admin())
 *
 * For an anonymous visitor `auth.uid()` is NULL, so `user_id = NULL` is NULL,
 * never true, and `is_admin()` is false. A direct query returns zero rows —
 * always. Verified as the anon role against both projects before this was
 * written: `GET /rest/v1/tickets?select=id` came back empty with a zero-row
 * content-range, while the same request against `showings` came back `0-0/34`.
 * So the empty result is the policy, not an empty table.
 *
 * Both callers previously read availability that way, and both were silently
 * broken by it:
 *
 *   * Showing.tsx — `ticketsSold` was permanently 0, so the quantity ceiling
 *     never engaged, and `takenSeatIds` was permanently empty, so the seat map
 *     offered seats that were already sold.
 *   * StaffPOS.tsx — worse, because `is_admin()` reads `profiles.role` while
 *     the staff policies use `user_roles`; a staff-only account sees none of
 *     the sales it just rang up.
 *
 * `held` counts unpaid `pending` rows still inside their hold window, matching
 * what the checkout function and the capacity trigger count. Counting only
 * confirmed rows would advertise seats the server is about to refuse.
 *
 * The RPC is SECURITY DEFINER and returns only aggregates and seat ids — no
 * buyer, contact or price data. Returns null if the lookup fails, so callers
 * can leave whatever they were showing untouched rather than flashing a wrong
 * "sold out".
 */
/**
 * The RPC's `tiers` column, as a map. Tolerant of its absence — a database
 * that predates 20261123060222 returns no such column — by treating every tier
 * as unlimited, which is exactly what that database enforces.
 */
function parseTiers(raw: unknown): Map<string, TierAvailability> {
  const out = new Map<string, TierAvailability>();
  if (!Array.isArray(raw)) return out;
  for (const row of raw as Array<Record<string, unknown>>) {
    if (typeof row?.tier_id !== 'string') continue;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    out.set(row.tier_id, {
      maxTickets: num(row.max_tickets),
      held: num(row.held) ?? 0,
      available: num(row.available),
    });
  }
  return out;
}

export async function fetchShowingAvailability(
  showingId: string,
): Promise<ShowingAvailability | null> {
  const { data, error } = await supabase
    .rpc('showing_availability', { p_showing_id: showingId })
    .maybeSingle();

  if (error || !data) {
    console.error('[availability] lookup failed for showing', showingId, error);
    return null;
  }

  return {
    totalSeats: data.total_seats ?? 0,
    requiresSeatSelection: !!data.requires_seat_selection,
    held: data.held ?? 0,
    available: data.available ?? 0,
    takenSeatIds: new Set<string>(data.taken_seat_ids ?? []),
    tiers: parseTiers(data.tiers),
  };
}
