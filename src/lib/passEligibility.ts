/**
 * Which passes are good at which screenings.
 *
 * Eligibility used to be a boolean on the showing, which could only ever speak
 * for every pass at once. It is now a row in `pass_type_showings` per (pass
 * type, showing): a pass is good at a screening iff that row exists, and a
 * screening nobody has tagged accepts no passes at all. The door enforces this
 * inside `admit_with_film_pass`; everything here is the admin side of the same
 * table.
 *
 * Three screens write it — the showing form (one screening, on save), the bulk
 * tagger (a festival's whole run at once) and nothing else — and they all go
 * through `setShowingEligibility` so they cannot disagree about what a write
 * means. That matters more than it looks: the natural implementation is
 * "delete everything for this showing, insert the ticked ones", and that would
 * make a bulk edit for one pass type silently untag every *other* pass from
 * every screening it touched.
 */

import { supabase } from '@/integrations/supabase/client';

/**
 * The face value of an ordinary screening.
 *
 * A business fact, not a derivable one — a $12 movie and an $8 movie differ by
 * a pricing decision, and nothing in the schema records which screenings are
 * "standard". It is used for one thing only: deciding whether the showing form
 * pre-ticks the default passes for a newly priced movie. Nothing at the door
 * reads it, deliberately — 20260813000000 declined to derive eligibility from
 * price precisely so a price change could never silently start or stop
 * accepting passes, and that still holds. This only moves a checkbox, in front
 * of somebody who can see it move and untick it.
 */
export const STANDARD_MOVIE_TICKET_PRICE = 8;

export interface PassTypeOption {
  id: string;
  name: string;
  redemption_price: number;
  per_showing_use_limit: number | null;
  is_default_for_movies: boolean;
  is_active: boolean;
}

/**
 * Pass types offered when tagging a screening.
 *
 * Inactive types come back too. A pass that is no longer sold may still be in
 * a patron's wallet with a balance on it, so its eligibility rows still need
 * to be visible and editable — hiding it here would make an existing tag
 * un-untickable and read as data loss.
 */
export async function fetchPassTypes(): Promise<PassTypeOption[]> {
  const { data, error } = await supabase
    .from('film_pass_types')
    .select('id, name, redemption_price, per_showing_use_limit, is_default_for_movies, is_active')
    .order('name');

  if (error) throw new Error(error.message);

  return (data ?? []).map(t => ({
    id: t.id,
    name: t.name,
    // Postgres numeric arrives as a string through PostgREST.
    redemption_price: Number(t.redemption_price ?? 0),
    per_showing_use_limit: t.per_showing_use_limit ?? null,
    is_default_for_movies: !!t.is_default_for_movies,
    is_active: !!t.is_active,
  }));
}

/** The pass types currently tagged for one screening. */
export async function fetchShowingEligibility(showingId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('pass_type_showings')
    .select('pass_type_id')
    .eq('showing_id', showingId);

  if (error) throw new Error(error.message);
  return (data ?? []).map(r => r.pass_type_id);
}

/**
 * Make the tags for one screening match `passTypeIds` exactly.
 *
 * Written as a diff rather than delete-then-insert for two reasons. It leaves
 * `created_at` / `created_by` intact on tags nobody changed, so "who made this
 * screening redeemable" survives an unrelated edit to the same form. And a
 * failed insert after a successful delete would leave the screening accepting
 * *nothing*, which is the one wrong state that is invisible until a patron is
 * turned away at the door — a diff that fails partway leaves the tags it has
 * not reached alone.
 *
 * RLS on this table filters writes rather than failing them, so a blocked
 * insert comes back as 204 with no error. Both writes therefore ask for their
 * rows back and the count is checked, which is the only thing that says
 * whether anything actually happened.
 */
export async function setShowingEligibility(
  showingId: string,
  passTypeIds: string[],
): Promise<void> {
  const wanted = new Set(passTypeIds);
  const current = new Set(await fetchShowingEligibility(showingId));

  const toAdd = [...wanted].filter(id => !current.has(id));
  const toRemove = [...current].filter(id => !wanted.has(id));

  if (toRemove.length > 0) {
    const { data, error } = await supabase
      .from('pass_type_showings')
      .delete()
      .eq('showing_id', showingId)
      .in('pass_type_id', toRemove)
      .select('id');

    if (error) throw new Error(error.message);
    if ((data ?? []).length !== toRemove.length) {
      throw new Error('Pass eligibility could not be removed — check your permissions.');
    }
  }

  if (toAdd.length > 0) {
    const { data, error } = await supabase
      .from('pass_type_showings')
      .insert(toAdd.map(pass_type_id => ({ pass_type_id, showing_id: showingId })))
      .select('id');

    if (error) throw new Error(error.message);
    if ((data ?? []).length !== toAdd.length) {
      throw new Error('Pass eligibility could not be saved — check your permissions.');
    }
  }
}

/**
 * Tag or untag one pass type across many screenings at once.
 *
 * The festival case: a run is twenty screenings, and setting them one form at
 * a time is how a feature goes unused. Scoped to a single pass type on purpose
 * — it only ever adds or removes rows for `passTypeId`, so bulk-tagging a
 * festival cannot disturb which screenings the standard pass covers.
 *
 * Re-tagging an already-tagged screening is the normal case when extending a
 * run, and the unique constraint on the pair would fail the whole batch for it.
 * Handled by reading what is already there and inserting only the difference,
 * rather than by an ignore-duplicates upsert: the count then means exactly one
 * thing, so a short count is an RLS refusal and can be raised. Under
 * ignore-duplicates the two are indistinguishable, and a silently blocked
 * bulk-tag reads as "12 of 12, the rest already did" — a success message for
 * work that did not happen.
 *
 * Returns how many rows actually changed.
 */
export async function setBulkEligibility(
  passTypeId: string,
  showingIds: string[],
  eligible: boolean,
): Promise<number> {
  if (showingIds.length === 0) return 0;

  const { data: existing, error: readErr } = await supabase
    .from('pass_type_showings')
    .select('showing_id')
    .eq('pass_type_id', passTypeId)
    .in('showing_id', showingIds);

  if (readErr) throw new Error(readErr.message);
  const already = new Set((existing ?? []).map(r => r.showing_id));

  if (!eligible) {
    const toRemove = showingIds.filter(id => already.has(id));
    if (toRemove.length === 0) return 0;

    const { data, error } = await supabase
      .from('pass_type_showings')
      .delete()
      .eq('pass_type_id', passTypeId)
      .in('showing_id', toRemove)
      .select('id');

    if (error) throw new Error(error.message);
    if ((data ?? []).length !== toRemove.length) {
      throw new Error('Some screenings could not be untagged — check your permissions.');
    }
    return toRemove.length;
  }

  const toAdd = showingIds.filter(id => !already.has(id));
  if (toAdd.length === 0) return 0;

  const { data, error } = await supabase
    .from('pass_type_showings')
    .insert(toAdd.map(showing_id => ({ pass_type_id: passTypeId, showing_id })))
    .select('id');

  if (error) throw new Error(error.message);
  if ((data ?? []).length !== toAdd.length) {
    throw new Error('Some screenings could not be tagged — check your permissions.');
  }
  return toAdd.length;
}
