// Tests for what a renter actually gets billed.
//
// Run: deno test --node-modules-dir=none --allow-env \
//        supabase/functions/_shared/rental_invoice_test.ts
//
// A wrong invoice is not a crash. It is a 200 from Square and a piece of paper
// in a renter's inbox asking for the wrong amount, discovered — if ever — when
// somebody reconciles the books. The properties pinned here are the ones with
// no other alarm attached: a discount that Square would have refused as a
// negative line, a fractional quantity that would have been refused or
// silently truncated to a whole one, and tax appearing on lines nobody marked
// taxable.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  addDays,
  buildOrderParts,
  formatDateSpan,
  invoiceDescription,
  paymentDueDate,
  SALES_TAX_UID,
  splitName,
  venueToday,
} from './rental_invoice.ts';

function line(over: Partial<Parameters<typeof buildOrderParts>[0][number]> = {}) {
  return {
    line_kind: 'general',
    description: 'Theater rental',
    quantity: 1,
    unit_price: 100,
    is_taxable: false,
    sort_order: 0,
    ...over,
  };
}

Deno.test('a whole quantity keeps its per-unit price on the invoice', () => {
  const { lineItems } = buildOrderParts([
    line({ description: 'Theater rental (hourly)', quantity: 4, unit_price: 180 }),
  ]);

  assertEquals(lineItems.length, 1);
  assertEquals(lineItems[0].quantity, '4');
  assertEquals(lineItems[0].base_price_money, { amount: 18_000, currency: 'USD' });
  // No note needed — "4 × $180.00" is what the invoice already shows.
  assertEquals(lineItems[0].note, undefined);
});

Deno.test('a fractional quantity is billed as one extended line', () => {
  // Square's quantity is a whole-number string unless the line carries a
  // quantity_unit; 4.5 would be rejected or rounded. The arithmetic survives
  // in the note instead.
  const { lineItems } = buildOrderParts([
    line({ quantity: 4.5, unit_price: 180 }),
  ]);

  assertEquals(lineItems[0].quantity, '1');
  assertEquals(lineItems[0].base_price_money, { amount: 81_000, currency: 'USD' });
  assertEquals(lineItems[0].note, '4.5 × $180.00');
});

Deno.test('a non-profit discount becomes a discount, not a negative line', () => {
  const { lineItems, discounts, netSubtotalCents } = buildOrderParts([
    line({ quantity: 1, unit_price: 500 }),
    line({
      line_kind: 'nonprofit_discount',
      description: 'Non-profit discount',
      quantity: 1,
      unit_price: -125,
      sort_order: 1,
    }),
  ]);

  assertEquals(lineItems.length, 1);
  assertEquals(discounts.length, 1);
  assertEquals(discounts[0].type, 'FIXED_AMOUNT');
  assertEquals(discounts[0].scope, 'ORDER');
  assertEquals(discounts[0].amount_money, { amount: 12_500, currency: 'USD' });
  assertEquals(netSubtotalCents, 37_500);
});

Deno.test('a discount typed as a positive amount still credits the renter', () => {
  // Staff type "125" under the discount kind about as often as "-125". Both
  // have to reduce the bill; treating the first as a charge would bill the
  // renter for their own discount.
  const { discounts, netSubtotalCents } = buildOrderParts([
    line({ quantity: 1, unit_price: 500 }),
    line({ line_kind: 'nonprofit_discount', quantity: 1, unit_price: 125, sort_order: 1 }),
  ]);

  assertEquals(discounts[0].amount_money, { amount: 12_500, currency: 'USD' });
  assertEquals(netSubtotalCents, 37_500);
});

Deno.test('tax is declared only when a line is flagged taxable', () => {
  const untaxed = buildOrderParts([line()]);
  assertEquals(untaxed.taxes, []);
  assertEquals(untaxed.lineItems[0].applied_taxes, undefined);

  const taxed = buildOrderParts([line({ is_taxable: true })]);
  assertEquals(taxed.taxes.length, 1);
  assertEquals(taxed.taxes[0].percentage, '6');
  assertEquals(taxed.taxes[0].scope, 'LINE_ITEM');
  assertEquals(taxed.lineItems[0].applied_taxes, [{ tax_uid: SALES_TAX_UID }]);
});

Deno.test('tax applies to the flagged line only, not the whole order', () => {
  const { lineItems } = buildOrderParts([
    line({ description: 'Rental', is_taxable: false }),
    line({ description: 'Poster printing', is_taxable: true, sort_order: 1 }),
  ]);

  assertEquals(lineItems[0].applied_taxes, undefined);
  assertEquals(lineItems[1].applied_taxes, [{ tax_uid: SALES_TAX_UID }]);
});

Deno.test('lines keep the order staff arranged them in', () => {
  const { lineItems } = buildOrderParts([
    line({ description: 'Second', sort_order: 2 }),
    line({ description: 'First', sort_order: 1 }),
  ]);

  assertEquals(lineItems.map((i) => i.name), ['First', 'Second']);
});

Deno.test('an empty description falls back to the line kind', () => {
  const { lineItems } = buildOrderParts([line({ description: '' })]);
  assertEquals(lineItems[0].name, 'General use rental');
});

Deno.test('money rounds to whole cents', () => {
  const { lineItems, netSubtotalCents } = buildOrderParts([
    line({ quantity: 3, unit_price: 33.333 }),
  ]);
  assertEquals(lineItems[0].base_price_money, { amount: 3333, currency: 'USD' });
  assertEquals(netSubtotalCents, 10_000);
});

Deno.test('due date is net-14 from the day it is generated', () => {
  // 2026-08-14T18:00Z is still August 14 in Moscow, Idaho.
  assertEquals(paymentDueDate(new Date('2026-08-14T18:00:00Z')), '2026-08-28');
  // 2026-08-15T02:00Z is 7 PM on the 14th here — the terms run from the
  // venue's day, not UTC's.
  assertEquals(venueToday(new Date('2026-08-15T02:00:00Z')), '2026-08-14');
  assertEquals(paymentDueDate(new Date('2026-08-15T02:00:00Z')), '2026-08-28');
});

Deno.test('date arithmetic crosses months and years', () => {
  assertEquals(addDays('2026-12-28', 14), '2027-01-11');
  assertEquals(addDays('2026-02-28', 1), '2026-03-01');
});

Deno.test('a date span reads as one phrase', () => {
  assertEquals(formatDateSpan('2026-08-14'), 'August 14, 2026');
  assertEquals(formatDateSpan('2026-08-14', null), 'August 14, 2026');
  assertEquals(formatDateSpan('2026-08-14', '2026-08-14'), 'August 14, 2026');
  assertEquals(formatDateSpan('2026-08-14', '2026-08-16'), 'August 14–16, 2026');
  assertEquals(formatDateSpan('2026-08-30', '2026-09-02'), 'August 30 – September 2, 2026');
  assertEquals(formatDateSpan('2026-12-30', '2027-01-02'), 'December 30, 2026 – January 2, 2027');
  assertEquals(formatDateSpan(null), '');
});

Deno.test('the description names the event and its dates', () => {
  const text = invoiceDescription({
    event_title: 'Palouse Film Festival',
    proposed_date: '2026-08-14',
    end_date: '2026-08-16',
    organization_name: 'Palouse Arts',
  });
  assertEquals(
    text,
    'Kenworthy Performing Arts Centre — theatre rental\nPalouse Film Festival\nAugust 14–16, 2026\nPalouse Arts',
  );
});

Deno.test('a one-word name still makes a Square customer', () => {
  assertEquals(splitName('Cher'), { given_name: 'Cher' });
  assertEquals(splitName('Jordan Goins'), { given_name: 'Jordan', family_name: 'Goins' });
  assertEquals(splitName('Mary Anne Van Dyke'), {
    given_name: 'Mary Anne Van',
    family_name: 'Dyke',
  });
  assertEquals(splitName(''), { given_name: 'Renter' });
});
