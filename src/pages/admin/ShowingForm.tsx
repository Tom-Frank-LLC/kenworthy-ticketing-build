import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { SeatTierEditor, type SeatTierEditorHandle } from '@/components/admin/SeatTierEditor';
import { instantToVenueLocalInput, venueLocalToInstant } from '@/lib/datetime';

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
  // Whether a film pass may be redeemed at the door for this screening.
  // Passes are for standard movies; premium screenings and events are not
  // covered. Events cannot be eligible at all — a database trigger forces the
  // flag off for them — so this control only ever governs movies.
  const [filmPassEligible, setFilmPassEligible] = useState(true);
  // GA or reserved seating, decided here rather than on the venue: the same
  // auditorium hosts a general-admission movie on Friday and a reserved-seat
  // performance on Saturday. This is the column the customer picker, the box
  // office, pricing and the capacity trigger all already read; until now
  // nothing wrote it, so it sat at its default and no showing was ever
  // reserved-seating. New showings default to GA.
  const [requiresSeatSelection, setRequiresSeatSelection] = useState(false);
  const [saving, setSaving] = useState(false);
  const seatEditorRef = useRef<SeatTierEditorHandle>(null);

  const [tiers, setTiers] = useState<TierRow[]>([...DEFAULT_TIERS]);
  const [useTiers, setUseTiers] = useState(true);
  const [savedShowingId, setSavedShowingId] = useState<string | null>(isEdit ? (id ?? null) : null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }

    Promise.all([
      supabase.from('movies').select('id, title, is_active, release_year').order('title'),
      supabase.from('events').select('id, title, ticket_type, is_active').order('title'),
      supabase.from('live_performances').select('id, title, is_active').order('title'),
      supabase.from('venues').select('id, name, has_assigned_seating, total_seats').order('name'),
    ]).then(([moviesRes, eventsRes, concertsRes, venuesRes]) => {
      setMovies(moviesRes.data || []);
      setEvents((eventsRes.data || []).filter((e: any) => e.ticket_type === 'ticketed'));
      setConcerts(concertsRes.data || []);
      const venueList = venuesRes.data || [];
      setVenues(venueList);
      // One venue means there is no choice to make, so don't make the admin
      // make it. Only on a new showing — auto-filling an existing showing that
      // was saved with no venue would rewrite its row on the next save without
      // anyone asking for that.
      if (!isEdit && venueList.length === 1) setVenueId(venueList[0].id);
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
          // Shown as the venue's wall clock, which is what the admin means by
          // "7:30 PM" regardless of where they are sitting. The old
          // getTimezoneOffset() shift rendered it in the browser's zone, so
          // editing a showing from a Mountain-set machine displayed it an hour
          // late — and saving then wrote that wrong hour back.
          setStartTime(instantToVenueLocalInput(data.start_time));
          setTicketPrice(String(data.ticket_price));
          setFilmPassEligible(data.film_pass_eligible ?? true);
          setRequiresSeatSelection(data.requires_seat_selection ?? false);
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

  // Inactive titles stay in the list — a film is often scheduled before it is
  // switched on — but they are labelled so it is not a silent surprise. The
  // year disambiguates remakes sharing a title (Dune, The Thing, …).
  const itemOptions = useMemo(() => currentItems.map((item: any) => {
    const hint = [
      category === 'movie' && item.release_year ? String(item.release_year) : null,
      item.is_active ? null : 'inactive',
    ].filter(Boolean).join(' · ');
    return { value: item.id, label: item.title, hint: hint || undefined };
  }), [currentItems, category]);

  // has_assigned_seating is a capability, not a policy: it says this venue has
  // a seat map in venue_seats, which is what makes the per-showing toggle
  // meaningful. It does not say every showing here is reserved seating.
  // Memoised because SeatTierEditor keys its load effect on this object. As a
  // fresh literal it changed identity on every render of this form, so typing a
  // price or a date reloaded the editor and silently threw away seats painted
  // but not yet saved.
  const seedProd = useMemo(() =>
    category === 'movie' && itemId ? { type: 'movie' as const, id: itemId }
    : category === 'event' && itemId ? { type: 'event' as const, id: itemId }
    : category === 'concert' && itemId ? { type: 'concert' as const, id: itemId }
    : undefined,
  [category, itemId]);

  const selectedVenue = venues.find((v: any) => v.id === venueId);
  const venueHasSeatMap = !!selectedVenue?.has_assigned_seating;

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

    const assignedSeating = venueHasSeatMap && requiresSeatSelection;

    // Checked before the insert below. Failing afterwards would leave a created
    // showing behind with the form still on screen, and a second press of the
    // button would create a second one.
    if (assignedSeating && seatEditorRef.current?.validate() === false) {
      setSaving(false);
      return;
    }

    const showingData: any = {
      movie_id: category === 'movie' ? itemId : null,
      event_id: category === 'event' ? itemId : null,
      concert_id: undefined,
      live_performance_id: category === 'concert' ? itemId : null,
      venue_id: venueId || null,
      // `startTime` is a naive wall clock from <input type="datetime-local">.
      // `new Date(naive)` would interpret it in the browser's zone; it has to
      // be interpreted in the venue's, or the stored instant depends on which
      // machine the admin happened to use.
      start_time: venueLocalToInstant(startTime).toISOString(),
      ticket_price: parseFloat(ticketPrice),
      film_pass_eligible: category === 'movie' && filmPassEligible,
      // Only claim reserved seating when there is a seat map to reserve from.
      // A showing flagged reserved with no seats behind it renders an empty
      // picker the buyer cannot get past.
      requires_seat_selection: venueHasSeatMap && requiresSeatSelection,
    };

    let showingId = id;

    if (isEdit) {
      const { error } = await supabase.from('showings').update(showingData).eq('id', id);
      if (error) { toast.error(error.message); setSaving(false); return; }
    } else {
      // Capacity comes from the room. showings.total_seats defaults to 200 and
      // has never been editable here, so every showing ever created has claimed
      // a 200-seat house — 65 short of the real one, which for a GA showing is
      // the sold-out ceiling the capacity trigger enforces. Set on create only:
      // on edit it is left alone, so a capacity somebody deliberately reduced
      // for a limited-seating night is not silently restored to the full house.
      if (selectedVenue?.total_seats) showingData.total_seats = selectedVenue.total_seats;
      const { data, error } = await supabase.from('showings').insert(showingData).select('id').single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      showingId = data.id;
      // Seed seat-tier template from the production, if any
      try {
        await supabase.rpc('apply_production_template_to_showing', { p_showing_id: showingId });
      } catch (_) { /* no template — fine */ }
    }

    // Seat pricing for an assigned-seating showing is written by the seat editor
    // and by nothing else. showing_seat_tiers.tier_id cascades from
    // showing_price_tiers, so the tier list below deleting and reinserting its
    // rows would take every painted seat assignment with it — which is what used
    // to happen on every press of Update Showing.
    if (assignedSeating && showingId) {
      const ok = await seatEditorRef.current?.persist(showingId);
      // `!== true` rather than `=== false`: an absent ref returns undefined, and
      // reading that as success is exactly how the seat map got silently dropped.
      // The showing itself is already saved by this point, so a failure here is
      // reported rather than pretending nothing landed.
      if (ok !== true) {
        toast.error('Showing saved, but its seat pricing could not be stored.');
        setSaving(false);
        return;
      }
    } else if (useTiers && showingId) {
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
  // The tier grid appears when this showing is actually sold as reserved
  // seating — not merely because the room has a seat map. Gating it on the
  // venue meant it showed for GA screenings, where per-seat prices are never
  // read, and the switch that would have made it meaningful did not exist.
  // Deliberately not gated on the showing existing yet. The seat map comes from
  // the venue, not the showing, so there is nothing to wait for — only the write
  // needs an id, and that happens on submit via seatEditorRef.
  const showSeatOverride = venueHasSeatMap && requiresSeatSelection;


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
              <Label htmlFor="showing-item">
                {category === 'movie' ? 'Movie' : category === 'event' ? 'Event' : 'Live Performance'} *
              </Label>
              <SearchableSelect
                id="showing-item"
                options={itemOptions}
                value={itemId}
                onChange={setItemId}
                placeholder={`Select a ${category === 'concert' ? 'live performance' : category}`}
                searchPlaceholder={`Search ${category === 'concert' ? 'live performances' : `${category}s`}…`}
              />
            </div>
            <div className="space-y-2">
              <Label>Venue</Label>
              <Select
                value={venueId}
                // Radix resets a controlled Select whose current value has no
                // matching SelectItem registered yet, and it does so by calling
                // onValueChange(''). Both paths here set the venue before the
                // list is registered — on edit the showing fetch resolves before
                // the venues fetch, and on a new showing the item is registered
                // in the same commit that sets the value — so the selection was
                // being wiped microseconds after it was made. That is why this
                // picker read as empty even for a showing that has a venue.
                // No item in this list carries an empty value, so an empty
                // emission is always Radix resetting itself and never the admin
                // making a choice; dropping it costs nothing and keeps ours.
                onValueChange={v => { if (v) setVenueId(v); }}
              >
                <SelectTrigger><SelectValue placeholder="Select a venue (optional)" /></SelectTrigger>
                <SelectContent>
                  {venues.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}{v.has_assigned_seating ? ' — seat map' : ' — no seat map'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {venues.length === 0 && (
                <p className="text-xs text-amber-500">
                  No venues exist yet. Add one under Listings → Venues.
                </p>
              )}
            </div>

            {/* Seating model. Per showing, because the same room runs a GA
                screening one night and a reserved-seat performance the next.
                Only offered when the chosen venue has a seat map to reserve
                from — without one there is nothing to pick. */}
            {venueHasSeatMap && (
              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresSeatSelection}
                    onChange={e => setRequiresSeatSelection(e.target.checked)}
                    className="rounded"
                  />
                  <span className="font-semibold">Assigned seating for this showing</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Off: general admission — buyers pick a quantity and capacity is a simple count.
                  On: buyers choose their seats from {selectedVenue?.name ?? 'the venue'}'s map.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Date & Time *</Label>
              <Input type="datetime-local" required value={startTime} onChange={e => setStartTime(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Theatre local time (Pacific), whatever your computer is set to
              </p>
            </div>
            <div className="space-y-2">
              <Label>Base Ticket Price ($)</Label>
              <Input type="number" step="0.01" value={ticketPrice} onChange={e => setTicketPrice(e.target.value)} />
              <p className="text-xs text-muted-foreground">Fallback price when no tiers are used</p>
            </div>

            {/* Film pass eligibility. Only meaningful for movies — the database
                forces it off for events and concerts regardless of what is
                submitted here, so showing the control for them would be a lie. */}
            {category === 'movie' && (
              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filmPassEligible}
                    onChange={e => setFilmPassEligible(e.target.checked)}
                    className="rounded"
                  />
                  <span className="font-semibold">Accept film passes at the door</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Standard screenings take passes. Turn this off for premium screenings — a pass
                  covers a fixed amount, so a higher-priced film gives away more than intended.
                </p>
                {filmPassEligible && parseFloat(ticketPrice) > 8 && (
                  <p className="text-xs text-amber-500">
                    This screening is priced above the standard ${'8'}.00. Passes still deduct
                    their usual amount — turn this off unless that is deliberate.
                  </p>
                )}
              </div>
            )}

            {/* Price Tiers. Hidden for assigned seating: there the tiers live in the
                seat editor, which owns both the prices and which seats carry them.
                Two writers for showing_price_tiers is what let one of them delete
                the other's work. */}
            {!(venueHasSeatMap && requiresSeatSelection) && (
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
            )}

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update Showing' : 'Create Showing'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {showSeatOverride && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display">Seat Pricing — This Showing</CardTitle>
            <p className="text-xs text-muted-foreground font-serif">
              {showingIdForEditor
                ? "Inherits the production's seat map. Any change here applies only to this showing."
                : "Paint the tiers now — they are stored when you create the showing."}
            </p>
          </CardHeader>
          <CardContent>
            <SeatTierEditor
              ref={seatEditorRef}
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
