import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Archive, Loader2, Search, Upload, Wand2 } from 'lucide-react';
import { parseHistoricalWorkbook } from '@/lib/parseHistoricalXlsx';

/**
 * The screened-films archive: every film the Kenworthy is recorded as having
 * shown, 1926 on (`historical_screenings`), and the movie listings made from it.
 *
 * Restored 2026-11-13 after three months switched off (see
 * deferred-archive/README.md). What changed on the way back:
 *
 *   - "Match to current movies" called an edge function that never finished
 *     (it re-read the same unmatched batch forever). It is replaced by the SQL
 *     function import_archive_listings(), which links every archive film to
 *     our listing for it, or makes an archival listing, and makes a showing
 *     per screening. Preview first: it reports what it would do and changes
 *     nothing.
 *   - "Clear archive" is gone. Archival showings cascade from their archive
 *     row, so it would now delete ten thousand showings with one confirm().
 *     The full export lives in deferred-archive/data/ if a reload is needed.
 *   - The 8,500 archive-only films are not loaded into the dashboard; they are
 *     found here, by search.
 */

const CHUNK = 500;

type Stats = { screenings: number; linked: number; archivalShowings: number; archivalFilms: number };
type ImportResult = {
  dry_run: boolean;
  films_linked_to_existing: number;
  films_linked_to_archival: number;
  movies_created: number;
  archive_rows_linked: number;
  showings_created: number;
  skipped_overlap: number;
  existing_links: { archive_title: string; film_year: number | null; movie_id: string; movie_title: string }[];
};
type ArchivalFilm = { id: string; title: string; release_year: number | null };

async function count(q: PromiseLike<{ count: number | null }>) {
  return (await q).count ?? 0;
}

export default function ArchiveTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [query, setQuery] = useState('');
  const [films, setFilms] = useState<ArchivalFilm[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const head = { count: 'exact' as const, head: true };
    const [screenings, linked, archivalShowings, archivalFilms] = await Promise.all([
      count(supabase.from('historical_screenings').select('id', head).eq('venue_name', 'Kenworthy')),
      count(supabase.from('historical_screenings').select('id', head).eq('venue_name', 'Kenworthy').not('matched_movie_id', 'is', null)),
      count(supabase.from('showings').select('id', head).eq('is_archival', true)),
      count(supabase.from('movies').select('id', head).eq('is_archival', true)),
    ]);
    setStats({ screenings, linked, archivalShowings, archivalFilms });
  }

  useEffect(() => { void refresh(); }, []);

  async function handleWorkbook(file: File) {
    setBusy('upload');
    setProgress('Reading workbook…');
    try {
      const rows = parseHistoricalWorkbook(await file.arrayBuffer());
      setProgress(`Parsed ${rows.length.toLocaleString()} screenings. Uploading…`);
      let done = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { data, error } = await supabase.from('historical_screenings').insert(slice).select('id');
        if (error) throw error;
        if ((data?.length ?? 0) !== slice.length) throw new Error('Some rows were not saved — uploading is admin-only.');
        done += slice.length;
        setProgress(`Uploaded ${done.toLocaleString()} of ${rows.length.toLocaleString()}…`);
      }
      toast.success(`Added ${rows.length.toLocaleString()} screenings. Preview the listings next.`);
      await refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed');
    } finally {
      setBusy(null);
      setProgress('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function runImport(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'import');
    setProgress(dryRun ? 'Working out what would change…' : 'Creating listings…');
    const { data, error } = await supabase.rpc('import_archive_listings', { p_dry_run: dryRun });
    setBusy(null);
    setProgress('');
    if (error) { toast.error(error.message); return; }
    const result = data as unknown as ImportResult;
    if (dryRun) {
      setPreview(result);
    } else {
      setPreview(null);
      toast.success(
        `Created ${result.movies_created.toLocaleString()} archive films and ${result.showings_created.toLocaleString()} showings.`,
      );
      await refresh();
    }
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setFilms(null); return; }
    const { data, error } = await supabase
      .from('movies')
      .select('id, title, release_year')
      .eq('is_archival', true)
      .ilike('title', `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
      .order('title')
      .limit(50);
    if (error) { toast.error(error.message); return; }
    setFilms(data ?? []);
  }

  const nothingToDo = !!preview && preview.movies_created + preview.showings_created + preview.archive_rows_linked === 0;

  const tiles: [string, number | undefined][] = [
    ['Kenworthy screenings', stats?.screenings],
    ['Linked to a listing', stats?.linked],
    ['Archive-only films', stats?.archivalFilms],
    ['Archival showings', stats?.archivalShowings],
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map(([label, n]) => (
          <Card key={label} className="glass">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="text-2xl font-display font-bold">{n == null ? '—' : n.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
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
          <CardTitle className="font-display flex items-center gap-2">
            <Wand2 className="h-5 w-5" /> Listings from the archive
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Each archive film joins our listing for it when we have one, so its history travels with
            the current film; otherwise it gets an archive listing of its own. Each screening becomes a
            showing at 7:00 PM (the archive records dates, not times) — except where we already have
            our own showing of that film, which stands. Archive listings are public on the History page
            and kept off the dashboard, box office and calendar.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => runImport(true)} disabled={!!busy}>
              Preview
            </Button>
            <Button onClick={() => runImport(false)} disabled={!!busy || !preview || nothingToDo}>
              Create listings
            </Button>
          </div>
          {preview && (
            <div className="rounded-md bg-secondary/40 p-3 text-sm space-y-1">
              {nothingToDo ? (
                <p>Everything in the archive is already listed. Nothing to do.</p>
              ) : (
                <>
                  <p>This would:</p>
                  <ul className="list-disc pl-5">
                    <li>link {preview.films_linked_to_existing.toLocaleString()} archive films to listings we already have</li>
                    <li>create {preview.movies_created.toLocaleString()} archive-only film listings</li>
                    <li>create {preview.showings_created.toLocaleString()} archival showings</li>
                    <li>leave {preview.skipped_overlap.toLocaleString()} screenings to our own existing showings</li>
                  </ul>
                  {preview.existing_links.length > 0 && (
                    <details className="pt-1">
                      <summary className="cursor-pointer">Films joining an existing listing</summary>
                      <ul className="mt-1 max-h-64 overflow-auto">
                        {preview.existing_links.map((l) => (
                          <li key={`${l.movie_id}-${l.film_year}`}>
                            {l.archive_title}{l.film_year ? ` (${l.film_year})` : ''} → {l.movie_title}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Search className="h-5 w-5" /> Find an archive film
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Bringing a film back? Open its archive listing and make it active rather than creating a new
            one — its screening history then shows on the new showing's page.
          </p>
          <form onSubmit={search} className="flex gap-2 max-w-md">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title…"
              aria-label="Search archive films by title" />
            <Button type="submit" variant="outline">Search</Button>
          </form>
          {films && (
            films.length ? (
              <ul className="space-y-1 text-sm">
                {films.map((f) => (
                  <li key={f.id}>
                    <Link to={`/admin/movies/${f.id}`} className="underline hover:text-accent">
                      {f.title}{f.release_year ? ` (${f.release_year})` : ''}
                    </Link>
                  </li>
                ))}
                {films.length === 50 && <li className="text-muted-foreground">First 50 shown — narrow the search.</li>}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No archive-only film matches.</p>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Archive className="h-5 w-5" /> Add to the archive
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload a workbook of screenings (one sheet per year, a Date column, then a column per
            theater; double features split on "/"). Rows are added to what is already here, so upload
            only screenings that are not in the archive yet. Then Preview and Create listings above.
          </p>
          <Label htmlFor="archive-upload" className="sr-only">Archive workbook</Label>
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <Input id="archive-upload" ref={fileRef} type="file" accept=".xlsx" className="max-w-sm"
              disabled={!!busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleWorkbook(f); }} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
