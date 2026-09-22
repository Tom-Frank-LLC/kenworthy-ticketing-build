import { supabase } from '@/integrations/supabase/client';

/** One tier as the admin typed it, in display order. */
export interface PriceTierInput {
  tier_name: string;
  price: number;
  /** Seat-editor swatch. Omitted keeps whatever the row already has. */
  color?: string;
}

/** A live tier as the database returns it after a save. */
export interface PriceTierRow {
  id: string;
  showing_id: string;
  tier_name: string;
  price: number;
  color: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

/**
 * Replace a showing's price tiers with `tiers`, and return the live rows.
 *
 * The only way tiers are written. It used to be delete-then-insert from two
 * different components, and neither checked the delete: tickets.tier_id has
 * no ON DELETE, so the first sale against a tier made every later delete fail
 * (silently) and every later insert append — which is how a showing ended up
 * with General Admission four times over. See
 * docs/FINDINGS-duplicate-price-tiers.md.
 *
 * set_showing_price_tiers() reconciles by name instead: a tier that is still
 * in the list is updated in place (its id, and every ticket pointing at it,
 * survives the save), a new name is inserted, a removed tier is deleted if
 * nothing references it and retired (is_active = false) if a ticket does.
 * Atomic, and admin-gated in the function itself.
 *
 * Throws on any failure: the caller has already saved the showing by the
 * time this runs, and a tier write that fails quietly is exactly the bug.
 */
export async function setShowingPriceTiers(
  showingId: string,
  tiers: PriceTierInput[],
): Promise<PriceTierRow[]> {
  const { data, error } = await supabase.rpc('set_showing_price_tiers', {
    p_showing_id: showingId,
    p_tiers: tiers.map(t => ({
      tier_name: t.tier_name.trim(),
      price: t.price,
      ...(t.color ? { color: t.color } : {}),
    })),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PriceTierRow[];
}
