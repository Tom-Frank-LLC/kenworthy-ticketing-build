import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

type Mapping = { id: string; source_type: string; source_key: string; account_id: string; is_default: boolean };
type Account = { id: string; code: string; name: string; qbo_account_name: string; account_type: string };

const SOURCE_TYPE_LABELS: Record<string, string> = {
  ticket_type: 'Ticket types',
  pass_type: 'Pass types',
  concession_category: 'Concession categories',
  merch_item: 'Merchandise',
  rental_line_kind: 'Rental invoice lines',
  donation_designation: 'Donation designations',
  sponsorship_program: 'Sponsorship programs',
  tip: 'Tips',
  sales_tax: 'Sales tax',
  grant_program: 'Grants',
  discount: 'Discounts',
  refund: 'Refunds',
  interest: 'Bank interest',
  expense_category: 'Expense categories',
  payroll_category: 'Payroll categories',
};

export default function AccountMappingsTab() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const [m, a] = await Promise.all([
      supabase.from('account_mappings' as any).select('*').order('source_type').order('source_key'),
      supabase.from('chart_of_accounts' as any).select('id,code,name,qbo_account_name,account_type').eq('is_active', true).order('sort_order'),
    ]);
    if (m.error) toast.error(m.error.message);
    if (a.error) toast.error(a.error.message);
    setMappings((m.data as any) || []);
    setAccounts((a.data as any) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const g: Record<string, Mapping[]> = {};
    for (const m of mappings) (g[m.source_type] ||= []).push(m);
    return g;
  }, [mappings]);

  function change(id: string, accountId: string) {
    setDirty(prev => ({ ...prev, [id]: accountId }));
  }

  async function save() {
    const entries = Object.entries(dirty);
    if (!entries.length) return;
    for (const [id, account_id] of entries) {
      const { error } = await supabase.from('account_mappings' as any).update({ account_id }).eq('id', id);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`Saved ${entries.length} mapping(s)`);
    setDirty({});
    load();
  }

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin inline" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!Object.keys(dirty).length}>
          <Save className="h-4 w-4 mr-1" /> Save mappings ({Object.keys(dirty).length})
        </Button>
      </div>

      {Object.entries(grouped).map(([type, items]) => (
        <Card key={type} className="glass">
          <CardHeader>
            <CardTitle className="font-display text-base">{SOURCE_TYPE_LABELS[type] || type}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {items.map(m => {
                const currentId = dirty[m.id] ?? m.account_id;
                return (
                  <div key={m.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-4 flex items-center gap-2">
                      <span className="text-sm">{m.source_key}</span>
                      {m.is_default && <Badge variant="outline" className="text-xs">default</Badge>}
                    </div>
                    <div className="col-span-8">
                      <select value={currentId} onChange={e => change(m.id, e.target.value)}
                              className="w-full h-9 rounded border bg-background px-2 text-sm">
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>{a.code} — {a.qbo_account_name} ({a.account_type})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}