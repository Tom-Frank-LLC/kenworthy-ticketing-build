// Regenerates the `discounted` section of _shared/pricing_vectors.json.
//
// The probe is NOT left deployed. First:
//   npx supabase functions deploy square-discount-probe --project-ref rpqzrpboyhshdrfdwayk --no-verify-jwt
// and delete it again afterwards. It refuses to run against production.
//
//   PROBE_KEY=<staging service_role key> deno run --allow-net --allow-env --allow-read --allow-write \
//     supabase/functions/square-discount-probe/generate_discount_vectors.ts
//
// For each case it asks the STAGING database's own pricing function
// (quote_ticket_order, via a throwaway showing) how the discount is allocated —
// there is no local copy of that arithmetic any more — then asks Square's
// SANDBOX to total the order in the exact shape checkout sends (one line per
// price, each with its own fixed LINE_ITEM discount). For percent rules it also
// asks Square to apply its OWN percentage, so the database's order-wide
// rounding of D is checked against Square's rather than against itself.
//
// Needs PROBE_KEY (staging service_role) and leaves nothing behind on staging.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

type DiscountRule = { id: string; type: 'percent' | 'fixed_per_ticket' | 'fixed_per_order'; value: number; min_quantity: number; label: string; created_at: string };

const db = createClient(`https://${'rpqzrpboyhshdrfdwayk'}.supabase.co`, Deno.env.get('PROBE_KEY')!);

/** The database's allocation of a rule over these list prices, per ticket. */
async function allocate(rule: DiscountRule, list: number[]): Promise<{ perTicket: number[] }> {
  const { data: showing } = await db.from('showings').insert({ ticket_price: 0, start_time: new Date(Date.now() + 7 * 86400e3).toISOString(), is_active: true }).select('id').single();
  try {
    const tiers = await Promise.all([...new Set(list)].map(async (c) => {
      const { data } = await db.from('showing_price_tiers').insert({ showing_id: showing!.id, tier_name: `c${c}`, price: c / 100 }).select('id').single();
      return [c, data!.id] as const;
    }));
    const tierId = new Map(tiers);
    await db.from('ticket_discounts').insert({ showing_id: showing!.id, type: rule.type, value: rule.value, min_quantity: rule.min_quantity, label: rule.label });
    const { data: rows, error } = await db.rpc('quote_ticket_order', { p_showing_id: showing!.id, p_tickets: list.map((c) => ({ tier_id: tierId.get(c) })), p_channel: 'none' });
    if (error) throw new Error(error.message);
    return { perTicket: rows.map((r: any) => Math.round(Number(r.discount_amount) * 100)) };
  } finally {
    await db.from('showings').delete().eq('id', showing!.id); // cascades tiers and rules
  }
}

const REF = 'rpqzrpboyhshdrfdwayk';
const KEY = Deno.env.get('PROBE_KEY')!;
const VECTORS = new URL('../_shared/pricing_vectors.json', import.meta.url);
const TAX = [{ uid: 'tx', name: 'Sales tax', percentage: '6', scope: 'LINE_ITEM', type: 'ADDITIVE' }];

const rule = (type: DiscountRule['type'], value: number, min: number, label: string): DiscountRule =>
  ({ id: 'r', type, value, min_quantity: min, label, created_at: '2026-01-01T00:00:00Z' });
const n = (count: number, cents: number) => Array.from({ length: count }, () => cents);

const cases: Array<{ label: string; list: number[]; rule: DiscountRule }> = [
  { label: '25% off 4 x $9 (the Oct 3 shape at an awkward price)', list: n(4, 900), rule: rule('percent', 25, 4, '25% off 4+') },
  { label: '25% off 5 x $9', list: n(5, 900), rule: rule('percent', 25, 4, '25% off 4+') },
  { label: '25% off 7 x $9', list: n(7, 900), rule: rule('percent', 25, 4, '25% off 4+') },
  { label: '25% off 4 x $10 (lands on 50 cents)', list: n(4, 1000), rule: rule('percent', 25, 4, '25% off 4+') },
  { label: '25% off 4 x $8.25', list: n(4, 825), rule: rule('percent', 25, 4, '25% off 4+') },
  { label: '25% off 3 x $8.50 (D is a tie: 637.5)', list: n(3, 850), rule: rule('percent', 25, 1, '25% off') },
  { label: '15% off 7 x $19.99', list: n(7, 1999), rule: rule('percent', 15, 4, '15% off 4+') },
  { label: '12.5% off 5 x $15', list: n(5, 1500), rule: rule('percent', 12.5, 4, '12.5% off 4+') },
  { label: '25% off mixed tiers: 2 x $20 + 3 x $8.25', list: [2000, 2000, 825, 825, 825], rule: rule('percent', 25, 4, '25% off 4+') },
  { label: '25% off with a free ticket in the order: $0 + 4 x $9', list: [0, 900, 900, 900, 900], rule: rule('percent', 25, 4, '25% off 4+') },
  { label: '100% off 2 x $8.25', list: n(2, 825), rule: rule('percent', 100, 1, 'On the house') },
  { label: '$2 off each of 4 x $9', list: n(4, 900), rule: rule('fixed_per_ticket', 2, 4, '$2 off each, 4+') },
  { label: '$2.25 off each of 5 x $9', list: n(5, 900), rule: rule('fixed_per_ticket', 2.25, 4, '$2.25 off each, 4+') },
  { label: '$5 off each, capped by a $3.33 ticket: $3.33 + 3 x $19.99', list: [333, 1999, 1999, 1999], rule: rule('fixed_per_ticket', 5, 4, '$5 off each') },
  { label: '$10 off an order of 4 x $9', list: n(4, 900), rule: rule('fixed_per_order', 10, 4, '$10 off 4+') },
  { label: '$10 off an order of 7 x $8.25', list: n(7, 825), rule: rule('fixed_per_order', 10, 4, '$10 off 4+') },
  { label: '$7.77 off mixed tiers: $19.99 + 2 x $3.33 + 4 x $6.75', list: [1999, 333, 333, 675, 675, 675, 675], rule: rule('fixed_per_order', 7.77, 4, '$7.77 off 4+') },
  { label: '$100 off an order worth $36 (capped at the order)', list: n(4, 900), rule: rule('fixed_per_order', 100, 4, '$100 off') },
];

function grouped(list: number[], perTicket: number[]) {
  const by = new Map<number, { count: number; off: number }>();
  list.forEach((c, i) => {
    const g = by.get(c) ?? { count: 0, off: 0 };
    g.count++; g.off += perTicket[i]; by.set(c, g);
  });
  return [...by].filter(([c]) => c > 0);
}

const body: { cases: unknown[] } = { cases: [] };
for (const c of cases) {
  const applied = await allocate(c.rule, c.list);
  const groups = grouped(c.list, applied.perTicket);
  body.cases.push({
    label: c.label,
    order: {
      line_items: groups.map(([cents, g], i) => ({
        uid: `g${i}`, name: 'Ticket', quantity: String(g.count),
        base_price_money: { amount: cents, currency: 'USD' },
        applied_taxes: [{ tax_uid: 'tx' }],
        ...(g.off > 0 ? { applied_discounts: [{ discount_uid: `d${i}` }] } : {}),
      })),
      taxes: TAX,
      discounts: groups.filter(([, g]) => g.off > 0).map(([, g], i) => ({
        uid: `d${i}`, name: c.rule.label, amount_money: { amount: g.off, currency: 'USD' }, scope: 'LINE_ITEM',
      })),
    },
  });
  if (c.rule.type === 'percent') {
    body.cases.push({
      label: `native:${c.label}`,
      order: {
        line_items: groups.map(([cents, g], i) => ({
          uid: `g${i}`, name: 'Ticket', quantity: String(g.count),
          base_price_money: { amount: cents, currency: 'USD' },
          applied_taxes: [{ tax_uid: 'tx' }], applied_discounts: [{ discount_uid: 'p' }],
        })),
        taxes: TAX,
        discounts: [{ uid: 'p', name: c.rule.label, percentage: String(c.rule.value), scope: 'LINE_ITEM' }],
      },
    });
  }
}

const res = await fetch(`https://${REF}.supabase.co/functions/v1/square-discount-probe`, {
  method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const out = await res.json();
const by = new Map<string, any>(out.results.map((r: any) => [r.label, r]));

const discounted = cases.map((c) => {
  const r = by.get(c.label);
  if (!r || r.error) throw new Error(`${c.label}: ${JSON.stringify(r?.error)}`);
  const native = by.get(`native:${c.label}`);
  return {
    label: c.label,
    ticket_list_cents: c.list,
    rule: { type: c.rule.type, value: c.rule.value, min_quantity: c.rule.min_quantity },
    square_discount_cents: r.discount_total,
    square_tax_cents: r.tax_total,
    square_total_cents: r.total,
    ...(native ? { square_native_percent: { discount_cents: native.discount_total, total_cents: native.total } } : {}),
  };
});

const doc = JSON.parse(await Deno.readTextFile(VECTORS));
doc.discounted = discounted;
await Deno.writeTextFile(VECTORS, JSON.stringify(doc, null, 1));
for (const d of discounted) {
  const nat = d.square_native_percent;
  console.log(d.label.padEnd(62), 'D', d.square_discount_cents, 'tax', d.square_tax_cents, 'total', d.square_total_cents,
    nat ? (nat.discount_cents === d.square_discount_cents && nat.total_cents === d.square_total_cents ? '| native % agrees' : `| NATIVE DIFFERS ${JSON.stringify(nat)}`) : '');
}
