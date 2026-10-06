import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { squareErrorSummary } from './log.ts';

Deno.test('a Square error is logged as category/code, never its echoed detail (L15)', () => {
  const body = {
    errors: [{
      category: 'INVALID_REQUEST_ERROR',
      code: 'INVALID_EMAIL_ADDRESS',
      field: 'email_address',
      detail: 'renter@example.org is not a valid email address',
    }],
  };
  const line = squareErrorSummary(body);
  assertEquals(line, 'INVALID_REQUEST_ERROR/INVALID_EMAIL_ADDRESS (email_address)');
  assert(!line.includes('renter@example.org'));
});

Deno.test('no body, or no errors, says so', () => {
  assertEquals(squareErrorSummary(null), 'no error body');
  assertEquals(squareErrorSummary({}), 'no error body');
});
