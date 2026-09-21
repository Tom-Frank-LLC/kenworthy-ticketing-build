import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ticketLimitError } from './ticket_limit.ts';

Deno.test('within the limit is allowed, exactly at it too', () => {
  assertEquals(ticketLimitError(20, 0, 6), null);
  assertEquals(ticketLimitError(20, 0, 20), null);
  assertEquals(ticketLimitError(20, 12, 8), null);
});

Deno.test('over the limit is refused, and says what the limit is and where to go', () => {
  const msg = ticketLimitError(20, 0, 21)!;
  assertStringIncludes(msg, 'up to 20 tickets');
  assertStringIncludes(msg, 'box office');
});

Deno.test('the limit is on what a buyer holds, across orders', () => {
  assertStringIncludes(ticketLimitError(20, 12, 12)!, 'up to 8 more');
  assertStringIncludes(ticketLimitError(20, 20, 1)!, 'the most one buyer can hold');
});

Deno.test('NULL is no cap at all', () => {
  assertEquals(ticketLimitError(null, 0, 250), null);
  assertEquals(ticketLimitError(null, 40, 250), null);
  assertEquals(ticketLimitError(undefined, 0, 250), null);
});

Deno.test('a showing tightened to 2 is tightened', () => {
  assertEquals(ticketLimitError(2, 0, 2), null);
  assertStringIncludes(ticketLimitError(2, 0, 3)!, 'up to 2 tickets');
});
