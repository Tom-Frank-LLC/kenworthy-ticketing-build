import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';

type Account = {
  id: string;
  code: string;
  name: string;
  qbo_account_name: string;
  qbo_account_id: string | null;
  account_type: string;
  parent_id: string | null;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
};

const TYPES = ['income', 'contra_income', 'expense', 'contra_expense', 'other_income', 'other_expense'];

export default function ChartOfAccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Record<string, Partial<Account>>>({});
  const [filter, setFilter] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('chart_of_accounts' as any)
      .select('*')
      .order('sort_order');
    if (error) toast.error(error.message);
    else setAccounts((data as any) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function edit(id: string, patch: Partial<Account>) {
    setDirty(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  }

  async function saveAll() {
    const updates = Object.entries(dirty);
    if (!updates.length) return;
    for (const [id, patch] of updates) {
      const { error } = await supabase.from('chart_of_accounts' as any).update(patch).eq('id', id);
      if (error) { toast.error(`${id}: ${error.message}`); return; }
    }
    toast.success(`Saved ${updates.length} account(s)`);
    setDirty({});
    load();
  }

  async function addAccount() {
    const code = prompt('Account code (e.g. 4999)');
    if (!code) return;
    const name = prompt('Account name')?.trim();
    if (!name) return;
    const { error } = await supabase.from('chart_of_accounts' as any).insert({
      code, name, qbo_account_name: name, account_type: 'income', sort_order: 9999,
    });
    if (error) toast.error(error.message);
    else { toast.success('Added'); load(); }
  }

  async function remove(a: Account) {
    if (!confirm(`Deactivate ${a.code} — ${a.name}?`)) return;
    const { error } = await supabase.from('chart_of_accounts' as any).update({ is_active: false }).eq('id', a.id);
    if (error) toast.error(error.message);
    else { toast.success('Deactivated'); load(); }
  }

  const filtered = accounts.filter(a =>
    !filter || a.code.toLowerCase().includes(filter.toLowerCase()) || a.name.toLowerCase().includes(filter.toLowerCase()) || a.qbo_account_name.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin inline" /></div>;

  return (
    <div className="space-y-4">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display flex items-center justify-between">
            <span>Chart of Accounts</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={addAccount}><Plus className="h-4 w-4 mr-1" /> Add</Button>
              <Button size="sm" onClick={saveAll} disabled={!Object.keys(dirty).length}>
                <Save className="h-4 w-4 mr-1" /> Save changes ({Object.keys(dirty).length})
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input placeholder="Filter by code or name…" value={filter} onChange={e => setFilter(e.target.value)} className="mb-4 max-w-sm" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 pr-2">Code</th>
                  <th className="text-left py-2 pr-2">Name</th>
                  <th className="text-left py-2 pr-2">QBO Name</th>
                  <th className="text-left py-2 pr-2">Type</th>
                  <th className="text-left py-2 pr-2">Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} className="border-b border-border/40">
                    <td className="py-2 pr-2"><Badge variant="outline" className="text-xs">{a.code}</Badge></td>
                    <td className="py-2 pr-2">
                      <Input value={a.name} onChange={e => edit(a.id, { name: e.target.value })} className="h-8" />
                    </td>
                    <td className="py-2 pr-2">
                      <Input value={a.qbo_account_name} onChange={e => edit(a.id, { qbo_account_name: e.target.value })} className="h-8" />
                    </td>
                    <td className="py-2 pr-2">
                      <select value={a.account_type} onChange={e => edit(a.id, { account_type: e.target.value })}
                              className="h-8 rounded border bg-background px-2 text-xs">
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <Switch checked={a.is_active} onCheckedChange={v => edit(a.id, { is_active: v })} />
                    </td>
                    <td className="py-2">
                      <Button variant="ghost" size="sm" onClick={() => remove(a)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}