import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Upload, Eye, EyeOff, Trash2, Image as ImageIcon, ExternalLink, Save } from 'lucide-react';
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
        .select('body_text')
        .maybeSingle(),
    ]);

    if (photoRes.error) toast.error(photoRes.error.message);
    // The admin SELECT policy returns drafts too, so this list is everything.
    setPhotos(orderBackstagePhotos((photoRes.data ?? []) as AdminPhoto[]));

    const stored = (copyRes.data as { body_text: string | null } | null)?.body_text ?? '';
    setBody(stored);
    setBodyDraft(stored);
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

      {/* ------------------------------------------- How the room gets used */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h4 className="font-display uppercase tracking-[0.2em] text-sm text-primary">
            How the room gets used
          </h4>
          <p className="text-xs text-muted-foreground">
            The paragraph under the sign. Leave a blank line between paragraphs.
            Clearing it hides the section — and the booking link with it.
            <strong className="text-foreground">
              {' '}What is in here now is placeholder copy written to sound right,
              not the real wording. Replace it.
            </strong>
          </p>
          <Textarea
            id="backstage-body"
            rows={10}
            className="font-serif"
            aria-label="How the room gets used"
            value={bodyDraft}
            onChange={e => setBodyDraft(e.target.value)}
          />
          <Button size="sm" variant="outline" disabled={savingBody || !bodyDirty} onClick={saveBody}>
            <Save className="h-4 w-4 mr-1" />
            {savingBody ? 'Saving…' : 'Save copy'}
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------ The gallery */}
      <div>
        <h4 className="font-display uppercase tracking-[0.2em] text-sm text-primary mb-3">
          Past events
        </h4>
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
      </div>

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
