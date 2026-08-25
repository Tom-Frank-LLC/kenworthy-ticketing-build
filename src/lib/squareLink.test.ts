// The two rules that decide whether a Square linking problem is visible.
//
// Both failed silently in production, and silence is the thing worth pinning:
// every case below would have "passed" under the old code by showing nothing
// and returning nothing.

import { describe, expect, it } from 'vitest';
import {
  dismissalKey,
  dismissedKeys,
  needsForScope,
  squareSaveOutcome,
} from './squareLink';

const row = (kind: 'movie' | 'event' | 'live_performance', id: string) => ({
  production_id: id,
  kind,
  title: id,
});

describe('needsForScope', () => {
  const rows = [row('movie', 'm1'), row('event', 'e1'), row('live_performance', 'p1')];

  it('keeps every kind when the surface is unscoped', () => {
    expect(needsForScope(rows, undefined).map(r => r.production_id)).toEqual(['m1', 'e1', 'p1']);
    expect(needsForScope(rows, []).map(r => r.production_id)).toEqual(['m1', 'e1', 'p1']);
  });

  // The edge function builds needs_dashboard_item before it applies `kinds`, so
  // a movie-scoped request really does carry concerts. This is the filter.
  it('drops other kinds on a scoped surface', () => {
    expect(needsForScope(rows, ['movie']).map(r => r.production_id)).toEqual(['m1']);
  });

  it('keeps both kinds the Live Events surface covers', () => {
    expect(needsForScope(rows, ['event', 'live_performance']).map(r => r.production_id))
      .toEqual(['e1', 'p1']);
  });

  // A dismissal is recorded against the table, not the kind — so this only
  // works if both surfaces agree on the string.
  it('hides a title dismissed in the flag box', () => {
    const dismissed = dismissedKeys([{ entity_type: 'movies', entity_id: 'm1' }]);
    expect(needsForScope(rows, ['movie'], dismissed)).toEqual([]);
  });

  it('does not let one table\'s dismissal hide another table\'s row with the same id', () => {
    const dismissed = dismissedKeys([{ entity_type: 'events', entity_id: 'shared' }]);
    const both = [row('movie', 'shared'), row('event', 'shared')];
    expect(needsForScope(both, ['movie', 'event'], dismissed).map(r => r.kind)).toEqual(['movie']);
  });

  it('maps each kind to the table the dismissal panel writes', () => {
    expect(dismissalKey('movie', 'x')).toBe('movies:x');
    expect(dismissalKey('event', 'x')).toBe('events:x');
    expect(dismissalKey('live_performance', 'x')).toBe('live_performances:x');
  });

  it('survives a missing list', () => {
    expect(needsForScope(undefined, ['movie'])).toEqual([]);
    expect(needsForScope(null, null)).toEqual([]);
  });
});

describe('squareSaveOutcome', () => {
  it('says nothing when every tier linked', () => {
    expect(squareSaveOutcome({ counts: { linked: 2 } })).toBeNull();
  });

  it('says nothing when the variations were written or adopted', () => {
    expect(squareSaveOutcome({ counts: { would_append: 1 }, tally: { written: 1 } })).toBeNull();
    expect(squareSaveOutcome({ counts: { adopt_existing: 1 } })).toBeNull();
  });

  // A price disagreement is not a linking failure — we charge our own price
  // either way — so it stays out of the save path deliberately.
  it('stays quiet about price drift', () => {
    expect(squareSaveOutcome({ counts: { price_drift: 1 } })).toBeNull();
  });

  it('still warns about a title with no Square item', () => {
    expect(squareSaveOutcome({ counts: { needs_item: 1 } })?.code).toBe('needs_item');
  });

  // The three that were silent before. Each means the showing will not report
  // against a catalog item, and each needs a different action.
  it('warns when two Square items share the title', () => {
    const out = squareSaveOutcome({ counts: { ambiguous_item: 1 } });
    expect(out?.code).toBe('ambiguous_item');
    expect(out?.message).toMatch(/More than one Square item/);
  });

  it('warns when the linked item cannot hold showtimes', () => {
    expect(squareSaveOutcome({ counts: { not_event_item: 1 } })?.code).toBe('not_event_item');
  });

  it('warns when the linked item has vanished from the catalog', () => {
    expect(squareSaveOutcome({ counts: { stored_item_gone: 1 } })?.code).toBe('stored_item_gone');
  });

  it('reports the item problem ahead of the write problem', () => {
    expect(squareSaveOutcome({ counts: { needs_item: 1, ambiguous_item: 1 } })?.code).toBe('needs_item');
  });

  it('warns when Square accepted the write but did not keep it', () => {
    expect(squareSaveOutcome({ counts: { would_append: 1 }, tally: { accepted_but_not_stored: 1 } })?.code)
      .toBe('accepted_but_not_stored');
  });

  it('warns when the append errored or was refused', () => {
    expect(squareSaveOutcome({ counts: { would_append: 1 }, tally: { error: 1 } })?.code).toBe('write_failed');
    expect(squareSaveOutcome({ counts: { would_append: 1 }, tally: { refused: 1 } })?.code).toBe('write_failed');
  });

  it('warns when Square kept the variation but our mapping row did not', () => {
    expect(squareSaveOutcome({ counts: { would_append: 1 }, tally: { written_unmapped: 1 } })?.code)
      .toBe('written_unmapped');
  });

  it('warns when the showing has no production behind it', () => {
    expect(squareSaveOutcome({ counts: {}, skipped: [{ reason: 'showing has no production row' }] })?.code)
      .toBe('no_production');
  });

  it('warns when no tier had a usable price', () => {
    expect(squareSaveOutcome({ counts: {}, skipped: [{ reason: 'no valid price' }] })?.code).toBe('no_price');
  });

  it('repeats a skip reason it does not recognise rather than swallowing it', () => {
    const out = squareSaveOutcome({ counts: {}, skipped: [{ reason: 'something new' }] });
    expect(out?.code).toBe('skipped');
    expect(out?.message).toMatch(/something new/);
  });

  // The edge function's "no active showings" early return is a 200 with an
  // empty counts object. It used to read as a clean save.
  it('warns when the planner was given nothing to do', () => {
    expect(squareSaveOutcome({ ok: true, counts: {} })?.code).toBe('nothing_planned');
    expect(squareSaveOutcome({})?.code).toBe('nothing_planned');
  });

  // A duplicate tier is collapsed on purpose and the other tier still carries
  // the showing, so the save is not in trouble.
  it('does not treat a collapsed duplicate tier as a failure', () => {
    expect(squareSaveOutcome({
      counts: { linked: 1 },
      skipped: [{ reason: 'duplicate tier after canonicalisation' }],
    })?.code).toBe('skipped');
  });
});
