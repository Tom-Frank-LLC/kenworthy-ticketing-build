import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Upload, Eye, EyeOff, Trash2, FileText, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  BOOKLET_DISPLAY_ORDER,
  FESTIVAL_SLUG,
  groupProgramsByYear,
  pageRowsForPdf,
  previousGeneratedSet,
  type FestivalProgram,
} from '@/lib/festival';
import { renderPdfPages, type RenderedPage } from '@/lib/pdfPages';

const BUCKET = 'festival-programs';

/** What the archive page can draw. Anything else is refused at the picker. */
const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

/** The festival row's editable fields, as the form holds them. */
interface FestivalDraft {
  about: string;
  betweenSeasons: boolean;
  offSeasonNote: string;
}

const EMPTY_DRAFT: FestivalDraft = { about: '', betweenSeasons: false, offSeasonNote: '' };

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
 *
 * Since the between-seasons work it also edits the festival itself — the
 * standing description and the off-season switch — because this tab is where
 * Tom already comes to manage everything else on that page.
 */
export default function FestivalProgramsTab() {
  const [programs, setPrograms] = useState<FestivalProgram[]>([]);
  // year -> trailer url, as stored. Edits are held separately so a half-typed
  // URL never looks saved.
  const [trailers, setTrailers] = useState<Record<number, string>>({});
  const [trailerDraft, setTrailerDraft] = useState<Record<number, string>>({});
  const [blurbs, setBlurbs] = useState<Record<number, string>>({});
  const [blurbDraft, setBlurbDraft] = useState<Record<number, string>>({});
  const [savingYear, setSavingYear] = useState<number | null>(null);
  // Which year the "This year" card edits. Defaults to the calendar year, which
  // is right in August and wrong in January — so it is an input, not a constant.
  const [thisYear, setThisYear] = useState<number>(() => new Date().getFullYear());
  const [heroImages, setHeroImages] = useState<Record<number, string>>({});
  const [heroFile, setHeroFile] = useState<Record<number, File | null>>({});
  const [published, setPublished] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  // What the upload is doing right now, for the button. A PDF takes long
  // enough to render and upload page by page that a bare "Uploading…" reads as
  // a hang somewhere around page twelve.
  const [progress, setProgress] = useState<string | null>(null);

  // The festival row: name is carried through the upsert, the rest is edited.
  const [festivalName, setFestivalName] = useState<string>('Kenworthy Silent Film Festival');
  const [festival, setFestival] = useState<FestivalDraft>(EMPTY_DRAFT);
  const [festivalDraft, setFestivalDraft] = useState<FestivalDraft>(EMPTY_DRAFT);
  const [savingFestival, setSavingFestival] = useState(false);

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [title, setTitle] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('festival_programs')
      .select('id, year, title, file_path, file_type, display_order, is_published, thumbnail_path, generated_from')
      .eq('festival_slug', FESTIVAL_SLUG);
    if (error) toast.error(error.message);
    const rows = (data ?? []) as Array<FestivalProgram & { is_published: boolean }>;
    setPrograms(rows);
    setPublished(Object.fromEntries(rows.map(r => [r.id, r.is_published])));

    const { data: yearRows } = await supabase
      .from('festival_years')
      .select('year, trailer_url, blurb, hero_image_path')
      .eq('festival_slug', FESTIVAL_SLUG);
    const tMap: Record<number, string> = {};
    const bMap: Record<number, string> = {};
    const hMap: Record<number, string> = {};
    for (const r of (yearRows ?? []) as Array<{
      year: number; trailer_url: string | null; blurb: string | null; hero_image_path: string | null;
    }>) {
      if (r.trailer_url) tMap[r.year] = r.trailer_url;
      if (r.blurb) bMap[r.year] = r.blurb;
      if (r.hero_image_path) hMap[r.year] = r.hero_image_path;
    }
    setTrailers(tMap);
    setTrailerDraft(tMap);
    setBlurbs(bMap);
    setBlurbDraft(bMap);
    setHeroImages(hMap);

    const { data: festivalRow, error: fErr } = await supabase
      .from('festivals')
      .select('name, about, between_seasons, off_season_note')
      .eq('slug', FESTIVAL_SLUG)
      .maybeSingle();
    if (fErr) toast.error(fErr.message);
    if (festivalRow) {
      setFestivalName(festivalRow.name);
      const draft: FestivalDraft = {
        about: festivalRow.about ?? '',
        betweenSeasons: festivalRow.between_seasons === true,
        offSeasonNote: festivalRow.off_season_note ?? '',
      };
      setFestival(draft);
      setFestivalDraft(draft);
    }

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveYear = async (year: number) => {
    const url = (trailerDraft[year] ?? '').trim();
    const blurb = (blurbDraft[year] ?? '').trim();
    setSavingYear(year);
    try {
      // The photograph first, so the row never points at an object that has not
      // finished uploading. A failed upload keeps whatever was there before.
      let heroPath: string | null = heroImages[year] ?? null;
      const file = heroFile[year];
      if (file) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `hero/${year}-${Date.now()}_${safe}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        heroPath = path;
      }
      // Upsert on (festival_slug, year): the year may have had programmes for
      // ages without ever having a row of its own.
      const { data, error } = await supabase
        .from('festival_years')
        .upsert(
          {
            festival_slug: FESTIVAL_SLUG, year,
            trailer_url: url || null,
            blurb: blurb || null,
            hero_image_path: heroPath,
          },
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
      setBlurbs(prev => {
        const next = { ...prev };
        if (blurb) next[year] = blurb; else delete next[year];
        return next;
      });
      if (heroPath) setHeroImages(prev => ({ ...prev, [year]: heroPath! }));
      setHeroFile(prev => ({ ...prev, [year]: null }));
      toast.success(`Saved ${year}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that year');
    } finally {
      setSavingYear(null);
    }
  };

  /**
   * The festival row. One save for all three fields, because the switch and
   * the note are one decision — "we are between seasons, and this is what to
   * say about it" — and saving them separately would let the page show the
   * note under a featured year for as long as the admin took to click twice.
   */
  const saveFestival = async () => {
    setSavingFestival(true);
    try {
      const about = festivalDraft.about.trim();
      const note = festivalDraft.offSeasonNote.trim();
      const { data, error } = await supabase
        .from('festivals')
        .upsert(
          {
            slug: FESTIVAL_SLUG,
            name: festivalName,
            about: about || null,
            between_seasons: festivalDraft.betweenSeasons,
            off_season_note: note || null,
          },
          { onConflict: 'slug' },
        )
        .select('slug');
      if (error) throw error;
      if (!data?.length) throw new Error('Nothing saved — you may not have admin rights.');
      const saved = { about, betweenSeasons: festivalDraft.betweenSeasons, offSeasonNote: note };
      setFestival(saved);
      setFestivalDraft(saved);
      toast.success(
        festivalDraft.betweenSeasons
          ? 'Saved — the festival page now leads with the standing description'
          : 'Saved',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the festival');
    } finally {
      setSavingFestival(false);
    }
  };

  const festivalDirty =
    festivalDraft.about !== festival.about ||
    festivalDraft.betweenSeasons !== festival.betweenSeasons ||
    festivalDraft.offSeasonNote !== festival.offSeasonNote;

  /** Trailer + blurb for one year. The same two fields wherever a year appears. */
  const YearFields = ({ year }: { year: number }) => {
    const dirty =
      (trailerDraft[year] ?? '') !== (trailers[year] ?? '') ||
      (blurbDraft[year] ?? '') !== (blurbs[year] ?? '');
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={`trailer-${year}`} className="text-xs">Trailer (optional)</Label>
          <Input
            id={`trailer-${year}`}
            placeholder="Paste a YouTube, Vimeo or video file link"
            value={trailerDraft[year] ?? ''}
            onChange={e => setTrailerDraft(d => ({ ...d, [year]: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor={`blurb-${year}`} className="text-xs">
            About this year&rsquo;s programme (optional)
          </Label>
          <RichTextEditor
            id={`blurb-${year}`}
            rows={3}
            placeholder="Shown under the festival title in place of the standing description."
            value={blurbDraft[year] ?? ''}
            onChange={blurb => setBlurbDraft(d => ({ ...d, [year]: blurb }))}
          />
        </div>
        <div>
          <Label htmlFor={`hero-${year}`} className="text-xs">
            Hero photograph (optional)
          </Label>
          <div className="flex items-center gap-3 mt-1">
            {(heroFile[year] || heroImages[year]) && (
              <img
                src={heroFile[year]
                  ? URL.createObjectURL(heroFile[year]!)
                  : publicUrl(heroImages[year])}
                alt=""
                className="w-24 h-14 rounded object-cover border border-border bg-background shrink-0"
              />
            )}
            <Input
              id={`hero-${year}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={e => setHeroFile(f => ({ ...f, [year]: e.target.files?.[0] || null }))}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Runs full width across the top of the festival page. Wide-cropped, so
            a landscape photograph of the room works best.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={savingYear === year || (!dirty && !heroFile[year])}
          onClick={() => saveYear(year)}>
          {savingYear === year ? 'Saving…' : `Save ${year}`}
        </Button>
      </div>
    );
  };

  const publicUrl = (path: string) =>
    supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  /**
   * One file in, and for a PDF a whole year out.
   *
   * A PDF is rendered to page images in the browser first (src/lib/pdfPages.ts)
   * and only then uploaded, so a booklet pdf.js cannot open costs nothing but
   * time: the upload proceeds exactly as it did before there was a renderer,
   * as a download-only PDF. When the render succeeds the year gets what the
   * import script would have given it — the PDF as the download, page one as
   * its cover, and one image row per page for the flip-through — and an
   * earlier upload of the same year's booklet is replaced rather than joined.
   *
   * The order of operations is what makes a failure anywhere leave the year
   * no worse than before: the new booklet and its pages are fully in place
   * before the old set is removed, and any step that fails after the PDF row
   * exists cleans up its own objects and downgrades to a warning.
   */
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
    setProgress(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uploadedBy = userData.user?.id ?? null;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const stamp = Date.now();
      const isPdf = file.type === 'application/pdf';
      // Timestamp-prefixed: the bucket is public, so an unpublished scan is
      // only unlisted, and a guessable path would make that meaningless.
      const path = `${FESTIVAL_SLUG}/${parsedYear}/${stamp}_${safeName}`;

      // Render before uploading anything, so a PDF that will not render is
      // known before the year has been touched.
      let pages: RenderedPage[] = [];
      let renderProblem: string | null = null;
      if (isPdf) {
        try {
          setProgress('Reading the PDF…');
          pages = await renderPdfPages(file, {
            onProgress: (done, total) => setProgress(`Rendering page ${done} of ${total}…`),
          });
        } catch (e) {
          renderProblem = e instanceof Error ? e.message : 'The PDF could not be rendered';
          pages = [];
        }
      }

      // What an earlier upload of this year's booklet left behind, read now —
      // before this upload adds rows — so the new booklet can never be in the
      // set that gets replaced.
      let stale: Array<{ id: string; file_path: string; thumbnail_path: string | null }> = [];
      if (pages.length) {
        const { data: existing } = await supabase
          .from('festival_programs')
          .select('id, file_path, thumbnail_path, generated_from')
          .eq('festival_slug', FESTIVAL_SLUG)
          .eq('year', parsedYear);
        stale = previousGeneratedSet(existing ?? []);
      }

      setProgress(isPdf ? 'Uploading the PDF…' : 'Uploading…');
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      // Page one as the cover, uploaded a second time under its own path — as
      // the import script does — so deleting a page row never blanks the
      // booklet's tile. Uploaded before the row that points at it.
      let thumbnailPath: string | null = null;
      if (pages.length) {
        const coverPath = `${FESTIVAL_SLUG}/${parsedYear}/cover-${stamp}.jpg`;
        const { error: covErr } = await supabase.storage
          .from(BUCKET)
          .upload(coverPath, pages[0].blob, { contentType: 'image/jpeg', upsert: false });
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
          // A rendered booklet takes the script's title and slot so the two
          // kinds of import read the same in this list and on the page.
          title: title.trim() || (pages.length ? `Full programme (${pages.length} pages)` : null),
          file_path: path,
          file_type: isPdf ? 'pdf' : 'image',
          display_order: pages.length ? BOOKLET_DISPLAY_ORDER : parseInt(displayOrder, 10) || 0,
          is_published: false,
          uploaded_by: uploadedBy,
          thumbnail_path: thumbnailPath,
        })
        .select('id');
      if (insErr) throw insErr;
      if (!inserted || inserted.length === 0) {
        await supabase.storage.from(BUCKET).remove([path, thumbnailPath].filter((p): p is string => !!p));
        throw new Error('The program was not saved — you may not have admin rights.');
      }
      const pdfId = inserted[0].id as string;

      // The pages. Objects first, then all the rows at once, then the old set
      // — so nothing is removed until its replacement is entirely there.
      let pageOutcome: string | null = null;
      if (pages.length) {
        const pagePaths: string[] = [];
        try {
          for (const p of pages) {
            setProgress(`Uploading page ${p.page} of ${pages.length}…`);
            const pagePath = `${FESTIVAL_SLUG}/${parsedYear}/${String(p.page).padStart(3, '0')}-${stamp}.jpg`;
            const { error } = await supabase.storage
              .from(BUCKET)
              .upload(pagePath, p.blob, { contentType: 'image/jpeg', upsert: false });
            if (error) throw error;
            pagePaths.push(pagePath);
          }
          const rows = pageRowsForPdf({
            festivalSlug: FESTIVAL_SLUG, year: parsedYear, pdfId, pagePaths,
            isPublished: false, uploadedBy,
          });
          const { data: pageRows, error: pageErr } = await supabase
            .from('festival_programs')
            .insert(rows)
            .select('id');
          if (pageErr) throw pageErr;
          if ((pageRows?.length ?? 0) !== rows.length) {
            throw new Error('the page rows were not saved');
          }

          if (stale.length) {
            setProgress('Removing the earlier upload…');
            const { data: gone, error: delErr } = await supabase
              .from('festival_programs')
              .delete()
              .in('id', stale.map(r => r.id))
              .select('id');
            if (delErr || !gone?.length) {
              pageOutcome = 'The earlier upload of this year could not be removed — delete it from the list below.';
            } else {
              await supabase.storage.from(BUCKET).remove(
                stale.flatMap(r => [r.file_path, r.thumbnail_path].filter((p): p is string => !!p)),
              );
            }
          }
        } catch (e) {
          // The booklet is saved. The flip-through is not, and nothing of the
          // earlier upload has been touched.
          if (pagePaths.length) await supabase.storage.from(BUCKET).remove(pagePaths);
          pageOutcome =
            `The PDF is saved as a download, but its pages could not be uploaded (${e instanceof Error ? e.message : 'unknown error'}). Try the upload again.`;
        }
      }

      if (renderProblem) {
        toast.warning(`Uploaded as a download only — the pages could not be rendered (${renderProblem}).`);
      } else if (pageOutcome) {
        toast.warning(pageOutcome);
      } else if (pages.length) {
        toast.success(
          `Uploaded the PDF and ${pages.length} page${pages.length === 1 ? '' : 's'}` +
          `${stale.length ? ', replacing the earlier upload' : ''} — publish them when the year is ready to show`,
        );
      } else {
        toast.success('Uploaded — publish it when the year is ready to show');
      }
      setTitle(''); setFile(null); setDisplayOrder('0');
      setUploadOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(null);
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

  /**
   * Publish or hide a whole year at once. Thirty page rows and a booklet is
   * thirty-one clicks otherwise, and a year half-published is a flip-through
   * with pages missing from the middle.
   */
  const publishYear = async (year: number, next: boolean) => {
    const ids = programs.filter(p => p.year === year).map(p => p.id);
    const { data, error } = await supabase
      .from('festival_programs')
      .update({ is_published: next })
      .in('id', ids)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error(error?.message ?? 'Nothing changed — you may not have admin rights.');
      return;
    }
    setPublished(prev => ({ ...prev, ...Object.fromEntries(data.map(r => [r.id, next])) }));
    toast.success(next ? `Published ${year}` : `Hid ${year} from the festival page`);
  };

  const remove = async (program: FestivalProgram) => {
    const label = program.title || `${program.year} program`;
    // Pages rendered from this booklet go with it — the database cascades the
    // rows, and the objects are collected here so they go too.
    const rendered = programs.filter(p => p.generated_from === program.id);
    const also = rendered.length
      ? ` This also removes the ${rendered.length} page${rendered.length === 1 ? '' : 's'} rendered from it.`
      : '';
    if (!confirm(`Delete "${label}"? This removes the file as well and cannot be undone.${also}`)) return;

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
      .remove(
        [program, ...rendered]
          .flatMap(p => [p.file_path, p.thumbnail_path])
          .filter((p): p is string => !!p),
      );
    if (rmErr) toast.warning('Listing removed, but the file is still in storage.');
    else toast.success('Program deleted');
    await load();
  };

  const archive = groupProgramsByYear(programs);

  return (
    <div className="space-y-6">
      {/* The festival itself: what the page says when no particular year is
          speaking, and whether one is. The switch is here rather than on a
          year because "nothing is on" is not a fact about any year. */}
      <CollapsibleSection id="pages.festival.about" title="About the festival" defaultOpen>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <div className="space-y-1">
              <Label htmlFor="festival-between-seasons">Festival is between seasons</Label>
              <p className="text-xs text-muted-foreground">
                On: no year is featured. The standing description leads the page,
                every year — including the one just finished — sits under Past
                Programs, and the pass and lineup are hidden. Turn it off once the
                next festival is announced; nothing about any year is lost either way.
              </p>
            </div>
            <Switch
              id="festival-between-seasons"
              checked={festivalDraft.betweenSeasons}
              onCheckedChange={v => setFestivalDraft(d => ({ ...d, betweenSeasons: v }))}
            />
          </div>
          {festivalDraft.betweenSeasons && (
            <div>
              <Label htmlFor="festival-off-season-note" className="text-xs">
                Line shown in place of the lineup (optional)
              </Label>
              <Input
                id="festival-off-season-note"
                placeholder="The next festival will be announced soon."
                value={festivalDraft.offSeasonNote}
                onChange={e => setFestivalDraft(d => ({ ...d, offSeasonNote: e.target.value }))}
              />
            </div>
          )}
          <div>
            <Label htmlFor="festival-about" className="text-xs">
              About the Festival (standing description)
            </Label>
            <RichTextEditor
              id="festival-about"
              rows={4}
              placeholder="What the festival is, for a reader who has never been."
              value={festivalDraft.about}
              onChange={about => setFestivalDraft(d => ({ ...d, about }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Shown under the festival title whenever the featured year has no
              blurb of its own, and always while the festival is between seasons.
            </p>
          </div>
          <Button size="sm" disabled={savingFestival || !festivalDirty} onClick={saveFestival}>
            {savingFestival ? 'Saving…' : 'Save festival'}
          </Button>
        </div>
      </CollapsibleSection>

      {/* This year, which has no scanned programme and therefore never appeared
          in the list below — the list is built from uploaded files. Its trailer
          and its copy are the two things that need setting before the festival,
          which is exactly when there is nothing to upload yet. */}
      <CollapsibleSection id="pages.festival.this-year" title="This year" defaultOpen>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            inputMode="numeric"
            aria-label="Festival year"
            className="w-28 h-8"
            value={thisYear}
            onChange={e => setThisYear(parseInt(e.target.value, 10) || thisYear)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Shown on the festival page above the lineup. The blurb replaces the
          standing description; leave it empty to keep that.
        </p>
        <YearFields year={thisYear} />
      </CollapsibleSection>

      <CollapsibleSection
        id="pages.festival.programs"
        title="Festival Programs"
        count={archive.length}
        description="Scanned programs shown on the Silent Film Festival page. Uploads start unpublished — nothing is public until you publish it."
        defaultOpen
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Upload program
          </Button>
        }
      >
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
            {archive.map(group => {
              const allPublished = group.programs.every(p => published[p.id]);
              return (
              <div key={group.year}>
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <h4 className="font-display uppercase tracking-[0.2em] text-sm text-primary">
                    {group.year}
                  </h4>
                  {group.programs.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => publishYear(group.year, !allPublished)}
                    >
                      {allPublished
                        ? <><EyeOff className="h-4 w-4 mr-1" /> Unpublish all of {group.year}</>
                        : <><Eye className="h-4 w-4 mr-1" /> Publish all of {group.year}</>}
                    </Button>
                  )}
                </div>

                {/* One trailer and one blurb per year, not per file. A year has
                    eight scanned pages and one of each, so hanging them off a page
                    would leave seven empty boxes and no answer to which counts. */}
                <div className="mb-3">
                  <YearFields year={group.year} />
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
                            {program.generated_from && ' · rendered from the PDF'}
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
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!uploading) setUploadOpen(open); }}>
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
            {/* A booklet's pages order themselves; the field is for loose images. */}
            {file?.type !== 'application/pdf' && (
              <div>
                <Label htmlFor="program-order">Display order within the year</Label>
                <Input
                  id="program-order" type="number" inputMode="numeric"
                  value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)}
                />
              </div>
            )}
            <div>
              <Label htmlFor="program-file">PDF or image</Label>
              <Input
                id="program-file" type="file" accept={ACCEPTED.join(',')}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            {file?.type === 'application/pdf' && (
              <p className="text-xs text-muted-foreground">
                Every page of the PDF is rendered as an image for the page-by-page
                viewer, with page one as the year&rsquo;s thumbnail, and the PDF
                itself is kept as the download. If this year already has pages
                from an earlier PDF upload, they are replaced.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? (progress ?? 'Uploading…') : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
