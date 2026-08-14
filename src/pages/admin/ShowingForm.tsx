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
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  STANDARD_MOVIE_TICKET_PRICE,
  fetchPassTypes,
  fetchShowingEligibility,
  setShowingEligibility,
  type PassTypeOption,
} from '@/lib/passEligibility';

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
  // Which passes may be redeemed at the door for this screening.
  //
  // This used to be one boolean that could only speak for every pass at once,
  // and only for movies — a trigger forced it off for anything else. Both
  // limits are gone: eligibility is a row per (pass type, showing), so a
  // festival pass can cover an event or a live performance inside its run
  // while an ordinary Tuesday film takes only the standard pass.
  const [passTypes, setPassTypes] = useState<PassTypeOption[]>([]);
  const [eligiblePassTypeIds, setEligiblePassTypeIds] = useState<string[]>([]);
  // Kept separate from the selection so unticking the box does not throw away
  // which passes were chosen — reticking it restores them, which is what an
  // admin who unticked it to look at something else expects.
  const [passEligible, setPassEligible] = useState(false);
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
      // Paged: the catalog passed 1,000 titles with the historical import, and
      // PostgREST truncates at 1,000 without an error. Ordered by title, the
      // rows it dropped were the alphabetical tail — every film from "The Marx
      // Brothers: Horse Feathers" on was simply absent from the picker, and the
      // search box could not find what had never been loaded. The secondary
      // sort on id keeps the paging stable when two titles match.
      fetchAllRows((from, to) =>
        supabase
          .from('movies')
          .select('id, title, is_active, release_year')
          .order('title')
          .order('id')
          .range(from, to)
      ),
      // events and live_performances are ~200 and ~0 rows, well under the
      // ceiling; they would need the same treatment before they approach it.
      supabase.from('events').select('id, title, ticket_type, is_active').order('title'),
      supabase.from('live_performances').select('id, title, is_active').order('title'),
      supabase.from('venues').select('id, name, has_assigned_seating, total_seats').order('name'),
      fetchPassTypes().catch(() => [] as PassTypeOption[]),
    ]).then(([moviesRes, eventsRes, concertsRes, venuesRes, types]) => {
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

      setPassTypes(types);
      // A new standard-priced movie takes the standard passes, as it always
      // did — showings.film_pass_eligible defaulted to true and nobody had to
      // think about it. Under an explicit model that default has to be stated
      // somewhere or the standard pass quietly stops working at everything
      // created from now on; this is where it is stated, in front of an admin
      // who can see it and change it.
      if (!isEdit) {
        const defaults = types.filter(t => t.is_default_for_movies && t.is_active);
        setEligiblePassTypeIds(defaults.map(t => t.id));
        setPassEligible(defaults.length > 0);
      }
    });

    if (isEdit) {
      Promise.all([
        supabase.from('showings').select('*').eq('id', id).single(),
        supabase.from('showing_price_tiers').select('*').eq('showing_id', id).order('display_order'),
        fetchShowingEligibility(id!).catch(() => [] as string[]),
      ]).then(([showingRes, tiersRes, eligibleIds]) => {
        // What is actually tagged, never a guess. An existing screening's
        // eligibility is a decision somebody already made — re-deriving it
        // from the price here would overwrite that decision on the next save.
        setEligiblePassTypeIds(eligibleIds);
        setPassEligible(eligibleIds.length > 0);

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

  /**
   * Editing the price re-applies the pass default for a movie.
   *
   * The standard pass deducts a fixed amount, so it only makes sense against
   * the standard face value: at $12 a $6 redemption gives away twice what the
   * theatre intended, and there is no version of that which is an accident
   * worth preserving. Moving the price off $8 therefore unticks the box, and
   * moving it back ticks it again.
   *
   * Deliberately not a lock. Whoever is standing here can retick it — a $10
   * screening the theatre has decided to honour passes at is a real thing, and
   * this is a default rather than a rule. The door does not consult the price
   * at all: eligibility is the rows, and the rows are what this form writes.
   *
   * Only fired by a keystroke in the price field, never on load. Recomputing
   * this while loading an existing showing would overwrite a decision somebody
   * already made, at the moment they opened the form to look at it.
   */
  const handleTicketPriceChange = (value: string) => {
    setTicketPrice(value);
    if (category !== 'movie') return;

    const isStandardPrice = parseFloat(value) === STANDARD_MOVIE_TICKET_PRICE;
    const defaults = passTypes.filter(t => t.is_default_for_movies && t.is_active);

    if (isStandardPrice) {
      // Union, not replacement: a festival pass somebody deliberately added to
      // this screening is not a casualty of correcting a typo in the price.
      setEligiblePassTypeIds(prev => [...new Set([...prev, ...defaults.map(t => t.id)])]);
      setPassEligible(true);
    } else {
      dropDefaultPasses(defaults);
    }
  };

  /**
   * Remove the standard passes from the selection, leaving anything tagged by
   * hand alone.
   *
   * Shared by the two events that invalidate the movie default — moving the
   * price off the standard fare, and switching the screening to an event or a
   * performance.
   */
  const dropDefaultPasses = (defaults: PassTypeOption[]) => {
    const defaultIds = new Set(defaults.map(t => t.id));
    const remaining = eligiblePassTypeIds.filter(passId => !defaultIds.has(passId));
    setEligiblePassTypeIds(remaining);
    setPassEligible(remaining.length > 0);
  };

  const togglePassType = (passTypeId: string) => {
    setEligiblePassTypeIds(prev =>
      prev.includes(passTypeId) ? prev.filter(p => p !== passTypeId) : [...prev, passTypeId],
    );
  };

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

    // Pass eligibility, after the showing exists so a new one has an id to
    // hang rows off. Reported rather than swallowed on failure: the showing is
    // already saved by this point, and a screening silently accepting no
    // passes is invisible until somebody is turned away at the door.
    if (showingId) {
      try {
        await setShowingEligibility(showingId, passEligible ? eligiblePassTypeIds : []);
      } catch (err) {
        toast.error(
          `Showing saved, but its pass eligibility was not stored — ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
        setSaving(false);
        return;
      }
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
              {/* Switching away from Movie drops the standard passes with it.
                  They are pre-ticked because a new film at the standard price
                  takes them; an event is not that, and carrying the tick across
                  would make a gala silently redeemable — which is precisely
                  what the trigger this replaces existed to prevent. A festival
                  pass ticked by hand stays ticked, because that is a decision
                  rather than a default. */}
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v as Category);
                  setItemId('');
                  if (v !== 'movie') {
                    dropDefaultPasses(passTypes.filter(t => t.is_default_for_movies));
                  }
                }}
              >
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
              <Input type="number" step="0.01" value={ticketPrice} onChange={e => handleTicketPriceChange(e.target.value)} />
              <p className="text-xs text-muted-foreground">Fallback price when no tiers are used</p>
            </div>

            {/* Pass eligibility. Shown for every category now: the trigger that
                forced events and live performances ineligible is gone, because
                a festival pass covering a performance inside its run is the
                point rather than drift. Which passes work here is the only
                question left, and it is asked in one place for all three. */}
            <div className="space-y-3 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={passEligible}
                  onChange={e => setPassEligible(e.target.checked)}
                  className="rounded"
                />
                <span className="font-semibold">Accept passes at the door</span>
              </label>

              {passTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No pass types exist yet. Create one under Admin → Film Passes before tagging
                  screenings.
                </p>
              ) : !passEligible ? (
                <p className="text-xs text-muted-foreground">
                  No pass is valid at this screening. Anyone presenting one is turned away at the
                  door with "not valid for this screening".
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Tick every pass that works here. A pass is valid at this screening only if it
                    is ticked — there is no default.
                  </p>
                  {passTypes.map(pt => (
                    <label
                      key={pt.id}
                      className="flex items-start gap-2 text-sm cursor-pointer rounded-md bg-secondary/40 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={eligiblePassTypeIds.includes(pt.id)}
                        onChange={() => togglePassType(pt.id)}
                        className="rounded mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{pt.name}</span>
                        {!pt.is_active && (
                          <span className="text-muted-foreground"> · no longer sold</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          ${pt.redemption_price.toFixed(2)} per admission ·{' '}
                          {pt.per_showing_use_limit === null
                            ? 'no per-screening limit'
                            : `up to ${pt.per_showing_use_limit} admission${
                                pt.per_showing_use_limit === 1 ? '' : 's'
                              } here`}
                        </span>
                      </span>
                    </label>
                  ))}
                  {eligiblePassTypeIds.length === 0 && (
                    <p className="text-xs text-amber-500">
                      Nothing ticked — this screening will accept no passes.
                    </p>
                  )}
                </div>
              )}

              {/* The price rule, stated where it can be acted on. Passes deduct
                  a fixed amount, so a screening above the standard face value
                  gives away more than intended — editing the price unticks the
                  standard passes for exactly that reason, and this says so
                  rather than leaving the change to be noticed. */}
              {category === 'movie' &&
                parseFloat(ticketPrice) !== STANDARD_MOVIE_TICKET_PRICE &&
                eligiblePassTypeIds.some(passId =>
                  passTypes.find(t => t.id === passId)?.is_default_for_movies,
                ) && (
                  <p className="text-xs text-amber-500">
                    This screening is not priced at the standard $
                    {STANDARD_MOVIE_TICKET_PRICE.toFixed(2)}, but a standard pass is still ticked.
                    A pass deducts a fixed amount whatever the seat costs — leave it only if that
                    is deliberate.
                  </p>
                )}
            </div>

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
