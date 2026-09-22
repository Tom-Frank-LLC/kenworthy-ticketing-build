import { supabase } from '@/integrations/supabase/client';

export type DiscountType = 'percent' | 'fixed_per_ticket' | 'fixed_per_order';

/** A `ticket_discounts` row as the site reads it, for the offer badge. */
export interface DiscountRule {
  id: string;
  type: DiscountType;
  value: number;
  min_quantity: number;
  label: string;
  created_at: string;
  eligible_tiers?: string[] | null;
  is_active?: boolean | null;
  code?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

/**
 * The rules that may apply right now: active, inside their window, no promo
 * code. For DISPLAY — the offer badge. The database applies the same tests
 * when it prices, against its own clock; nothing here affects a charge.
 */
export function usableRules(rows: DiscountRule[], nowMs: number): DiscountRule[] {
  return rows
    .filter((r) => r.is_active !== false && !r.code)
    .filter((r) => !r.starts_at || Date.parse(r.starts_at) <= nowMs)
    .filter((r) => !r.ends_at || nowMs < Date.parse(r.ends_at))
    .map((r) => ({ ...r, value: Number(r.value) }));
}

const COLUMNS = 'id, type, value, min_quantity, label, created_at, is_active, code, starts_at, ends_at, eligible_tiers';

/**
 * The discount rules that could apply to a showing right now: its own, and its
 * production's.
 *
 * Two reads rather than one `.or()`, matching `_shared/pricing.ts`, so a scope
 * column is only ever matched by equality. RLS already limits the public to
 * active rules; `usableRules` applies the window and drops promo-code rules.
 *
 * This feeds a PREVIEW. The charge is set by the server from its own read of
 * the same table, and a failure here must never block a sale — it just means
 * the page quotes full price and the server still applies the discount.
 */
export async function fetchDiscountRules(showing: {
  id: string;
  movie_id?: string | null;
  event_id?: string | null;
  live_performance_id?: string | null;
}): Promise<DiscountRule[]> {
  const production: [string, string | null | undefined] = showing.event_id
    ? ['event_id', showing.event_id]
    : showing.live_performance_id
    ? ['live_performance_id', showing.live_performance_id]
    : ['movie_id', showing.movie_id];

  try {
    // The scope column is one of four; naming it dynamically sends the query
    // builder's generics into a loop, so the column is spelt out per branch.
    const own = supabase.from('ticket_discounts').select(COLUMNS).eq('showing_id', showing.id);
    const shared = !production[1]
      ? Promise.resolve({ data: [] as DiscountRule[] })
      : production[0] === 'event_id'
      ? supabase.from('ticket_discounts').select(COLUMNS).eq('event_id', production[1])
      : production[0] === 'live_performance_id'
      ? supabase.from('ticket_discounts').select(COLUMNS).eq('live_performance_id', production[1])
      : supabase.from('ticket_discounts').select(COLUMNS).eq('movie_id', production[1]);
    const [o, sh] = await Promise.all([own, shared]);
    const rows = [...((o.data ?? []) as DiscountRule[]), ...((sh.data ?? []) as DiscountRule[])];
    return usableRules(rows, Date.now());
  } catch (err) {
    console.warn('[discounts] could not load rules; quoting full price', err);
    return [];
  }
}

/** "Buy 4 or more and save 25%" — the line that advertises a rule. */
export function describeOffer(rule: DiscountRule): string {
  const amount = rule.type === 'percent'
    ? `${Number(rule.value)}%`
    : `$${Number(rule.value).toFixed(2).replace(/\.00$/, '')}${rule.type === 'fixed_per_ticket' ? ' per ticket' : ''}`;
  if (rule.min_quantity <= 1) return `Save ${amount}`;
  return `Buy ${rule.min_quantity} or more and save ${amount}`;
}

/** "Adult and Child tickets" — or '' when a rule applies to every type. */
export function describeEligibility(rule: Pick<DiscountRule, 'eligible_tiers'>): string {
  const names = rule.eligible_tiers;
  if (!names) return '';
  const shown = names.map((n) => n || 'general admission');
  if (shown.length === 1) return `${shown[0]} tickets`;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]} tickets`;
}

