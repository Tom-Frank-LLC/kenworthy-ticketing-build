import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  ArrowDown, ArrowUp, ExternalLink, Image as ImageIcon, Pencil, Plus, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { instantToVenueLocalInput, venueLocalToInstant } from '@/lib/datetime';
import { slideImageUrl } from '@/hooks/useFeaturedSlides';
import {
  SLIDE_ACCEPTED_TYPES,
  SLIDE_BUCKET,
  SLIDE_COLUMNS,
  isSlideLive,
  linkUrlProblem,
  orderSlides,
  type FeaturedSlide,
} from '@/lib/featuredSlides';

/**
 * The hand-written half of the home page's curator carousel.
 *
 * The other half is derived: flag a movie, an event or one showing
 * `is_featured` and it becomes a slide. That works for everything that sells a
 * ticket and for nothing that does not, which is why the Silent Film Festival
 * — a real page with a real audience and no showing behind it — could not be
 * promoted at all without inventing a fake showing to hang the flag off. A row
 * here is that promotion, with nothing pretending to be for sale.
 *
 * Two things about the editing model are worth knowing before changing it:
 *
 *   **The image is upload-only.** There is no "paste a URL" field. A stored
 *   object is one source of truth — it is what delete cleans up and what the
 *   render endpoint resizes — while a remote URL would be neither, and would
 *   put someone else's host in the critical path of our home page.
 *
 *   **Live is two conditions, not one.** A slide is on the page when it is
 *   active AND inside its date window. The list says which of the two is
 *   holding a slide back, because "why isn't it showing" is otherwise a
 *   question the admin cannot answer from this screen.
 *
 * Every write here goes through RLS, and an RLS denial is a 204 with no error.
 * That is why each one ends in `.select()` and checks the row count rather
 * than trusting the absence of an error.
 */

/** A blank slide, as the Add dialog opens on it. */
const EMPTY = {
  title: '',
  blurb: '',
  image_alt: '',
  link_url: '',
  cta_label: 'Read more',
  is_active: true,
  starts_at: '',
  ends_at: '',
};

type Draft = typeof EMPTY;

/** Why a slide is not on the page, or null when it is. */
function heldBack(slide: FeaturedSlide, now: Date): string | null {
  if (isSlideLive(slide, now)) return null;
  if (!slide.is_active) return 'Off';
  if (slide.starts_at && new Date(slide.starts_at) > now) return 'Scheduled';
  return 'Finished';
}

export default function FeaturedSlidesTab() {
  const [slides, setSlides] = useState<FeaturedSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // The slide being written, and the row it belongs to when this is an edit.
  // Held apart from `slides` so an abandoned edit leaves no trace: closing the
  // dialog is a cancel, and the row is untouched until a save comes back with
  // a row count.
  const [editing, setEditing] = useState<FeaturedSlide | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [dropImage, setDropImage] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // `featured_slides` is not in the generated Supabase types yet, the same as
    // backstage_photos and press_page_content.
    const { data, error } = await (supabase as any)
      .from('featured_slides')
      .select(SLIDE_COLUMNS);
    if (error) toast.error(error.message);
    // The admin SELECT policy returns drafts and expired rows too, so this
    // list is everything — which is the point of the screen.
    setSlides(orderSlides((data ?? []) as FeaturedSlide[]));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // One instant for the whole render, so two rows cannot disagree about
  // whether "now" is before or after the same timestamp.
  const now = useMemo(() => new Date(), [slides]);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY);
    setFile(null);
    setDropImage(false);
    setOpen(true);
  };

  const openEdit = (slide: FeaturedSlide) => {
    setEditing(slide);
    setDraft({
      title: slide.title,
      blurb: slide.blurb ?? '',
      image_alt: slide.image_alt ?? '',
      link_url: slide.link_url,
      cta_label: slide.cta_label,
      is_active: slide.is_active,
      starts_at: slide.starts_at ? instantToVenueLocalInput(slide.starts_at) : '',
      ends_at: slide.ends_at ? instantToVenueLocalInput(slide.ends_at) : '',
    });
    setFile(null);
    setDropImage(false);
    setOpen(true);
  };

  const linkProblem = draft.link_url ? linkUrlProblem(draft.link_url) : null;

  /**
   * Create or update, image and all.
   *
   * The object is uploaded before the row is written and removed again if the
   * row does not land, so a refused write cannot leave bytes in the bucket
   * nothing points at. On an edit, the *previous* object is removed only after
   * the row is pointing at the new one — in that order, so the page is never
   * pointing at bytes that do not exist. A failure to clean up is a warning,
   * not an error: an orphan costs storage, while a row pointing at nothing
   * costs the reader a broken image on the home page.
   */
  const save = async () => {
    const title = draft.title.trim();
    if (!title) { toast.error('A slide needs a title'); return; }
    const problem = linkUrlProblem(draft.link_url);
    if (problem) { toast.error(problem); return; }
    if (file && !(SLIDE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      toast.error('Only JPEG, PNG, WebP or AVIF images can go on a slide');
      return;
    }
    const startsAt = draft.starts_at ? venueLocalToInstant(draft.starts_at) : null;
    const endsAt = draft.ends_at ? venueLocalToInstant(draft.ends_at) : null;
    if (startsAt && endsAt && endsAt <= startsAt) {
      toast.error('The end has to come after the start');
      return;
    }

    setBusy(true);
    let uploaded: string | null = null;
    try {
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        // Timestamp-prefixed: the bucket is public, so an inactive slide's
        // image is only unlisted, and a guessable path would make that
        // meaningless.
        uploaded = `slides/${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(SLIDE_BUCKET)
          .upload(uploaded, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
      }

      const fields = {
        title,
        blurb: draft.blurb.trim() || null,
        image_alt: draft.image_alt.trim() || null,
        link_url: draft.link_url.trim(),
        cta_label: draft.cta_label.trim() || 'Read more',
        is_active: draft.is_active,
        starts_at: startsAt ? startsAt.toISOString() : null,
        ends_at: endsAt ? endsAt.toISOString() : null,
      };

      if (editing) {
        const previous = editing.image_path;
        const patch: Record<string, unknown> = { ...fields };
        // Three cases, and only two of them touch the column: a new upload
        // repoints it, "remove the image" clears it, and doing neither must
        // leave the existing path alone rather than writing null over it.
        if (uploaded) patch.image_path = uploaded;
        else if (dropImage) patch.image_path = null;

        const { data, error } = await (supabase as any)
          .from('featured_slides')
          .update(patch)
          .eq('id', editing.id)
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Nothing was saved — you may not have admin rights.');

        if (previous && (uploaded || dropImage)) {
          const { error: rmErr } = await supabase.storage.from(SLIDE_BUCKET).remove([previous]);
          if (rmErr) toast.warning('Slide saved, but the old image is still in storage.');
        }
        uploaded = null;
        toast.success('Slide saved');
      } else {
        const { data: userData } = await supabase.auth.getUser();
        const { data, error } = await (supabase as any)
          .from('featured_slides')
          .insert({
            ...fields,
            image_path: uploaded,
            // New slides go to the back of the queue. Reordering is two
            // clicks away and a slide silently jumping in front of the one
            // already there is a surprise.
            display_order: slides.length,
            created_by: userData.user?.id ?? null,
          })
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('The slide was not saved — you may not have admin rights.');
        uploaded = null;
        toast.success(draft.is_active ? 'Slide added' : 'Slide added — switch it on when it is ready');
      }

      setOpen(false);
      await load();
    } catch (e) {
      if (uploaded) await supabase.storage.from(SLIDE_BUCKET).remove([uploaded]);
      toast.error(e instanceof Error ? e.message : 'Could not save that slide');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (slide: FeaturedSlide) => {
    const next = !slide.is_active;
    const { data, error } = await (supabase as any)
      .from('featured_slides')
      .update({ is_active: next })
      .eq('id', slide.id)
      .select('id');
    if (error || !data?.length) {
      toast.error(error?.message ?? 'Nothing changed — you may not have admin rights.');
      return;
    }
    setSlides(prev => prev.map(s => (s.id === slide.id ? { ...s, is_active: next } : s)));
    toast.success(next ? 'Switched on' : 'Switched off');
  };

  /**
   * Move a slide one place up or down.
   *
   * Both rows are rewritten, not just the one that moved: display_order ties
   * are broken by created_at, so swapping a single value leaves two slides
   * claiming the same position and the tiebreak — not the admin — deciding
   * which leads. Renumbering the pair from their positions in the list also
   * repairs a list where everything sits at the default 0.
   */
  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= slides.length) return;
    const reordered = [...slides];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    setBusy(true);
    try {
      for (const [position, slide] of reordered.entries()) {
        if (slide.display_order === position) continue;
        const { data, error } = await (supabase as any)
          .from('featured_slides')
          .update({ display_order: position })
          .eq('id', slide.id)
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('The order was not saved — you may not have admin rights.');
      }
      setSlides(orderSlides(reordered.map((s, position) => ({ ...s, display_order: position }))));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reorder the slides');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slide: FeaturedSlide) => {
    if (!confirm(`Delete "${slide.title}"? This removes its image as well and cannot be undone.`)) return;

    // Row first. A deleted object with a surviving row is a broken image on the
    // home page; a surviving object with no row is invisible and reclaimable.
    const { data, error } = await (supabase as any)
      .from('featured_slides')
      .delete()
      .eq('id', slide.id)
      .select('id');
    if (error || !data?.length) {
      toast.error(error?.message ?? 'Nothing was deleted — you may not have admin rights.');
      return;
    }
    if (slide.image_path) {
      const { error: rmErr } = await supabase.storage.from(SLIDE_BUCKET).remove([slide.image_path]);
      if (rmErr) toast.warning('Slide removed, but its image is still in storage.');
    }
    toast.success('Slide deleted');
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-2xl">
          <h3 className="font-display text-2xl">Curator&rsquo;s picks</h3>
          <p className="text-sm text-muted-foreground font-serif">
            Slides you write by hand, at the front of the carousel on the home page.
            Use one to point at a page that has no showing behind it — the Silent
            Film Festival, Backstage, rentals. Films and events flagged
            &ldquo;featured&rdquo; on their own forms follow after these, soonest first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" /> View home page
            </a>
          </Button>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" /> Add slide
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading…</p>
      ) : slides.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>No hand-written slides. The carousel is showing featured films and events only.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {slides.map((slide, index) => {
            const held = heldBack(slide, now);
            return (
              <Card key={slide.id}>
                <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                  {slide.image_path ? (
                    <img
                      src={slideImageUrl(slide.image_path, 320)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-16 w-24 shrink-0 rounded object-contain bg-muted border border-border"
                    />
                  ) : (
                    <div className="h-16 w-24 shrink-0 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-lg truncate">{slide.title}</span>
                      <Badge variant={held ? 'secondary' : 'default'}>{held ?? 'Live'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 break-all">
                      {slide.cta_label} → {slide.link_url}
                    </p>
                    {(slide.starts_at || slide.ends_at) && (
                      <p className="text-xs text-muted-foreground">
                        {slide.starts_at ? `From ${instantToVenueLocalInput(slide.starts_at).replace('T', ' ')}` : 'From now'}
                        {' · '}
                        {slide.ends_at ? `until ${instantToVenueLocalInput(slide.ends_at).replace('T', ' ')}` : 'no end'}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline" size="icon"
                      aria-label={`Move ${slide.title} earlier`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline" size="icon"
                      aria-label={`Move ${slide.title} later`}
                      disabled={busy || index === slides.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <div className="flex items-center gap-2 px-2">
                      <Switch
                        id={`slide-active-${slide.id}`}
                        checked={slide.is_active}
                        onCheckedChange={() => toggleActive(slide)}
                      />
                      <Label htmlFor={`slide-active-${slide.id}`} className="text-xs">On</Label>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openEdit(slide)}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(slide)} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={o => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit slide' : 'Add a slide'}</DialogTitle>
            <DialogDescription>
              A picture, a headline, a sentence and a link. Nothing here sells a ticket.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="slide-title">Title</Label>
              <Input
                id="slide-title"
                placeholder="e.g. Kenworthy Silent Film Festival"
                value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="slide-blurb">Blurb</Label>
              <RichTextEditor
                id="slide-blurb"
                rows={6}
                aria-label="Slide blurb"
                value={draft.blurb}
                onChange={value => setDraft(d => ({ ...d, blurb: value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                The curator&rsquo;s sentence. Long copy scrolls inside the slide rather
                than stretching the band, so it will not break the layout — but the
                reader has to want to scroll it.
              </p>
            </div>

            <div>
              <Label htmlFor="slide-link">Link</Label>
              <Input
                id="slide-link"
                placeholder="/silent-film-festival"
                value={draft.link_url}
                onChange={e => setDraft(d => ({ ...d, link_url: e.target.value }))}
                aria-invalid={linkProblem ? true : undefined}
                aria-describedby="slide-link-help"
              />
              <p
                id="slide-link-help"
                className={`text-xs mt-1 ${linkProblem ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {linkProblem ??
                  'A path on this site (/silent-film-festival) opens in the app. A full https:// address opens in a new tab.'}
              </p>
            </div>

            <div>
              <Label htmlFor="slide-cta">Button label</Label>
              <Input
                id="slide-cta"
                placeholder="Explore the Festival"
                value={draft.cta_label}
                onChange={e => setDraft(d => ({ ...d, cta_label: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="slide-file">Image</Label>
              {editing?.image_path && !dropImage && (
                <img
                  src={slideImageUrl(editing.image_path, 320)}
                  alt=""
                  className="h-24 w-full rounded object-contain bg-muted border border-border mb-2"
                />
              )}
              <Input
                id="slide-file"
                type="file"
                accept={SLIDE_ACCEPTED_TYPES.join(',')}
                onChange={e => { setFile(e.target.files?.[0] || null); setDropImage(false); }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                JPEG, PNG, WebP or AVIF, up to 10 MB. Shown whole on a dark plinth
                rather than cropped, so a square or landscape graphic is fine. The
                page serves a resized copy — upload the full-size original.
              </p>
              {editing?.image_path && !file && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={dropImage}
                    onChange={e => setDropImage(e.target.checked)}
                  />
                  Remove the image — the slide becomes copy and a button
                </label>
              )}
            </div>

            <div>
              <Label htmlFor="slide-alt">Image description</Label>
              <Input
                id="slide-alt"
                placeholder="e.g. An organist at the Wurlitzer, 1926"
                value={draft.image_alt}
                onChange={e => setDraft(d => ({ ...d, image_alt: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Read out to anyone who cannot see the picture. Say what the picture
                shows, not what the slide is for — the title already says that, and
                it is what gets used if you leave this blank.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="slide-start">Show from</Label>
                <Input
                  id="slide-start" type="datetime-local"
                  value={draft.starts_at}
                  onChange={e => setDraft(d => ({ ...d, starts_at: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="slide-end">Show until</Label>
                <Input
                  id="slide-end" type="datetime-local"
                  value={draft.ends_at}
                  onChange={e => setDraft(d => ({ ...d, ends_at: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Both optional, both theatre time. An end date is how a festival promo
              retires itself the morning after instead of waiting for someone to
              remember.
            </p>

            <div className="flex items-center gap-2">
              <Switch
                id="slide-draft-active"
                checked={draft.is_active}
                onCheckedChange={value => setDraft(d => ({ ...d, is_active: value }))}
              />
              <Label htmlFor="slide-draft-active">On the home page</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add slide'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
