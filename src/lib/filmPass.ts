/**
 * The one description of a film pass that the buying pages share.
 *
 * Three surfaces read a pass now — the gallery at /film-passes, the per-pass
 * page at /film-pass/:id, and the purchase panel inside it — and all three
 * quote the same offer back to the buyer. The column list and the two derived
 * sentences live here so a card cannot advertise one thing while the order
 * summary charges for another.
 *
 * Nothing here is authority. `film-pass-checkout` prices the order from
 * `film_pass_types` on the server; these numbers exist to agree with it on
 * screen, which is a display obligation rather than a pricing one.
 */

export interface PassType {
  id: string;
  name: string;
  price: number;
  initial_balance: number;
  redemption_price: number;
  /** What a seat costs at the door. Null on a pass nobody has priced. */
  ticket_face_value: number | null;
  expiration_days: number | null;
  /** Artwork in the pass-images bucket. Null on a pass nobody has given one. */
  image_path: string | null;
  /** Where this pass is and is not valid. Staff-edited; null prints nothing. */
  fine_print: string | null;
  /** Set when the pass belongs to a festival, which gets its own page. */
  festival_slug: string | null;
}

/**
 * Every column the buying pages need, as one string.
 *
 * Shared because a page that forgets `ticket_face_value` does not fail — it
 * quietly falls back to the barer sentence, which reads as a deliberate choice
 * rather than as a missing column.
 */
export const PASS_TYPE_COLUMNS =
  'id, name, price, initial_balance, redemption_price, ticket_face_value, ' +
  'expiration_days, image_path, fine_print, festival_slug';

/** Up to this many per order; past it, the box office wants a conversation. */
export const MAX_PASS_QUANTITY = 10;

/**
 * Idaho sales tax, added on top of the listed price.
 *
 * `film-pass-checkout` computes exactly this on the server and rounds PER PASS,
 * so two passes cost twice one pass rather than twice-then-rounded. The
 * server's number is what Square charges; if this disagrees the buyer reads one
 * figure and their card takes another.
 */
export const PASS_TAX_RATE = 0.06;

export const money = (n: number) => `$${n.toFixed(2)}`;

export interface PassOrderTotals {
  subtotal: number;
  taxDue: number;
  total: number;
}

/** The three figures the order summary prints, rounded the server's way. */
export function passOrderTotals(pass: PassType, quantity: number): PassOrderTotals {
  const unitCents = Math.round(Number(pass.price) * 100);
  const unitTaxCents = Math.round(unitCents * PASS_TAX_RATE);
  return {
    subtotal: (unitCents * quantity) / 100,
    taxDue: (unitTaxCents * quantity) / 100,
    total: ((unitCents + unitTaxCents) * quantity) / 100,
  };
}

/** How many admissions the balance buys at this pass's redemption price. */
export function passAdmissions(pass: PassType): number {
  return Math.floor(Number(pass.initial_balance) / Number(pass.redemption_price || 1));
}

/**
 * What the pass is worth, as a sentence, in plain text.
 *
 * States the offer the right way round. The obvious line quotes
 * `redemption_price` — "about 10 films at $6 each" — but that is the balance
 * spent per admission, the pass's internal accounting. The reason to buy is the
 * $8 seat the $6 gets you, so the face value is what the sentence leads with,
 * and a pass with no face value set says only how many films it covers rather
 * than inventing one.
 */
export function passWorthLine(pass: PassType): string {
  const films = passAdmissions(pass);
  return pass.ticket_face_value
    ? `Good for ${films} films — tickets that cost ${money(Number(pass.ticket_face_value))} each at the door.`
    : `Good for ${films} films.`;
}

/**
 * The same sentence, continuing one already started ("Each is …").
 *
 * Only the first letter changes. Lowercasing the whole line would work today
 * and stop working the moment a pass name or a proper noun appears in it.
 */
export function passWorthClause(pass: PassType): string {
  const line = passWorthLine(pass);
  return line.charAt(0).toLowerCase() + line.slice(1);
}
