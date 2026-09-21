// The per-buyer ticket limit for online checkout.
//
// `showings.max_tickets_per_buyer`: a number, or NULL for "no cap" (migration
// …_showings_max_tickets_per_buyer.sql, which also records where the old
// constant of 4 came from and why it went).
//
// The limit is on what one buyer HOLDS for a showing, not on one purchase: two
// orders of 12 are 24, against a limit of 20. "Buyer" is the contact they typed,
// so this is a courtesy limit, not a security boundary — capacity is enforced by
// the database, and bots are Turnstile's and the rate limiter's job.

/**
 * An absurd request is refused before anything is read from the database —
 * pricing loads rows per ticket, and an uncapped showing must not turn one POST
 * into unbounded work. Far above any real house: the theatre seats a few hundred.
 */
export const MAX_TICKETS_PER_REQUEST = 1000;

/** Why this purchase may not go ahead, or null if it may. */
export function ticketLimitError(
  limit: number | null | undefined,
  alreadyHeld: number,
  requested: number,
): string | null {
  if (limit === null || limit === undefined) return null; // no cap on this showing
  if (alreadyHeld + requested <= limit) return null;

  if (alreadyHeld === 0) {
    return `This showing allows up to ${limit} tickets per buyer online. For a larger group, please call the box office.`;
  }
  const room = Math.max(0, limit - alreadyHeld);
  return room === 0
    ? `You already have ${alreadyHeld} ticket(s) for this showing, which is the most one buyer can hold online. For more, please call the box office.`
    : `You already have ${alreadyHeld} ticket(s) for this showing, so you can add up to ${room} more online. For a larger group, please call the box office.`;
}
