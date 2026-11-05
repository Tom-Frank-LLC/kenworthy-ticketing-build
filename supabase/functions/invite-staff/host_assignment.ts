// Which production a host invite assigns (BRIEF-host-magic-link-view).
// Kept apart from index.ts so it can be tested without serving anything.

export type ProductionTable = 'events' | 'live_performances' | 'movies';

export interface HostAssignment {
  table: ProductionTable;
  column: 'event_id' | 'live_performance_id' | 'movie_id';
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `{ kind, id }` from the admin tab, as the table and column to write.
 * null when absent (an ordinary invite), 'invalid' when present but malformed:
 * a malformed one is refused, never treated as absent, or a typo would quietly
 * send a renter a set-a-password invite instead.
 */
export function parseHostAssignment(raw: unknown): HostAssignment | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return 'invalid';
  const { kind, id } = raw as { kind?: unknown; id?: unknown };
  if (typeof id !== 'string' || !UUID_RE.test(id)) return 'invalid';
  if (kind === 'event') return { table: 'events', column: 'event_id', id };
  if (kind === 'live_performance') return { table: 'live_performances', column: 'live_performance_id', id };
  if (kind === 'movie') return { table: 'movies', column: 'movie_id', id };
  return 'invalid';
}
