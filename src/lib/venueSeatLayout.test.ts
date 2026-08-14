import { describe, it, expect } from 'vitest';
import { isPlainRowLayout, type VenueSeat } from './venueSeatLayout';

// This predicate is the only thing standing between the Kenworthy seat chart
// and the venue form's Save button. The form models a room as "row A has N
// seats" and regenerates every seat as 1..N with no section on save — so if it
// ever returns true for the real chart, saving the venue silently replaces 265
// hand-entered seats with a contiguous approximation, and every seat-tier
// assignment (stored against venue_seats.id, rejoined by row+section+number)
// resolves to nothing.

const seat = (
  seat_row: string,
  seat_number: number,
  section: string | null = 'center',
  seat_type = 'standard',
): VenueSeat => ({ seat_row, seat_number, section, seat_type });

const run = (row: string, count: number, section: string | null = 'center') =>
  Array.from({ length: count }, (_, i) => seat(row, i + 1, section));

describe('isPlainRowLayout', () => {
  it('accepts a venue with no seats yet, so a new room stays editable', () => {
    expect(isPlainRowLayout([])).toBe(true);
  });

  it('accepts even rows numbered from 1, which is what the editor can express', () => {
    expect(isPlainRowLayout([...run('A', 20), ...run('B', 20)])).toBe(true);
  });

  it('accepts rows of differing lengths', () => {
    expect(isPlainRowLayout([...run('A', 12), ...run('B', 20)])).toBe(true);
  });

  it('treats a null section as centre rather than as a second bank', () => {
    expect(isPlainRowLayout(run('A', 6, null))).toBe(true);
  });

  it('rejects a row with a gap — the editor would fill it in with a seat that does not exist', () => {
    // Kenworthy row K, left bank: 1,2,4,5,6,7 — there is no seat 3.
    const k = [1, 2, 4, 5, 6, 7].map(n => seat('K', n));
    expect(isPlainRowLayout(k)).toBe(false);
  });

  it('rejects a row that does not start at 1 — the editor always renumbers from 1', () => {
    expect(isPlainRowLayout([20, 21, 22, 23].map(n => seat('M', n, 'right')))).toBe(false);
  });

  it('rejects multiple banks in one row — the editor has nowhere to put a section', () => {
    expect(isPlainRowLayout([...run('A', 7, 'left'), ...run('A', 7, 'center')])).toBe(false);
  });

  it('rejects mixed seat types in a row — the editor stores one type per row', () => {
    expect(isPlainRowLayout([
      seat('A', 1, 'center', 'standard'),
      seat('A', 2, 'center', 'accessible'),
    ])).toBe(false);
  });

  it('rejects the real Kenworthy chart', () => {
    // A faithful slice: three banks with disjoint number ranges, gaps in each.
    const chart: VenueSeat[] = [
      ...[1, 2, 4, 5, 6, 7].map(n => seat('K', n, 'left')),
      ...[8, 9, 10, 12, 13, 14, 15, 17, 18, 19].map(n => seat('K', n, 'center')),
      ...[20, 21, 22, 23, 25, 26].map(n => seat('K', n, 'right')),
    ];
    expect(isPlainRowLayout(chart)).toBe(false);
  });
});
