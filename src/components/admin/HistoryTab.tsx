import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { History, Plus, Pencil, Trash2, Save, X, Loader2, ExternalLink } from 'lucide-react';
import { PosterUpload } from '@/components/admin/PosterUpload';
import { safeHttpUrl } from '@/lib/press';

/**
 * Admin control for the /history timeline.
 *
 * Every milestone on that page is a row of `kenworthy_history`. They were not
 * always: until 2026-11-13 the 26 the page showed were hardcoded in
 * History.tsx and the table was empty, so this editor (then a card in the
 * superadmin Archive tab) could add a milestone but could change none of the
 * ones anyone could see. 20261113214659 moved them into the table.
 *
 * The CHECK on `category` allows exactly these.
 */
const CATEGORIES = [
  'milestone', 'renovation', 'programming', 'community', 'ownership', 'closure', 'reopening',
] as const;
type Category = (typeof CATEGORIES)[number];

type Milestone = {
  id: string;
  year: number;
  event_date: string | null;
  category: Category;
  title: string;
  description: string | null;
  image_url: string | null;
  source_url: string | null;
  display_order: number;
};

type Draft = {
  id: string | null;
  year: string;
  event_date: string;
  category: Category;
  title: string;
  description: string;
  image_url: string;
  source_url: string;
};

const EMPTY: Draft = {
  id: null,
  year: String(new Date().getFullYear()),
  event_date: '',
  category: 'milestone',
  title: '',
  description: '',
  image_url: '',
  source_url: '',
};

function toDraft(m: Milestone): Draft {
  return {
    id: m.id,
    year: String(m.year),
    event_date: m.event_date ?? '',
    category: m.category,
    title: m.title,
    description: m.description ?? '',
    image_url: m.image_url ?? '',
    source_url: m.source_url ?? '',
  };
}

export default function HistoryTab() {
  const [rows, setRows] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('kenworthy_history')
      .select('id, year, event_date, category, title, description, image_url, source_url, display_order')
      // The order the public timeline uses, so this list previews it.
      .order('year', { ascending: false })
      .order('display_order', { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as Milestone[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    if (!draft) return;
    const year = Number(draft.year);
    const title = draft.title.trim();
    if (!Number.isInteger(year) || year < 1800 || year > 2200) {
      toast.error('Enter the year as four digits.');
      return;
    }
    if (!title) { toast.error('The milestone needs a title.'); return; }
    let source_url: string | null = null;
    if (draft.source_url.trim()) {
      source_url = safeHttpUrl(draft.source_url);
      if (!source_url) { toast.error('That source link is not a valid web address.'); return; }
    }

    const row = {
      year,
      event_date: draft.event_date || null,
      category: draft.category,
      title,
      description: draft.description.trim() || null,
      image_url: draft.image_url.trim() || null,
      source_url,
    };

    setSaving(true);
    // .select(): a write RLS refuses comes back 204 with no error.
    const { data, error } = draft.id
      ? await supabase.from('kenworthy_history').update(row).eq('id', draft.id).select('id')
      : await supabase.from('kenworthy_history').insert(row).select('id');
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was saved — editing the timeline is admin-only.'); return; }
    toast.success(draft.id ? 'Milestone updated' : 'Milestone added');
    setDraft(null);
    await load();
  }

  async function remove(m: Milestone) {
    if (!window.confirm(`Delete "${m.title}" (${m.year}) from the timeline?`)) return;
    const { data, error } = await supabase.from('kenworthy_history').delete().eq('id', m.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was deleted — editing the timeline is admin-only.'); return; }
    toast.success('Milestone deleted');
    if (draft?.id === m.id) setDraft(null);
    await load();
  }

  const form = draft && (
    <Card className="glass border-primary/40">
      <CardHeader>
        <CardTitle className="font-display text-lg">
          {draft.id ? 'Edit milestone' : 'New milestone'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="ms-year">Year</Label>
            <Input id="ms-year" inputMode="numeric" value={draft.year}
              onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ms-date">Exact date (optional)</Label>
            <Input id="ms-date" type="date" value={draft.event_date}
              onChange={(e) => setDraft({ ...draft, event_date: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ms-category">Category</Label>
            <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v as Category })}>
              <SelectTrigger id="ms-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="ms-title">Title</Label>
          <Input id="ms-title" value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="ms-description">Story</Label>
          <Textarea id="ms-description" rows={4} value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </div>
        <PosterUpload
          currentUrl={draft.image_url}
          onUrlChange={(url) => setDraft((d) => (d ? { ...d, image_url: url } : d))}
          folder="history"
          label="Photo"
          previewClassName="w-full max-w-md aspect-[16/9]"
          alt="Milestone photo preview"
        />
        <p className="text-sm text-muted-foreground">
          Use real archival photos only — the timeline is a historical record.
        </p>
        <div>
          <Label htmlFor="ms-source">Source link (optional)</Label>
          <Input id="ms-source" placeholder="https://…" value={draft.source_url}
            onChange={(e) => setDraft({ ...draft, source_url: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save
          </Button>
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="font-display flex items-center gap-2">
            <History className="h-5 w-5" /> History timeline
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/history" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" /> View page
              </a>
            </Button>
            <Button size="sm" onClick={() => setDraft({ ...EMPTY })} disabled={!!draft && !draft.id}>
              <Plus className="h-4 w-4 mr-1" /> Add milestone
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Every milestone on the public History page, newest first — the order the page shows them in.
          </p>
          {draft && !draft.id && form}
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && !rows.length && <p className="text-sm text-muted-foreground">No milestones yet.</p>}
          {rows.map((m) => (
            <div key={m.id} className="space-y-2">
              <div className="flex items-center gap-3 rounded-md bg-secondary/40 px-3 py-2">
                <div className="w-20 aspect-[16/9] shrink-0 overflow-hidden rounded bg-secondary">
                  {m.image_url && <img src={m.image_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <Badge variant="outline" className="font-display">{m.year}</Badge>
                <Badge variant="secondary" className="hidden sm:inline-flex capitalize">{m.category}</Badge>
                <span className="truncate flex-1 min-w-0">{m.title}</span>
                <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(m))} aria-label={`Edit ${m.title}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(m)} aria-label={`Delete ${m.title}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {draft?.id === m.id && form}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
