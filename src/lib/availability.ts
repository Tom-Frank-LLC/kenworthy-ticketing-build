import { supabase } from '@/integrations/supabase/client';

export type ShowingAvailability = {
  totalSeats: number;
  requiresSeatSelection: boolean;
  /** Tickets occupying space: confirmed sales plus unexpired pending holds. */
  held: number;
  /** Capacity left, floored at zero. */
  available: number;
  takenSeatIds: Set<string>;
};

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
  };
}
