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
  /** NULL = everywhere; else a subset of online / in_person (20261120190412). */
  channels?: string[] | null;
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

const COLUMNS = 'id, type, value, min_quantity, label, created_at, is_active, code, starts_at, ends_at, eligible_tiers, channels';

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
  const where = channelPhrase(rule.channels);
  if (rule.min_quantity <= 1) return `Save ${amount}${where}`;
  return `Buy ${rule.min_quantity} or more and save ${amount}${where}`;
}

/** " online only" / " at the box office", or '' for a rule that applies everywhere. */
export function channelPhrase(channels: string[] | null | undefined): string {
  if (!channels || channels.length !== 1) return '';
  return channels[0] === 'online' ? ' online only' : ' at the box office';
}

// ---- Usage limits (ticket_discount_limits, 20261120190412) ------------------

export type LimitCounts = 'orders' | 'tickets';
export type LimitPer = 'total' | 'buyer' | 'showing' | 'day' | 'buyer_showing';
export interface DiscountLimit {
  id?: string;
  counts: LimitCounts;
  per: LimitPer;
  max_uses: number;
}

export const LIMIT_PER_LABELS: Record<LimitPer, string> = {
  total: 'in total',
  buyer: 'per person',
  showing: 'per showing',
  day: 'per day of shows',
  buyer_showing: 'per person, per showing',
};

/** "100 orders in total", "2 tickets per person". */
export function describeLimit(limit: DiscountLimit): string {
  const n = Number(limit.max_uses);
  const unit = limit.counts === 'orders' ? (n === 1 ? 'order' : 'orders') : (n === 1 ? 'ticket' : 'tickets');
  return `${n} ${unit} ${LIMIT_PER_LABELS[limit.per] ?? limit.per}`;
}

/**
 * What the till shows beside an applied code that has a per-person limit, or
 * null when it has none. Counter sales are recorded under the staff member
 * ringing them, so the database cannot tell who the patron is; staff check.
 */
export function buyerLimitNote(limits: DiscountLimit[]): string | null {
  const personal = limits.filter((l) => l.per === 'buyer' || l.per === 'buyer_showing');
  if (personal.length === 0) return null;
  return `Limit ${personal.map(describeLimit).join('; ')}. The till can't check this, so please confirm with the patron.`;
}

/** "Adult and Child tickets" — or '' when a rule applies to every type. */
export function describeEligibility(rule: Pick<DiscountRule, 'eligible_tiers'>): string {
  const names = rule.eligible_tiers;
  if (!names) return '';
  const shown = names.map((n) => n || 'general admission');
  if (shown.length === 1) return `${shown[0]} tickets`;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]} tickets`;
}

