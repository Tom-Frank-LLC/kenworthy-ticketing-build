import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  Users, Plus, Trash2, Save, X, ArrowUp, ArrowDown, Loader2,
} from 'lucide-react';
import { PosterUpload } from '@/components/admin/PosterUpload';
import { byStaffOrder, STAFF_BIO_COLUMNS, type StaffBio } from '@/lib/staffBios';
import { htmlToPlainText } from '@/lib/richText';

/**
 * Admin control for the "Kenworthy Staff" section of the public About page.
 *
 * The whole screen turns on one distinction that is easy to lose: a bio
 * existing here and a bio appearing on /about are two separate acts. Adding
 * someone writes a row that nobody outside this tab can read; ticking
 * "Display on About Us" is what publishes it. That is why the checkbox sits in
 * the list rather than inside the editor — it is the thing staff come back to
 * change, and it should not require opening a form to find.
 *
 * `is_active` is the other flag, and it means something different: still on
 * staff. Someone who leaves gets un-ticked, not deleted, so their headshot and
 * the paragraph someone took the trouble to write survive the decision.
 */

/** A row being edited, or the not-yet-saved new one. */
type Draft = {
  id: string | null;
  name: string;
  title: string;
  bio: string;
  headshot_url: string;
};

const EMPTY_DRAFT: Draft = { id: null, name: '', title: '', bio: '', headshot_url: '' };

export default function StaffBios() {
  const [bios, setBios] = useState<StaffBio[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);

  async function load() {
    setLoading(true);
    // Ordered the way /about orders it, so this list reads as a preview of the
    // page rather than a second arrangement staff have to translate. The name
    // tie-break matters: every row starts at sort_order 0.
    const { data, error } = await (supabase as any)
      .from('staff_bios')
      .select(STAFF_BIO_COLUMNS)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) toast.error(error.message);
    setBios(data || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  // The one ordering both the list and the reorder buttons work from. The
  // query already asks for this order, but re-sorting locally keeps the
  // optimistic reorder below honest without a second round-trip.
  const ordered = [...bios].sort(byStaffOrder);
  const publishedCount = bios.filter(b => b.display_on_about && b.is_active).length;

  async function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('A bio needs a name.'); return; }

    const row = {
      name,
      title: draft.title.trim() || null,
      bio: draft.bio.trim() || null,
      headshot_url: draft.headshot_url.trim() || null,
    };

    setSaving(true);
    // .select() on every write: an RLS refusal comes back as a 204 with no
    // error, which otherwise reads as success and leaves a toast lying.
    const query = draft.id
      ? (supabase as any).from('staff_bios').update(row).eq('id', draft.id).select('id')
      : (supabase as any)
          .from('staff_bios')
          // New bios land at the end of the list, not the top — adding someone
          // should not reshuffle an order somebody set deliberately.
          .insert({ ...row, sort_order: Math.max(0, ...bios.map(b => b.sort_order)) + 1 })
          .select('id');
    const { data, error } = await query;
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was saved — you may not have permission.'); return; }
    toast.success(draft.id ? 'Bio updated' : 'Bio added — tick “Display on About Us” to publish it');
    setDraft(null);
    await load();
  }

  async function toggleDisplay(b: StaffBio) {
    const { data, error } = await (supabase as any)
      .from('staff_bios')
      .update({ display_on_about: !b.display_on_about })
      .eq('id', b.id)
      .select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing changed — you may not have permission.'); return; }
    toast.success(
      !b.display_on_about
        ? `${b.name} now appears on the About page`
        : `${b.name} removed from the About page`,
    );
    await load();
  }

  async function toggleActive(b: StaffBio) {
    const { data, error } = await (supabase as any)
      .from('staff_bios')
      .update({ is_active: !b.is_active })
      .eq('id', b.id)
      .select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing changed — you may not have permission.'); return; }
    toast.success(
      !b.is_active
        ? `${b.name} marked as current staff`
        : `${b.name} marked as former staff — hidden from About, bio kept`,
    );
    await load();
  }

  async function remove(b: StaffBio) {
    if (!confirm(
      `Delete ${b.name}'s bio? Marking them former staff hides them and keeps the bio; deleting does not.`,
    )) return;
    const { data, error } = await (supabase as any)
      .from('staff_bios').delete().eq('id', b.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was deleted — deleting bios is admin-only.'); return; }
    toast.success('Bio deleted');
    await load();
  }

  /**
   * Move a bio one place up or down the list.
   *
   * This renumbers rather than swapping the two rows' sort_order values.
   * Swapping is fewer writes, but it is a no-op whenever the two rows tie —
   * and since sort_order defaults to 0, a fresh list is *entirely* ties, so
   * the first several clicks would appear to do nothing. Renumbering the
   * displayed order gives every row a distinct position on the first move.
   * Only the rows whose number actually changes are written.
   */
  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;

    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];

    const writes = next
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => b.sort_order !== i);
    if (!writes.length) return;

    setReordering(true);
    // Optimistic: the list jumps immediately, then load() confirms it. Without
    // this the row visibly sits still until the round-trip finishes, and the
    // natural response is to click again.
    setBios(next.map((b, i) => ({ ...b, sort_order: i })));
    const results = await Promise.all(
      writes.map(({ b, i }) =>
        (supabase as any).from('staff_bios').update({ sort_order: i }).eq('id', b.id).select('id'),
      ),
    );
    setReordering(false);
    const failed = results.find((r: any) => r.error || !r.data?.length);
    if (failed) toast.error(failed.error?.message || 'Could not reorder — you may not have permission.');
    await load();
  }

  return (
    <div className="space-y-4">
      <CollapsibleSection id="pages.bios.page" title="Staff bios" icon={Users} defaultOpen>
        <p className="font-serif text-sm text-muted-foreground">
          These are the cards in the <span className="font-medium">Kenworthy Staff</span> section
          of the public <span className="font-medium">/about</span> page, directly under the Board
          of Directors. A bio only appears there once you tick{' '}
          <span className="font-medium">Display on About Us</span> — adding someone here doesn’t
          publish them.
        </p>
        <p className="font-serif text-sm text-muted-foreground">
          When someone leaves, use <span className="font-medium">Former staff</span> rather than
          Delete: it takes them off the page and keeps the headshot and the write-up in case they
          come back or you want the copy again.
        </p>
        <p className="font-serif text-xs text-muted-foreground">
          Headshots go in the same public image store as posters, so an uploaded photo is
          reachable by anyone who has its link even before you publish the bio. Upload photos you
          are happy to have public.
        </p>
        <p className="font-serif text-sm text-muted-foreground">
          {publishedCount === 0
            ? 'Nobody is on the About page yet — the section stays hidden until someone is.'
            : `${publishedCount} ${publishedCount === 1 ? 'person is' : 'people are'} showing on the About page.`}
        </p>
        {!draft && (
          <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Plus className="h-4 w-4 mr-1" /> Add a staff member
          </Button>
        )}
      </CollapsibleSection>

      {draft && (
        <Card className="glass border-primary/40">
          <CardHeader>
            <CardTitle className="font-display text-base">
              {draft.id ? `Edit ${draft.name || 'bio'}` : 'New staff bio'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder="As it should read on the page"
                  value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Title (optional)</Label>
                <Input
                  placeholder="Executive Director"
                  value={draft.title}
                  onChange={e => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="staff-bio">Bio (optional)</Label>
              <RichTextEditor
                id="staff-bio"
                rows={5}
                placeholder="A paragraph or two, in their own voice if you have it."
                value={draft.bio}
                onChange={bio => setDraft({ ...draft, bio })}
              />
            </div>
            <PosterUpload
              currentUrl={draft.headshot_url}
              onUrlChange={url => setDraft(d => (d ? { ...d, headshot_url: url } : d))}
              folder="staff"
              label="Headshot (optional)"
              previewClassName="w-32 aspect-square"
              alt="Headshot preview"
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
        ) : bios.length === 0 ? (
          <Card className="glass">
            <CardContent className="p-8 text-center text-muted-foreground font-serif">
              No staff bios yet. The About page shows the Board of Directors and goes straight on to
              the history until you add one.
            </CardContent>
          </Card>
        ) : ordered.map((b, index) => (
          <Card key={b.id} className={b.display_on_about && b.is_active ? 'glass border-primary/40' : 'glass'}>
            <CardContent className="p-3 flex items-start gap-3">
              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || reordering}
                  aria-label={`Move ${b.name} earlier`}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => move(index, 1)}
                  disabled={index === ordered.length - 1 || reordering}
                  aria-label={`Move ${b.name} later`}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>

              {b.headshot_url ? (
                <img
                  src={b.headshot_url}
                  alt=""
                  className="hidden sm:block w-16 h-16 object-cover rounded-full shrink-0"
                />
              ) : (
                <div className="hidden sm:flex w-16 h-16 rounded-full bg-secondary shrink-0 items-center justify-center text-muted-foreground text-xs">
                  No photo
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium flex items-center gap-2 flex-wrap">
                  {b.name}
                  {!b.is_active && <Badge variant="outline">Former staff</Badge>}
                </p>
                {b.title && <p className="text-xs text-muted-foreground mt-1">{b.title}</p>}
                {b.bio && (
                  <p className="text-xs text-muted-foreground font-serif mt-1 line-clamp-2">
                    {htmlToPlainText(b.bio)}
                  </p>
                )}
                <label className="flex items-center gap-2 mt-2 cursor-pointer w-fit">
                  <Checkbox
                    checked={b.display_on_about}
                    onCheckedChange={() => toggleDisplay(b)}
                    aria-label={`Display ${b.name} on the About page`}
                  />
                  <span className="text-xs">
                    Display on About Us
                    {/* Ticked but inactive is a real state and a confusing one —
                        say why the card is not on the page rather than leaving
                        the tick looking broken. */}
                    {b.display_on_about && !b.is_active && (
                      <span className="text-muted-foreground">
                        {' '}— hidden while marked former staff
                      </span>
                    )}
                  </span>
                </label>
              </div>

              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  size="sm" variant="outline"
                  onClick={() => setDraft({
                    id: b.id,
                    name: b.name,
                    title: b.title ?? '',
                    bio: b.bio ?? '',
                    headshot_url: b.headshot_url ?? '',
                  })}
                >
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggleActive(b)}>
                  {b.is_active ? 'Former staff' : 'Current staff'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(b)}>
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
