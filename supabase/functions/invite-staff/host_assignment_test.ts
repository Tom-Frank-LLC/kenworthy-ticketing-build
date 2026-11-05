import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { parseHostAssignment } from './host_assignment.ts';

const ID = '10000000-0000-0000-0000-000000000001';

Deno.test('no host_assignment is an ordinary invite', () => {
  assertEquals(parseHostAssignment(undefined), null);
  assertEquals(parseHostAssignment(null), null);
});

Deno.test('each kind names its own table and column', () => {
  assertEquals(parseHostAssignment({ kind: 'event', id: ID }), { table: 'events', column: 'event_id', id: ID });
  assertEquals(parseHostAssignment({ kind: 'live_performance', id: ID }),
    { table: 'live_performances', column: 'live_performance_id', id: ID });
  assertEquals(parseHostAssignment({ kind: 'movie', id: ID }), { table: 'movies', column: 'movie_id', id: ID });
});

Deno.test('a malformed one is refused, not read as absent', () => {
  assertEquals(parseHostAssignment('movie'), 'invalid');
  assertEquals(parseHostAssignment({ kind: 'movie' }), 'invalid');
  assertEquals(parseHostAssignment({ kind: 'movie', id: 'not-a-uuid' }), 'invalid');
  assertEquals(parseHostAssignment({ kind: 'showing', id: ID }), 'invalid');
  // Only the three production tables: never a table name passed through.
  assertEquals(parseHostAssignment({ kind: 'user_roles', id: ID }), 'invalid');
});
