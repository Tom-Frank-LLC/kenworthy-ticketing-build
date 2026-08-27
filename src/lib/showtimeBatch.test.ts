import { describe, expect, it } from 'vitest';
import {
  findCollidingRowIndexes,
  findDuplicateRowIndexes,
  makeShowtimeRow,
  nextShowtimeValue,
  plannedShowtimes,
  shiftLocalInput,
  summarizeBatch,
  summarizeSquareOutcomes,
  type ShowtimeOutcome,
} from './showtimeBatch';

const rows = (...values: string[]) => values.map(v => makeShowtimeRow(v));

describe('shiftLocalInput', () => {
  it('keeps the wall clock when it adds days', () => {
    expect(shiftLocalInput('2026-08-14T19:30', 1)).toBe('2026-08-15T19:30');
    expect(shiftLocalInput('2026-08-14T19:30', 7)).toBe('2026-08-21T19:30');
  });

  it('rolls over months and leap years', () => {
    expect(shiftLocalInput('2026-08-31T19:30', 1)).toBe('2026-09-01T19:30');
    expect(shiftLocalInput('2026-12-31T23:00', 1)).toBe('2027-01-01T23:00');
    expect(shiftLocalInput('2028-02-28T14:00', 1)).toBe('2028-02-29T14:00');
  });

  it('does not shift the hour across a DST boundary', () => {
    // 8 Mar 2026 is the US spring-forward. A week added as 7 × 86,400,000 ms to
    // a real instant would come back an hour off; a 7:30 show is at 7:30 both
    // weeks, and that is what an admin building a run means.
    expect(shiftLocalInput('2026-03-07T19:30', 1)).toBe('2026-03-08T19:30');
    expect(shiftLocalInput('2026-03-01T19:30', 7)).toBe('2026-03-08T19:30');
    // 1 Nov 2026 is the fall-back.
    expect(shiftLocalInput('2026-10-31T19:30', 1)).toBe('2026-11-01T19:30');
  });

  it('returns nothing for a value that is not a datetime', () => {
    expect(shiftLocalInput('', 1)).toBe('');
    expect(shiftLocalInput('2026-08-14', 1)).toBe('');
  });
});

describe('nextShowtimeValue', () => {
  it('offsets from the last row that has a date', () => {
    expect(nextShowtimeValue(rows('2026-08-14T19:30'), 1)).toBe('2026-08-15T19:30');
  });

  it('skips trailing blank rows rather than giving up on them', () => {
    // Pressing "+1 day" twice: the second press must offset from the dated row,
    // not from the blank one the first press appended.
    expect(nextShowtimeValue(rows('2026-08-14T19:30', ''), 7)).toBe('2026-08-21T19:30');
  });

  it('has nothing to offset from when no row has a date', () => {
    expect(nextShowtimeValue(rows('', ''), 1)).toBe('');
  });
});

describe('findDuplicateRowIndexes', () => {
  it('flags the later copy and never the first', () => {
    const dupes = findDuplicateRowIndexes(
      rows('2026-08-14T19:30', '2026-08-15T19:30', '2026-08-14T19:30'),
    );
    expect([...dupes]).toEqual([2]);
  });

  it('does not treat blank rows as duplicates of each other', () => {
    expect(findDuplicateRowIndexes(rows('', '', '2026-08-14T19:30')).size).toBe(0);
  });
});

describe('findCollidingRowIndexes', () => {
  it('flags rows the venue already has a showing at', () => {
    const hits = findCollidingRowIndexes(
      rows('2026-08-14T19:30', '2026-08-15T19:30'),
      new Set(['2026-08-15T19:30']),
    );
    expect([...hits]).toEqual([1]);
  });

  it('flags nothing when the venue is clear', () => {
    expect(findCollidingRowIndexes(rows('2026-08-14T19:30'), new Set()).size).toBe(0);
  });
});

describe('plannedShowtimes', () => {
  it('drops blanks, de-duplicates, and orders oldest first', () => {
    expect(
      plannedShowtimes(
        rows('2026-08-16T19:30', '', '2026-08-14T19:30', '2026-08-16T19:30', '2026-08-15T14:00'),
      ),
    ).toEqual(['2026-08-14T19:30', '2026-08-15T14:00', '2026-08-16T19:30']);
  });

  it('is empty when nothing is filled in', () => {
    expect(plannedShowtimes(rows('', ''))).toEqual([]);
  });
});

describe('summarizeBatch', () => {
  const created = (value: string, showingId: string): ShowtimeOutcome =>
    ({ value, status: 'created', showingId });
  const failed = (value: string, detail: string): ShowtimeOutcome =>
    ({ value, status: 'failed', detail });
  const incomplete = (value: string, showingId: string, detail: string): ShowtimeOutcome =>
    ({ value, status: 'incomplete', showingId, detail });

  it('says so plainly when every showtime landed', () => {
    const s = summarizeBatch([
      created('2026-08-14T19:30', 'a'),
      created('2026-08-15T19:30', 'b'),
      created('2026-08-16T19:30', 'c'),
    ]);
    expect(s.headline).toBe('Created 3 showtimes.');
    expect(s.tone).toBe('success');
    expect(s.retryValues).toEqual([]);
  });

  it('counts and names a partial batch rather than reporting success', () => {
    const s = summarizeBatch([
      created('2026-08-14T19:30', 'a'),
      failed('2026-08-15T19:30', 'duplicate key value violates unique constraint'),
      created('2026-08-16T19:30', 'c'),
    ]);
    expect(s.headline).toBe('Created 2 of 3 showtimes.');
    expect(s.tone).toBe('error');
    expect(s.created).toHaveLength(2);
    expect(s.failed[0].detail).toContain('unique constraint');
  });

  it('leaves only the failed rows in the form to retry', () => {
    // An incomplete row must never come back for a retry: the showing exists,
    // and creating it again would put two showings on the same night.
    const s = summarizeBatch([
      created('2026-08-14T19:30', 'a'),
      incomplete('2026-08-15T19:30', 'b', 'price tiers failed — timeout'),
      failed('2026-08-16T19:30', 'insert failed'),
    ]);
    expect(s.retryValues).toEqual(['2026-08-16T19:30']);
    expect(s.incomplete).toHaveLength(1);
  });

  it('counts an incomplete showing as one that exists, and warns rather than fails', () => {
    const s = summarizeBatch([
      created('2026-08-14T19:30', 'a'),
      incomplete('2026-08-15T19:30', 'b', 'pass eligibility was not stored — timeout'),
    ]);
    expect(s.headline).toBe('Created 2 of 2 showtimes.');
    expect(s.tone).toBe('warning');
  });

  it('keeps the singular for one showtime', () => {
    expect(summarizeBatch([created('2026-08-14T19:30', 'a')]).headline).toBe('Created 1 showtime.');
    expect(summarizeBatch([failed('2026-08-14T19:30', 'nope')]).headline).toBe('Created 0 of 1 showtime.');
  });
});

describe('summarizeSquareOutcomes', () => {
  const needsItem = { code: 'needs_item', message: 'Saved. This title has no Square item yet.' };
  const writeFailed = { code: 'write_failed', message: 'Saved, but Square did not take the ticket items.' };

  it('says nothing when every showing got its items', () => {
    expect(summarizeSquareOutcomes([null, null, null])).toBeNull();
  });

  it('collapses one repeated warning into a single counted sentence', () => {
    // The whole point: four identical toasts say nothing the first one did not.
    expect(summarizeSquareOutcomes([needsItem, needsItem, needsItem, null])).toBe(
      '3 showtimes: Saved. This title has no Square item yet.',
    );
  });

  it('keeps the single-showing wording when there is only one', () => {
    expect(summarizeSquareOutcomes([needsItem])).toBe('Saved. This title has no Square item yet.');
  });

  it('reports each distinct problem with its own count', () => {
    const out = summarizeSquareOutcomes([needsItem, writeFailed, needsItem]);
    expect(out).toContain('2 showtimes: Saved. This title has no Square item yet.');
    expect(out).toContain('1 showtime: Saved, but Square did not take the ticket items.');
  });
});
