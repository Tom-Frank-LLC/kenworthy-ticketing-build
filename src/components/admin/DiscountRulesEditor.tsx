import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { describeEligibility, describeOffer } from '@/lib/discounts';
import { canonicalTierName, type DiscountType } from '@/lib/orderMath';

/**
 * Ticket discount rules for one showing, or for every showing of a production.
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
 * What a rule DOES is not decided here. The arithmetic is `lib/orderMath.ts`,
 * the server applies it (`_shared/pricing.ts`), and the database verifies it on
 * every sale (`enforce_ticket_order_totals`).
 */

export type DiscountScope =
  | { showing_id: string }
  | { movie_id: string }
  | { event_id: string }
  | { live_performance_id: string };

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
}

const TYPE_LABELS: Record<DiscountType, string> = {
  percent: 'Percent off',
  fixed_per_ticket: 'Dollars off each ticket',
  fixed_per_order: 'Dollars off the whole order',
};

const COLUMNS = 'id, type, value, min_quantity, label, is_active, starts_at, ends_at, created_at, eligible_tiers';

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

export default function DiscountRulesEditor({ scope, audience }: {
  scope: DiscountScope;
  /** "this showing" / "every showing of this event" — completes the help line. */
  audience: string;
}) {
  const [scopeColumn, scopeId] = Object.entries(scope)[0] as [string, string];

  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState<DiscountType>('percent');
  const [value, setValue] = useState('');
  const [minQuantity, setMinQuantity] = useState('4');
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  // The ticket types sold here, canonical, and the ones the new rule reduces.
  // Every type starts ticked: "all types" is the common case and is stored as
  // NULL, so a rule made before a tier is added still covers the new tier.
  const [tierNames, setTierNames] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const table = () => (supabase as any).from('ticket_discounts');

  const load = useCallback(async () => {
    const { data, error } = await table().select(COLUMNS).eq(scopeColumn, scopeId).order('created_at');
    if (error) toast.error('Could not load discounts: ' + error.message);
    setRules((data ?? []).map((r: any) => ({ ...r, value: Number(r.value) })));
    setLoading(false);
  }, [scopeColumn, scopeId]);

  useEffect(() => { void load(); }, [load]);

  // Which ticket types exist here. For one showing, its tiers; for a production,
  // every tier on any of its showings. Names are canonicalised and de-duplicated
  // so "Students" and "Student" are one box. A showing with no tiers has no
  // boxes to show — every rule applies to its one price.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let showingIds: string[] = [];
      if (scopeColumn === 'showing_id') showingIds = [scopeId];
      else {
        const { data } = await supabase.from('showings').select('id').eq(scopeColumn as 'movie_id', scopeId);
        showingIds = (data ?? []).map((s) => s.id);
      }
      if (showingIds.length === 0) { if (!cancelled) setTierNames([]); return; }
      const { data } = await supabase.from('showing_price_tiers').select('tier_name').in('showing_id', showingIds);
      const names = [...new Set((data ?? []).map((t) => canonicalTierName(t.tier_name)).filter(Boolean))].sort();
      if (!cancelled) setTierNames(names);
    })();
    return () => { cancelled = true; };
  }, [scopeColumn, scopeId]);

  const shownLabel = labelTouched ? label : suggestLabel(type, value, minQuantity);

  async function addRule() {
    const v = Number(value);
    const min = Math.floor(Number(minQuantity));
    if (!Number.isFinite(v) || v <= 0) return toast.error('Enter an amount greater than zero.');
    if (type === 'percent' && v > 100) return toast.error('A percent discount cannot be more than 100.');
    if (!Number.isInteger(min) || min < 1) return toast.error('Minimum tickets must be 1 or more.');
    if (!shownLabel.trim()) return toast.error('Enter the displayed text — buyers see it on the showing page and their receipt.');
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      return toast.error('The offer has to end after it starts.');
    }
    const eligible = tierNames.filter((n) => !excluded.has(n));
    if (tierNames.length > 0 && eligible.length === 0) {
      return toast.error('Tick at least one ticket type the discount applies to.');
    }

    setBusy(true);
    const { data, error } = await table()
      .insert({
        [scopeColumn]: scopeId,
        type,
        value: Math.round(v * 100) / 100,
        min_quantity: min,
        label: shownLabel.trim(),
        starts_at: toIso(startsAt),
        ends_at: toIso(endsAt),
        is_active: true,
        // NULL = every type. Only a rule that leaves some type out stores a list.
        eligible_tiers: excluded.size > 0 ? eligible : null,
      })
      .select(COLUMNS);
    setBusy(false);

    if (error) return toast.error('Could not add the discount: ' + error.message);
    if (!data || data.length !== 1) {
      return toast.error('The discount was not saved. You may not have permission to add one.');
    }
    toast.success('Discount added — it applies to sales from now on.');
    setValue(''); setLabel(''); setLabelTouched(false); setStartsAt(''); setEndsAt(''); setExcluded(new Set());
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

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground font-serif">
        Applies automatically to {audience}, online and at the box office. If more than one
        discount fits an order, the buyer gets the single largest — they never stack. Free
        tickets, comps and film-pass admissions are never discounted and do not count towards
        a minimum. A minimum higher than the showing's online ticket limit (set on each
        showing; 20 unless changed) can only be reached at the box office.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discounts yet.</p>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{rule.label}</p>
                <p className="text-sm text-muted-foreground">
                  {describeOffer(rule)}
                  {rule.eligible_tiers && ` · ${describeEligibility(rule)} only`}
                  {rule.starts_at && ` · from ${formatWindow(rule.starts_at)}`}
                  {rule.ends_at && ` · until ${formatWindow(rule.ends_at)}`}
                </p>
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
            </li>
          ))}
        </ul>
      )}

      <fieldset className="space-y-3 rounded-md border border-border p-3" disabled={busy}>
        <legend className="px-1 text-sm font-medium">Add a discount</legend>
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
            <p className="text-xs text-muted-foreground">
              Untick a type to leave it at its own price — a student or senior ticket, say, that is
              already reduced. Every ticket in the order still counts towards the minimum.
            </p>
          </fieldset>
        )}
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
        <Button type="button" onClick={addRule}>Add discount</Button>
      </fieldset>
    </div>
  );
}
