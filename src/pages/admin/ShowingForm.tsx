import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import {
  formatRuntime,
  formatShowtime,
  instantToVenueLocalInput,
  venueLocalToInstant,
} from '@/lib/datetime';
import { DEFAULT_SHOWING_MINUTES } from '@/lib/purchasable';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { squareSaveOutcome } from '@/lib/squareLink';
import {
  findCollidingRowIndexes,
  findDuplicateRowIndexes,
  initialShowtimeRows,
  makeShowtimeRow,
  nextShowtimeValue,
  plannedShowtimes,
  summarizeBatch,
  summarizeSquareOutcomes,
  type BatchSummary,
  type ShowtimeOutcome,
  type SquareBatchEntry,
} from '@/lib/showtimeBatch';
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

/**
 * Which categories the picker may offer, from `?kind=`.
 *
 * The listings are two separate screens and a showing belongs to exactly one
 * of them, so the form no longer offers all three from both. Opened from
 * Movies it is a movie; opened from Live Events it is an event or a
 * performance and never a film. The old single selector listing all three was
 * the reason dating a concert began in the Movies tab.
 */
const KIND_CATEGORIES: Record<string, Category[]> = {
  movie: ['movie'],
  live: ['event', 'concert'],
};

/** `?movie=` / `?event=` / `?performance=` → the category each one scopes to. */
const SCOPE_PARAMS: { param: string; category: Category }[] = [
  { param: 'movie', category: 'movie' },
  { param: 'event', category: 'event' },
  { param: 'performance', category: 'concert' },
];

/**
 * Read the production this form was deep-linked to, if any.
 *
 * The listings open this form from a specific title's card, so the item is
 * already decided by the time the admin gets here. Before this, every new
 * showing started at "Movie" with an empty picker no matter where it was
 * opened from, which is why a concert could only be dated by going to the
 * Movies tab and hunting for it in a category selector.
 *
 * Edit mode ignores the params entirely: the showing's own row already says
 * what it is attached to, and letting a URL argue with it is how a showing
 * gets silently reparented.
 */
function readScope(params: URLSearchParams): { category: Category; itemId: string } | null {
  for (const { param, category } of SCOPE_PARAMS) {
    const itemId = params.get(param);
    if (itemId) return { category, itemId };
  }
  return null;
}

export default function ShowingForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== 'new';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin, loading: authLoading } = useAuth();

  // Read once, on the first render. A useState initialiser rather than an
  // effect so the form never paints as an unscoped "Movie" form for a frame,
  // and — more importantly — so the loader below can see the scope when it
  // decides whether to pre-tick the standard film passes.
  const [scope, setScope] = useState(() => (isEdit ? null : readScope(searchParams)));

  // Which listing sent us here. Narrows the picker even when no single title
  // was named — "Add Show" from Live Events offers events and performances,
  // and nothing else.
  const allowedCategories = (!isEdit && KIND_CATEGORIES[searchParams.get('kind') ?? '']) || null;

  const [category, setCategory] = useState<Category>(
    scope?.category ?? allowedCategories?.[0] ?? 'movie',
  );
  // A movie has showings; an event has shows. Same row, same table — the word
  // follows the listing it was opened from so the two screens read like the
  // two things they are.
  const noun = category === 'movie' ? 'showing' : 'show';
  const Noun = category === 'movie' ? 'Showing' : 'Show';

  const [movies, setMovies] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [concerts, setConcerts] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);

  const [itemId, setItemId] = useState(scope?.itemId ?? '');
  const [venueId, setVenueId] = useState('');
  // Edit mode edits the one showing it opened, so it keeps the single field.
  // Create mode builds a list instead: every other field on this form is shared
  // config, so scheduling a four-night run meant filling all of it four times
  // and getting it identical four times.
  const [startTime, setStartTime] = useState('');
  const [showtimeRows, setShowtimeRows] = useState(initialShowtimeRows);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  // Venue-local wall clocks the chosen venue already has a showing at, for the
  // collision hint. A warning and never a block — see findCollidingRowIndexes.
  const [existingShowtimes, setExistingShowtimes] = useState<ReadonlySet<string>>(new Set());
  const batchSummaryRef = useRef<HTMLDivElement>(null);
  const [ticketPrice, setTicketPrice] = useState('8.00');
  // How long this showing runs. Blank means "ask the production", which is the
  // right answer for almost every film and no answer at all for an event — see
  // the field itself, below, and showing_ends_at() in the database.
  const [durationMinutes, setDurationMinutes] = useState('');
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
  // "Free" comes in two kinds and this is the switch between them. Off, a $0
  // showing still issues a free ticket and holds a seat (an RSVP). On, it
  // issues nothing at all — doors open, walk in. See src/lib/purchasable.ts.
  const [noTicketRequired, setNoTicketRequired] = useState(false);
  // Closed to online sales by hand, whatever the seat count says — the house
  // filled through a channel this system cannot count. Not capacity: the
  // arithmetic that hides the buy button when the seats really do run out is
  // unrelated and still runs. See src/lib/purchasable.ts.
  const [manuallySoldOut, setManuallySoldOut] = useState(false);
  // Optional replacement for the standard notice. Kept when the showing is
  // reopened, so a run that sells out every Saturday keeps its sentence.
  const [soldOutMessageText, setSoldOutMessageText] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
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
          .select('id, title, is_active, release_year, duration_minutes')
          .order('title')
          .order('id')
          .range(from, to)
      ),
      // events and live_performances are ~200 and ~0 rows, well under the
      // ceiling; they would need the same treatment before they approach it.
      supabase.from('events').select('id, title, ticket_type, is_active').order('title'),
      supabase.from('live_performances').select('id, title, ticket_type, is_active').order('title'),
      supabase.from('venues').select('id, name, has_assigned_seating, total_seats').order('name'),
      fetchPassTypes().catch(() => [] as PassTypeOption[]),
    ]).then(([moviesRes, eventsRes, concertsRes, venuesRes, types]) => {
      // Only ticketed events can carry a showing: an RSVP or info-only event
      // is dated by its external link, or not dated at all.
      const ticketedEvents = (eventsRes.data || []).filter((e: any) => e.ticket_type === 'ticketed');
      // The same rule for performances now that they carry a ticketing mode:
      // before, the column did not exist and every row was ticketed by
      // default, so this filter changes nothing for the rows already there.
      const ticketedConcerts = (concertsRes.data || []).filter((c: any) => c.ticket_type === 'ticketed');
      setMovies(moviesRes.data || []);
      setEvents(ticketedEvents);
      setConcerts(ticketedConcerts);

      // A hand-edited URL can name a title this picker never lists — a
      // non-ticketed event, say. Dropping the scope puts the selectors back,
      // rather than presenting an empty picker with nothing reachable in it.
      if (scope) {
        const scopedList = scope.category === 'movie' ? (moviesRes.data || [])
          : scope.category === 'event' ? ticketedEvents
          : ticketedConcerts;
        if (!scopedList.some((row: any) => row.id === scope.itemId)) {
          setScope(null);
          setItemId('');
          toast.error(`That title cannot take a ${noun} — choose one below.`);
        }
      }
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
      //
      // Movies only. Switching the category by hand drops these again (see the
      // Category select), so opening the form pre-scoped to an event or a
      // performance has to skip them in the first place — otherwise the one
      // path that never touches the selector is the one path that leaves a
      // gala silently redeemable against a film pass.
      if (!isEdit && category === 'movie') {
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
          setDurationMinutes(data.duration_minutes ? String(data.duration_minutes) : '');
          setRequiresSeatSelection(data.requires_seat_selection ?? false);
          setNoTicketRequired(data.no_ticket_required ?? false);
          setManuallySoldOut(data.manually_sold_out ?? false);
          setSoldOutMessageText(data.sold_out_message ?? '');
          setIsFeatured(data.is_featured ?? false);
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

  // What a blank duration field will actually mean. Mirrors the fallback chain
  // in showing_ends_at() and in resolveDurationMinutes(): the film's own
  // runtime if there is one, otherwise the default. Shown as the placeholder
  // so the admin can see the assumption rather than having to know it.
  const selectedMovieRuntime =
    category === 'movie'
      ? Number(movies.find((m: any) => m.id === itemId)?.duration_minutes) || null
      : null;
  const durationInheritedFrom: 'movie' | 'default' = selectedMovieRuntime ? 'movie' : 'default';
  const inheritedDuration = selectedMovieRuntime ?? DEFAULT_SHOWING_MINUTES;

  // The field takes a total because that is what the column stores, but the
  // listing reads it back as hours + minutes. Echoing the patron-facing string
  // is what turns a slipped digit into something visible at entry rather than
  // on the live site. Empty while the field is blank, which is the state that
  // means "inherit" — the sentence below explains that case instead.
  const durationEcho = formatRuntime(Number(durationMinutes));

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

  const updateShowtime = (index: number, value: string) => {
    setShowtimeRows(prev => prev.map((r, i) => (i === index ? { ...r, value } : r)));
  };

  /** Append a row — blank, or offset from the last dated one to build a run. */
  const addShowtime = (offsetDays?: number) => {
    setShowtimeRows(prev => [
      ...prev,
      makeShowtimeRow(offsetDays ? nextShowtimeValue(prev, offsetDays) : ''),
    ]);
  };

  const removeShowtime = (index: number) => {
    // Never leave the list empty: an admin who removed the last row would be
    // looking at a form with nowhere to type a date and a button that refuses.
    setShowtimeRows(prev => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const plannedRows = useMemo(() => plannedShowtimes(showtimeRows), [showtimeRows]);
  const duplicateRows = useMemo(() => findDuplicateRowIndexes(showtimeRows), [showtimeRows]);
  const collidingRows = useMemo(
    () => findCollidingRowIndexes(showtimeRows, existingShowtimes),
    [showtimeRows, existingShowtimes],
  );
  const plannedKey = useMemo(() => plannedRows.join('|'), [plannedRows]);

  /**
   * What the venue already has at exactly these instants.
   *
   * An `in` filter on the exact timestamps rather than a range scan across the
   * days involved: the result is at most one row per showtime asked about, so
   * there is nothing for PostgREST's silent 1,000-row cap to truncate and no
   * window to get wrong. The cost is that it only notices an exact match — a
   * 7:35 showing is not reported as clashing with a 7:30 one — which is the
   * right granularity for a hint about double-booking a room.
   *
   * Admins and staff see every showing through the SELECT policy on `showings`,
   * so unlike an anon read this one is not quietly looking at a fraction of the
   * table and calling the rest free.
   */
  useEffect(() => {
    if (isEdit || !venueId || !plannedKey) { setExistingShowtimes(new Set()); return; }
    let cancelled = false;
    // Debounced: <input type="datetime-local"> fires onChange for every
    // component as it is typed, so an undebounced query would run several times
    // per showtime for a hint nobody reads until they have stopped typing.
    const timer = setTimeout(() => {
      const instants = plannedKey.split('|').map(v => venueLocalToInstant(v).toISOString());
      supabase
        .from('showings')
        .select('start_time, is_active')
        .eq('venue_id', venueId)
        .in('start_time', instants)
        .then(({ data, error }) => {
          if (cancelled || error) return;
          setExistingShowtimes(
            new Set(
              (data || [])
                // A cancelled showing is not something to warn about clashing
                // with — the slot it used to hold is free again.
                .filter((row: any) => row.is_active !== false)
                .map((row: any) => instantToVenueLocalInput(row.start_time)),
            ),
          );
        });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isEdit, venueId, plannedKey]);

  /**
   * Bring the batch summary into view when there is one.
   *
   * It renders above a form the admin is scrolled to the *bottom* of — they
   * have just pressed Create, which is the last control on the page. Without
   * this the panel appears off-screen behind them and the only thing they can
   * actually see is their filled-in fields going blank.
   */
  useEffect(() => {
    if (batchSummary) batchSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [batchSummary]);

  const addTier = () => {
    setTiers(prev => [...prev, { tier_name: '', price: '8.00', display_order: prev.length }]);
  };

  const removeTier = (index: number) => {
    setTiers(prev => prev.filter((_, i) => i !== index));
  };

  const updateTier = (index: number, field: 'tier_name' | 'price', value: string) => {
    setTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  /**
   * Is this showing free, in the sense the no-ticket flag requires?
   *
   * Not just `ticketPrice === 0`. A base price of 0 with a $8 Adult tier is a
   * priced showing — the tier is what buyers actually pay, and the base is the
   * fallback nobody reaches. The database says the same thing in two halves:
   * a CHECK on ticket_price, and a trigger on showing_price_tiers.
   *
   * NaN from a half-typed price reads as not-free, which errs towards hiding
   * the option rather than towards offering a state the save would refuse.
   */
  const priceIsZero = (parseFloat(ticketPrice) || 0) === 0;
  const hasPricedTier = useTiers && tiers.some(t => (parseFloat(t.price) || 0) > 0);
  const isFreeShowing = priceIsZero && !hasPricedTier;

  /**
   * The flag as it will actually be saved.
   *
   * Derived rather than read straight from the radio, so that a price typed in
   * after the box was ticked silently wins. The alternative — an effect that
   * unticks the box on every keystroke — fights the admin mid-edit, and the box
   * is not on screen in that state anyway.
   *
   * One value for the whole submit, batch included: "these settings apply to
   * every showtime" has to cover this one too, or a run of free nights would
   * come out half ticketed.
   */
  const noTicket = noTicketRequired && isFreeShowing;

  /**
   * The shared config one showing is written from, plus the date it is for.
   *
   * Built per showtime rather than held as one object, but from the same state
   * every time, so a batch cannot end up with four showings that disagree about
   * the price. Everything here except `start_time` is what the UI calls "these
   * settings apply to every showtime".
   */
  const buildShowingData = (naiveStartTime: string): any => ({
    movie_id: category === 'movie' ? itemId : null,
    event_id: category === 'event' ? itemId : null,
    concert_id: undefined,
    live_performance_id: category === 'concert' ? itemId : null,
    venue_id: venueId || null,
    // A naive wall clock from <input type="datetime-local">. `new Date(naive)`
    // would interpret it in the browser's zone; it has to be interpreted in the
    // venue's, or the stored instant depends on which machine the admin used.
    start_time: venueLocalToInstant(naiveStartTime).toISOString(),
    // The CHECK on showings refuses the flag alongside a price, and it is right
    // to. Sent as an explicit zero rather than trusting the admin to have
    // cleared the box: the two fields state one decision, and letting them
    // disagree turns a deliberate choice into a save that fails.
    ticket_price: noTicket ? 0 : parseFloat(ticketPrice),
    // Blank clears the override rather than storing 0 — NULL is what makes
    // showing_ends_at() fall through to the film's own runtime, and the
    // column's CHECK constraint refuses a zero or negative anyway.
    duration_minutes: durationMinutes.trim() === '' ? null : parseInt(durationMinutes, 10),
    // Only claim reserved seating when there is a seat map to reserve from.
    // A showing flagged reserved with no seats behind it renders an empty
    // picker the buyer cannot get past.
    // A walk-in showing has no seats to reserve — there is no ticket to attach
    // one to. Forced rather than merely hidden, so that flipping an
    // assigned-seating showing to no-ticket does not leave a seat map behind
    // that the page would try to render with nothing to sell from it.
    requires_seat_selection: !noTicket && venueHasSeatMap && requiresSeatSelection,
    is_featured: isFeatured,
    no_ticket_required: noTicket,
    // Forced false on a walk-in night, for the same reason the price and the
    // seat flag are: a showing that issues no tickets cannot sell out of them,
    // and leaving a stale true behind would print "Sold Out" over a screening
    // anyone can attend. The readers guard against it too — this is the half
    // that stops the contradiction being written down.
    manually_sold_out: !noTicket && manuallySoldOut,
    // Blank clears it rather than storing an empty string, so the page falls
    // back to the standard notice instead of rendering a sentence with nothing
    // in it. Written whatever the flag says: the text outlives a reopening.
    sold_out_message: soldOutMessageText.trim() === '' ? null : soldOutMessageText.trim(),
  });

  /**
   * Seat pricing, price tiers and pass eligibility for one showing that exists.
   *
   * Extracted rather than duplicated: edit mode and every row of a create batch
   * run exactly this, so the two cannot drift into disagreeing about what a
   * saved showing is owed.
   *
   * Returns null when everything landed, and otherwise both wordings for the
   * same fact — the sentence the single-showing form has always shown, and the
   * phrase the batch summary prints beside the datetime it belongs to. A
   * nullable failure rather than an `ok` union because this project compiles
   * with `strict: false`, where a boolean discriminant does not narrow.
   */
  const applySideEffects = async (
    showingId: string,
    assignedSeating: boolean,
  ): Promise<{ message: string; detail: string } | null> => {
    // Seat pricing for an assigned-seating showing is written by the seat editor
    // and by nothing else. showing_seat_tiers.tier_id cascades from
    // showing_price_tiers, so the tier list below deleting and reinserting its
    // rows would take every painted seat assignment with it — which is what used
    // to happen on every press of Update Showing.
    //
    // The editor writes from its own painted state to whichever showing id it
    // is handed and never reads the showing back, so one painted map applies to
    // every showing in a batch. That is what "these settings apply to every
    // showtime" has to mean for a room with assigned seats, and it is why a
    // reserved run does not have to be created a night at a time.
    if (noTicket) {
      // Cleared, not merely skipped. A showing flipped from tiered-and-priced
      // to walk-in would otherwise keep its old tiers: dead rows that sell
      // nothing (the checkout refuses the showing outright) but that make the
      // showing read as priced the next time this form loads it.
      //
      // This runs *after* the showings write above, which is why the database
      // guards only the tier side of the rule — a trigger on `showings` would
      // refuse the flag for tiers that this very next statement deletes.
      await supabase.from('showing_price_tiers').delete().eq('showing_id', showingId);
    } else if (assignedSeating) {
      const ok = await seatEditorRef.current?.persist(showingId);
      // `!== true` rather than `=== false`: an absent ref returns undefined, and
      // reading that as success is exactly how the seat map got silently dropped.
      if (ok !== true) {
        return {
          message: 'Showing saved, but its seat pricing could not be stored.',
          detail: 'seat pricing was not stored',
        };
      }
    } else if (useTiers) {
      // Not redundant on a brand-new showing: the production template RPC may
      // have just seeded tiers, and these replace them.
      await supabase.from('showing_price_tiers').delete().eq('showing_id', showingId);

      const validTiers = tiers.filter(t => t.tier_name.trim());
      if (validTiers.length > 0) {
        const { error: tierError } = await supabase.from('showing_price_tiers').insert(
          validTiers.map((t, i) => ({
            showing_id: showingId,
            tier_name: t.tier_name.trim(),
            price: parseFloat(t.price),
            display_order: i,
          }))
        );
        if (tierError) {
          return {
            message: 'Showing saved but tiers failed: ' + tierError.message,
            detail: `price tiers failed — ${tierError.message}`,
          };
        }
      }
    } else if (isEdit) {
      // Remove tiers if user unchecked
      await supabase.from('showing_price_tiers').delete().eq('showing_id', showingId);
    }

    // Pass eligibility, after the showing exists so a new one has an id to
    // hang rows off. Reported rather than swallowed on failure: the showing is
    // already saved by this point, and a screening silently accepting no
    // passes is invisible until somebody is turned away at the door.
    try {
      // Never on a walk-in showing. A pass admission is a ticket row with a
      // deduction against it, and the trigger refuses that row — so a pass
      // scanned at a screening tagged this way would fail at the door with a
      // raw database error instead of a verdict the scanner can render.
      // Cleared here, at the only place that tags a screening, rather than
      // special-cased inside admit_with_film_pass().
      await setShowingEligibility(
        showingId,
        !noTicket && passEligible ? eligiblePassTypeIds : [],
      );
    } catch (err) {
      const why = err instanceof Error ? err.message : 'unknown error';
      return {
        message: `Showing saved, but its pass eligibility was not stored — ${why}`,
        detail: `pass eligibility was not stored — ${why}`,
      };
    }

    return null;
  };

  /**
   * Give one showing its Square variations, so a sale can carry a
   * catalog_object_id and land in item-sales under the right category.
   *
   * After the save and deliberately non-blocking. The catalog write is
   * append-only and read back before it counts, but Square locks the catalog
   * during an upsert and answers 429 while it is held — that is a reason to
   * tell somebody, never a reason to lose a showing they just filled in. A
   * failure leaves the showing sellable as an ad-hoc line and the batch job
   * picks it up later.
   */
  const runSquareEnsure = async (showingId: string): Promise<SquareBatchEntry | null> => {
    // Nothing will ever sell against a walk-in showing, so it gets no catalog
    // item. A $0 variation no order can reference is dead weight in a catalog
    // that is already the theatre's entire sales history, and the item-sales
    // reporting this exists to feed has nothing to report for a night that
    // takes no money. Returning null is "no shortfall to report", which is
    // exactly right — not deploying an item here is the intended outcome.
    if (noTicket) return null;

    try {
      const { data: sq, error: sqErr } = await supabase.functions.invoke('square-showing-variations', {
        body: { action: 'ensure_showing', showing_id: showingId },
      });
      if (sqErr || (sq as any)?.error) {
        console.error('[ShowingForm] Square variations not created', sqErr || sq);
        return {
          code: 'invoke_failed',
          message: 'Saved, but Square did not get its ticket items. It will sell without item reporting.',
        };
      }
      // Every way this can fall short, not just the one. `needs_item` used to
      // be the only status checked, which left three other kinds of "this
      // showing has no usable catalog item" — and a 200 carrying no work at
      // all — reading exactly like a clean save. See src/lib/squareLink.ts.
      const outcome = squareSaveOutcome(sq);
      if (outcome) {
        console.warn(`[ShowingForm] Square: ${outcome.code}`, sq);
        return { code: outcome.code, message: outcome.message };
      }
      return null;
    } catch (sqErr) {
      console.error('[ShowingForm] Square variations threw', sqErr);
      return {
        code: 'invoke_threw',
        message: 'Saved, but Square did not get its ticket items. It will sell without item reporting.',
      };
    }
  };

  /**
   * One showtime, start to finish: insert, seed the template, price it, tag its
   * passes, tell Square.
   *
   * The whole sequence, so a batch repeats it rather than reimplementing it.
   * Nothing here throws — every way it can stop comes back as an outcome the
   * caller reports, because a client-side loop over five network round trips is
   * not a transaction and pretending otherwise is how a partial batch gets
   * announced as a whole one.
   */
  const createOneShowing = async (
    naiveStartTime: string,
    assignedSeating: boolean,
  ): Promise<{ outcome: ShowtimeOutcome; square: SquareBatchEntry | null }> => {
    const showingData = buildShowingData(naiveStartTime);
    // Capacity comes from the room. showings.total_seats defaults to 200 and
    // has never been editable here, so every showing ever created has claimed
    // a 200-seat house — 65 short of the real one, which for a GA showing is
    // the sold-out ceiling the capacity trigger enforces. Set on create only:
    // on edit it is left alone, so a capacity somebody deliberately reduced
    // for a limited-seating night is not silently restored to the full house.
    if (selectedVenue?.total_seats) showingData.total_seats = selectedVenue.total_seats;

    const { data, error } = await supabase.from('showings').insert(showingData).select('id').single();
    if (error) {
      return {
        outcome: { value: naiveStartTime, status: 'failed', detail: error.message, message: error.message },
        square: null,
      };
    }
    const showingId = data.id as string;

    // Seed seat-tier template from the production, if any
    try {
      await supabase.rpc('apply_production_template_to_showing', { p_showing_id: showingId });
    } catch (_) { /* no template — fine */ }

    const shortfall = await applySideEffects(showingId, assignedSeating);
    if (shortfall) {
      // The showing exists and will sell; only what came after it is missing.
      // Not a failure — retrying this row would create a second showing at the
      // same time in the same room — and not a success either.
      return {
        outcome: {
          value: naiveStartTime,
          status: 'incomplete',
          showingId,
          detail: shortfall.detail,
          message: shortfall.message,
        },
        square: null,
      };
    }

    const square = await runSquareEnsure(showingId);
    return { outcome: { value: naiveStartTime, status: 'created', showingId }, square };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemId) { toast.error('Please select an item'); return; }

    // `!noTicket` for the same reason the column is forced false: a walk-in
    // showing has no seats to price, and letting the seat editor validate and
    // persist against one would write per-seat tiers for tickets that can never
    // exist.
    const assignedSeating = !noTicket && venueHasSeatMap && requiresSeatSelection;

    // Checked before any insert below. Failing afterwards would leave created
    // showings behind with the form still on screen, and a second press of the
    // button would create every one of them again.
    if (assignedSeating && seatEditorRef.current?.validate() === false) return;

    if (isEdit) {
      setSaving(true);
      const { error } = await supabase.from('showings').update(buildShowingData(startTime)).eq('id', id);
      if (error) { toast.error(error.message); setSaving(false); return; }

      const shortfall = await applySideEffects(id!, assignedSeating);
      if (shortfall) { toast.error(shortfall.message); setSaving(false); return; }

      const square = await runSquareEnsure(id!);
      if (square) toast.warning(square.message);
      toast.success(`${Noun} updated!`);
      navigate('/admin');
      setSaving(false);
      return;
    }

    const planned = plannedShowtimes(showtimeRows);
    if (planned.length === 0) { toast.error('Add at least one showtime.'); return; }

    setSaving(true);
    setBatchSummary(null);
    setBatchProgress({ done: 0, total: planned.length });

    const outcomes: ShowtimeOutcome[] = [];
    const squares: Array<SquareBatchEntry | null> = [];
    // Sequential rather than concurrent. Each row runs five writes, one of them
    // a Square catalog upsert that answers 429 while the catalog lock is held —
    // firing a whole run of those at once is how a batch turns into a partial
    // one for a reason that has nothing to do with the showings.
    for (const value of planned) {
      const { outcome, square } = await createOneShowing(value, assignedSeating);
      outcomes.push(outcome);
      squares.push(square);
      setBatchProgress({ done: outcomes.length, total: planned.length });
    }

    const summary = summarizeBatch(outcomes);
    const squareMessage = summarizeSquareOutcomes(squares);
    setBatchProgress(null);

    // Rows that failed stay in the form to try again; anything that produced a
    // showing leaves the list, so a second press cannot double-create it.
    setShowtimeRows(
      summary.retryValues.length > 0
        ? summary.retryValues.map(v => makeShowtimeRow(v))
        : initialShowtimeRows(),
    );

    if (planned.length === 1) {
      // One showtime is the form it has always been: the same three messages,
      // and the same landing on the showing that was just created.
      const only = outcomes[0];
      if (only.status === 'created') {
        if (squareMessage) toast.warning(squareMessage);
        toast.success(`${Noun} created!`);
        setSavedShowingId(only.showingId!);
        navigate(`/admin/showings/${only.showingId}`, { replace: true });
      } else {
        toast.error(only.message ?? 'Showing could not be created.');
      }
      setSaving(false);
      return;
    }

    // A batch where everything landed leaves the form, exactly as creating a
    // single showtime always has.
    //
    // It used to stay and show the summary. That read as a failure: the panel
    // renders above the form, the admin is at the bottom of the page because
    // Create is the last control on it, and so the only visible change was
    // every field they had filled in going blank. The toast said "Created 3
    // showtimes" to somebody already convinced they had lost their work.
    //
    // Nothing is lost by leaving — the showings are on the admin list, which is
    // where this lands, and there is nothing on the summary to act on when
    // every row succeeded.
    if (summary.tone === 'success') {
      if (squareMessage) toast.warning(squareMessage);
      toast.success(summary.headline);
      navigate('/admin');
      setSaving(false);
      return;
    }

    // Anything short of that stays put, because there *is* something to act on:
    // which nights failed, which need finishing, and the failed rows waiting in
    // the form to retry. The effect above scrolls it into view for the same
    // reason the success case now leaves.
    setBatchSummary(summary);
    if (squareMessage) toast.warning(squareMessage);
    if (summary.tone === 'error') toast.error(summary.headline);
    else toast.warning(summary.headline);
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
  // `!noTicket` for the same reason the switch is hidden below: a walk-in
  // showing sells no seats, so the per-seat pricing column has nothing to
  // price.
  const showSeatOverride = !noTicket && venueHasSeatMap && requiresSeatSelection;


  return (
    <div className={`container py-8 px-4 ${showSeatOverride ? 'max-w-4xl' : 'max-w-lg'}`}>
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mb-4">← Back</Button>

      {/* What the batch actually did, per showtime.
          There is no transaction behind a batch — it is a client-side loop over
          five network round trips per row, and it can stop anywhere. A blanket
          "Created!" over a run where the third night failed is the failure this
          panel exists to prevent, so it names every night and what became of
          it. Only for a real batch: one showtime still navigates straight to
          the showing it made, exactly as it always did. */}
      {batchSummary && (
        <div ref={batchSummaryRef}>
        <Card className="glass mb-4">
          <CardHeader>
            <CardTitle className="font-display">{batchSummary.headline}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {batchSummary.created.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold">Created</p>
                <ul className="space-y-1">
                  {batchSummary.created.map(o => (
                    <li key={o.value}>
                      <Link
                        to={`/admin/showings/${o.showingId}`}
                        className="underline underline-offset-2 hover:text-accent"
                      >
                        {formatShowtime(venueLocalToInstant(o.value), 'EEE, MMM d yyyy · h:mm a')}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {batchSummary.incomplete.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold text-amber-500">Created, but not finished</p>
                <ul className="space-y-1">
                  {batchSummary.incomplete.map(o => (
                    <li key={o.value}>
                      <Link
                        to={`/admin/showings/${o.showingId}`}
                        className="underline underline-offset-2 hover:text-accent"
                      >
                        {formatShowtime(venueLocalToInstant(o.value), 'EEE, MMM d yyyy · h:mm a')}
                      </Link>
                      <span className="text-muted-foreground"> — {o.detail}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  These showings exist and will sell. Open each one to finish it — creating
                  them again would put two showings on the same night.
                </p>
              </div>
            )}

            {batchSummary.failed.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold text-destructive">Not created</p>
                <ul className="space-y-1">
                  {batchSummary.failed.map(o => (
                    <li key={o.value}>
                      {formatShowtime(venueLocalToInstant(o.value), 'EEE, MMM d yyyy · h:mm a')}
                      <span className="text-muted-foreground"> — {o.detail}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Left in the form below with the same settings, ready to try again.
                </p>
              </div>
            )}

            <Button type="button" variant="outline" size="sm" onClick={() => navigate('/admin')}>
              Done — back to admin
            </Button>
          </CardContent>
        </Card>
        </div>
      )}
      <div className={showSeatOverride ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display">{isEdit ? `Edit ${Noun}` : `Add ${Noun}`}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {scope || allowedCategories?.length === 1 ? (
              /* Opened from a title's card, so the category is already
                 settled and showing the selector only invites it to be
                 changed by accident. Reversible: Change puts both pickers
                 back, keeping whatever is already selected. */
              <div className="space-y-2">
                <Label>Category</Label>
                <div className="flex items-center gap-3">
                  <span className="text-sm">
                    {category === 'movie' ? 'Movie' : category === 'event' ? 'Event' : 'Live Performance'}
                  </span>
                  {scope && (allowedCategories?.length ?? 3) > 1 && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => setScope(null)}
                    >
                      Change
                    </Button>
                  )}
                </div>
              </div>
            ) : (
            <div className="space-y-2">
              <Label htmlFor="showing-category">Category *</Label>
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
                <SelectTrigger id="showing-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(allowedCategories ?? (['movie', 'event', 'concert'] as Category[])).map(c => (
                    <SelectItem key={c} value={c}>
                      {c === 'movie' ? 'Movie' : c === 'event' ? 'Event' : 'Live Performance'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}
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
            {venueHasSeatMap && !noTicket && (
              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresSeatSelection}
                    onChange={e => setRequiresSeatSelection(e.target.checked)}
                    className="rounded"
                  />
                  <span className="font-semibold">Assigned seating for this {noun}</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Off: general admission — buyers pick a quantity and capacity is a simple count.
                  On: buyers choose their seats from {selectedVenue?.name ?? 'the venue'}'s map.
                </p>
              </div>
            )}
            {/* Curator's pick, for this date only. The same flag exists on the
                film itself (Movie / Event / Concert form), and the two are
                independent: flagging the film puts one entry on the home page
                listing its whole run, flagging a night puts that night up on
                its own. Both is a deliberate "see this film, and especially
                this night", and shows both. */}
            <div className="space-y-2 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={e => setIsFeatured(e.target.checked)}
                  className="rounded"
                />
                <span className="font-semibold">Curator's pick — this {noun}</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Highlights this one date on the homepage, for the night that is worth
                singling out — a 35mm print, a Q&amp;A, the show with the live score.
                To recommend the film across its whole run instead, use the Curator's
                pick switch on the film itself. Doesn't change calendar order.
              </p>
            </div>

            {/* Edit mode edits one existing showing, so it asks for one date.
                Create mode asks for the list: everything above and below is the
                same for every night of a run, and the date is the only thing
                that is not. */}
            {isEdit ? (
              <div className="space-y-2">
                <Label>Date & Time *</Label>
                <Input type="datetime-local" required value={startTime} onChange={e => setStartTime(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Theatre local time (Pacific), whatever your computer is set to
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Showtimes *</Label>
                <p className="text-xs text-muted-foreground">
                  Every other setting on this form — the title, venue, price, runtime,
                  passes{venueHasSeatMap ? ' and seating' : ''} — applies to every showtime
                  listed here.
                </p>
                <div className="space-y-2">
                  {showtimeRows.map((row, i) => (
                    <div key={row.key} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          type="datetime-local"
                          value={row.value}
                          onChange={e => updateShowtime(i, e.target.value)}
                          className="flex-1"
                          aria-label={`Showtime ${i + 1}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeShowtime(i)}
                          disabled={showtimeRows.length === 1}
                          aria-label={`Remove showtime ${i + 1}`}
                          className="shrink-0"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      {/* Said before the save rather than discovered after it.
                          A duplicate is dropped rather than refused — the
                          admin asked for that night once, and once is what
                          they get — but silently dropping it would leave them
                          counting three showings where they typed four. */}
                      {duplicateRows.has(i) && (
                        <p className="text-xs text-amber-500">
                          Already listed above — this row will be skipped.
                        </p>
                      )}
                      {collidingRows.has(i) && !duplicateRows.has(i) && (
                        <p className="text-xs text-amber-500">
                          {selectedVenue?.name ?? 'This venue'} already has a showing at this time.
                          Fine if that is deliberate — this is only a heads-up.
                        </p>
                      )}
                      {showtimeRows.length > 1 && !row.value.trim() && (
                        <p className="text-xs text-muted-foreground">Blank — this row will be skipped.</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => addShowtime()}>
                    <Plus className="h-4 w-4 mr-1" /> Add another showtime
                  </Button>
                  {/* Calendar arithmetic on the wall clock, so "same time next
                      week" stays the same time across a DST change. */}
                  <Button type="button" variant="ghost" size="sm" onClick={() => addShowtime(1)}>
                    +1 day
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => addShowtime(7)}>
                    +1 week
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Theatre local time (Pacific), whatever your computer is set to.
                  {plannedRows.length > 1 && ` ${plannedRows.length} showings will be created, oldest first.`}
                </p>
              </div>
            )}
            {/* Duration decides when this showing stops being sellable: the
                rule is that sales close when the show ends, so something has
                to say when that is. A film answers for itself. An event or a
                live performance has no runtime column anywhere in the schema,
                so leaving this blank gives it the two-hour default — fine for
                most, worth setting for a festival or a double bill. */}
            <div className="space-y-2">
              <Label htmlFor="showing-duration">Runs For (minutes)</Label>
              <Input
                id="showing-duration"
                type="number"
                min="1"
                step="1"
                placeholder={String(inheritedDuration)}
                value={durationMinutes}
                aria-describedby="showing-duration-help"
                onChange={e => setDurationMinutes(e.target.value)}
              />
              <p id="showing-duration-help" className="text-xs text-muted-foreground">
                {durationEcho ? <>Shows as <strong>{durationEcho}</strong> on the site. </> : null}
                {durationInheritedFrom === 'movie'
                  ? `Leave blank to use this film's runtime (${formatRuntime(inheritedDuration)}). Set it for a double bill, an intermission, or a Q&A after.`
                  : `Leave blank to assume ${formatRuntime(inheritedDuration)}. Tickets stop being sold once the showing ends.`}
              </p>
            </div>

            <div className="space-y-2">
              {/* Labelled the way the runtime field beside it is: the <Label>
                  was rendering unattached, so a screen reader announced the
                  price box as an unnamed number field. */}
              <Label htmlFor="showing-price">Base Ticket Price ($)</Label>
              <Input
                id="showing-price"
                type="number"
                step="0.01"
                value={ticketPrice}
                aria-describedby="showing-price-help"
                onChange={e => handleTicketPriceChange(e.target.value)}
              />
              <p id="showing-price-help" className="text-xs text-muted-foreground">
                Fallback price when no tiers are used
              </p>
            </div>

            {/* The two kinds of free.

                Only asked when the showing is actually free — a priced showing
                has no such choice to make, and the database refuses the
                combination outright (the CHECK on showings, and the trigger on
                showing_price_tiers). Hiding it rather than disabling it keeps
                the form from offering a state the save would reject.

                Set the price to 0 and this appears; type a price back in and it
                goes, taking the flag with it — `noTicket` is derived, so the
                price always wins over a box ticked earlier. Applies to every
                showtime in a batch, like the rest of these settings. */}
            {isFreeShowing && (
              <div className="space-y-3 border-t border-border pt-4">
                <Label className="text-base font-semibold">This showing is free</Label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="free-ticketing-mode"
                    checked={!noTicketRequired}
                    onChange={() => setNoTicketRequired(false)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="font-semibold">Require a free ticket</span>
                    <span className="block text-xs text-muted-foreground">
                      Patrons reserve a $0 ticket. Seats are held, capacity counts down, and
                      the tickets scan at the door — an RSVP. Use this when you need to know
                      how many are coming.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="free-ticketing-mode"
                    checked={noTicketRequired}
                    onChange={() => setNoTicketRequired(true)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="font-semibold">No ticket needed — show "Free"</span>
                    <span className="block text-xs text-muted-foreground">
                      Doors open, walk in. The showing page says "Free — no ticket needed"
                      with no purchase panel, and the listings say "Free" instead of "Get
                      Tickets".
                    </span>
                  </span>
                </label>
                {noTicketRequired && (
                  <p className="text-xs text-amber-500">
                    Nothing is issued, reserved or scanned for this showing: no seats are held,
                    no passes are accepted, and no attendance is recorded online. Saving will
                    clear any price tiers, assigned seating and pass eligibility it has.
                  </p>
                )}
              </div>
            )}

            {/* Closed by hand.

                The same flag the quick toggle on the admin listing sets — this
                is here for whoever is already inside the form, and because it
                is the only place the custom notice can be written.

                Not offered on a walk-in night: nothing is issued, so there is
                nothing to sell out, and `buildShowingData` forces the column
                false in that state anyway.

                Deliberately not the same control as Active. Deactivating hides
                the showing from the site; this leaves it listed and readable
                and only stops it selling. */}
            {!noTicket && (
              <div className="space-y-3 border-t border-border pt-4">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manuallySoldOut}
                    onChange={e => setManuallySoldOut(e.target.checked)}
                    className="rounded mt-1"
                  />
                  <span className="min-w-0">
                    <span className="font-semibold">Sold out — close online sales</span>
                    <span className="block text-xs text-muted-foreground">
                      The showing stays on the site with its date and details, and shows a
                      "Sold Out" notice instead of a purchase panel. Use this when the house
                      filled somewhere else — a block booking, a buyout, a phone sale.
                      The box office can still sell and comp in person.
                    </span>
                  </span>
                </label>
                {manuallySoldOut && (
                  <div className="space-y-1">
                    <Label htmlFor="sold-out-message" className="text-sm">
                      Notice (optional)
                    </Label>
                    <Input
                      id="sold-out-message"
                      value={soldOutMessageText}
                      aria-describedby="sold-out-message-help"
                      placeholder="Sold out — this screening was booked privately."
                      onChange={e => setSoldOutMessageText(e.target.value)}
                    />
                    <p id="sold-out-message-help" className="text-xs text-muted-foreground">
                      Replaces the standard notice on the showing page, and is what a stale
                      tab is told if it tries to buy. Leave blank for "This showing is sold
                      out." Kept if you reopen the showing later.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Pass eligibility. Shown for every category now: the trigger that
                forced events and live performances ineligible is gone, because
                a festival pass covering a performance inside its run is the
                point rather than drift. Which passes work here is the only
                question left, and it is asked in one place for all three. */}
            {!noTicket && (
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
            )}

            {/* Price Tiers. Hidden for assigned seating: there the tiers live in the
                seat editor, which owns both the prices and which seats carry them.
                Two writers for showing_price_tiers is what let one of them delete
                the other's work. */}
            {!noTicket && !(venueHasSeatMap && requiresSeatSelection) && (
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
              {saving
                ? batchProgress && batchProgress.total > 1
                  // Named rather than a spinner: a batch is several seconds of
                  // network per showing, and "which one is it on" is the thing
                  // somebody watching actually wants to know.
                  ? `Saving ${batchProgress.done + 1} of ${batchProgress.total}...`
                  : 'Saving...'
                : isEdit
                  ? `Update ${Noun}`
                  : plannedRows.length > 1
                    ? `Create ${plannedRows.length} Showtimes`
                    : `Create ${Noun}`}
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
