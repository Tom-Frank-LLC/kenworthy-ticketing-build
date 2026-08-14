export interface VenueSeat {
  seat_row: string;
  seat_number: number;
  seat_type: string;
  section: string | null;
}

/**
 * Can this seat map survive a round trip through the venue form's row editor?
 *
 * The editor models a venue as "row A has N seats", and saving regenerates
 * every seat as 1..N with no section. That is lossy, and silently so. The real
 * Kenworthy chart is not shaped like that: row K runs 1,2,4,5,6,7 in the left
 * bank, 8,9,10,12,… in the centre, 20,21,22,23,25,26 on the right — gaps where
 * there is no seat, and a section deciding which bank a number sits in.
 * Regenerating it would produce a contiguous 1..26 with every seat marked
 * 'center', which is a different room.
 *
 * It would also break pricing with no visible error. Seat tiers are stored
 * against venue_seats.id, and the customer page rejoins venue_seats to the
 * physical `seats` table by (seat_row, section, seat_number) — see Showing.tsx
 * and functions/_shared/pricing.ts. Rewrite those keys and every tier
 * assignment resolves to nothing: the map still renders, just with no prices.
 *
 * So the editor stays available for the simple case it was built for — a plain
 * room of even rows, or a venue with no map yet — and steps aside for a chart
 * it cannot express, rather than quietly flattening it.
 */
export function isPlainRowLayout(seats: VenueSeat[]): boolean {
  if (seats.length === 0) return true;

  const byRow = new Map<string, VenueSeat[]>();
  for (const s of seats) {
    const list = byRow.get(s.seat_row);
    if (list) list.push(s);
    else byRow.set(s.seat_row, [s]);
  }

  for (const rowSeats of byRow.values()) {
    // One bank only — the editor has nowhere to put a section.
    if (rowSeats.some(s => (s.section || 'center').toLowerCase() !== 'center')) return false;
    // One seat type per row — the editor stores a single type for the row.
    if (new Set(rowSeats.map(s => s.seat_type)).size > 1) return false;
    // Numbered 1..N with nothing missing.
    const numbers = [...new Set(rowSeats.map(s => s.seat_number))].sort((a, b) => a - b);
    if (numbers.length !== rowSeats.length) return false;
    if (numbers[0] !== 1) return false;
    if (numbers[numbers.length - 1] !== numbers.length) return false;
  }

  return true;
}
