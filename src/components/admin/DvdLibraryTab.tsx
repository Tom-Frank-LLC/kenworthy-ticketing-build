import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Disc, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInCalendarDays } from 'date-fns';

type Dvd = any;
type Rental = any;
type Settings = any;

export default function DvdLibraryTab() {
  return (
    <Tabs defaultValue="library" className="space-y-4">
      <TabsList>
        <TabsTrigger value="library"><Disc className="h-4 w-4 mr-1" /> Library</TabsTrigger>
        <TabsTrigger value="rentals"><RefreshCw className="h-4 w-4 mr-1" /> Active rentals</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="library"><LibraryPanel /></TabsContent>
      <TabsContent value="rentals"><RentalsPanel /></TabsContent>
      <TabsContent value="settings"><SettingsPanel /></TabsContent>
    </Tabs>
  );
}

function LibraryPanel() {
  const [items, setItems] = useState<Dvd[]>([]);
  const [editing, setEditing] = useState<Dvd | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  async function load() {
    const { data, error } = await (supabase as any).from('dvds').select('*').order('title');
    if (error) toast.error(error.message); else setItems(data || []);
  }
  useEffect(() => { load(); }, []);

  function startNew() { setEditing({ title: '', copies_total: 1, copies_available: 1, rental_price: 3, is_active: true }); setOpen(true); }
  function startEdit(d: Dvd) { setEditing({ ...d }); setOpen(true); }

  async function save() {
    if (!editing?.title) { toast.error('Title required'); return; }
    const payload: any = {
      title: editing.title, year: editing.year || null, director: editing.director || null,
      genre: editing.genre || null, synopsis: editing.synopsis || null, cover_url: editing.cover_url || null,
      copies_total: Number(editing.copies_total) || 0,
      copies_available: Number(editing.copies_available) || 0,
      rental_price: Number(editing.rental_price) || 0,
      is_active: editing.is_active !== false,
      notes: editing.notes || null,
    };
    const res = editing.id
      ? await (supabase as any).from('dvds').update(payload).eq('id', editing.id)
      : await (supabase as any).from('dvds').insert(payload);
    if (res.error) toast.error(res.error.message);
    else { toast.success('Saved'); setOpen(false); setEditing(null); load(); }
  }

  async function remove(id: string) {
    if (!confirm('Remove this DVD from the catalog?')) return;
    const { error } = await (supabase as any).from('dvds').delete().eq('id', id);
    if (error) toast.error(error.message); else { toast.success('Removed'); load(); }
  }

  const filtered = items.filter(d => !q || `${d.title} ${d.director||''} ${d.genre||''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input placeholder="Search title, director, genre…" value={q} onChange={e => setQ(e.target.value)} className="max-w-sm" />
        <Button onClick={startNew} className="ml-auto"><Plus className="h-4 w-4 mr-1" /> Add DVD</Button>
      </div>
      {filtered.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground font-serif">No DVDs in the catalog yet.</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map(d => (
            <Card key={d.id} className="glass">
              <CardContent className="p-3 flex items-center gap-3">
                {d.cover_url
                  ? <img src={d.cover_url} alt={d.title} className="w-12 h-16 object-cover rounded" />
                  : <div className="w-12 h-16 rounded bg-muted flex items-center justify-center"><Disc className="h-5 w-5 text-muted-foreground" /></div>}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{d.title} {d.year && <span className="text-muted-foreground">({d.year})</span>}</p>
                  <p className="text-xs text-muted-foreground font-serif truncate">
                    {[d.director, d.genre].filter(Boolean).join(' • ')}
                  </p>
                </div>
                <Badge variant={d.copies_available > 0 ? 'default' : 'outline'} className="text-xs">
                  {d.copies_available}/{d.copies_total} avail
                </Badge>
                <Badge variant="outline" className="text-xs">${Number(d.rental_price).toFixed(2)}</Badge>
                {!d.is_active && <Badge variant="outline" className="text-xs">hidden</Badge>}
                <Button size="sm" variant="outline" onClick={() => startEdit(d)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(d.id)}><Trash2 className="h-4 w-4" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display uppercase">{editing?.id ? 'Edit DVD' : 'Add DVD'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title" className="col-span-2"><Input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} /></Field>
              <Field label="Year"><Input type="number" value={editing.year || ''} onChange={e => setEditing({ ...editing, year: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Director"><Input value={editing.director || ''} onChange={e => setEditing({ ...editing, director: e.target.value })} /></Field>
              <Field label="Genre" className="col-span-2"><Input value={editing.genre || ''} onChange={e => setEditing({ ...editing, genre: e.target.value })} /></Field>
              <Field label="Cover image URL" className="col-span-2"><Input value={editing.cover_url || ''} onChange={e => setEditing({ ...editing, cover_url: e.target.value })} placeholder="https://…" /></Field>
              <Field label="Synopsis" className="col-span-2"><Textarea rows={3} value={editing.synopsis || ''} onChange={e => setEditing({ ...editing, synopsis: e.target.value })} /></Field>
              <Field label="Copies total"><Input type="number" min={0} value={editing.copies_total ?? 0} onChange={e => setEditing({ ...editing, copies_total: Number(e.target.value) })} /></Field>
              <Field label="Copies available"><Input type="number" min={0} value={editing.copies_available ?? 0} onChange={e => setEditing({ ...editing, copies_available: Number(e.target.value) })} /></Field>
              <Field label="Rental price ($)"><Input type="number" min={0} step="0.01" value={editing.rental_price ?? 0} onChange={e => setEditing({ ...editing, rental_price: Number(e.target.value) })} /></Field>
              <Field label="Visible to members">
                <Select value={editing.is_active === false ? 'no' : 'yes'} onValueChange={v => setEditing({ ...editing, is_active: v === 'yes' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Staff notes" className="col-span-2"><Textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RentalsPanel() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filter, setFilter] = useState<string>('active');

  async function load() {
    const [{ data: r }, { data: s }] = await Promise.all([
      (supabase as any).from('dvd_rentals').select('*, dvds(title, cover_url, rental_price), profiles(display_name, email)').order('reserved_at', { ascending: false }),
      (supabase as any).from('dvd_settings').select('*').limit(1).maybeSingle(),
    ]);
    setRentals(r || []);
    setSettings(s);
  }
  useEffect(() => { load(); }, []);

  const filtered = rentals.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'active') return ['reserved', 'checked_out', 'overdue'].includes(r.status);
    return r.status === filter;
  });

  async function update(id: string, patch: any) {
    const { error } = await (supabase as any).from('dvd_rentals').update(patch).eq('id', id);
    if (error) toast.error(error.message); else { toast.success('Updated'); load(); }
  }

  function lateDays(r: Rental) {
    if (!r.due_at) return 0;
    const days = differenceInCalendarDays(new Date(), new Date(r.due_at));
    return Math.max(0, days);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="reserved">Reserved</SelectItem>
            <SelectItem value="checked_out">Checked out</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="returned">Returned</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground font-serif">No rentals match this filter.</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map(r => {
            const overdue = r.due_at && new Date(r.due_at) < new Date() && ['checked_out','reserved','overdue'].includes(r.status);
            const ld = lateDays(r);
            return (
              <Card key={r.id} className="glass">
                <CardContent className="p-3 grid gap-2 md:grid-cols-[1fr_auto] items-center">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.dvds?.title || '—'}</p>
                    <p className="text-xs text-muted-foreground font-serif truncate">
                      {r.profiles?.display_name || r.profiles?.email || 'member'} • {r.status}
                      {r.due_at && <> • due {format(new Date(r.due_at), 'MMM d')}</>}
                      {overdue && <> • <span className="text-destructive">overdue {ld}d</span></>}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {r.status === 'reserved' && (
                      <Button size="sm" onClick={() => update(r.id, { status: 'checked_out', payment_method: r.payment_method || 'cash' })}>
                        Check out
                      </Button>
                    )}
                    {['checked_out','overdue'].includes(r.status) && (
                      <Button size="sm" onClick={() => {
                        const fee = settings ? Math.round(ld * Number(settings.late_fee_per_day) * 100) / 100 : 0;
                        update(r.id, { status: 'returned', late_fee: fee });
                      }}>
                        Return{ld > 0 && settings ? ` (+$${(ld * Number(settings.late_fee_per_day)).toFixed(2)} late)` : ''}
                      </Button>
                    )}
                    {overdue && r.status === 'checked_out' && (
                      <Button size="sm" variant="outline" onClick={() => update(r.id, { status: 'overdue' })}>Mark overdue</Button>
                    )}
                    {['reserved','checked_out','overdue'].includes(r.status) && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => update(r.id, { status: 'cancelled' })}>Cancel</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);

  async function load() {
    const { data } = await (supabase as any).from('dvd_settings').select('*').limit(1).maybeSingle();
    setS(data);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!s) return;
    const { error } = await (supabase as any).from('dvd_settings').update({
      loan_days: Number(s.loan_days),
      max_active_per_user: Number(s.max_active_per_user),
      late_fee_per_day: Number(s.late_fee_per_day),
      default_rental_price: Number(s.default_rental_price),
      reservation_hold_hours: Number(s.reservation_hold_hours),
    }).eq('id', s.id);
    if (error) toast.error(error.message); else toast.success('Saved');
  }

  if (!s) return <p className="text-muted-foreground font-serif">Loading…</p>;
  return (
    <Card className="glass max-w-lg">
      <CardContent className="p-4 grid grid-cols-2 gap-3">
        <Field label="Loan length (days)"><Input type="number" min={1} value={s.loan_days} onChange={e => setS({ ...s, loan_days: e.target.value })} /></Field>
        <Field label="Max active rentals / member"><Input type="number" min={1} value={s.max_active_per_user} onChange={e => setS({ ...s, max_active_per_user: e.target.value })} /></Field>
        <Field label="Late fee per day ($)"><Input type="number" min={0} step="0.01" value={s.late_fee_per_day} onChange={e => setS({ ...s, late_fee_per_day: e.target.value })} /></Field>
        <Field label="Default rental price ($)"><Input type="number" min={0} step="0.01" value={s.default_rental_price} onChange={e => setS({ ...s, default_rental_price: e.target.value })} /></Field>
        <Field label="Reservation hold (hours)"><Input type="number" min={1} value={s.reservation_hold_hours} onChange={e => setS({ ...s, reservation_hold_hours: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end"><Button onClick={save}>Save settings</Button></div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className || ''}`}>
      <Label className="text-xs font-display uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}