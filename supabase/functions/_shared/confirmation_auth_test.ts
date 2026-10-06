// Who may redirect a ticket confirmation.
//
// The trap this guards: the box office sells tickets that are *owned by the
// staff member ringing the sale*, and the patron's address exists only as an
// override on the request. If staff are not operators, the override is dropped,
// the ticket is emailed to the counter, and `confirmation_sent_at` is stamped —
// so the correct resend is then refused as "already sent". A failure that both
// misdelivers and blocks its own repair.
//
// The mirror trap is the one the overrides were closed for in the first place:
// a signed-in patron must never be able to point their own order at somebody
// else's address.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { flagsFor, isOperator, overridesFor } from './confirmation_auth.ts';

const SERVICE = { isServiceRole: true, isStaff: false };
const STAFF = { isServiceRole: false, isStaff: true };
const PATRON = { isServiceRole: false, isStaff: false };

const PATRON_CONTACT = {
  email: 'walkup@example.com',
  phone: '2085551234',
  name: 'Walk-up Patron',
};

Deno.test('the service role is an operator', () => {
  assertEquals(isOperator(SERVICE), true);
});

Deno.test('signed-in staff are operators — the box office cannot deliver otherwise', () => {
  assertEquals(isOperator(STAFF), true);
});

Deno.test('a signed-in patron is not an operator', () => {
  assertEquals(isOperator(PATRON), false);
});

Deno.test('staff keep the counter-typed recipient', () => {
  assertEquals(overridesFor(STAFF, PATRON_CONTACT), PATRON_CONTACT);
});

Deno.test('the service role keeps it too', () => {
  assertEquals(overridesFor(SERVICE, PATRON_CONTACT), PATRON_CONTACT);
});

Deno.test('a patron cannot redirect their own confirmation elsewhere', () => {
  assertEquals(overridesFor(PATRON, { email: 'attacker@example.com' }), {
    email: '',
    phone: '',
    name: '',
  });
});

Deno.test('a missing override is an empty string, not "undefined"', () => {
  // deliver.ts falls back on falsy, and the string "undefined" is truthy — it
  // would be sent to Resend as an address.
  assertEquals(overridesFor(STAFF, {}), { email: '', phone: '', name: '' });
  assertEquals(overridesFor(STAFF, { email: undefined, phone: null }), {
    email: '',
    phone: '',
    name: '',
  });
});

Deno.test('M1: a patron cannot force a resend or claim an account was created', () => {
  assertEquals(flagsFor(PATRON, { force: true, account_created: true }), {
    force: false,
    accountCreated: false,
  });
});

Deno.test('operators keep force and account_created', () => {
  for (const op of [SERVICE, STAFF]) {
    assertEquals(flagsFor(op, { force: true, account_created: true }), {
      force: true,
      accountCreated: true,
    });
    // Truthy is not true: only a literal boolean counts.
    assertEquals(flagsFor(op, { force: 'yes', account_created: 1 }), {
      force: false,
      accountCreated: false,
    });
  }
});
