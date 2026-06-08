import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Archive, Loader2, Wand2, Trash2, Plus, History } from 'lucide-react';
import { parseHistoricalWorkbook } from '@/lib/parseHistoricalXlsx';

const CHUNK = 500;

const HISTORY_CATEGORIES = [
  'renovation', 'ownership', 'milestone', 'closure', 'reopening', 'community', 'programming',
] as const;
type HistoryCategory = typeof HISTORY_CATEGORIES[number];

type Counts = { historical: number; milestones: number };

async function insertChunked(table: 'historical_screenings', rows: any[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await (supabase.from(table) as any).insert(slice);
    if (error) throw new Error(`${table} chunk ${i}: ${error.message}`);
  }
}

export default function ArchiveTab() {
  const [counts, setCounts] = useState<Counts>({ historical: 0, milestones: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [history, setHistory] = useState<any[]>([]);
  const [draft, setDraft] = useState({
    year: new Date().getFullYear(),
    event_date: '',
    category: 'milestone' as HistoryCategory,
    title: '',
    description: '',
    image_url: '',
    source_url: '',
  });
  const histFileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const [h, m, list] = await Promise.all([
      supabase.from('historical_screenings').select('*', { count: 'exact', head: true }),
      supabase.from('kenworthy_history').select('*', { count: 'exact', head: true }),
      supabase.from('kenworthy_history').select('*').order('year', { ascending: true }).order('event_date', { ascending: true, nullsFirst: true }),
    ]);
    setCounts({
      historical: h.count ?? 0,
      milestones: m.count ?? 0,
    });
    setHistory(list.data ?? []);
  }

  useEffect(() => { refresh(); }, []);

  async function handleHistoricalFile(file: File) {
    setBusy('historical');
    setProgress('Reading workbook…');
    try {
      const buf = await file.arrayBuffer();
      setProgress('Parsing 101 years of sheets…');
      const rows = parseHistoricalWorkbook(buf);
      setProgress(`Parsed ${rows.length.toLocaleString()} screenings. Uploading…`);
      let done = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error } = await (supabase.from('historical_screenings') as any).insert(slice);
        if (error) throw error;
        done += slice.length;
        setProgress(`Uploaded ${done.toLocaleString()} of ${rows.length.toLocaleString()}…`);
      }
      toast.success(`Imported ${rows.length.toLocaleString()} historical screenings.`);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Import failed');
    } finally {
      setBusy(null);
      setProgress('');
      if (histFileRef.current) histFileRef.current.value = '';
    }
  }

  async function runMatch() {
    setBusy('match');
    try {
      const { data, error } = await supabase.functions.invoke('match-historical-screenings');
      if (error) throw error;
      toast.success(`Matched ${data.matched} of ${data.processed} screenings to current movies.`);
    } catch (e: any) {
      toast.error(e.message ?? 'Match failed');
    } finally {
      setBusy(null);
    }
  }

  async function clearTable(table: 'historical_screenings') {
    if (!confirm(`Delete ALL rows from ${table}? This cannot be undone.`)) return;
    setBusy(`clear-${table}`);
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) toast.error(error.message);
    else { toast.success('Cleared'); refresh(); }
    setBusy(null);
  }

  async function addMilestone() {
    if (!draft.title || !draft.year) {
      toast.error('Title and year are required');
      return;
    }
    const { error } = await supabase.from('kenworthy_history').insert({
      year: Number(draft.year),
      event_date: draft.event_date || null,
      category: draft.category,
      title: draft.title,
      description: draft.description || null,
      image_url: draft.image_url || null,
      source_url: draft.source_url || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Milestone added');
    setDraft({ ...draft, title: '', description: '', image_url: '', source_url: '', event_date: '' });
    refresh();
  }

  async function deleteMilestone(id: string) {
    if (!confirm('Delete this milestone?')) return;
    const { error } = await supabase.from('kenworthy_history').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Deleted'); refresh(); }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="glass">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Historical screenings</p>
            <p className="text-2xl font-display font-bold">{counts.historical.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Timeline milestones</p>
            <p className="text-2xl font-display font-bold">{counts.milestones.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {busy && (
        <Card className="glass border-primary/40">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm">{progress || 'Working…'}</span>
          </CardContent>
        </Card>
      )}

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><Archive className="h-5 w-5" /> 100-Year Film Archive</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload the master xlsx (one sheet per year, columns per theater). Each cell becomes a screening row;
            double features split on “/”. Run matching after upload to auto-link to current movies.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input ref={histFileRef} type="file" accept=".xlsx" className="max-w-sm"
              disabled={!!busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleHistoricalFile(f); }} />
            <Button onClick={runMatch} disabled={!!busy} variant="outline">
              <Wand2 className="h-4 w-4 mr-1" /> Match to current movies
            </Button>
            <Button onClick={() => clearTable('historical_screenings')} disabled={!!busy} variant="ghost">
              <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Clear archive
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><History className="h-5 w-5" /> Building &amp; Milestone Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Year *</Label>
              <Input type="number" value={draft.year}
                onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Specific date (optional)</Label>
              <Input type="date" value={draft.event_date}
                onChange={(e) => setDraft({ ...draft, event_date: e.target.value })} />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v as HistoryCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HISTORY_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title *</Label>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} />
            </div>
            <div>
              <Label>Image URL</Label>
              <Input value={draft.image_url} onChange={(e) => setDraft({ ...draft, image_url: e.target.value })} />
            </div>
            <div>
              <Label>Source URL</Label>
              <Input value={draft.source_url} onChange={(e) => setDraft({ ...draft, source_url: e.target.value })} />
            </div>
          </div>
          <Button onClick={addMilestone}><Plus className="h-4 w-4 mr-1" /> Add milestone</Button>

          <div className="space-y-2 pt-4">
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between rounded-md bg-secondary/40 px-3 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant="outline" className="font-display">{h.year}</Badge>
                  <Badge variant="secondary" className="text-xs">{h.category}</Badge>
                  <span className="truncate">{h.title}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteMilestone(h.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {!history.length && <p className="text-sm text-muted-foreground">No milestones yet.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}