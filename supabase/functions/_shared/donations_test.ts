// Tests for the pure parts of donation acknowledgment.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/_shared/donations_test.ts
//
// Two things here are worth a test rather than a read-through. The receipt is a
// tax document: if the EIN, the amount, or the no-goods-or-services sentence is
// missing, a donor cannot substantiate the deduction the page promised them.
// And the tribute notice must never carry the amount — telling someone what a
// third party gave in their name is the kind of mistake you only find out about
// after it has been sent.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildReceiptHtml,
  buildReceiptSubject,
  buildReceiptText,
  buildTributeHtml,
  buildTributeSubject,
  buildTributeText,
  dedicationPhrase,
  formatGiftDate,
  formatMoney,
  TAX_ID,
  type DonationSummary,
} from './donations.ts';

const gift = (over: Partial<DonationSummary> = {}): DonationSummary => ({
  amountCents: 5000,
  donorName: 'Ada Lovelace',
  dedicationType: null,
  dedicateTo: null,
  notifyName: null,
  message: null,
  receiptUrl: null,
  createdAt: '2026-08-13T19:30:00.000Z',
  bundled: false,
  ...over,
});

Deno.test('formatMoney renders cents as dollars', () => {
  assertEquals(formatMoney(100), '$1.00');
  assertEquals(formatMoney(2550), '$25.50');
  assertEquals(formatMoney(0), '$0.00');
});

Deno.test('formatGiftDate is a date a person can read', () => {
  assertEquals(formatGiftDate('2026-08-13T19:30:00.000Z'), 'August 13, 2026');
  assertEquals(formatGiftDate('nonsense'), '');
});

Deno.test('dedicationPhrase needs both halves', () => {
  assertEquals(dedicationPhrase('in_honor', 'Grace Hopper'), 'In honor of Grace Hopper');
  assertEquals(dedicationPhrase('in_memory', 'Grace Hopper'), 'In memory of Grace Hopper');
  // A type with nobody named is not a dedication.
  assertEquals(dedicationPhrase('in_memory', '   '), null);
  assertEquals(dedicationPhrase(null, 'Grace Hopper'), null);
});

Deno.test('receipt carries what makes it a tax receipt', () => {
  const d = gift();
  const text = buildReceiptText(d);
  const html = buildReceiptHtml(d);

  for (const body of [text, html]) {
    assertStringIncludes(body, '$50.00');
    assertStringIncludes(body, TAX_ID);
    assertStringIncludes(body, '501(c)(3)');
    assertStringIncludes(body, 'No goods or services were provided');
    assertStringIncludes(body, 'August 13, 2026');
  }
  assertStringIncludes(buildReceiptSubject(d), '$50.00');
  assertStringIncludes(text, 'Hi Ada,');
});

Deno.test('receipt names the dedication and links the Square receipt when there is one', () => {
  const d = gift({
    dedicationType: 'in_memory',
    dedicateTo: 'Alan Turing',
    receiptUrl: 'https://squareup.com/receipt/preview/abc123',
  });
  assertStringIncludes(buildReceiptText(d), 'In memory of Alan Turing');
  assertStringIncludes(buildReceiptHtml(d), 'In memory of Alan Turing');
  assertStringIncludes(buildReceiptHtml(d), 'https://squareup.com/receipt/preview/abc123');

  // And says nothing about a card receipt when Square gave us no link — which
  // is every sandbox charge, the case that started all this.
  assert(!buildReceiptText(gift()).includes('Card receipt'));
});

Deno.test('a bundled gift says the tickets came separately and were the taxed part', () => {
  const bundled = buildReceiptText(gift({ bundled: true }));
  assertStringIncludes(bundled, 'your gift was not taxed');
  assertStringIncludes(bundled, 'tickets are confirmed');
  // A standalone gift has no tickets to explain.
  assert(!buildReceiptText(gift()).includes('tickets are confirmed'));
});

Deno.test('tribute notice never states the amount', () => {
  const d = gift({
    amountCents: 25000,
    dedicationType: 'in_honor',
    dedicateTo: 'Grace Hopper',
    notifyName: 'Margaret Hamilton',
    message: 'Thinking of you today.',
  });

  for (const body of [buildTributeText(d), buildTributeHtml(d)]) {
    assert(!body.includes('250.00'), 'the tribute notice must not disclose the gift amount');
    assert(!body.includes('$'), 'the tribute notice must carry no money at all');
    assertStringIncludes(body, 'Ada Lovelace');
    assertStringIncludes(body, 'in honor of Grace Hopper');
    assertStringIncludes(body, 'Thinking of you today.');
  }
  assertStringIncludes(buildTributeText(d), 'Hi Margaret,');
  assertStringIncludes(buildTributeSubject(d), 'in your honor');
});

Deno.test('an in-memory tribute is worded for a death, not a birthday', () => {
  const d = gift({
    dedicationType: 'in_memory',
    dedicateTo: 'Alan Turing',
    notifyName: 'Joan Clarke',
  });
  assertStringIncludes(buildTributeSubject(d), 'in memory of someone you love');
  assertStringIncludes(buildTributeText(d), 'in memory of Alan Turing');
});

Deno.test('an anonymous donor is described, not left blank', () => {
  const d = gift({
    donorName: null,
    dedicationType: 'in_honor',
    dedicateTo: 'Grace Hopper',
    notifyName: null,
  });
  assertStringIncludes(buildTributeText(d), 'Someone has made a donation');
  assertStringIncludes(buildTributeText(d), 'Hi there,');
  assertStringIncludes(buildReceiptText(gift({ donorName: null })), 'Hi there,');
});

Deno.test('donor-supplied text is escaped into the HTML', () => {
  const d = gift({
    donorName: '<script>alert(1)</script>',
    dedicationType: 'in_honor',
    dedicateTo: 'Ada & Co',
    notifyName: 'Someone',
    message: '<img src=x onerror=alert(1)>',
  });
  const html = buildTributeHtml(d);
  assert(!html.includes('<script>'), 'donor name must not reach the DOM as markup');
  assert(!html.includes('<img src=x'), 'the message must not reach the DOM as markup');
  assertStringIncludes(html, 'Ada &amp; Co');
});
