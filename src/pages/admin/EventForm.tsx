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

export default function EventForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== 'new';
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [genre, setGenre] = useState('');
  const [rating, setRating] = useState('');
  const [ticketType, setTicketType] = useState<'ticketed' | 'rsvp' | 'info_only'>('ticketed');
  const [rsvpUrl, setRsvpUrl] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }
    if (isEdit) {
      supabase.from('events').select('*').eq('id', id).single().then(({ data }) => {
        if (data) {
          setTitle(data.title);
          setDescription(data.description || '');
          setPosterUrl(data.poster_url || '');
          setGenre(data.genre || '');
          setRating(data.rating || '');
          setTicketType(data.ticket_type);
          setRsvpUrl(data.rsvp_url || '');
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
    const eventData = {
      title,
      description: description || null,
      poster_url: posterUrl || null,
      genre: genre || null,
      rating: rating || null,
      ticket_type: ticketType,
      rsvp_url: rsvpUrl || null,
      is_active: isActive,
      trailer_url: trailerUrl || null,
      is_featured: isFeatured,
    };

    // .select() so an RLS-filtered write (204, no error) can't pass as saved.
    const { data, error } = isEdit
      ? await supabase.from('events').update(eventData).eq('id', id).select('id')
      : await supabase.from('events').insert(eventData).select('id');

    if (error) toast.error(error.message);
    else if (!data || data.length === 0) toast.error('Nothing was saved — your account may not have permission to edit this.');
    else { toast.success(isEdit ? 'Event updated!' : 'Event created!'); navigate('/admin'); }
    setSaving(false);
  };

  if (authLoading) return null;

  return (
    <div className={`container py-8 px-4 ${isEdit && ticketType === 'ticketed' ? 'max-w-4xl' : 'max-w-lg'}`}>
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mb-4">← Back</Button>
      <div className={isEdit && ticketType === 'ticketed' ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display">{isEdit ? 'Edit Event' : 'Add Event'}</CardTitle>
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
            <PosterUpload currentUrl={posterUrl} onUrlChange={setPosterUrl} folder="events" />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Genre</Label>
                <Input value={genre} onChange={e => setGenre(e.target.value)} placeholder="Gala" />
              </div>
              <div className="space-y-2">
                <Label>Rating</Label>
                <Input value={rating} onChange={e => setRating(e.target.value)} placeholder="NR" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Ticket Type *</Label>
              <Select value={ticketType} onValueChange={(v) => setTicketType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ticketed">Ticketed (has showings)</SelectItem>
                  <SelectItem value="rsvp">RSVP (external link)</SelectItem>
                  <SelectItem value="info_only">Info Only (display only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ticketType === 'rsvp' && (
              <div className="space-y-2">
                <Label>RSVP URL</Label>
                <Input value={rsvpUrl} onChange={e => setRsvpUrl(e.target.value)} placeholder="https://..." />
              </div>
            )}
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
              {saving ? 'Saving...' : isEdit ? 'Update Event' : 'Create Event'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {isEdit && id && ticketType === 'ticketed' && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display">Seat Pricing</CardTitle>
            <p className="text-xs text-muted-foreground font-serif">
              Group seats into price tiers. New showings inherit this map; staff can override per showing.
            </p>
          </CardHeader>
          <CardContent>
            <SeatTierEditor mode="production" productionType="event" productionId={id} />
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
