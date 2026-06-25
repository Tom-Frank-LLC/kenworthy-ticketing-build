import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';

type TipMethod = 'off' | 'pooled_equal' | 'by_hours';

export function WageTipRules() {
  const [id, setId] = useState<string | null>(null);
  const [ot, setOt] = useState(40);
  const [tipMethod, setTipMethod] = useState<TipMethod>('off');
  const [roles, setRoles] = useState<Array<{ role: string; wage: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('labor_settings').select('*').order('created_at').limit(1).maybeSingle();
    if (error) { toast.error(error.message); setLoading(false); return; }
    if (data) {
      setId(data.id);
      setOt(Number(data.ot_weekly_hours) || 40);
      setTipMethod((data.tip_method as TipMethod) || 'off');
      const wd = (data.role_wage_defaults || {}) as Record<string, number>;
      setRoles(Object.entries(wd).map(([role, wage]) => ({ role, wage: Number(wage) })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    const wd: Record<string, number> = {};
    roles.forEach((r) => { if (r.role.trim()) wd[r.role.trim()] = Number(r.wage) || 0; });
    const payload = { ot_weekly_hours: ot, tip_method: tipMethod, role_wage_defaults: wd };
    const { error } = id
      ? await supabase.from('labor_settings').update(payload).eq('id', id)
      : await supabase.from('labor_settings').insert(payload);
    if (error) toast.error(error.message); else toast.success('Saved');
    setSaving(false);
    load();
  };

  if (loading) return <Card><CardContent className="py-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-2" />Loading…</CardContent></Card>;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Wage & tip rules</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Overtime threshold (hrs / week)</Label>
            <Input type="number" min={0} step={0.5} value={ot} onChange={(e) => setOt(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground mt-1">Idaho default is 40. Hours above this earn 1.5×.</p>
          </div>
          <div>
            <Label>Tip pool method</Label>
            <Select value={tipMethod} onValueChange={(v) => setTipMethod(v as TipMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off — tips not pooled</SelectItem>
                <SelectItem value="pooled_equal">Pooled equally among clocked-in staff</SelectItem>
                <SelectItem value="by_hours">Pooled weighted by hours worked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Default wage by role</Label>
            <Button size="sm" variant="outline" onClick={() => setRoles([...roles, { role: '', wage: 15 }])}>
              <Plus className="h-4 w-4 mr-1" /> Add role
            </Button>
          </div>
          <div className="space-y-2">
            {roles.length === 0 && <p className="text-sm text-muted-foreground">No role defaults yet. Square wages on individual staff still apply.</p>}
            {roles.map((r, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input placeholder="Role (e.g. Box office)" value={r.role} onChange={(e) => {
                  const next = [...roles]; next[i].role = e.target.value; setRoles(next);
                }} />
                <Input type="number" step={0.25} className="w-32" value={r.wage} onChange={(e) => {
                  const next = [...roles]; next[i].wage = Number(e.target.value); setRoles(next);
                }} />
                <span className="text-sm text-muted-foreground">/ hr</span>
                <Button size="icon" variant="ghost" onClick={() => setRoles(roles.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Save rules</Button>
        </div>
      </CardContent>
    </Card>
  );
}