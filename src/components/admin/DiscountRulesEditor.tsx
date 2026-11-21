import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LIMIT_PER_LABELS,
  describeEligibility,
  describeLimit,
  describeOffer,
  type DiscountLimit,
  type DiscountType,
  type LimitCounts,
  type LimitPer,
} from '@/lib/discounts';

/**
 * Ticket discount rules: for one showing, for every showing of a production,
 * or (scope `{ sitewide: true }`, the Promo codes tab) site-wide promo codes.
 *
 * Unlike the price-tier editors this does not ride along with the form's Save
 * button: each rule is written the moment it is added, switched or removed.
 * A discount is a small, separate decision ("turn the group offer off for
 * tonight") and should not need the whole showing re-saved — nor be lost
 * because somebody navigated away from a form they never meant to submit.
 *
 * Every write selects what it wrote and checks the count. RLS denials on this
 * project come back as a success with no rows, so an unchecked write here would
 * tell an admin their offer was live when it was not.
 *
 * What a rule DOES is not decided here. The database prices every sale
 * (price_ticket_order), including whether a code is valid and has uses left;
 * the table's own constraints refuse what it cannot hold (a site-wide rule
 * with no code, a lower-case code, a duplicate code). See BRIEF-promo-codes.
 */

export type DiscountScope =
  | { showing_id: string }
  | { movie_id: string }
  | { event_id: string }
  | { live_performance_id: string }
  | { sitewide: true };

type ScopeColumn = 'showing_id' | 'movie_id' | 'event_id' | 'live_performance_id';
type Channels = 'everywhere' | 'online' | 'in_person';

interface RuleRow {
  id: string;
  type: DiscountType;
  value: number;
  min_quantity: number;
  label: string;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  eligible_tiers: string[] | null;
  code: string | null;
  channels: string[] | null;
  ticket_discount_limits: Required<DiscountLimit>[];
  /** Only read on the Promo codes tab, to say where a scoped code works. */
  movies?: { title: string } | null;
  events?: { title: string } | null;
  live_performances?: { title: string } | null;
  showings?: { start_time: string | null } | null;
}

const TYPE_LABELS: Record<DiscountType, string> = {
  percent: 'Percent off',
  fixed_per_ticket: 'Dollars off each ticket',
  fixed_per_order: 'Dollars off the whole order',
};

const CHANNEL_LABELS: Record<Channels, string> = {
  everywhere: 'Online and at the box office',
  online: 'Online only',
  in_person: 'Box office only',
};

const COLUMNS = 'id, type, value, min_quantity, label, is_active, starts_at, ends_at, created_at, eligible_tiers, code, channels, ticket_discount_limits(id, counts, per, max_uses)';
const SITEWIDE_COLUMNS = `${COLUMNS}, movies(title), events(title), live_performances(title), showings(start_time)`;

/** The table's own rule for a code (ticket_discounts_code_format). */
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
/** What an admin types becomes the stored form: upper-case, no spaces. */
export const normaliseCode = (raw: string) => raw.toUpperCase().replace(/\s+/g, '');

/** `<input type="datetime-local">` speaks local wall-clock time with no zone. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
const formatWindow = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function suggestLabel(type: DiscountType, value: string, minQuantity: string): string {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return '';
  const min = Math.max(1, Math.floor(Number(minQuantity)) || 1);
  const amount = type === 'percent' ? `${v}%` : `$${v.toFixed(2).replace(/\.00$/, '')}`;
  const what = type === 'fixed_per_ticket' ? `${amount} off each ticket` : `${amount} off`;
  return min > 1 ? `${what} when you buy ${min}+` : what;
}

/** Where a code works, for the Promo codes list. */
function whereItWorks(rule: RuleRow): string {
  if (rule.movies?.title) return `Film: ${rule.movies.title}`;
  if (rule.events?.title) return `Event: ${rule.events.title}`;
  if (rule.live_performances?.title) return `Performance: ${rule.live_performances.title}`;
  if (rule.showings) {
    return `One showing${rule.showings.start_time ? `, ${formatWindow(rule.showings.start_time)}` : ''}`;
  }
  return 'Every film, event and performance';
}

const toChannels = (c: Channels): string[] | null => (c === 'everywhere' ? null : [c]);

interface DraftLimit { key: number; max: string; counts: LimitCounts; per: LimitPer }

/** One "N orders/tickets per …" row, for the add form and for an existing rule. */
function LimitFields({ draft, onChange, idPrefix }: {
  draft: DraftLimit;
  onChange: (next: DraftLimit) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1 w-24">
        <Label htmlFor={`${idPrefix}-max`}>Up to</Label>
        <Input
          id={`${idPrefix}-max`} type="number" inputMode="numeric" min="1" step="1"
          value={draft.max} onChange={(e) => onChange({ ...draft, max: e.target.value })}
        />
      </div>
      <div className="space-y-1 w-32">
        <Label htmlFor={`${idPrefix}-counts`}>Counting</Label>
        <Select value={draft.counts} onValueChange={(v) => onChange({ ...draft, counts: v as LimitCounts })}>
          <SelectTrigger id={`${idPrefix}-counts`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="orders">orders</SelectItem>
            <SelectItem value="tickets">tickets</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 min-w-[12rem] flex-1">
        <Label htmlFor={`${idPrefix}-per`}>Measured</Label>
        <Select value={draft.per} onValueChange={(v) => onChange({ ...draft, per: v as LimitPer })}>
          <SelectTrigger id={`${idPrefix}-per`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(LIMIT_PER_LABELS) as LimitPer[]).map((p) => (
              <SelectItem key={p} value={p}>{LIMIT_PER_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** A limit ready to insert, or the sentence explaining why it is not. */
function readLimit(d: DraftLimit): { ok: true; limit: DiscountLimit } | { ok: false; error: string } {
  const n = Math.floor(Number(d.max));
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'Each limit needs a number of 1 or more.' };
  return { ok: true, limit: { counts: d.counts, per: d.per, max_uses: n } };
}

export default function DiscountRulesEditor({ scope, audience }: {
  scope: DiscountScope;
  /** "this showing" / "every showing of this event" — completes the help line. */
  audience: string;
}) {
  const sitewide = 'sitewide' in scope;
  const [scopeColumn, scopeId] = sitewide
    ? [null, null]
    : (Object.entries(scope)[0] as [ScopeColumn, string]);

  const [rules, setRules] = useState<RuleRow[]>([]);
  const [usage, setUsage] = useState<Record<string, { orders: number; tickets: number }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState<DiscountType>('percent');
  const [value, setValue] = useState('');
  const [minQuantity, setMinQuantity] = useState(sitewide ? '1' : '4');
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [code, setCode] = useState('');
  const [channels, setChannels] = useState<Channels>('everywhere');
  const [limits, setLimits] = useState<DraftLimit[]>([]);
  const nextKey = useRef(1);
  // A limit being added to an existing rule: which rule, and the draft.
  const [addingTo, setAddingTo] = useState<{ ruleId: string; draft: DraftLimit } | null>(null);
  // The ticket types sold here, canonical, and the ones the new rule reduces.
  // Every type starts ticked: "all types" is the common case and is stored as
  // NULL, so a rule made before a tier is added still covers the new tier.
  const [tierNames, setTierNames] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const table = () => supabase.from('ticket_discounts');

  const load = useCallback(async () => {
    // The scope column is one of four; a dynamic column name sends the query
    // builder's generics into a loop, so it is matched with a filter string.
    // The Promo codes tab lists every coded rule, wherever it applies.
    const query = sitewide
      ? table().select(SITEWIDE_COLUMNS).not('code', 'is', null).order('created_at')
      : table().select(COLUMNS).filter(scopeColumn!, 'eq', scopeId!).order('created_at');
    const { data, error } = await query;
    if (error) toast.error('Could not load discounts: ' + error.message);
    const rows = ((data ?? []) as any[]).map((r) => ({
      ...r, value: Number(r.value), ticket_discount_limits: r.ticket_discount_limits ?? [],
    })) as RuleRow[];
    setRules(rows);
    setLoading(false);
    // Uses so far, by the database's own count (the one the limits enforce).
    if (rows.length > 0) {
      const { data: used } = await supabase.rpc('ticket_discount_usage', { p_discount_ids: rows.map((r) => r.id) });
      const byId: Record<string, { orders: number; tickets: number }> = {};
      for (const u of (used ?? []) as { discount_id: string; orders: number; tickets: number }[]) {
        byId[u.discount_id] = { orders: Number(u.orders), tickets: Number(u.tickets) };
      }
      setUsage(byId);
    }
  }, [sitewide, scopeColumn, scopeId]);

  useEffect(() => { void load(); }, [load]);

  // Which ticket types exist here. For one showing, its tiers; for a production,
  // every tier on any of its showings. Names are canonicalised and de-duplicated
  // so "Students" and "Student" are one box. A showing with no tiers has no
  // boxes to show — every rule applies to its one price. A site-wide code has
  // no one set of tiers, so it always covers every type.
  useEffect(() => {
    if (sitewide) { setTierNames([]); return; }
    let cancelled = false;
    (async () => {
      let showingIds: string[] = [];
      if (scopeColumn === 'showing_id') showingIds = [scopeId!];
      else {
        const { data } = await supabase.from('showings').select('id').filter(scopeColumn!, 'eq', scopeId!).eq('is_archival', false);
        showingIds = (data ?? []).map((s) => s.id);
      }
      if (showingIds.length === 0) { if (!cancelled) setTierNames([]); return; }
      // Live tiers only: a retired one is not a type anybody can buy.
      const { data } = await supabase.from('showing_price_tiers').select('tier_name').in('showing_id', showingIds).eq('is_active', true);
      // One spelling per type, decided by the database's canonical_tier_name —
      // the same function the pricing uses to match a rule to a ticket — so
      // the box an admin ticks is the name a sale will be checked against.
      const raw = [...new Set((data ?? []).map((t) => t.tier_name).filter(Boolean))];
      const canonical = await Promise.all(raw.map(async (r) => {
        const { data: c } = await supabase.rpc('canonical_tier_name', { raw: r });
        return typeof c === 'string' ? c : r;
      }));
      const names = [...new Set(canonical.filter(Boolean))].sort();
      if (!cancelled) setTierNames(names);
    })();
    return () => { cancelled = true; };
  }, [sitewide, scopeColumn, scopeId]);

  const shownLabel = labelTouched ? label : suggestLabel(type, value, minQuantity);

  function newDraft(): DraftLimit {
    nextKey.current += 1;
    return { key: nextKey.current, max: '', counts: 'orders', per: sitewide ? 'buyer' : 'total' };
  }

  async function addRule() {
    const v = Number(value);
    const min = Math.floor(Number(minQuantity));
    const c = normaliseCode(code);
    if (!Number.isFinite(v) || v <= 0) return toast.error('Enter an amount greater than zero.');
    if (type === 'percent' && v > 100) return toast.error('A percent discount cannot be more than 100.');
    if (!Number.isInteger(min) || min < 1) return toast.error('Minimum tickets must be 1 or more.');
    if (!shownLabel.trim()) return toast.error('Enter the displayed text — buyers see it on their order and receipt.');
    if (sitewide && !c) return toast.error('A site-wide discount needs a promo code. Without one it would apply to every ticket sold.');
    if (c && !CODE_PATTERN.test(c)) {
      return toast.error('A code is 3 to 32 letters, numbers, dashes or underscores, starting with a letter or number.');
    }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      return toast.error('The offer has to end after it starts.');
    }
    const eligible = tierNames.filter((n) => !excluded.has(n));
    if (tierNames.length > 0 && eligible.length === 0) {
      return toast.error('Tick at least one ticket type the discount applies to.');
    }
    const parsed = limits.map(readLimit);
    const bad = parsed.find((p) => 'error' in p);
    if (bad && 'error' in bad) return toast.error(bad.error);
    const readyLimits = parsed.flatMap((p) => ('limit' in p ? [p.limit] : []));
    if (new Set(readyLimits.map((l) => `${l.counts}/${l.per}`)).size !== readyLimits.length) {
      return toast.error('Two limits measure the same thing. Keep one of them.');
    }

    setBusy(true);
    // With limits, the rule is written switched off and only switched on once
    // its limits are saved: a limited code must never be live, even for a
    // moment, without the limits that were meant to hold it.
    const { data, error } = await table()
      .insert({
        ...(sitewide ? {} : { [scopeColumn!]: scopeId }),
        type,
        value: Math.round(v * 100) / 100,
        min_quantity: min,
        label: shownLabel.trim(),
        starts_at: toIso(startsAt),
        ends_at: toIso(endsAt),
        is_active: readyLimits.length === 0,
        // NULL = every type. Only a rule that leaves some type out stores a list.
        eligible_tiers: excluded.size > 0 ? eligible : null,
        code: c || null,
        channels: toChannels(channels),
      })
      .select('id');

    if (error) {
      setBusy(false);
      if (error.code === '23505') return toast.error(`The code ${c} is already in use. Codes are unique across the site.`);
      return toast.error('Could not add the discount: ' + error.message);
    }
    if (!data || data.length !== 1) {
      setBusy(false);
      return toast.error('The discount was not saved. You may not have permission to add one.');
    }
    const ruleId = data[0].id;

    if (readyLimits.length > 0) {
      const { data: saved, error: limitErr } = await supabase
        .from('ticket_discount_limits')
        .insert(readyLimits.map((l) => ({ ...l, discount_id: ruleId })))
        .select('id');
      const { data: on } = !limitErr && saved?.length === readyLimits.length
        ? await table().update({ is_active: true }).eq('id', ruleId).select('id')
        : { data: null };
      if (limitErr || saved?.length !== readyLimits.length || on?.length !== 1) {
        // Leave nothing half-made: no limit-less code, switched on or off.
        await table().delete().eq('id', ruleId);
        setBusy(false);
        return toast.error('Could not save the limits, so the discount was not added' + (limitErr ? ': ' + limitErr.message : '.'));
      }
    }
    setBusy(false);

    toast.success(c ? `Code ${c} added. It works from now on.` : 'Discount added — it applies to sales from now on.');
    setValue(''); setLabel(''); setLabelTouched(false); setStartsAt(''); setEndsAt(''); setExcluded(new Set());
    setCode(''); setChannels('everywhere'); setLimits([]);
    void load();
  }

  async function setActive(rule: RuleRow, isActive: boolean) {
    setBusy(true);
    const { data, error } = await table().update({ is_active: isActive }).eq('id', rule.id).select('id');
    setBusy(false);
    if (error || !data || data.length !== 1) {
      return toast.error('Could not change that discount' + (error ? ': ' + error.message : '.'));
    }
    toast.success(isActive ? 'Discount switched on.' : 'Discount switched off.');
    void load();
  }

  async function removeRule(rule: RuleRow) {
    setBusy(true);
    const { data, error } = await table().delete().eq('id', rule.id).select('id');
    setBusy(false);
    if (error || !data || data.length !== 1) {
      return toast.error('Could not remove that discount' + (error ? ': ' + error.message : '.'));
    }
    toast.success('Discount removed. Tickets already sold keep the price they paid.');
    void load();
  }

  async function addLimit(rule: RuleRow, draft: DraftLimit) {
    const parsed = readLimit(draft);
    if ('error' in parsed) return toast.error(parsed.error);
    if (rule.ticket_discount_limits.some((l) => l.counts === parsed.limit.counts && l.per === parsed.limit.per)) {
      return toast.error('That rule already has a limit measuring the same thing. Remove it first to change the number.');
    }
    setBusy(true);
    const { data, error } = await supabase
      .from('ticket_discount_limits')
      .insert({ ...parsed.limit, discount_id: rule.id })
      .select('id');
    setBusy(false);
    if (error || !data || data.length !== 1) {
      return toast.error('Could not add that limit' + (error ? ': ' + error.message : '.'));
    }
    setAddingTo(null);
    toast.success(`Limit added: ${describeLimit(parsed.limit)}.`);
    void load();
  }

  async function removeLimit(limit: Required<DiscountLimit>) {
    setBusy(true);
    const { data, error } = await supabase.from('ticket_discount_limits').delete().eq('id', limit.id).select('id');
    setBusy(false);
    if (error || !data || data.length !== 1) {
      return toast.error('Could not remove that limit' + (error ? ': ' + error.message : '.'));
    }
    toast.success('Limit removed. Uses so far still count if you add it back.');
    void load();
  }

  return (
    <div className="space-y-5">
      {!sitewide && (
        <p className="text-sm text-muted-foreground font-serif">
          Applies to {audience}. Without a promo code, a discount applies automatically; with one,
          it is hidden from the showing page and applies only when the code is entered. If more
          than one discount fits an order, the buyer gets the single largest — they never stack.
          Free tickets, comps and film-pass admissions are never discounted and do not count
          towards a minimum. A minimum higher than the showing's online ticket limit (set on each
          showing; 20 unless changed) can only be reached at the box office.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{sitewide ? 'No promo codes yet.' : 'No discounts yet.'}</p>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => {
            const used = usage[rule.id];
            return (
              <li key={rule.id} className="space-y-2 rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium flex flex-wrap items-center gap-2">
                      {rule.label}
                      {rule.code && <Badge variant="outline" className="tracking-wide">{rule.code}</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {sitewide && `${whereItWorks(rule)} · `}
                      {describeOffer(rule)}
                      {rule.eligible_tiers && ` · ${describeEligibility(rule)} only`}
                      {rule.starts_at && ` · from ${formatWindow(rule.starts_at)}`}
                      {rule.ends_at && ` · until ${formatWindow(rule.ends_at)}`}
                    </p>
                    {used && (used.orders > 0 || rule.code || rule.ticket_discount_limits.length > 0) && (
                      <p className="text-sm text-muted-foreground">
                        Used on {used.orders} {used.orders === 1 ? 'order' : 'orders'}, {used.tickets} {used.tickets === 1 ? 'ticket' : 'tickets'} so far
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`discount-active-${rule.id}`}
                      checked={rule.is_active}
                      disabled={busy}
                      onCheckedChange={(on) => setActive(rule, on)}
                    />
                    <Label htmlFor={`discount-active-${rule.id}`} className="text-sm">
                      {rule.is_active ? 'On' : 'Off'}
                    </Label>
                  </div>
                  <Button
                    type="button" variant="ghost" size="icon" disabled={busy}
                    aria-label={`Remove ${rule.label}`} onClick={() => removeRule(rule)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {(rule.ticket_discount_limits.length > 0 || addingTo?.ruleId === rule.id) && (
                  <ul className="flex flex-wrap gap-2" aria-label={`Limits on ${rule.label}`}>
                    {rule.ticket_discount_limits.map((l) => (
                      <li key={l.id} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
                        Up to {describeLimit(l)}
                        <Button
                          type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={busy}
                          aria-label={`Remove the limit ${describeLimit(l)}`} onClick={() => removeLimit(l)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {addingTo?.ruleId === rule.id ? (
                  <div className="space-y-2">
                    <LimitFields
                      idPrefix={`limit-${rule.id}`}
                      draft={addingTo.draft}
                      onChange={(draft) => setAddingTo({ ruleId: rule.id, draft })}
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={busy} onClick={() => addLimit(rule, addingTo.draft)}>Save limit</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setAddingTo(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button" variant="ghost" size="sm" disabled={busy}
                    onClick={() => setAddingTo({ ruleId: rule.id, draft: newDraft() })}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add a limit
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <fieldset className="space-y-3 rounded-md border border-border p-3" disabled={busy}>
        <legend className="px-1 text-sm font-medium">{sitewide ? 'Add a site-wide promo code' : 'Add a discount'}</legend>
        {/* items-end: the inputs share a baseline even if a label wraps onto two
            lines at a narrow width or a larger text size. No placeholders in this
            form — greyed example text read as a setting already made. */}
        <div className="grid gap-3 sm:grid-cols-3 items-end">
          <div className="space-y-1">
            <Label htmlFor="discount-type">Kind</Label>
            <Select value={type} onValueChange={(v) => setType(v as DiscountType)}>
              <SelectTrigger id="discount-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as DiscountType[]).map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="discount-value">{type === 'percent' ? 'Percent' : 'Dollars'}</Label>
            <Input
              id="discount-value" type="number" inputMode="decimal" min="0" step="0.01"
              max={type === 'percent' ? 100 : undefined}
              value={value} onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="discount-min">Ticket minimum</Label>
            <Input
              id="discount-min" type="number" inputMode="numeric" min="1" step="1"
              value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="discount-label">Displayed text</Label>
          <Input
            id="discount-label" value={shownLabel}
            onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 items-end">
          <div className="space-y-1">
            <Label htmlFor="discount-code">{sitewide ? 'Promo code' : 'Promo code (optional)'}</Label>
            <Input
              id="discount-code" value={code} autoComplete="off" spellCheck={false} maxLength={32}
              aria-describedby="discount-code-help"
              onChange={(e) => setCode(normaliseCode(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="discount-channels">Where it can be used</Label>
            <Select value={channels} onValueChange={(v) => setChannels(v as Channels)}>
              <SelectTrigger id="discount-channels"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CHANNEL_LABELS) as Channels[]).map((c) => (
                  <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p id="discount-code-help" className="text-sm text-muted-foreground">
          {sitewide
            ? 'Letters and numbers, 3 to 32 characters. '
            : 'Leave empty to apply automatically. With a code, letters and numbers, 3 to 32 characters. '}
          Make it hard to guess: a short common word can be found by trying, and anyone who finds it can use it.
        </p>
        {tierNames.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Applies to</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {tierNames.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={!excluded.has(name)}
                    onChange={(e) => setExcluded((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.delete(name); else next.add(name);
                      return next;
                    })}
                  />
                  {name}
                </label>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Untick a type to leave it at its own price — a student or senior ticket, say, that is
              already reduced. Every ticket in the order still counts towards the minimum.
            </p>
          </fieldset>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Usage limits (optional)</legend>
          {limits.map((d, i) => (
            <div key={d.key} className="flex items-end gap-2">
              <div className="flex-1">
                <LimitFields
                  idPrefix={`new-limit-${d.key}`}
                  draft={d}
                  onChange={(next) => setLimits((prev) => prev.map((x, j) => (j === i ? next : x)))}
                />
              </div>
              <Button
                type="button" variant="ghost" size="icon" aria-label="Remove this limit"
                onClick={() => setLimits((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setLimits((prev) => [...prev, newDraft()])}>
            <Plus className="h-4 w-4 mr-1" /> Add a limit
          </Button>
          <p className="text-sm text-muted-foreground">
            A failed card payment doesn't use anything up; a refund doesn't give a use back.
          </p>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="discount-starts">Starts (optional)</Label>
            <Input id="discount-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="discount-ends">Ends (optional)</Label>
            <Input id="discount-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <Button type="button" onClick={addRule}>{sitewide ? 'Add promo code' : 'Add discount'}</Button>
      </fieldset>
    </div>
  );
}
