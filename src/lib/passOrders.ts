/**
 * Shared shape and formatting for the outstanding film-pass order queue.
 *
 * A paid online order is an obligation: money taken, physical pass still owed.
 * Two screens show that queue — the box office counter (`FilmPassPOS`, which
 * can activate against a row) and the admin dashboard (`FilmPassesTab`, which
 * is read-only oversight). Both render the mailing address, and that address
 * is hand-copied onto an envelope, so it must not drift between them.
 *
 * The write side is `supabase/functions/_shared/pass_orders.ts`, which
 * validates and normalises every field before it is stored. This module is the
 * read side and deliberately re-trims rather than trusting that, because a row
 * written before a validation rule existed is still a row staff have to post.
 */

export type PassFulfillment = 'pickup' | 'mail';

/**
 * As stored in `film_pass_orders.mailing_address` (jsonb). Every field is
 * optional here even though the edge function requires all but `line2` — this
 * is untyped JSON coming back from the database, not a validated input.
 */
export interface PassMailingAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

/** One row of the `queue` action's response from `film-pass-checkout`. */
export interface QueuedPassOrder {
  id: string;
  quantity: number;
  fulfillment: PassFulfillment;
  mailing_address: PassMailingAddress | null;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  amount_paid: number;
  created_at: string;
  pass_type_id: string;
  pass_type_name: string;
}

const clean = (value: string | null | undefined) => (value ?? '').trim();

/**
 * One-line postal address for display.
 *
 * Built piece by piece rather than by interpolating a template, so a row
 * missing a city or a ZIP renders as much as it has instead of the stray
 * punctuation a half-filled `${city}, ${state} ${zip}` leaves behind. An
 * address that is entirely empty returns '' — callers decide what to show
 * in that case, because "no address on a mail order" is a data problem worth
 * surfacing rather than papering over.
 */
export function formatMailingAddress(address: PassMailingAddress | null | undefined): string {
  if (!address) return '';

  const stateAndZip = [clean(address.state), clean(address.postal_code)]
    .filter(Boolean)
    .join(' ');

  const cityLine = [clean(address.city), stateAndZip].filter(Boolean).join(', ');

  return [clean(address.line1), clean(address.line2), cityLine].filter(Boolean).join(', ');
}

/** Buyer label for a queue row, falling back through the fields most likely to be set. */
export function passOrderBuyerLabel(order: Pick<QueuedPassOrder, 'buyer_name' | 'buyer_email'>): string {
  return clean(order.buyer_name) || clean(order.buyer_email) || 'Unnamed buyer';
}
