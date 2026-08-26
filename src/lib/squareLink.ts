// What the admin Square-catalog surfaces are allowed to hide, and what a
// showing's save is allowed to stay quiet about.
//
// Both rules live here rather than in the components because both were, until
// now, held in two places that disagreed with each other. The linking list and
// the flag box each decided independently which productions to show, and each
// concluded the other one was handling it — so movies and events could be
// dismissed but never linked. And the save-time warning tested a single count
// out of the eight statuses the planner can return, so four different ways of
// failing to reach Square all looked exactly like success.
//
// The authority for the statuses named below is the planner in
// `supabase/functions/square-showing-variations/index.ts`. If a status is added
// there, add it here too: the default in `squareSaveOutcome` is to stay silent,
// which is the wrong default for a status nobody has classified yet.

export type ProductionKind = 'movie' | 'event' | 'live_performance';

/**
 * Which table a production kind's dismissal is recorded against.
 *
 * `SquareLinkPanel` writes dismissals keyed by table name because its scopes
 * are surfaces ("live_performances" covers two kinds), while the linking list
 * is keyed by production kind. Both have to arrive at the same string or a
 * title dismissed in one place goes on being flagged in the other — which is
 * the same "two panels answering one question" confusion that made the
 * original bug possible.
 */
export const PRODUCTION_KIND_TABLE: Record<ProductionKind, string> = {
  movie: 'movies',
  event: 'events',
  live_performance: 'live_performances',
};

/** The (entity_type, entity_id) pair `square_link_dismissals` is keyed by. */
export function dismissalKey(kind: ProductionKind, productionId: string): string {
  return `${PRODUCTION_KIND_TABLE[kind]}:${productionId}`;
}

/** Build the lookup set from what the dismissals table returned. */
export function dismissedKeys(
  rows: Array<{ entity_type: string; entity_id: string }> | null | undefined,
): Set<string> {
  return new Set((rows ?? []).map(r => `${r.entity_type}:${r.entity_id}`));
}

/**
 * The unlinked productions this surface should actually show.
 *
 * Two filters, and both are load-bearing:
 *
 * 1. **Kind.** `needs_dashboard_item` is assembled in the edge function *before*
 *    the `kinds` scope is applied — the scope narrows `adoptable`, `appendable`
 *    and `price_drift` and nothing else. So a request scoped to movies still
 *    gets every live performance in this list, and filtering here is the only
 *    thing standing between the Movies tab and a list of concerts. Rows carry
 *    `kind`, not the `production_kind` the other three lists use.
 *
 * 2. **Dismissal.** The flag box lets someone say "stop telling me about this".
 *    If the linking list ignored that, dismissing a title would visibly fail —
 *    it would vanish from one box on the tab and stay put in the other.
 */
export function needsForScope<T extends { production_id: string; kind: ProductionKind }>(
  rows: T[] | null | undefined,
  kinds: ProductionKind[] | null | undefined,
  dismissed: ReadonlySet<string> = new Set(),
): T[] {
  const scoped = !!kinds?.length;
  return (rows ?? []).filter(
    r => (!scoped || kinds!.includes(r.kind)) && !dismissed.has(dismissalKey(r.kind, r.production_id)),
  );
}

// --- the save-time warning --------------------------------------------------

export interface SquareSaveOutcome {
  /** Sonner level. Nothing here is an error: the showing is already saved. */
  tone: 'warning';
  message: string;
  /** Which signal produced it, for the console line and for tests. */
  code: string;
}

/**
 * What to tell someone who just saved a showing, about Square.
 *
 * The old rule was `counts.needs_item` and nothing else. That is one of four
 * statuses meaning "this showing did not get a catalog item", and the other
 * three are worse, not better:
 *
 *   * `ambiguous_item`   — two Square items share the title, so the planner
 *                          refused to guess. Visible in the unlinked list, but
 *                          the save said nothing.
 *   * `not_event_item`   — the title is linked to a REGULAR item, which cannot
 *                          hold a showtime at all. Not in the unlinked list
 *                          either, so this was silent *everywhere*.
 *   * `stored_item_gone` — the linked item is no longer in the catalog. Also
 *                          silent everywhere.
 *
 * Ordered most-actionable first and deliberately returns one message: a save
 * that fires four toasts trains people to dismiss all of them.
 */
export function squareSaveOutcome(response: unknown): SquareSaveOutcome | null {
  const r = (response ?? {}) as {
    counts?: Record<string, number>;
    tally?: Record<string, number>;
    skipped?: Array<{ reason?: string }>;
  };
  const counts = r.counts ?? {};
  const tally = r.tally ?? {};
  const skipped = r.skipped ?? [];
  const warn = (code: string, message: string): SquareSaveOutcome => ({ tone: 'warning', code, message });

  // --- the title has no usable catalog item ---
  if (counts.needs_item) {
    return warn('needs_item', 'Saved. This title has no Square item yet — link it under Square catalog.');
  }
  if (counts.ambiguous_item) {
    return warn(
      'ambiguous_item',
      'Saved. More than one Square item has this title, so nothing was linked — pick the right one under Square catalog.',
    );
  }
  if (counts.not_event_item) {
    return warn(
      'not_event_item',
      'Saved. This title is linked to a Square item that is not an Event item, so it cannot carry showtimes. Relink it under Square catalog.',
    );
  }
  if (counts.stored_item_gone) {
    return warn(
      'stored_item_gone',
      'Saved. The Square item this title was linked to is no longer in the catalog — relink it under Square catalog.',
    );
  }

  // --- the item was fine; the write was not ---
  if (tally.accepted_but_not_stored) {
    return warn('accepted_but_not_stored', 'Saved, but Square did not keep the ticket items. Tell a manager.');
  }
  if (tally.error || tally.refused) {
    return warn(
      'write_failed',
      'Saved, but Square did not take the ticket items. It will sell without item reporting — try again from Square catalog.',
    );
  }
  if (tally.written_unmapped) {
    return warn(
      'written_unmapped',
      'Saved. Square has the ticket items but our link to them did not store — refresh Square catalog before selling.',
    );
  }

  // --- nothing was even planned ---
  //
  // `skipped` is the planner saying it declined to build a variation. The
  // reasons are exact strings from `desiredVariations`; anything unrecognised
  // still warns, because an unexplained skip is the failure mode this whole
  // function exists to end.
  const reasons = new Set(skipped.map(s => s.reason).filter(Boolean) as string[]);
  if (reasons.has('showing has no production row')) {
    return warn(
      'no_production',
      'Saved, but Square could not tell what this showing is for, so it has no ticket items.',
    );
  }
  if (reasons.has('no valid price')) {
    return warn(
      'no_price',
      'Saved, but this showing has no usable price, so it has no ticket items in Square.',
    );
  }
  if (reasons.size) {
    return warn('skipped', `Saved, but Square skipped this showing: ${[...reasons].join('; ')}.`);
  }

  // A response that planned nothing and skipped nothing means the showing never
  // reached the planner — the function's own "no active showings" early return
  // answers exactly this shape. It is a success code carrying no work.
  if (!Object.keys(counts).length) {
    return warn(
      'nothing_planned',
      'Saved, but Square was not given any ticket items for this showing. Check it under Square catalog.',
    );
  }

  return null;
}
