import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Briefcase, Plus, Trash2, Save, X, ArrowUp, ArrowDown, Eye, EyeOff, Loader2,
} from 'lucide-react';
import { refreshHiringEnabled } from '@/hooks/useHiringEnabled';

/**
 * Admin control for the public /hiring page.
 *
 * Two independent things live here on purpose:
 *
 *   - The master switch (app_config.hiring_enabled). Off means /hiring is not
 *     public at all — the nav entry disappears and the page redirects to
 *     /volunteer, which carries the same coordinator contact.
 *   - The postings themselves (job_postings). Unpublishing one hides it from
 *     the public page but keeps the text, so next season's listing does not
 *     have to be retyped from scratch.
 *
 * Taking the page down is therefore not "delete all the postings", and that is
 * the whole reason the switch exists separately.
 */

interface Posting {
  id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

/** A row being edited, or the not-yet-saved new one. */
type Draft = { id: string | null; title: string; description: string };

export default function HiringTab() {
  const [postings, setPostings] = useState<Posting[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [postRes, cfgRes] = await Promise.all([
      (supabase as any)
        .from('job_postings')
        .select('id, title, description, is_active, sort_order')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false }),
      supabase.from('app_config').select('value').eq('key', 'hiring_enabled').maybeSingle(),
    ]);
    if (postRes.error) toast.error(postRes.error.message);
    setPostings(postRes.data || []);
    // Absent row reads as ON, matching useHiringEnabled — the two must not
    // disagree about what a missing flag means.
    setEnabled((cfgRes.data?.value as any)?.enabled !== false);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggleHiring(next: boolean) {
    setToggleBusy(true);
    const { error } = await supabase.from('app_config')
      .upsert({ key: 'hiring_enabled', value: { enabled: next }, updated_at: new Date().toISOString() });
    setToggleBusy(false);
    if (error) { toast.error(error.message); return; }
    setEnabled(next);
    // The header is rendered by this same app, and it caches the flag.
    await refreshHiringEnabled();
    toast.success(next
      ? 'Hiring page is live.'
      : 'Hiring page is off — /hiring now redirects to Volunteer.');
  }

  async function saveDraft() {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) { toast.error('A posting needs a title.'); return; }
    const description = draft.description.trim() || null;

    setSaving(true);
    if (draft.id) {
      // .select() is not optional here: a write blocked by RLS comes back as
      // 204 with no error, which supabase-js reports as success.
      const { data, error } = await (supabase as any)
        .from('job_postings')
        .update({ title, description })
        .eq('id', draft.id)
        .select('id');
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      if (!data?.length) { toast.error('Nothing was saved — you may not have permission.'); return; }
      toast.success('Posting updated');
    } else {
      // New postings go to the top of the list rather than the bottom: the
      // reason someone is on this screen is almost always the opening they
      // just typed.
      const sort_order = Math.min(0, ...postings.map(p => p.sort_order)) - 1;
      const { data, error } = await (supabase as any)
        .from('job_postings')
        .insert({ title, description, sort_order })
        .select('id');
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      if (!data?.length) { toast.error('Nothing was saved — you may not have permission.'); return; }
      toast.success('Posting added');
    }
    setDraft(null);
    await load();
  }

  async function togglePosting(p: Posting) {
    const { data, error } = await (supabase as any)
      .from('job_postings')
      .update({ is_active: !p.is_active })
      .eq('id', p.id)
      .select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing changed — you may not have permission.'); return; }
    toast.success(!p.is_active ? 'Published to the Hiring page' : 'Unpublished');
    await load();
  }

  async function remove(p: Posting) {
    if (!confirm(`Delete "${p.title}"? Unpublishing keeps the text; deleting does not.`)) return;
    const { data, error } = await (supabase as any)
      .from('job_postings')
      .delete()
      .eq('id', p.id)
      .select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was deleted — deleting postings is admin-only.'); return; }
    toast.success('Posting deleted');
    await load();
  }

  /**
   * Swap this row's sort_order with its neighbour's.
   *
   * Two writes rather than a renumber of the whole list, because the list is
   * short and a swap cannot leave a gap. Both rows are written before the
   * reload so a failure on the second one is visible rather than half-applied
   * on screen.
   */
  async function move(index: number, delta: number) {
    const a = postings[index];
    const b = postings[index + delta];
    if (!a || !b) return;
    // Equal sort_orders (e.g. two fresh rows both at 0) would make the swap a
    // no-op, so fall back to the positions they are actually displayed in.
    const [orderA, orderB] = a.sort_order === b.sort_order
      ? [index + delta, index]
      : [b.sort_order, a.sort_order];
    const results = await Promise.all([
      (supabase as any).from('job_postings').update({ sort_order: orderA }).eq('id', a.id).select('id'),
      (supabase as any).from('job_postings').update({ sort_order: orderB }).eq('id', b.id).select('id'),
    ]);
    const failed = results.find((r: any) => r.error || !r.data?.length);
    if (failed) { toast.error(failed.error?.message || 'Could not reorder.'); }
    await load();
  }

  return (
    <div className="space-y-4">
      <CollapsibleSection id="pages.hiring.page" title="Hiring page" icon={Briefcase} defaultOpen>
        {enabled !== null && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
            {enabled
              ? <Eye className="h-5 w-5 text-primary mt-0.5" />
              : <EyeOff className="h-5 w-5 text-muted-foreground mt-0.5" />}
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <Switch checked={enabled} onCheckedChange={toggleHiring} disabled={toggleBusy} />
                <span className="font-medium text-sm">
                  {enabled ? "We're hiring — page is LIVE" : 'Hiring page is OFF'}
                </span>
              </div>
              <p className="text-xs font-serif text-muted-foreground mt-1">
                {enabled
                  ? 'The Hiring link appears in the header and mobile menu, and /hiring shows the active postings below.'
                  : 'The Hiring link is hidden and /hiring redirects to the Volunteer page, which keeps Natalia’s contact details in front of anyone who follows an old link.'}
              </p>
            </div>
          </div>
        )}
        <p className="font-serif text-sm text-muted-foreground">
          The volunteer copy and the coordinator’s contact details are part of the page itself and
          are always shown — these postings are the paid openings listed above them.
        </p>
        {!draft && (
          <Button size="sm" onClick={() => setDraft({ id: null, title: '', description: '' })}>
            <Plus className="h-4 w-4 mr-1" /> New posting
          </Button>
        )}
      </CollapsibleSection>

      {draft && (
        <Card className="glass border-primary/40">
          <CardHeader>
            <CardTitle className="font-display text-base">
              {draft.id ? 'Edit posting' : 'New posting'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Job title — e.g. Box Office Attendant"
              value={draft.title}
              onChange={e => setDraft({ ...draft, title: e.target.value })}
            />
            <Textarea
              placeholder="Description, hours, how to apply… Line breaks are preserved on the public page."
              rows={8}
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
            />
            <div className="flex gap-2">
              <Button onClick={saveDraft} disabled={saving}>
                {saving
                  ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2">
        {loading ? (
          <p className="text-center py-8 text-muted-foreground font-serif">Loading…</p>
        ) : postings.length === 0 ? (
          <Card className="glass">
            <CardContent className="p-8 text-center text-muted-foreground font-serif">
              No job postings yet. The Hiring page still shows the volunteer positions and the
              coordinator’s contact details.
            </CardContent>
          </Card>
        ) : postings.map((p, i) => (
          <Card key={p.id} className="glass">
            <CardContent className="p-3 flex items-start gap-3">
              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => move(i, -1)} disabled={i === 0}
                  aria-label="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => move(i, 1)} disabled={i === postings.length - 1}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium flex items-center gap-2">
                  {p.title}
                  {!p.is_active && <Badge variant="outline">Draft</Badge>}
                </p>
                {p.description && (
                  <p className="text-xs text-muted-foreground font-serif mt-1 line-clamp-3 whitespace-pre-line">
                    {p.description}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  size="sm" variant="outline"
                  onClick={() => setDraft({ id: p.id, title: p.title, description: p.description ?? '' })}
                >
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => togglePosting(p)}>
                  {p.is_active ? 'Unpublish' : 'Publish'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
