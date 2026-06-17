import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Loader2 } from 'lucide-react';

type Line = {
  id: string;
  rental_request_id: string;
  line_kind: string;
  description: string;
  quantity: number;
  unit_price: number;
  account_id: string | null;
  is_taxable: boolean;
  sort_order: number;
  _dirty?: boolean;
  _new?: boolean;
};

type Account = { id: string; code: string; qbo_account_name: string; account_type: string };
type Mapping = { source_type: string; source_key: string; account_id: string; is_default: boolean };

const LINE_KINDS: { value: string; label: string }[] = [
  { value: 'general', label: 'General use rental' },
  { value: 'live_theater', label: 'Live theater rental' },
  { value: 'renter_fee', label: 'Fee charged to renter' },
  { value: 'film_licensing', label: 'Film licensing (renter pays)' },
  { value: 'poster_print', label: 'Poster printing' },
  { value: 'marquee', label: 'Marquee rental' },
  { value: 'rental_tickets', label: 'Rental ticket sales' },
  { value: 'nonprofit_discount', label: 'Non-profit discount' },
];

const TAX_RATE = 0.06;

function uuidish() {
  return 'new-' + Math.random().toString(36).slice(2, 10);
}

export default function RentalInvoiceLines({ rentalRequestId }: { rentalRequestId: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [l, a, m] = await Promise.all([
      supabase.from('rental_invoice_lines' as any).select('*').eq('rental_request_id', rentalRequestId).order('sort_order'),
      supabase.from('chart_of_accounts' as any).select('id,code,qbo_account_name,account_type').eq('is_active', true).order('sort_order'),
      supabase.from('account_mappings' as any).select('source_type,source_key,account_id,is_default').eq('source_type', 'rental_line_kind'),
    ]);
    if (l.error) toast.error(l.error.message);
    setLines(((l.data as any) || []) as Line[]);
    setAccounts(((a.data as any) || []) as Account[]);
    setMappings(((m.data as any) || []) as Mapping[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, [rentalRequestId]);

  function defaultAccountFor(kind: string): string | null {
    return mappings.find(m => m.source_key === kind)?.account_id
      ?? mappings.find(m => m.is_default)?.account_id
      ?? null;
  }

  function patch(id: string, p: Partial<Line>) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...p, _dirty: true } : l));
  }

  function addLine() {
    const kind = 'general';
    setLines(prev => [...prev, {
      id: uuidish(),
      rental_request_id: rentalRequestId,
      line_kind: kind,
      description: '',
      quantity: 1,
      unit_price: 0,
      account_id: defaultAccountFor(kind),
      is_taxable: false,
      sort_order: prev.length,
      _new: true, _dirty: true,
    }]);
  }

  async function removeLine(line: Line) {
    if (line._new) {
      setLines(prev => prev.filter(l => l.id !== line.id));
      return;
    }
    if (!confirm('Remove this line?')) return;
    const { error } = await supabase.from('rental_invoice_lines' as any).delete().eq('id', line.id);
    if (error) toast.error(error.message);
    else { toast.success('Removed'); load(); }
  }

  async function saveAll() {
    setSaving(true);
    try {
      const toCreate = lines.filter(l => l._new);
      const toUpdate = lines.filter(l => l._dirty && !l._new);
      if (toCreate.length) {
        const { error } = await supabase.from('rental_invoice_lines' as any).insert(
          toCreate.map(({ id, _new, _dirty, ...rest }) => rest)
        );
        if (error) throw error;
      }
      for (const l of toUpdate) {
        const { _new, _dirty, id, ...rest } = l;
        const { error } = await supabase.from('rental_invoice_lines' as any).update(rest).eq('id', id);
        if (error) throw error;
      }
      toast.success(`Saved ${toCreate.length + toUpdate.length} line(s)`);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const l of lines) {
      const lt = Number(l.quantity) * Number(l.unit_price);
      subtotal += lt;
      if (l.is_taxable) tax += lt * TAX_RATE;
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [lines]);

  const dirtyCount = lines.filter(l => l._dirty).length;

  if (loading) return <div className="py-6 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-serif text-xs text-muted-foreground">
          Each line defaults its QBO account from the line kind. Override per line as needed.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-4 w-4 mr-1" /> Add line</Button>
          <Button size="sm" onClick={saveAll} disabled={!dirtyCount || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save ({dirtyCount})
          </Button>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="font-serif text-sm text-muted-foreground py-3">No invoice lines yet. Click <em>Add line</em> to start.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b">
              <tr>
                <th className="text-left py-1.5 pr-2">Kind</th>
                <th className="text-left py-1.5 pr-2">Description</th>
                <th className="text-right py-1.5 pr-2 w-16">Qty</th>
                <th className="text-right py-1.5 pr-2 w-24">Unit $</th>
                <th className="text-left py-1.5 pr-2">QBO account</th>
                <th className="text-center py-1.5 pr-2 w-12">Tax</th>
                <th className="text-right py-1.5 pr-2 w-20">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const lineTotal = Number(l.quantity) * Number(l.unit_price);
                const mappedDefault = defaultAccountFor(l.line_kind);
                const isOverride = l.account_id && l.account_id !== mappedDefault;
                return (
                  <tr key={l.id} className="border-b border-border/40">
                    <td className="py-1.5 pr-2">
                      <select value={l.line_kind} onChange={e => {
                        const kind = e.target.value;
                        patch(l.id, { line_kind: kind, account_id: isOverride ? l.account_id : defaultAccountFor(kind) });
                      }} className="h-8 rounded border bg-background px-2 text-xs">
                        {LINE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input value={l.description} onChange={e => patch(l.id, { description: e.target.value })} className="h-8" placeholder="e.g. Saturday rental, 4 hours" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input type="number" step="0.01" value={l.quantity} onChange={e => patch(l.id, { quantity: Number(e.target.value) })} className="h-8 text-right" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input type="number" step="0.01" value={l.unit_price} onChange={e => patch(l.id, { unit_price: Number(e.target.value) })} className="h-8 text-right" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1">
                        <select value={l.account_id || ''} onChange={e => patch(l.id, { account_id: e.target.value || null })}
                                className="h-8 rounded border bg-background px-2 text-xs flex-1 min-w-0">
                          <option value="">— (unmapped)</option>
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>{a.code} — {a.qbo_account_name}</option>
                          ))}
                        </select>
                        {isOverride && <Badge variant="outline" className="text-[10px]">override</Badge>}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 text-center">
                      <Switch checked={l.is_taxable} onCheckedChange={v => patch(l.id, { is_taxable: v })} />
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono">${lineTotal.toFixed(2)}</td>
                    <td className="py-1.5">
                      <Button variant="ghost" size="sm" onClick={() => removeLine(l)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="text-sm">
              <tr><td colSpan={6} className="text-right pr-2 pt-2 text-muted-foreground">Subtotal</td><td className="text-right pr-2 pt-2 font-mono">${totals.subtotal.toFixed(2)}</td><td /></tr>
              <tr><td colSpan={6} className="text-right pr-2 text-muted-foreground">Tax (6%)</td><td className="text-right pr-2 font-mono">${totals.tax.toFixed(2)}</td><td /></tr>
              <tr><td colSpan={6} className="text-right pr-2 font-medium">Total</td><td className="text-right pr-2 font-mono font-bold">${totals.total.toFixed(2)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}