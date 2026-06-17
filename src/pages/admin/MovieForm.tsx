import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { PosterUpload } from '@/components/admin/PosterUpload';
import { SeatTierEditor } from '@/components/admin/SeatTierEditor';

export default function MovieForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== 'new';
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [duration, setDuration] = useState(90);
  const [rating, setRating] = useState('');
  const [genre, setGenre] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [trailerUrl, setTrailerUrl] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [distributor, setDistributor] = useState('');
  const [circuit, setCircuit] = useState('');
  const [termsPercent, setTermsPercent] = useState<string>('');
  const [releaseYear, setReleaseYear] = useState<string>('');
  const [releaseLabel, setReleaseLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }
    if (isEdit) {
      supabase.from('movies').select('*').eq('id', id).single().then(({ data }) => {
        if (data) {
          setTitle(data.title);
          setDescription(data.description || '');
          setPosterUrl(data.poster_url || '');
          setDuration(data.duration_minutes);
          setRating(data.rating || '');
          setGenre(data.genre || '');
          setIsActive(data.is_active);
          setTrailerUrl(data.trailer_url || '');
          setIsFeatured(!!data.is_featured);
          setDistributor((data as any).distributor || '');
          setCircuit((data as any).circuit || '');
          setTermsPercent((data as any).terms_percent != null ? String((data as any).terms_percent) : '');
          setReleaseYear((data as any).release_year != null ? String((data as any).release_year) : '');
          setReleaseLabel((data as any).release_label || '');
        }
      });
    }
  }, [id, isEdit, isAdmin, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const movieData = {
        title,
        description: description || null,
        poster_url: posterUrl || null,
        duration_minutes: duration,
        rating: rating || null,
        genre: genre || null,
        is_active: isActive,
        trailer_url: trailerUrl || null,
        is_featured: isFeatured,
        distributor: distributor || null,
        circuit: circuit || null,
        terms_percent: termsPercent ? Number(termsPercent) : null,
        release_year: releaseYear ? Number(releaseYear) : null,
        release_label: releaseLabel || null,
      };

      const { error } = isEdit
        ? await supabase.from('movies').update(movieData).eq('id', id)
        : await supabase.from('movies').insert(movieData);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success(isEdit ? 'Movie updated!' : 'Movie created!');
        navigate('/admin');
      }
    } catch (err: any) {
      toast.error(err?.message || 'An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) return null;

  return (
    <div className={`container py-8 px-4 ${isEdit ? 'max-w-4xl' : 'max-w-lg'}`}>
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mb-4">← Back</Button>
      <div className={isEdit ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display">{isEdit ? 'Edit Movie' : 'Add Movie'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input required value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
            </div>
            <PosterUpload currentUrl={posterUrl} onUrlChange={setPosterUrl} folder="movies" />
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Duration (min)</Label>
                <Input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Rating</Label>
                <Input value={rating} onChange={e => setRating(e.target.value)} placeholder="PG-13" />
              </div>
              <div className="space-y-2">
                <Label>Genre</Label>
                <Input value={genre} onChange={e => setGenre(e.target.value)} placeholder="Drama" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Trailer URL</Label>
              <Input value={trailerUrl} onChange={e => setTrailerUrl(e.target.value)} placeholder="YouTube, Vimeo, or direct video URL" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Active</Label>
            </div>
            <div className="flex items-start gap-3 rounded-md border border-accent/30 bg-accent/5 p-3">
              <Switch checked={isFeatured} onCheckedChange={setIsFeatured} />
              <div>
                <Label>Curator's pick</Label>
                <p className="font-serif text-xs text-muted-foreground mt-1">
                  Highlight this on the homepage as the featured production. Doesn't change calendar order.
                </p>
              </div>
            </div>
            <div className="space-y-3 rounded-md border border-border/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Distributor info (for Comscore box office receipts)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Distributor</Label>
                  <Input value={distributor} onChange={e => setDistributor(e.target.value)} placeholder="Warner Bros." />
                </div>
                <div className="space-y-1">
                  <Label>Circuit / Buyer</Label>
                  <Input value={circuit} onChange={e => setCircuit(e.target.value)} placeholder="Clark Film Buying" />
                </div>
                <div className="space-y-1">
                  <Label>Terms %</Label>
                  <Input type="number" step="0.01" value={termsPercent} onChange={e => setTermsPercent(e.target.value)} placeholder="35" />
                </div>
                <div className="space-y-1">
                  <Label>Release Year</Label>
                  <Input type="number" value={releaseYear} onChange={e => setReleaseYear(e.target.value)} placeholder="1986" />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Release Label</Label>
                  <Input value={releaseLabel} onChange={e => setReleaseLabel(e.target.value)} placeholder="2D / Default" />
                </div>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update Movie' : 'Create Movie'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {isEdit && id && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display">Seat Pricing</CardTitle>
            <p className="text-xs text-muted-foreground font-serif">
              Group seats into price tiers. New showings of this movie inherit this map; staff can override it on any single showing.
            </p>
          </CardHeader>
          <CardContent>
            <SeatTierEditor mode="production" productionType="movie" productionId={id} />
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
