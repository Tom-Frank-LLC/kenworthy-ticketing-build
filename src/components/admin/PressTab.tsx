import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { toast } from 'sonner';
import {
  Newspaper, Plus, Trash2, Save, X, Star, ArrowUp, ArrowDown, Loader2, ExternalLink,
} from 'lucide-react';
import { PosterUpload } from '@/components/admin/PosterUpload';
import { MAX_FEATURED, safeHttpUrl, type PressArticle } from '@/lib/press';
import { formatPlainDate } from '@/lib/datetime';

/**
 * Admin control for the public /press page.
 *
 * What this screen collects is *link metadata*, not coverage. The Kenworthy
 * does not own the articles it is written about, so there is no field here for
 * the article's text and there must not be one: a card carries a headline, the
 * outlet, a date, a blurb staff write themselves, and a thumbnail, and then it
 * sends the reader to the outlet to read it.
 *
 * Two independent things live here, for the same reason they are two tables:
 *
 *   - The page's own banner photo and intro paragraph, which belong to the
 *     page and survive every article being deleted.
 *   - The articles themselves, of which up to two can be pinned to the top.
 */

interface PageContent {
  photo_url: string;
  intro_text: string;
}

/** A row being edited, or the not-yet-saved new one. */
type Draft = {
  id: string | null;
  title: string;
  outlet: string;
  url: string;
  published_date: string;
  excerpt: string;
  image_url: string;
};

const EMPTY_DRAFT: Draft = {
  id: null, title: '', outlet: '', url: '', published_date: '', excerpt: '', image_url: '',
};

export default function PressTab() {
  const [articles, setArticles] = useState<PressArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<PageContent>({ photo_url: '', intro_text: '' });
  const [pageSaving, setPageSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [artRes, pageRes] = await Promise.all([
      (supabase as any)
        .from('press_articles')
        .select('id, title, outlet, url, published_date, excerpt, image_url, is_featured, feature_order, is_active')
        // Same order the public page renders in, so this list is a preview of
        // it rather than a second arrangement staff have to translate.
        .order('is_featured', { ascending: false })
        .order('feature_order', { ascending: true })
        .order('published_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('press_page_content')
        .select('photo_url, intro_text')
        .maybeSingle(),
    ]);
    if (artRes.error) toast.error(artRes.error.message);
    setArticles(artRes.data || []);
    if (pageRes.error) toast.error(pageRes.error.message);
    setPage({
      photo_url: pageRes.data?.photo_url ?? '',
      intro_text: pageRes.data?.intro_text ?? '',
    });
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const featuredCount = articles.filter(a => a.is_featured).length;

  async function savePageContent() {
    setPageSaving(true);
    // The row is seeded by the migration and there is no INSERT policy, so
    // this is an UPDATE rather than an upsert. .select() because a write RLS
    // refuses comes back as 204 with no error, which reads as success.
    const { data, error } = await (supabase as any)
      .from('press_page_content')
      .update({
        photo_url: page.photo_url.trim() || null,
        intro_text: page.intro_text.trim() || null,
      })
      .eq('id', true)
      .select('id');
    setPageSaving(false);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was saved — editing the page text is admin-only.'); return; }
    toast.success('Press page updated');
  }

  async function saveDraft() {
    if (!draft) return;
    const title = draft.title.trim();
    const outlet = draft.outlet.trim();
    if (!title) { toast.error('The article needs a headline.'); return; }
    if (!outlet) { toast.error('Name the outlet that published it.'); return; }

    // Normalised, not just validated: a bare "moscow-pullman.com/story" is
    // saved as https://…, and anything that is not http(s) is refused before
    // it can become an href on a public page.
    const url = safeHttpUrl(draft.url);
    if (!url) { toast.error('That link is not a valid web address.'); return; }

    const row = {
      title,
      outlet,
      url,
      published_date: draft.published_date || null,
      excerpt: draft.excerpt.trim() || null,
      image_url: draft.image_url.trim() || null,
    };

    setSaving(true);
    const query = draft.id
      ? (supabase as any).from('press_articles').update(row).eq('id', draft.id).select('id')
      : (supabase as any).from('press_articles').insert(row).select('id');
    const { data, error } = await query;
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was saved — you may not have permission.'); return; }
    toast.success(draft.id ? 'Article updated' : 'Article added');
    setDraft(null);
    await load();
  }

  /**
   * Pin or unpin an article.
   *
   * The third one is refused rather than silently bumping whichever article
   * happens to be oldest. Un-featuring is one click, and a page that quietly
   * drops the piece someone pinned last week is worse than a page that says
   * no.
   */
  async function toggleFeatured(a: PressArticle) {
    if (!a.is_featured && featuredCount >= MAX_FEATURED) {
      toast.error(
        `You can feature ${MAX_FEATURED} articles at a time — un-feature one to make room.`,
      );
      return;
    }
    const patch = a.is_featured
      ? { is_featured: false, feature_order: 0 }
      : {
          is_featured: true,
          // Newly pinned goes second, so featuring does not reshuffle the one
          // already at the top.
          feature_order:
            Math.max(0, ...articles.filter(x => x.is_featured).map(x => x.feature_order)) + 1,
        };
    const { data, error } = await (supabase as any)
      .from('press_articles').update(patch).eq('id', a.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing changed — you may not have permission.'); return; }
    toast.success(a.is_featured ? 'Un-featured' : 'Featured at the top of the Press page');
    await load();
  }

  async function togglePublished(a: PressArticle) {
    const { data, error } = await (supabase as any)
      .from('press_articles').update({ is_active: !a.is_active }).eq('id', a.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing changed — you may not have permission.'); return; }
    toast.success(!a.is_active ? 'Published to the Press page' : 'Unpublished');
    await load();
  }

  async function remove(a: PressArticle) {
    if (!confirm(`Delete "${a.title}"? Unpublishing keeps the link; deleting does not.`)) return;
    const { data, error } = await (supabase as any)
      .from('press_articles').delete().eq('id', a.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was deleted — deleting articles is admin-only.'); return; }
    toast.success('Article deleted');
    await load();
  }

  /**
   * Swap the two featured articles' positions.
   *
   * Same shape as the Hiring tab's reorder: two writes rather than a renumber,
   * with a fallback for the case where both rows carry the same
   * feature_order and a straight swap would be a no-op.
   */
  async function swapFeatured(index: number, delta: number) {
    const featured = articles.filter(f => f.is_featured);
    const a = featured[index];
    const b = featured[index + delta];
    if (!a || !b) return;
    const [orderA, orderB] = a.feature_order === b.feature_order
      ? [index + delta + 1, index + 1]
      : [b.feature_order, a.feature_order];
    const results = await Promise.all([
      (supabase as any).from('press_articles').update({ feature_order: orderA }).eq('id', a.id).select('id'),
      (supabase as any).from('press_articles').update({ feature_order: orderB }).eq('id', b.id).select('id'),
    ]);
    const failed = results.find((r: any) => r.error || !r.data?.length);
    if (failed) toast.error(failed.error?.message || 'Could not reorder.');
    await load();
  }

  const featured = articles.filter(a => a.is_featured);

  return (
    <div className="space-y-4">
      {/* The page's own photo and intro copy */}
      <CollapsibleSection id="pages.press.page" title="Press page" icon={Newspaper}>
        <p className="font-serif text-sm text-muted-foreground">
          The photo and paragraph below sit at the top of <span className="font-medium">/press</span>,
          above the coverage. Both are optional — leave them empty and the page starts straight in
          on the articles.
        </p>
        <PosterUpload
          currentUrl={page.photo_url}
          onUrlChange={url => setPage(p => ({ ...p, photo_url: url }))}
          folder="press"
          label="Banner photo"
          previewClassName="w-full max-w-md aspect-[16/9]"
          alt="Press page banner preview"
        />
        <div className="space-y-1">
          <Label htmlFor="press-intro">Intro text</Label>
          <RichTextEditor
            id="press-intro"
            rows={5}
            placeholder="A short introduction — who to contact for press enquiries, what Kenworthy is, anything you want a journalist to read first."
            value={page.intro_text}
            onChange={intro_text => setPage(p => ({ ...p, intro_text }))}
          />
        </div>
        <Button onClick={savePageContent} disabled={pageSaving}>
          {pageSaving
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            : <Save className="h-4 w-4 mr-1" />}
          Save page photo &amp; text
        </Button>
      </CollapsibleSection>

      {/* Articles */}
      <CollapsibleSection id="pages.press.coverage" title="Coverage" count={articles.length} defaultOpen>
        <p className="font-serif text-sm text-muted-foreground">
          Each entry is a <span className="font-medium">link</span> to an article on the outlet’s
          own site — a headline, the outlet, a date, and an optional line of your own summarising
          it. Don’t paste the article itself; it isn’t ours to republish.
        </p>
        <p className="font-serif text-sm text-muted-foreground">
          Up to {MAX_FEATURED} articles can be featured, which pins them to the top of the page as
          larger cards. Everything else is listed newest first.
          {featuredCount > 0 && ` ${featuredCount} of ${MAX_FEATURED} featured right now.`}
        </p>
        {!draft && (
          <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Plus className="h-4 w-4 mr-1" /> Add an article
          </Button>
        )}
      </CollapsibleSection>

      {draft && (
        <Card className="glass border-primary/40">
          <CardHeader>
            <CardTitle className="font-display text-base">
              {draft.id ? 'Edit article' : 'New article'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Headline</Label>
              <Input
                placeholder="As the outlet printed it"
                value={draft.title}
                onChange={e => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Outlet</Label>
                <Input
                  placeholder="Moscow-Pullman Daily News"
                  value={draft.outlet}
                  onChange={e => setDraft({ ...draft, outlet: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Published</Label>
                <Input
                  type="date"
                  value={draft.published_date}
                  onChange={e => setDraft({ ...draft, published_date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Link</Label>
              <Input
                placeholder="https://…"
                value={draft.url}
                onChange={e => setDraft({ ...draft, url: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Your blurb (optional)</Label>
              <Textarea
                rows={3}
                placeholder="A line or two in your own words, or a short quote — not the article."
                value={draft.excerpt}
                onChange={e => setDraft({ ...draft, excerpt: e.target.value })}
              />
            </div>
            <PosterUpload
              currentUrl={draft.image_url}
              onUrlChange={url => setDraft(d => (d ? { ...d, image_url: url } : d))}
              folder="press"
              label="Thumbnail (optional)"
              previewClassName="w-48 aspect-[16/9]"
              alt="Article thumbnail preview"
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
        ) : articles.length === 0 ? (
          <Card className="glass">
            <CardContent className="p-8 text-center text-muted-foreground font-serif">
              No coverage listed yet. The Press page shows the photo and intro text above until you
              add the first article.
            </CardContent>
          </Card>
        ) : articles.map(a => {
          const featuredIndex = featured.findIndex(f => f.id === a.id);
          return (
            <Card key={a.id} className={a.is_featured ? 'glass border-primary/40' : 'glass'}>
              <CardContent className="p-3 flex items-start gap-3">
                {a.is_featured && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => swapFeatured(featuredIndex, -1)}
                      disabled={featuredIndex <= 0}
                      aria-label="Show earlier among the featured"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => swapFeatured(featuredIndex, 1)}
                      disabled={featuredIndex < 0 || featuredIndex >= featured.length - 1}
                      aria-label="Show later among the featured"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {a.image_url && (
                  <img
                    src={a.image_url}
                    alt=""
                    className="hidden sm:block w-24 aspect-[16/9] object-cover rounded shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium flex items-center gap-2 flex-wrap">
                    {a.title}
                    {a.is_featured && (
                      <Badge className="text-xs">
                        <Star className="h-3 w-3 mr-1" /> Featured
                      </Badge>
                    )}
                    {!a.is_active && <Badge variant="outline">Draft</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {a.outlet}
                    {a.published_date && ` — ${formatPlainDate(a.published_date)}`}
                  </p>
                  {a.excerpt && (
                    <p className="text-xs text-muted-foreground font-serif mt-1 line-clamp-2">
                      {a.excerpt}
                    </p>
                  )}
                  <a
                    href={safeHttpUrl(a.url) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary inline-flex items-center gap-1 mt-1 hover:underline break-all"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" /> {a.url}
                  </a>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setDraft({
                      id: a.id,
                      title: a.title,
                      outlet: a.outlet,
                      url: a.url,
                      published_date: a.published_date ?? '',
                      excerpt: a.excerpt ?? '',
                      image_url: a.image_url ?? '',
                    })}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleFeatured(a)}>
                    {a.is_featured ? 'Un-feature' : 'Feature'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => togglePublished(a)}>
                    {a.is_active ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(a)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
