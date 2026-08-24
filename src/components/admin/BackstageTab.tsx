import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Upload, Eye, EyeOff, Trash2, Image as ImageIcon, ExternalLink, Save, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  BACKSTAGE_ACCEPTED_TYPES,
  BACKSTAGE_BUCKET,
  orderBackstagePhotos,
  type BackstagePhoto,
} from '@/lib/backstage';

/**
 * The unlisted /backstage page, from the admin side.
 *
 * Two independent things, deliberately in one tab because they are one page:
 *
 *   The paragraph. backstage_page_content is a single row and this is the only
 *   place it is ever written. It ships seeded with placeholder copy — the
 *   wording below the textarea says so, because a placeholder nobody knows is
 *   a placeholder becomes the final copy by default.
 *
 *   The photographs. Same shape as FestivalProgramsTab: upload to a public
 *   bucket, insert an unpublished row, publish when it is ready. Publishing is
 *   per row and reversible in both directions — a gallery has no "active" item
 *   the way the concession menu does.
 *
 * Every write here goes through RLS, and an RLS denial is a 204 with no error.
 * That is why each one ends in `.select()` and checks the row count rather than
 * trusting the absence of an error: without it a blocked write reports success
 * and the photograph silently never appears.
 */

/** Rows as the admin list needs them — the public shape plus its draft flag. */
interface AdminPhoto extends BackstagePhoto {
  is_published: boolean;
}

export default function BackstageTab() {
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  // The stored copy and the copy being typed, held apart so a half-written
  // paragraph never looks saved.
  const [body, setBody] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [savingBody, setSavingBody] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [file, setFile] = useState<File | null>(null);

  // The photo being edited, plus its in-progress values. Held separately from
  // `photos` so an abandoned edit leaves no trace — closing the dialog is a
  // cancel, and the row is untouched until the save comes back with a count.
  // The photograph at the top of the page. One object, replaced in place —
  // there is only ever one hero, so uploading a new one removes the old.
  const [heroPath, setHeroPath] = useState<string | null>(null);
  const [heroBusy, setHeroBusy] = useState(false);

  const [editing, setEditing] = useState<AdminPhoto | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editOrder, setEditOrder] = useState('0');
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Neither table is in the generated Supabase types yet, the same as
    // press_page_content and job_postings.
    const [photoRes, copyRes] = await Promise.all([
      (supabase as any)
        .from('backstage_photos')
        .select('id, caption, file_path, display_order, is_published, created_at'),
      (supabase as any)
        .from('backstage_page_content')
        .select('body_text, hero_path')
        .maybeSingle(),
    ]);

    if (photoRes.error) toast.error(photoRes.error.message);
    // The admin SELECT policy returns drafts too, so this list is everything.
    setPhotos(orderBackstagePhotos((photoRes.data ?? []) as AdminPhoto[]));

    const copy = copyRes.data as { body_text: string | null; hero_path: string | null } | null;
    const stored = copy?.body_text ?? '';
    setBody(stored);
    setBodyDraft(stored);
    setHeroPath(copy?.hero_path ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const publicUrl = (path: string) =>
    supabase.storage.from(BACKSTAGE_BUCKET).getPublicUrl(path).data.publicUrl;

  const thumbUrl = (path: string) =>
    supabase.storage.from(BACKSTAGE_BUCKET).getPublicUrl(path, {
      // 'contain', not the default 'cover': cover given only a width squashes
      // the image instead of scaling it. See the festival archive.
      transform: { width: 320, resize: 'contain', quality: 70 },
    }).data.publicUrl;

  const saveBody = async () => {
    setSavingBody(true);
    try {
      const next = bodyDraft.trim();
      const { data, error } = await (supabase as any)
        .from('backstage_page_content')
        .update({ body_text: next || null })
        .eq('id', true)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Nothing saved — you may not have admin rights.');
      setBody(next);
      toast.success(next ? 'Copy saved' : 'Copy cleared — the section is now hidden');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that copy');
    } finally {
      setSavingBody(false);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Choose a photograph');
      return;
    }
    if (!(BACKSTAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      toast.error('Only JPEG, PNG, WebP or AVIF images can go on the page');
      return;
    }

    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      // Timestamp-prefixed: the bucket is public, so an unpublished photo is
      // only unlisted, and a guessable path would make that meaningless.
      const path = `backstage/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from(BACKSTAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { data: inserted, error: insErr } = await (supabase as any)
        .from('backstage_photos')
        .insert({
          caption: caption.trim() || null,
          file_path: path,
          display_order: parseInt(displayOrder, 10) || 0,
          is_published: false,
          uploaded_by: userData.user?.id ?? null,
        })
        .select('id');
      if (insErr) throw insErr;
      if (!inserted || inserted.length === 0) {
        // The object uploaded but the row did not. Take the orphan back out
        // rather than leaving bytes in the bucket nothing points at.
        await supabase.storage.from(BACKSTAGE_BUCKET).remove([path]);
        throw new Error('The photograph was not saved — you may not have admin rights.');
      }

      toast.success('Uploaded — publish it when you want it on the page');
      setCaption(''); setFile(null); setDisplayOrder('0');
      setUploadOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  /**
   * Replace the hero photograph.
   *
   * Upload first, then point the row at it, then delete the object that was
   * there before — in that order, so the page is never pointing at bytes that
   * do not exist. The old object is removed last and its failure is a warning
   * rather than an error: an orphan in a bucket costs storage, while a row
   * pointing at nothing costs the reader a broken image at the top of the page.
   */
  const uploadHero = async (chosen: File) => {
    if (!(BACKSTAGE_ACCEPTED_TYPES as readonly string[]).includes(chosen.type)) {
      toast.error('Only JPEG, PNG, WebP or AVIF images can go on the page');
      return;
    }
    setHeroBusy(true);
    const previous = heroPath;
    try {
      const safeName = chosen.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `hero/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from(BACKSTAGE_BUCKET)
        .upload(path, chosen, { contentType: chosen.type, upsert: false });
      if (upErr) throw upErr;

      const { data, error } = await (supabase as any)
        .from('backstage_page_content')
        .update({ hero_path: path })
        .eq('id', true)
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        await supabase.storage.from(BACKSTAGE_BUCKET).remove([path]);
        throw new Error('The hero was not saved — you may not have admin rights.');
      }

      if (previous) {
        const { error: rmErr } = await supabase.storage
          .from(BACKSTAGE_BUCKET).remove([previous]);
        if (rmErr) toast.warning('New hero is live, but the old file is still in storage.');
      }
      setHeroPath(path);
      toast.success('Hero image updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload that image');
    } finally {
      setHeroBusy(false);
    }
  };

  const removeHero = async () => {
    if (!heroPath) return;
    if (!confirm('Remove the hero photograph? The page falls back to the drawn sign.')) return;
    setHeroBusy(true);
    try {
      const { data, error } = await (supabase as any)
        .from('backstage_page_content')
        .update({ hero_path: null })
        .eq('id', true)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Nothing changed — you may not have admin rights.');

      const { error: rmErr } = await supabase.storage
        .from(BACKSTAGE_BUCKET).remove([heroPath]);
      if (rmErr) toast.warning('Hero removed from the page, but the file is still in storage.');
      setHeroPath(null);
      toast.success('Hero removed — the page shows the drawn sign again');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the hero');
    } finally {
      setHeroBusy(false);
    }
  };

  const openEdit = (photo: AdminPhoto) => {
    setEditing(photo);
    setEditCaption(photo.caption ?? '');
    setEditOrder(String(photo.display_order));
  };

  /**
   * Caption and order only — deliberately not the image.
   *
   * Replacing the file would mean a second object, a path swap and an orphan to
   * clean up, and it is not what "edit" means here: a photograph is the thing,
   * and what needs correcting after the fact is the typo underneath it or where
   * it sits in the grid. A wrong photograph is a delete and a re-upload.
   */
  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const nextCaption = editCaption.trim() || null;
      const nextOrder = parseInt(editOrder, 10) || 0;

      const { data, error } = await (supabase as any)
        .from('backstage_photos')
        .update({ caption: nextCaption, display_order: nextOrder })
        .eq('id', editing.id)
        .select('id');
      if (error) throw error;
      // An RLS denial is a 204 with no error, so the row count is the only
      // thing that distinguishes a save from a silent refusal.
      if (!data?.length) throw new Error('Nothing was saved — you may not have admin rights.');

      // Re-sorted through the shared comparator rather than patched in place:
      // display_order is what the grid orders on, so an edit can move the row,
      // and the admin list has to agree with the public page about where.
      setPhotos(prev => orderBackstagePhotos(
        prev.map(p => (p.id === editing.id
          ? { ...p, caption: nextCaption, display_order: nextOrder }
          : p)),
      ));
      setEditing(null);
      toast.success('Photo updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that change');
    } finally {
      setSavingEdit(false);
    }
  };

  const togglePublished = async (photo: AdminPhoto) => {
    const next = !photo.is_published;
    const { data, error } = await (supabase as any)
      .from('backstage_photos')
      .update({ is_published: next })
      .eq('id', photo.id)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error(error?.message ?? 'Nothing changed — you may not have admin rights.');
      return;
    }
    setPhotos(prev => prev.map(p => (p.id === photo.id ? { ...p, is_published: next } : p)));
    toast.success(next ? 'Published to the Backstage page' : 'Hidden from the Backstage page');
  };

  const remove = async (photo: AdminPhoto) => {
    const label = photo.caption || 'this photograph';
    if (!confirm(`Delete ${label}? This removes the image file as well and cannot be undone.`)) return;

    // Row first. A deleted object with a surviving row is a broken image on a
    // public page; a surviving object with no row is invisible and reclaimable.
    const { data, error } = await (supabase as any)
      .from('backstage_photos')
      .delete()
      .eq('id', photo.id)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error(error?.message ?? 'Nothing was deleted — you may not have admin rights.');
      return;
    }
    const { error: rmErr } = await supabase.storage.from(BACKSTAGE_BUCKET).remove([photo.file_path]);
    if (rmErr) toast.warning('Listing removed, but the file is still in storage.');
    else toast.success('Photograph deleted');
    await load();
  };

  const bodyDirty = bodyDraft.trim() !== body.trim();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-2xl">Backstage</h3>
          <p className="text-sm text-muted-foreground font-serif">
            The speakeasy page. It is <strong>unlisted</strong> — not in any menu,
            reachable by clicking the neon Backstage sign at the bottom of the home
            page, or by the direct link. Anyone with that link can read it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/backstage" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" /> View page
            </a>
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Upload photo
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------- The hero image */}
      <CollapsibleSection id="pages.backstage.hero" title="Hero image">
        <p className="text-xs text-muted-foreground">
          The photograph at the very top of the page — a shot of the real neon
          sign works best. It <strong className="text-foreground">replaces</strong> the
          drawn sign rather than sitting above it, because both say
          &ldquo;Backstage&rdquo; and showing them together prints the name twice.
          With no hero, the page falls back to the drawn sign.
        </p>

        {heroPath ? (
          <img
            src={thumbUrl(heroPath)}
            alt="Current hero"
            className="h-32 w-full rounded object-cover border border-border"
          />
        ) : (
          <div className="h-32 w-full rounded border border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
            No hero image — the page is showing the drawn sign
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            id="backstage-hero-file"
            type="file"
            className="max-w-xs"
            accept={BACKSTAGE_ACCEPTED_TYPES.join(',')}
            disabled={heroBusy}
            onChange={e => {
              const chosen = e.target.files?.[0];
              // Cleared so choosing the same file twice still fires a change
              // — otherwise a failed upload cannot be retried without picking
              // a different file first.
              e.target.value = '';
              if (chosen) uploadHero(chosen);
            }}
          />
          {heroBusy && <span className="text-xs text-muted-foreground">Working…</span>}
          {heroPath && !heroBusy && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={publicUrl(heroPath)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Full size
                </a>
              </Button>
              <Button variant="ghost" size="sm" onClick={removeHero}>
                <Trash2 className="h-4 w-4 mr-1" /> Remove
              </Button>
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* ------------------------------------------- How the room gets used */}
      <CollapsibleSection id="pages.backstage.room" title="How the room gets used">
        <p className="text-xs text-muted-foreground">
          The paragraph under the sign. Enter starts a new paragraph.
          Clearing it hides the section — and the booking link with it.
          <strong className="text-foreground">
            {' '}What is in here now is placeholder copy written to sound right,
            not the real wording. Replace it.
          </strong>
        </p>
        <RichTextEditor
          id="backstage-body"
          rows={10}
          aria-label="How the room gets used"
          value={bodyDraft}
          onChange={setBodyDraft}
        />
        <Button size="sm" variant="outline" disabled={savingBody || !bodyDirty} onClick={saveBody}>
          <Save className="h-4 w-4 mr-1" />
          {savingBody ? 'Saving…' : 'Save copy'}
        </Button>
      </CollapsibleSection>

      {/* ------------------------------------------------------ The gallery */}
      <CollapsibleSection id="pages.backstage.gallery" title="Past events" count={photos.length} defaultOpen>
      <p className="text-xs text-muted-foreground mb-3">
        Uploads start unpublished — nothing is on the page until you publish it.
        The caption is also the image&rsquo;s alt text, so write it for someone who
        cannot see the photograph. Lower display order comes first; photos left
        at 0 fall back to newest first.
      </p>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading…</p>
      ) : photos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>No photographs yet. Upload one to start the gallery.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {photos.map(photo => (
            <Card key={photo.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <img
                  src={thumbUrl(photo.file_path)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-16 w-24 shrink-0 rounded object-cover border border-border"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-lg truncate">
                      {photo.caption || <span className="text-muted-foreground">No caption</span>}
                    </span>
                    <Badge variant={photo.is_published ? 'default' : 'secondary'}>
                      {photo.is_published ? 'Published' : 'Draft'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Order {photo.display_order}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" asChild>
                    <a href={publicUrl(photo.file_path)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1" /> Full size
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(photo)}>
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </Button>
                  <Button
                    variant={photo.is_published ? 'ghost' : 'default'}
                    size="sm"
                    onClick={() => togglePublished(photo)}
                  >
                    {photo.is_published
                      ? <><EyeOff className="h-4 w-4 mr-1" /> Unpublish</>
                      : <><Eye className="h-4 w-4 mr-1" /> Publish</>}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(photo)} title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </CollapsibleSection>

      {/* Edit — caption and order. Not the image; see saveEdit. */}
      <Dialog open={editing !== null} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit photo</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <img
                src={thumbUrl(editing.file_path)}
                alt=""
                className="h-32 w-full rounded object-cover border border-border"
              />
              <div>
                <Label htmlFor="edit-caption">Caption</Label>
                <Input
                  id="edit-caption"
                  placeholder="e.g. The Palouse Ramblers, February 2026"
                  value={editCaption}
                  onChange={e => setEditCaption(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Shown under the photograph, and read out as its description.
                  Clearing it falls back to &ldquo;an event in the Backstage
                  speakeasy&rdquo;.
                </p>
              </div>
              <div>
                <Label htmlFor="edit-order">Display order</Label>
                <Input
                  id="edit-order" type="number" inputMode="numeric"
                  value={editOrder} onChange={e => setEditOrder(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Lower comes first. Photos left at 0 fall back to newest first.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                To change the photograph itself, delete this one and upload the
                replacement.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload a Backstage photo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="backstage-caption">Caption</Label>
              <Input
                id="backstage-caption"
                placeholder="e.g. The Palouse Ramblers, February 2026"
                value={caption}
                onChange={e => setCaption(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Shown under the photograph, and read out as its description. Optional,
                but a photograph without one is described only as &ldquo;an event in the
                Backstage speakeasy&rdquo;.
              </p>
            </div>
            <div>
              <Label htmlFor="backstage-order">Display order</Label>
              <Input
                id="backstage-order" type="number" inputMode="numeric"
                value={displayOrder} onChange={e => setDisplayOrder(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="backstage-file">Image</Label>
              <Input
                id="backstage-file" type="file"
                accept={BACKSTAGE_ACCEPTED_TYPES.join(',')}
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                JPEG, PNG, WebP or AVIF, up to 10 MB. The page serves a resized copy,
                so upload the full-resolution photograph rather than shrinking it first.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
