// Tests for the pure parts of film-pass ordering.
//
// Run: deno test --node-modules-dir=none supabase/functions/_shared/pass_orders_test.ts
//
// These cover the two things that fail silently: an address a staff member
// cannot write on an envelope, and a confirmation email that leaves the buyer
// believing they hold something scannable. Both surface as a person standing at
// the door with nothing — weeks later, in the posting case.

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  admissionsFor,
  buildPassOrderEmailHtml,
  buildPassOrderEmailText,
  buildPassOrderSubject,
  buildPassPostedEmailHtml,
  buildPassPostedEmailText,
  buildPassPostedSubject,
  formatAddress,
  fulfillmentLine,
  postedLine,
  readMailingAddress,
  type PassOrderSummary,
  type PassPostedSummary,
} from './pass_orders.ts';

/**
 * Assert a pass email carries no scannable image.
 *
 * This used to be `html.includes('<img') === false`, which worked only because
 * the templates had no images at all. They now share the branded shell, which
 * puts the wordmark in the header — so "no images" is no longer the same claim
 * as "nothing that looks scannable". Asserting the logo is the *only* image
 * keeps the original guarantee intact: a QR sneaking in is still a failure,
 * because it would be a second one.
 */
function assertOnlyImageIsTheLogo(html: string, context: string) {
  const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
  assertEquals(srcs.length, 1, `${context}: expected only the logo, got ${srcs.join(', ')}`);
  // Either lockup — brand.ts swaps the standard one for the centenary artwork
  // by date, so pinning to a single filename would fail every January.
  assertEquals(
    /\/email-logo(-centenary)?\.png$/.test(srcs[0]),
    true,
    `${context}: the one image must be the wordmark, got ${srcs[0]}`,
  );
}

const address = {
  line1: '508 S Main St',
  line2: null,
  city: 'Moscow',
  state: 'ID',
  postal_code: '83843',
};

const order = (over: Partial<PassOrderSummary> = {}): PassOrderSummary => ({
  passTypeName: '$60 Film Pass',
  quantity: 1,
  amountPaid: 60,
  initialBalance: 60,
  redemptionPrice: 6,
  fulfillment: 'pickup',
  mailingAddress: null,
  buyerName: 'Ada Lovelace',
  ...over,
});

// --- addresses -------------------------------------------------------------
// A posted pass with an unusable address is not rejected by anything
// downstream; it becomes a label nobody can write.

Deno.test('readMailingAddress accepts a complete address and normalises the state', () => {
  const result = readMailingAddress({ ...address, state: 'id' });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.address.state, 'ID');
});

Deno.test('readMailingAddress names the missing field rather than failing generically', () => {
  for (const [field, message] of [
    ['line1', 'street address'],
    ['city', 'city'],
    ['state', 'state'],
    ['postal_code', 'ZIP'],
  ] as const) {
    const result = readMailingAddress({ ...address, [field]: '' });
    assertEquals(result.ok, false, `${field} should be required`);
    if (!result.ok) assertStringIncludes(result.error, message);
  }
});

Deno.test('readMailingAddress rejects a ZIP that is not one', () => {
  for (const zip of ['8384', '838433', 'ID 83843', 'abcde']) {
    const result = readMailingAddress({ ...address, postal_code: zip });
    assertEquals(result.ok, false, `${zip} should be refused`);
  }
  // ZIP+4 is a real postal code and must survive.
  assertEquals(readMailingAddress({ ...address, postal_code: '83843-1234' }).ok, true);
});

Deno.test('readMailingAddress refuses a non-object', () => {
  for (const bad of [null, undefined, 'somewhere', 42]) {
    assertEquals(readMailingAddress(bad).ok, false);
  }
});

Deno.test('formatAddress omits an absent second line rather than leaving a gap', () => {
  assertEquals(formatAddress(address), '508 S Main St, Moscow, ID 83843');
  assertEquals(
    formatAddress({ ...address, line2: 'Apt 2' }),
    '508 S Main St, Apt 2, Moscow, ID 83843',
  );
});

// --- what a pass is worth --------------------------------------------------
// The email says "about N films". N is derived, so changing either configured
// number changes the claim instead of making it a lie.

Deno.test('admissionsFor derives the count from the configured numbers', () => {
  assertEquals(admissionsFor(60, 6), 10);
  assertEquals(admissionsFor(100, 6), 16); // partial admissions do not count
  assertEquals(admissionsFor(60, 0), 0); // a misconfigured type must not divide by zero
});

// --- the confirmation ------------------------------------------------------

Deno.test('the subject says which way the pass is coming', () => {
  assertStringIncludes(buildPassOrderSubject(order()), 'ready to collect');
  // Not "on its way": this fires when the order is placed, and a mailed pass
  // has not left the building until a staff member posts it. That is what
  // buildPassPostedSubject is for, and it says "in the mail".
  const mailed = buildPassOrderSubject(
    order({ fulfillment: 'mail', mailingAddress: address }),
  );
  assertStringIncludes(mailed, 'We have your order');
  assertEquals(mailed.includes('on its way'), false);
  assertEquals(buildPassPostedSubject(posted()).includes('in the mail'), true);
});

Deno.test('a posted order names the address it is going to', () => {
  const line = fulfillmentLine(order({ fulfillment: 'mail', mailingAddress: address }));
  assertStringIncludes(line, '508 S Main St, Moscow, ID 83843');
});

Deno.test('a collection order sends the buyer to the box office, not to the door', () => {
  const line = fulfillmentLine(order());
  assertStringIncludes(line, 'box office');
});

Deno.test('the confirmation never implies the email itself is the pass', () => {
  for (const o of [order(), order({ fulfillment: 'mail', mailingAddress: address })]) {
    const html = buildPassOrderEmailHtml(o);
    const text = buildPassOrderEmailText(o);

    // The failure this guards: a buyer who thinks the email is scannable.
    assertStringIncludes(text, 'nothing to print');
    assertStringIncludes(html, 'nothing to print');
    assertOnlyImageIsTheLogo(html, 'no QR image belongs in a pass confirmation');

    // And the two rules they will otherwise discover at the door.
    assertStringIncludes(text, 'redeemable in person');
    assertStringIncludes(text, 'cannot be used online');
  }
});

Deno.test('the confirmation states the value in films, derived not hardcoded', () => {
  // Both halves are derived: how many admissions, and what each one costs. The
  // two live pass types disagree on both ($6 and $4), so a hardcoded either
  // would be wrong for one of them.
  assertStringIncludes(buildPassOrderEmailText(order()), 'ten film tickets');
  assertStringIncludes(
    buildPassOrderEmailText(order({ initialBalance: 90, redemptionPrice: 9 })),
    'ten film tickets',
  );
  assertStringIncludes(
    buildPassOrderEmailText(order({ initialBalance: 40, redemptionPrice: 4 })),
    'ten film tickets',
  );
  assertStringIncludes(
    buildPassOrderEmailText(order({ initialBalance: 30, redemptionPrice: 6 })),
    'five film tickets',
  );
  // Above the spelled-out range it falls back to the numeral rather than
  // printing undefined.
  assertStringIncludes(
    buildPassOrderEmailText(order({ initialBalance: 150, redemptionPrice: 6 })),
    '25 film tickets',
  );
});

Deno.test('the confirmation agrees with itself about the count', () => {
  const one = buildPassOrderEmailText(order({ quantity: 1 }));
  assertStringIncludes(one, 'Your pass is waiting for you at the box office, under your name.');
  assertStringIncludes(one, 'Your pass is redeemable in person');
  assertStringIncludes(one, 'It cannot be used online and is not eligible');

  const many = buildPassOrderEmailText(order({ quantity: 2 }));
  assertStringIncludes(many, 'Your passes are waiting for you at the box office, under your name.');
  assertStringIncludes(many, 'Each pass is redeemable in person');
  assertStringIncludes(many, 'They cannot be used online and are not eligible');
  // The bug this replaces: "Your 2 film passes is ready to collect".
  assertStringIncludes(buildPassOrderSubject(order({ quantity: 2 })), '2 film passes are ready');
  assertStringIncludes(
    buildPassOrderSubject(order({ quantity: 2, fulfillment: 'mail', mailingAddress: address })),
    'We have your order for 2 film passes',
  );
});

Deno.test('a mailed order names the address in the sentence the buyer acts on', () => {
  const text = buildPassOrderEmailText(
    order({ fulfillment: 'mail', mailingAddress: address, quantity: 1 }),
  );
  assertStringIncludes(text, 'Your pass will be mailed to you at');
  assertStringIncludes(text, formatAddress(address));
});

Deno.test('a buyer name with markup in it cannot reach the email as markup', () => {
  const html = buildPassOrderEmailHtml(order({ buyerName: '<script>alert(1)</script> Bobby' }));
  assertEquals(html.includes('<script>'), false);
  assertStringIncludes(html, '&lt;script&gt;');
});

Deno.test('an anonymous order still greets the buyer', () => {
  assertStringIncludes(buildPassOrderEmailText(order({ buyerName: null })), 'Hi there,');
  assertStringIncludes(buildPassOrderEmailHtml(order({ buyerName: null })), 'Hi there,');
});

Deno.test('quantity is reflected everywhere it is stated', () => {
  const o = order({ quantity: 3, amountPaid: 180 });
  assertStringIncludes(buildPassOrderSubject(o), '3 film passes');
  assertStringIncludes(buildPassOrderEmailText(o), '3 × $60 Film Pass');
  assertStringIncludes(buildPassOrderEmailText(o), 'Paid: $180');
  assertStringIncludes(buildPassOrderEmailHtml(o), 'Paid: $180');
});

// ---------------------------------------------------------------------------
// The "it's in the mail" notice
// ---------------------------------------------------------------------------
//
// Sent once, when a staff member confirms the envelope went out. It inherits
// the same trap as the confirmation — a patron who reads it as the pass itself
// — so it inherits the same assertions.

const posted = (over: Partial<PassPostedSummary> = {}): PassPostedSummary => ({
  passTypeName: '$60 Film Pass',
  quantity: 1,
  mailingAddress: address,
  buyerName: 'Ada Lovelace',
  ...over,
});

Deno.test('the posted notice says it is in the mail', () => {
  assertStringIncludes(buildPassPostedSubject(posted()), 'is in the mail');
  assertStringIncludes(buildPassPostedSubject(posted({ quantity: 2 })), 'are in the mail');
});

Deno.test('the posted notice names the address it went to', () => {
  assertStringIncludes(postedLine(posted()), '508 S Main St, Moscow, ID 83843');
  assertStringIncludes(buildPassPostedEmailText(posted()), '508 S Main St, Moscow, ID 83843');
  assertStringIncludes(buildPassPostedEmailHtml(posted()), '508 S Main St, Moscow, ID 83843');
});

Deno.test('the posted notice degrades without an address rather than printing null', () => {
  const line = postedLine(posted({ mailingAddress: null }));
  assertStringIncludes(line, 'the address you gave us');
  assertEquals(line.includes('null'), false);
});

Deno.test('the posted notice never implies the email itself is the pass', () => {
  const html = buildPassPostedEmailHtml(posted());
  const text = buildPassPostedEmailText(posted());

  assertStringIncludes(text, 'nothing to print');
  assertStringIncludes(html, 'nothing to print');
  assertOnlyImageIsTheLogo(html, 'no QR image belongs in a posted notice');
  // The rule the physical card depends on: it is used at the door, not online.
  assertStringIncludes(text, 'redeemable in person only');
});

Deno.test('the posted notice answers one question and leaves the rest to the confirmation', () => {
  const text = buildPassPostedEmailText(posted());
  // It says it has been sent, and where.
  assertStringIncludes(text, 'is on its way to you, at');
  assertStringIncludes(text, 'Please allow time for delivery');
  // It does not re-describe the pass. The order confirmation already did, and
  // repeating the economics here is how the two drifted apart.
  assertEquals(text.includes('film tickets'), false);
  assertEquals(text.includes('carries'), false);
  assertEquals(text.includes('redeemable in person for'), false);
  // Not a bare /\$\d/ check: the pass type is *named* "$60 Film Pass", so a
  // dollar sign in this email is not evidence of a price claim.
  assertEquals(text.includes('already activated'), false);
});

Deno.test('the posted notice agrees with itself about the count', () => {
  const one = buildPassPostedEmailText(posted({ quantity: 1 }));
  assertStringIncludes(one, 'Your pass is redeemable in person only');
  assertStringIncludes(one, 'hand it to our staff');

  const many = buildPassPostedEmailText(posted({ quantity: 2 }));
  assertStringIncludes(many, 'Your passes are redeemable in person only');
  assertStringIncludes(many, 'hand them to our staff');
});

Deno.test('a buyer name with markup cannot reach the posted notice as markup', () => {
  const html = buildPassPostedEmailHtml(posted({ buyerName: '<script>alert(1)</script> Bobby' }));
  assertEquals(html.includes('<script>'), false);
  assertStringIncludes(html, '&lt;script&gt;');
});

Deno.test('an anonymous order still gets a posted notice it can read', () => {
  assertStringIncludes(buildPassPostedEmailText(posted({ buyerName: null })), 'Hi there,');
  assertStringIncludes(buildPassPostedEmailHtml(posted({ buyerName: null })), 'Hi there,');
});

Deno.test('the posted notice reflects quantity', () => {
  const o = posted({ quantity: 3 });
  assertStringIncludes(buildPassPostedSubject(o), 'film passes');
  assertStringIncludes(buildPassPostedEmailText(o), '3 × $60 Film Pass');
  assertStringIncludes(buildPassPostedEmailHtml(o), '3 × $60 Film Pass');
});
