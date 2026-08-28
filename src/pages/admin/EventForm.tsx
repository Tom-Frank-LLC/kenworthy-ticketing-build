import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { PosterUpload } from '@/components/admin/PosterUpload';
import { GenreInput } from '@/components/admin/GenreInput';
import { formatGenres, parseGenres } from '@/lib/genres';
import { SeatTierEditor } from '@/components/admin/SeatTierEditor';
import {
  LEGACY_PERFORMANCE_TYPES,
  LIVE_EVENT_TYPES,
  TICKETING_MODES,
  type LiveEventType,
  type TicketingMode,
} from '@/lib/liveEventTypes';

/**
 * The one form for a live event.
 *
 * There were two — Add Event and Add Performance — sharing every field but one
 * each, sitting side by side in admin with nothing on screen saying which to
 * press. They are one form now, asking the two questions that actually differ:
 * what the thing is, and how people get in.
 *
 * It still serves two tables, because the rows in `live_performances` were not
 * migrated:
 *   /admin/events/new   → create in `events`
 *   /admin/events/:id   → edit an `events` row
 *   /admin/concerts/:id → edit a `live_performances` row (existing rows only)
 *
 * Everything new is written to `events`, which now carries both the type and
 * the ticketing mode. Splitting new rows across the two tables by type was the
 * obvious alternative and is wrong: `events` already holds a ballet and a
 * stand-up tour, so "performances live over there" is not true of the data,
 * and editing one would have offered a type list that excluded what it is.
 */

const PERFORMANCE_TABLE = 'live_performances';
const EVENT_TABLE = 'events';

export default function EventForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== 'new';
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, loading: authLoading } = useAuth();

  // Which table this row lives in is decided by the route, never by the form.
  // A type change cannot move a row between tables: the showings, the Square
  // link and the seat tiers all hang off its id.
  const isLegacyPerformance = location.pathname.startsWith('/admin/concerts');
  const table = isLegacyPerformance ? PERFORMANCE_TABLE : EVENT_TABLE;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [rating, setRating] = useState('');
  const [eventType, setEventType] = useState<LiveEventType | ''>('');
  const [ticketType, setTicketType] = useState<TicketingMode>('ticketed');
  const [rsvpUrl, setRsvpUrl] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [saving, setSaving] = useState(false);

  // A legacy performance row's own enum only knows the four art forms, so
  // offering it "Film screening" would fail at the database rather than here.
  const typeOptions = isLegacyPerformance
    ? LIVE_EVENT_TYPES.filter(t => LEGACY_PERFORMANCE_TYPES.includes(t.value))
    : LIVE_EVENT_TYPES;

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }
    if (!isEdit) return;

    supabase.from(table).select('*').eq('id', id).single().then(({ data }) => {
      if (!data) return;
      const row = data as any;
      setTitle(row.title);
      setDescription(row.description || '');
      setPosterUrl(row.poster_url || '');
      setGenres(parseGenres(row.genre));
      setRating(row.rating || '');
      // Both tables call it `subcategory`; only the enum behind it differs.
      setEventType((row.subcategory as LiveEventType) || '');
      setTicketType((row.ticket_type as TicketingMode) || 'ticketed');
      setRsvpUrl(row.rsvp_url || '');
      setIsActive(row.is_active);
      setTrailerUrl(row.trailer_url || '');
      setIsFeatured(!!row.is_featured);
    });
  }, [id, isEdit, isAdmin, authLoading, navigate, table]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventType) { toast.error('Choose what kind of event this is'); return; }
    setSaving(true);

    const eventData = {
      title,
      description: description || null,
      poster_url: posterUrl || null,
      genre: formatGenres(genres),
      rating: rating || null,
      subcategory: eventType,
      ticket_type: ticketType,
      // Only meaningful for RSVP. Cleared otherwise so a mode change cannot
      // leave a stale link behind that the site would still render.
      rsvp_url: ticketType === 'rsvp' ? (rsvpUrl || null) : null,
      is_active: isActive,
      trailer_url: trailerUrl || null,
      is_featured: isFeatured,
    };

    // .select() so an RLS-filtered write (204, no error) can't pass as saved.
    const { data, error } = isEdit
      ? await supabase.from(table).update(eventData as any).eq('id', id).select('id')
      : await supabase.from(EVENT_TABLE).insert(eventData as any).select('id');

    if (error) toast.error(error.message);
    else if (!data || data.length === 0) toast.error('Nothing was saved — your account may not have permission to edit this.');
    else { toast.success(isEdit ? 'Event updated!' : 'Event created!'); navigate('/admin?tab=listings'); }
    setSaving(false);
  };

  if (authLoading) return null;

  const showsSeatPricing = isEdit && !!id && ticketType === 'ticketed';

  return (
    <div className={`container py-8 px-4 ${showsSeatPricing ? 'max-w-4xl' : 'max-w-lg'}`}>
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin?tab=listings')} className="mb-4">← Back</Button>
      <div className={showsSeatPricing ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display">{isEdit ? 'Edit Event' : 'Add Event'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event-title">Title *</Label>
              <Input id="event-title" required value={title} onChange={e => setTitle(e.target.value)} />
            </div>

            {/* The two questions the old pair of buttons was really asking,
                now asked once each. They are independent: a concert people
                RSVP to is an ordinary thing, and used to be unsayable. */}
            <div className="space-y-2">
              <Label htmlFor="event-type">Type *</Label>
              <Select value={eventType} onValueChange={v => setEventType(v as LiveEventType)}>
                <SelectTrigger id="event-type"><SelectValue placeholder="What kind of event is this?" /></SelectTrigger>
                <SelectContent>
                  {typeOptions.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-ticketing">Ticketing *</Label>
              <Select value={ticketType} onValueChange={v => setTicketType(v as TicketingMode)}>
                <SelectTrigger id="event-ticketing"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TICKETING_MODES.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="font-serif text-xs text-muted-foreground">
                {TICKETING_MODES.find(m => m.value === ticketType)?.help}
              </p>
            </div>

            {ticketType === 'rsvp' && (
              <div className="space-y-2">
                <Label htmlFor="event-rsvp-url">RSVP URL</Label>
                <Input id="event-rsvp-url" value={rsvpUrl} onChange={e => setRsvpUrl(e.target.value)} placeholder="https://..." />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="event-description">Description</Label>
              <RichTextEditor
                id="event-description"
                value={description}
                onChange={setDescription}
                rows={5}
              />
            </div>
            <PosterUpload
              currentUrl={posterUrl}
              onUrlChange={setPosterUrl}
              folder={isLegacyPerformance ? 'live_performances' : 'events'}
            />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-full">
                <Label htmlFor="event-genre">Genre</Label>
                <GenreInput id="event-genre" kind="live" value={genres} onChange={setGenres} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-rating">Rating</Label>
                <Input id="event-rating" value={rating} onChange={e => setRating(e.target.value)} placeholder="NR" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-trailer">Trailer URL</Label>
              <Input id="event-trailer" value={trailerUrl} onChange={e => setTrailerUrl(e.target.value)} placeholder="YouTube, Vimeo, or direct video URL" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="event-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="event-active">Active (visible to public)</Label>
            </div>
            <div className="flex items-start gap-3 rounded-md border border-accent/30 bg-accent/5 p-3">
              <Switch id="event-featured" checked={isFeatured} onCheckedChange={setIsFeatured} />
              <div>
                <Label htmlFor="event-featured">Curator's pick</Label>
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
      {showsSeatPricing && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display">Seat Pricing</CardTitle>
            <p className="text-xs text-muted-foreground font-serif">
              Group seats into price tiers. New shows inherit this map; staff can override per show.
            </p>
          </CardHeader>
          <CardContent>
            <SeatTierEditor
              mode="production"
              productionType={isLegacyPerformance ? 'concert' : 'event'}
              productionId={id}
            />
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
