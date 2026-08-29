// Tests for the rule guarding a hand-edited donor email.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/_shared/lgl_test.ts
//
// syncDonationToLgl itself is all network and database and is exercised against
// the real LGL account, which has no sandbox — staging shares production's key,
// so a "test" sync writes a real donor record with no reversal path. What is
// testable here without touching any of that is the rule that decides whether an
// admin may put an address on a gift at all, and that is the part with teeth:
// let it through on an already-synced gift and the theatre ends up with two
// constituents for one human in its fundraising CRM.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { donorEmailEditError } from './lgl.ts';

Deno.test('an emailless, unsynced gift accepts a valid address', () => {
  assertEquals(donorEmailEditError({ lgl_gift_id: null }, 'donor@example.com'), null);
});

Deno.test('surrounding whitespace is not what makes an address invalid', () => {
  assertEquals(donorEmailEditError({}, '  donor@example.com  '), null);
});

Deno.test('an already-synced gift is refused, and says where to fix it', () => {
  const err = donorEmailEditError({ lgl_gift_id: '4821' }, 'donor@example.com');
  assert(err, 'a synced gift must not accept an email edit');
  assertStringIncludes(err, 'Little Green Light');
});

Deno.test('the synced check runs before the format check', () => {
  // Otherwise a synced gift would report "not a valid address" for a bad input
  // and "saved" for a good one — telling the operator the wrong thing about why
  // the edit is refused.
  const err = donorEmailEditError({ lgl_gift_id: '4821' }, 'nonsense');
  assert(err);
  assertStringIncludes(err, 'Little Green Light');
});

Deno.test('an empty address is refused', () => {
  assert(donorEmailEditError({ lgl_gift_id: null }, ''));
  assert(donorEmailEditError({ lgl_gift_id: null }, '   '));
});

Deno.test('a malformed address is refused', () => {
  for (const bad of ['donor', 'donor@', '@example.com', 'donor@example', 'a b@example.com']) {
    assert(donorEmailEditError({}, bad), `${bad} should be refused`);
  }
});

Deno.test('an absurdly long address is refused', () => {
  const long = 'a'.repeat(250) + '@example.com';
  assert(donorEmailEditError({}, long));
});
