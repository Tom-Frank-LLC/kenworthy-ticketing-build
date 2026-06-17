import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { SeatTierEditor } from '@/components/admin/SeatTierEditor';

type Category = 'movie' | 'event' | 'concert';

interface TierRow {
  id?: string;
  tier_name: string;
  price: string;
  display_order: number;
}

const DEFAULT_TIERS: TierRow[] = [
  { tier_name: 'Adult', price: '8.00', display_order: 0 },
  { tier_name: 'Child', price: '5.00', display_order: 1 },
  { tier_name: 'Student', price: '6.00', display_order: 2 },
];

export default function ShowingForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== 'new';
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();

  const [category, setCategory] = useState<Category>('movie');
  const [movies, setMovies] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [concerts, setConcerts] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);

  const [itemId, setItemId] = useState('');
  const [venueId, setVenueId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [ticketPrice, setTicketPrice] = useState('8.00');
  const [saving, setSaving] = useState(false);

  const [tiers, setTiers] = useState<TierRow[]>([...DEFAULT_TIERS]);
  const [useTiers, setUseTiers] = useState(true);
  const [savedShowingId, setSavedShowingId] = useState<string | null>(isEdit ? (id ?? null) : null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }

    Promise.all([
      supabase.from('movies').select('id, title, is_active').order('title'),
      supabase.from('events').select('id, title, ticket_type, is_active').order('title'),
      supabase.from('live_performances').select('id, title, is_active').order('title'),
      supabase.from('venues').select('id, name, has_assigned_seating').order('name'),
    ]).then(([moviesRes, eventsRes, concertsRes, venuesRes]) => {
      setMovies(moviesRes.data || []);
      setEvents((eventsRes.data || []).filter((e: any) => e.ticket_type === 'ticketed'));
      setConcerts(concertsRes.data || []);
      setVenues(venuesRes.data || []);
    });

    if (isEdit) {
      Promise.all([
        supabase.from('showings').select('*').eq('id', id).single(),
        supabase.from('showing_price_tiers').select('*').eq('showing_id', id).order('display_order'),
      ]).then(([showingRes, tiersRes]) => {
        const data = showingRes.data;
        if (data) {
          if (data.movie_id) { setCategory('movie'); setItemId(data.movie_id); }
          else if (data.event_id) { setCategory('event'); setItemId(data.event_id); }
          else if (data.live_performance_id) { setCategory('concert'); setItemId(data.live_performance_id); }
          setVenueId(data.venue_id || '');
          const dt = new Date(data.start_time);
          const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
            .toISOString().slice(0, 16);
          setStartTime(local);
          setTicketPrice(String(data.ticket_price));
        }

        const tierData = tiersRes.data || [];
        if (tierData.length > 0) {
          setUseTiers(true);
          setTiers(tierData.map((t: any) => ({
            id: t.id,
            tier_name: t.tier_name,
            price: String(t.price),
            display_order: t.display_order,
          })));
        } else {
          setUseTiers(false);
          setTiers([...DEFAULT_TIERS]);
        }
      });
    }
  }, [id, isEdit, isAdmin, authLoading, navigate]);

  const currentItems = category === 'movie' ? movies
    : category === 'event' ? events
    : concerts;

  const addTier = () => {
    setTiers(prev => [...prev, { tier_name: '', price: '8.00', display_order: prev.length }]);
  };

  const removeTier = (index: number) => {
    setTiers(prev => prev.filter((_, i) => i !== index));
  };

  const updateTier = (index: number, field: 'tier_name' | 'price', value: string) => {
    setTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemId) { toast.error('Please select an item'); return; }
    setSaving(true);

    const showingData: any = {
      movie_id: category === 'movie' ? itemId : null,
      event_id: category === 'event' ? itemId : null,
      concert_id: undefined,
      live_performance_id: category === 'concert' ? itemId : null,
      venue_id: venueId || null,
      start_time: new Date(startTime).toISOString(),
      ticket_price: parseFloat(ticketPrice),
    };

    let showingId = id;

    if (isEdit) {
      const { error } = await supabase.from('showings').update(showingData).eq('id', id);
      if (error) { toast.error(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('showings').insert(showingData).select('id').single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      showingId = data.id;
      // Seed seat-tier template from the production, if any
      try {
        await supabase.rpc('apply_production_template_to_showing', { p_showing_id: showingId });
      } catch (_) { /* no template — fine */ }
    }

    // Save price tiers
    if (useTiers && showingId) {
      // Delete existing tiers for this showing
      await supabase.from('showing_price_tiers').delete().eq('showing_id', showingId);

      const validTiers = tiers.filter(t => t.tier_name.trim());
      if (validTiers.length > 0) {
        const { error: tierError } = await supabase.from('showing_price_tiers').insert(
          validTiers.map((t, i) => ({
            showing_id: showingId!,
            tier_name: t.tier_name.trim(),
            price: parseFloat(t.price),
            display_order: i,
          }))
        );
        if (tierError) { toast.error('Showing saved but tiers failed: ' + tierError.message); setSaving(false); return; }
      }
    } else if (isEdit && showingId) {
      // Remove tiers if user unchecked
      await supabase.from('showing_price_tiers').delete().eq('showing_id', showingId);
    }

    toast.success(isEdit ? 'Showing updated!' : 'Showing created!');
    if (!isEdit && showingId) {
      setSavedShowingId(showingId);
      navigate(`/admin/showings/${showingId}`, { replace: true });
    } else {
      navigate('/admin');
    }
    setSaving(false);
  };

  if (authLoading) return null;

  const showingIdForEditor = savedShowingId ?? (isEdit ? id ?? null : null);
  const venueForEditor = venues.find(v => v.id === venueId);
  const showSeatOverride = !!showingIdForEditor && !!venueForEditor?.has_assigned_seating;

  const seedProd = category === 'movie' && itemId ? { type: 'movie' as const, id: itemId }
    : category === 'event' && itemId ? { type: 'event' as const, id: itemId }
    : category === 'concert' && itemId ? { type: 'concert' as const, id: itemId }
    : undefined;

  return (
    <div className={`container py-8 px-4 ${showSeatOverride ? 'max-w-4xl' : 'max-w-lg'}`}>
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mb-4">← Back</Button>
      <div className={showSeatOverride ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display">{isEdit ? 'Edit Showing' : 'Add Showing'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v as Category); setItemId(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="movie">Movie</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                  <SelectItem value="concert">Live Performance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{category === 'movie' ? 'Movie' : category === 'event' ? 'Event' : 'Live Performance'} *</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger><SelectValue placeholder={`Select a ${category}`} /></SelectTrigger>
                <SelectContent>
                  {currentItems.map((item: any) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}{!item.is_active ? ' (inactive)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Venue</Label>
              <Select value={venueId} onValueChange={setVenueId}>
                <SelectTrigger><SelectValue placeholder="Select a venue (optional)" /></SelectTrigger>
                <SelectContent>
                  {venues.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}{v.has_assigned_seating ? ' (Assigned Seats)' : ' (GA)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date & Time *</Label>
              <Input type="datetime-local" required value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Base Ticket Price ($)</Label>
              <Input type="number" step="0.01" value={ticketPrice} onChange={e => setTicketPrice(e.target.value)} />
              <p className="text-xs text-muted-foreground">Fallback price when no tiers are used</p>
            </div>

            {/* Price Tiers */}
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Price Tiers</Label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useTiers}
                    onChange={e => setUseTiers(e.target.checked)}
                    className="rounded"
                  />
                  Enable tiered pricing
                </label>
              </div>
              {useTiers && (
                <div className="space-y-2">
                  {tiers.map((tier, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder="Tier name (e.g. Adult)"
                        value={tier.tier_name}
                        onChange={e => updateTier(i, 'tier_name', e.target.value)}
                        className="flex-1"
                      />
                      <div className="relative w-24">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={tier.price}
                          onChange={e => updateTier(i, 'price', e.target.value)}
                          className="pl-6"
                        />
                      </div>
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeTier(i)} className="shrink-0">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addTier} className="w-full">
                    <Plus className="h-4 w-4 mr-1" /> Add Tier
                  </Button>
                </div>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update Showing' : 'Create Showing'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {showSeatOverride && showingIdForEditor && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display">Seat Pricing — This Showing</CardTitle>
            <p className="text-xs text-muted-foreground font-serif">
              Inherits the production's seat map. Any change here applies only to this showing.
            </p>
          </CardHeader>
          <CardContent>
            <SeatTierEditor
              mode="showing"
              showingId={showingIdForEditor}
              venueId={venueId || undefined}
              seedFromProduction={seedProd}
            />
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
