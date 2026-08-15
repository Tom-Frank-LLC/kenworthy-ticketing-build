import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { readContact } from './buyers.ts';

/**
 * Consent, and specifically what silence means.
 *
 * `readContact` turns a checkout body into the record of what the buyer agreed
 * to, and `marketingOptIn` is the half of it that decides whether they are
 * added to a mailing list. The checkbox on both checkout forms ships ticked, so
 * the ordinary case sends `true` explicitly — which makes the interesting case
 * the body that carries no consent field at all.
 *
 * That happens for real: the staff POS sells passes through the same function
 * and never asks, and any older client bundle still in someone's browser
 * predates the field. Reading those as consent would subscribe people who were
 * never given the chance to decline, which is the exact bug this branch
 * removed — `ticket-checkout` used to subscribe every buyer with an email and
 * never look at the box.
 *
 * The failure mode is silent in both directions: nothing errors, and the damage
 * shows up as strangers receiving mail they never asked for. So the rule is
 * pinned here rather than left to be re-derived by whoever next edits this
 * file and finds a default of `false` counter-intuitive.
 */

Deno.test('a ticked box is consent', () => {
  assertEquals(readContact({ name: 'A', email: 'a@b.com', marketing_opt_in: true }).marketingOptIn, true);
});

Deno.test('an unticked box is not consent', () => {
  assertEquals(readContact({ name: 'A', email: 'a@b.com', marketing_opt_in: false }).marketingOptIn, false);
});

Deno.test('silence is not consent — an absent field means no', () => {
  // The staff POS and any pre-checkbox client bundle land here.
  assertEquals(readContact({ name: 'A', email: 'a@b.com' }).marketingOptIn, false);
});

Deno.test('the guest form spelling of the field is accepted too', () => {
  // GuestCheckoutForm tracks this as `newsletter`; both spellings reach here.
  assertEquals(readContact({ name: 'A', email: 'a@b.com', newsletter: true }).marketingOptIn, true);
  assertEquals(readContact({ name: 'A', email: 'a@b.com', newsletter: false }).marketingOptIn, false);
});

Deno.test('only a real boolean true counts', () => {
  // A truthy string is what a form-encoded or hand-rolled caller sends, and it
  // is not an answer to the question — "false" is truthy, which is how a
  // loose check turns a decline into a subscribe.
  for (const value of ['true', 'false', 1, 'on', 'yes', {}, []]) {
    assertEquals(
      readContact({ name: 'A', email: 'a@b.com', marketing_opt_in: value }).marketingOptIn,
      false,
      `${JSON.stringify(value)} should not be read as consent`,
    );
  }
});

Deno.test('consent is read independently of the contact details', () => {
  // Phone-only buyers exist; consent must not ride on there being an email.
  const c = readContact({ name: 'A', phone: '555', marketing_opt_in: true });
  assertEquals(c.email, null);
  assertEquals(c.marketingOptIn, true);
});
