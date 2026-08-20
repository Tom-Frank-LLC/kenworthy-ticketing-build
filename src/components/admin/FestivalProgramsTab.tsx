import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Upload, Eye, EyeOff, Trash2, FileText, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { FESTIVAL_SLUG, groupProgramsByYear, type FestivalProgram } from '@/lib/festival';

const BUCKET = 'festival-programs';

/** What the archive page can draw. Anything else is refused at the picker. */
const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

/**
 * The festival program archive, from the admin side.
 *
 * Mirrors ConcessionMenusTab with two differences that both come from the files
 * being public rather than operational:
 *
 *   Preview is a plain link to the public URL, not a signed one. The bucket is
 *   public, so a signed URL here would be ceremony that proves nothing.
 *
 *   Publishing is per row, not one-of. A festival year has several files and
 *   they are all shown at once; there is no "active" program the way there is
 *   an active menu, so is_published toggles freely in both directions.
 */
export default function FestivalProgramsTab() {
  const [programs, setPrograms] = useState<FestivalProgram[]>([]);
  // year -> trailer url, as stored. Edits are held separately so a half-typed
  // URL never looks saved.
  const [trailers, setTrailers] = useState<Record<number, string>>({});
  const [trailerDraft, setTrailerDraft] = useState<Record<number, string>>({});
  const [savingYear, setSavingYear] = useState<number | null>(null);
  const [published, setPublished] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [title, setTitle] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [file, setFile] = useState<File | null>(null);
  // Only meaningful for a PDF, which cannot be its own thumbnail. The import
  // script renders this automatically with pdftoppm; a hand upload has no such
  // luxury, so it is offered here rather than left as a gap only the script
  // can fill.
  const [cover, setCover] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('festival_programs')
      .select('id, year, title, file_path, file_type, display_order, is_published, thumbnail_path')
      .eq('festival_slug', FESTIVAL_SLUG);
    if (error) toast.error(error.message);
    const rows = (data ?? []) as Array<FestivalProgram & { is_published: boolean }>;
    setPrograms(rows);
    setPublished(Object.fromEntries(rows.map(r => [r.id, r.is_published])));

    const { data: yearRows } = await supabase
      .from('festival_years')
      .select('year, trailer_url')
      .eq('festival_slug', FESTIVAL_SLUG);
    const map: Record<number, string> = {};
    for (const r of (yearRows ?? []) as Array<{ year: number; trailer_url: string | null }>) {
      if (r.trailer_url) map[r.year] = r.trailer_url;
    }
    setTrailers(map);
    setTrailerDraft(map);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveTrailer = async (year: number) => {
    const url = (trailerDraft[year] ?? '').trim();
    setSavingYear(year);
    try {
      // Upsert on (festival_slug, year): the year may have had programmes for
      // ages without ever having a row of its own.
      const { data, error } = await supabase
        .from('festival_years')
        .upsert(
          { festival_slug: FESTIVAL_SLUG, year, trailer_url: url || null },
          { onConflict: 'festival_slug,year' },
        )
        .select('year');
      if (error) throw error;
      if (!data?.length) throw new Error('Nothing saved — you may not have admin rights.');
      setTrailers(prev => {
        const next = { ...prev };
        if (url) next[year] = url; else delete next[year];
        return next;
      });
      toast.success(url ? `Trailer saved for ${year}` : `Trailer cleared for ${year}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that trailer');
    } finally {
      setSavingYear(null);
    }
  };

  const publicUrl = (path: string) =>
    supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const handleUpload = async () => {
    const parsedYear = parseInt(year, 10);
    if (!Number.isFinite(parsedYear) || parsedYear < 1900 || parsedYear > 2200) {
      toast.error('Enter a four-digit year');
      return;
    }
    if (!file) {
      toast.error('Choose a PDF or an image');
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Only PDF, PNG, JPEG or WebP files can be shown on the archive');
      return;
    }

    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      // Timestamp-prefixed: the bucket is public, so an unpublished scan is
      // only unlisted, and a guessable path would make that meaningless.
      const path = `${FESTIVAL_SLUG}/${parsedYear}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      // Uploaded before the row that points at it, so a row never references
      // an object that does not exist yet.
      let thumbnailPath: string | null = null;
      if (cover && file.type === 'application/pdf') {
        const coverPath = `${FESTIVAL_SLUG}/${parsedYear}/cover-${Date.now()}_${cover.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: covErr } = await supabase.storage
          .from(BUCKET)
          .upload(coverPath, cover, { contentType: cover.type, upsert: false });
        if (covErr) toast.warning('Cover image failed to upload — the program will list without one.');
        else thumbnailPath = coverPath;
      }

      // Admin writes go through RLS; without .select() a blocked insert is a
      // silent 204 and the upload looks like it worked.
      const { data: inserted, error: insErr } = await supabase
        .from('festival_programs')
        .insert({
          festival_slug: FESTIVAL_SLUG,
          year: parsedYear,
          title: title.trim() || null,
          file_path: path,
          file_type: file.type === 'application/pdf' ? 'pdf' : 'image',
          display_order: parseInt(displayOrder, 10) || 0,
          is_published: false,
          uploaded_by: userData.user?.id ?? null,
          thumbnail_path: thumbnailPath,
        })
        .select('id');
      if (insErr) throw insErr;
      if (!inserted || inserted.length === 0) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw new Error('The program was not saved — you may not have admin rights.');
      }

      toast.success('Uploaded — publish it when the year is ready to show');
      setTitle(''); setFile(null); setCover(null); setDisplayOrder('0');
      setUploadOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const togglePublished = async (program: FestivalProgram) => {
    const next = !published[program.id];
    const { data, error } = await supabase
      .from('festival_programs')
      .update({ is_published: next })
      .eq('id', program.id)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error(error?.message ?? 'Nothing changed — you may not have admin rights.');
      return;
    }
    setPublished(prev => ({ ...prev, [program.id]: next }));
    toast.success(next ? 'Published to the festival page' : 'Hidden from the festival page');
  };

  const remove = async (program: FestivalProgram) => {
    const label = program.title || `${program.year} program`;
    if (!confirm(`Delete "${label}"? This removes the file as well and cannot be undone.`)) return;

    // Row first. A deleted object with a surviving row is a broken image on a
    // public page; a surviving object with no row is invisible and reclaimable.
    const { data, error } = await supabase
      .from('festival_programs')
      .delete()
      .eq('id', program.id)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error(error?.message ?? 'Nothing was deleted — you may not have admin rights.');
      return;
    }
    const { error: rmErr } = await supabase.storage
      .from(BUCKET)
      .remove([program.file_path, program.thumbnail_path].filter((p): p is string => !!p));
    if (rmErr) toast.warning('Listing removed, but the file is still in storage.');
    else toast.success('Program deleted');
    await load();
  };

  const archive = groupProgramsByYear(programs);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-2xl">Festival Programs</h3>
          <p className="text-sm text-muted-foreground font-serif">
            Scanned programs shown on the Silent Film Festival page. Uploads start
            unpublished — nothing is public until you publish it.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4 mr-2" /> Upload program
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading…</p>
      ) : archive.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>No programs yet. Upload a scan to start the archive.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {archive.map(group => (
            <div key={group.year}>
              <h4 className="font-display uppercase tracking-[0.2em] text-sm text-primary mb-3">
                {group.year}
              </h4>

              {/* One trailer per year, not per file. A year has eight scanned
                  pages and one trailer, so hanging it off a page would leave
                  seven empty boxes and no answer to which one counts. */}
              <div className="flex items-end gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <Label htmlFor={`trailer-${group.year}`} className="text-xs">
                    Trailer for {group.year} (optional)
                  </Label>
                  <Input
                    id={`trailer-${group.year}`}
                    placeholder="Paste a YouTube, Vimeo or video file link"
                    value={trailerDraft[group.year] ?? ''}
                    onChange={e => setTrailerDraft(d => ({ ...d, [group.year]: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingYear === group.year ||
                    (trailerDraft[group.year] ?? '') === (trailers[group.year] ?? '')}
                  onClick={() => saveTrailer(group.year)}
                >
                  {savingYear === group.year ? 'Saving…' : 'Save'}
                </Button>
              </div>
              <div className="grid gap-3">
                {group.programs.map(program => (
                  <Card key={program.id}>
                    <CardContent className="p-4 flex items-center gap-4">
                      <FileText className="h-8 w-8 text-accent shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display text-lg truncate">
                            {program.title || `${group.year} program`}
                          </span>
                          <Badge variant={published[program.id] ? 'default' : 'secondary'}>
                            {published[program.id] ? 'Published' : 'Draft'}
                          </Badge>
                          <Badge variant="outline">{program.file_type.toUpperCase()}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Order {program.display_order}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button variant="outline" size="sm" asChild>
                          <a href={publicUrl(program.file_path)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-1" /> Preview
                          </a>
                        </Button>
                        <Button
                          variant={published[program.id] ? 'ghost' : 'default'}
                          size="sm"
                          onClick={() => togglePublished(program)}
                        >
                          {published[program.id]
                            ? <><EyeOff className="h-4 w-4 mr-1" /> Unpublish</>
                            : <><Eye className="h-4 w-4 mr-1" /> Publish</>}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(program)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload a festival program</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="program-year">Festival year</Label>
              <Input
                id="program-year" type="number" inputMode="numeric"
                placeholder="2025" value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="program-title">Title (optional)</Label>
              <Input
                id="program-title" placeholder="e.g. Cover, or Full programme"
                value={title} onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="program-order">Display order within the year</Label>
              <Input
                id="program-order" type="number" inputMode="numeric"
                value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="program-file">PDF or image</Label>
              <Input
                id="program-file" type="file" accept={ACCEPTED.join(',')}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            {file?.type === 'application/pdf' && (
              <div>
                <Label htmlFor="program-cover">Cover image (optional)</Label>
                <Input
                  id="program-cover" type="file" accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setCover(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Shown as this program&rsquo;s thumbnail in the archive. Without one the
                  listing falls back to a document icon — the programme still opens fine.
                </p>
              </div>
            )}
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
