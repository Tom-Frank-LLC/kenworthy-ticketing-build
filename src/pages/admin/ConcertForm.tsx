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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { PosterUpload } from '@/components/admin/PosterUpload';
import { SeatTierEditor } from '@/components/admin/SeatTierEditor';

const SUBCATEGORIES = [
  { value: 'concert', label: 'Concert' },
  { value: 'stand_up_comedy', label: 'Stand-up Comedy' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'dance', label: 'Dance' },
] as const;

export default function ConcertForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== 'new';
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [genre, setGenre] = useState('');
  const [rating, setRating] = useState('');
  const [subcategory, setSubcategory] = useState<string>('concert');
  const [isActive, setIsActive] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }
    if (isEdit) {
      supabase.from('live_performances').select('*').eq('id', id).single().then(({ data }) => {
        if (data) {
          setTitle(data.title);
          setDescription(data.description || '');
          setPosterUrl(data.poster_url || '');
          setGenre(data.genre || '');
          setRating(data.rating || '');
          setSubcategory(data.subcategory || 'concert');
          setIsActive(data.is_active);
          setTrailerUrl(data.trailer_url || '');
          setIsFeatured(!!data.is_featured);
        }
      });
    }
  }, [id, isEdit, isAdmin, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const performanceData = {
      title,
      description: description || null,
      poster_url: posterUrl || null,
      genre: genre || null,
      rating: rating || null,
      subcategory: subcategory as any,
      is_active: isActive,
      trailer_url: trailerUrl || null,
      is_featured: isFeatured,
    };

    const { error } = isEdit
      ? await supabase.from('live_performances').update(performanceData).eq('id', id)
      : await supabase.from('live_performances').insert(performanceData);

    if (error) toast.error(error.message);
    else { toast.success(isEdit ? 'Performance updated!' : 'Performance created!'); navigate('/admin'); }
    setSaving(false);
  };

  if (authLoading) return null;

  return (
    <div className={`container py-8 px-4 ${isEdit ? 'max-w-4xl' : 'max-w-lg'}`}>
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mb-4">← Back</Button>
      <div className={isEdit ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display">{isEdit ? 'Edit Live Performance' : 'Add Live Performance'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input required value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Subcategory *</Label>
              <Select value={subcategory} onValueChange={setSubcategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUBCATEGORIES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
            </div>
            <PosterUpload currentUrl={posterUrl} onUrlChange={setPosterUrl} folder="live_performances" />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Genre</Label>
                <Input value={genre} onChange={e => setGenre(e.target.value)} placeholder="Classical" />
              </div>
              <div className="space-y-2">
                <Label>Rating</Label>
                <Input value={rating} onChange={e => setRating(e.target.value)} placeholder="NR" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Trailer URL</Label>
              <Input value={trailerUrl} onChange={e => setTrailerUrl(e.target.value)} placeholder="YouTube, Vimeo, or direct video URL" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Active (visible to public)</Label>
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
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update Performance' : 'Create Performance'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {isEdit && id && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display">Seat Pricing</CardTitle>
            <p className="text-xs text-muted-foreground font-serif">
              Group seats into price tiers. New showings inherit this map; staff can override per showing.
            </p>
          </CardHeader>
          <CardContent>
            <SeatTierEditor mode="production" productionType="concert" productionId={id} />
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
