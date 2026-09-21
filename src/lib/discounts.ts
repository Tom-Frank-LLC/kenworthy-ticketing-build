import { supabase } from '@/integrations/supabase/client';
import { type DiscountRule, type DiscountRuleRow, usableRules } from './orderMath';

const COLUMNS = 'id, type, value, min_quantity, label, created_at, is_active, code, starts_at, ends_at';

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
    const table = () => (supabase as any).from('ticket_discounts').select(COLUMNS);
    const [own, shared] = await Promise.all([
      table().eq('showing_id', showing.id),
      production[1] ? table().eq(production[0], production[1]) : Promise.resolve({ data: [] }),
    ]);
    const rows: DiscountRuleRow[] = [...(own.data ?? []), ...(shared.data ?? [])];
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
