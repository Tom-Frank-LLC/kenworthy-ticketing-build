import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UndeliveredOrdersCard } from '@/components/admin/UndeliveredOrdersCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Film, Plus, Calendar, Ticket, Edit, Trash2, ShoppingCart, ScanLine, Music, PartyPopper, BarChart3, UtensilsCrossed, CreditCard, Download, Users, Wallet, KeyRound, FileText, Clock, Handshake, History, Disc, Search, X, ChevronLeft, ChevronRight, Mail, Heart, Eye, Building2, Briefcase, Newspaper, Martini, Store
} from 'lucide-react';
import { ProductionDetailDrawer } from '@/components/ProductionDetailDrawer';
import { AttendeeSheet } from '@/components/admin/AttendeeSheet';
import { CollapsibleSection } from '@/components/admin/CollapsibleSection';
import AnalyticsTab from '@/components/admin/AnalyticsTab';
import ConcessionItemsTab from '@/components/admin/ConcessionItemsTab';
import ConcessionMenusTab from '@/components/admin/ConcessionMenusTab';
import FestivalProgramsTab from '@/components/admin/FestivalProgramsTab';
import { SquareLinkPanel } from '@/components/admin/SquareLinkPanel';
import SquareCatalogTab from '@/components/admin/SquareCatalogTab';
import { DEFAULT_PAGES_TAB, resolveAdminSection } from '@/lib/adminSections';
import FilmPassesTab from '@/components/admin/FilmPassesTab';
import HostManagementTab from '@/components/admin/HostManagementTab';
import AccountingTab from '@/components/admin/AccountingTab';
import ChartOfAccountsTab from '@/components/admin/accounting/ChartOfAccountsTab';
import AccountMappingsTab from '@/components/admin/accounting/AccountMappingsTab';
import QboExportTab from '@/components/admin/accounting/QboExportTab';
import { FINANCIAL_IMPORTS_ENABLED } from '@/lib/flags';
import RentalRequestsTab from '@/components/admin/RentalRequestsTab';
import BoxOfficeReceiptsTab from '@/components/admin/BoxOfficeReceiptsTab';
import LaborTab from '@/components/admin/LaborTab';
import SponsorsTab from '@/components/admin/SponsorsTab';
import DvdLibraryTab from '@/components/admin/DvdLibraryTab';
import MailchimpTab from '@/components/admin/MailchimpTab';
import LglTab from '@/components/admin/LglTab';
import HiringTab from '@/components/admin/HiringTab';
import PressTab from '@/components/admin/PressTab';
import BackstageTab from '@/components/admin/BackstageTab';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { exportContactsCsv } from '@/lib/exportContacts';
import { formatShowtime } from '@/lib/datetime';
import { fetchAllRows } from '@/lib/fetchAllRows';

/**
 * PostgREST caps every response at 1000 rows, so a bare `.select('*')` silently
 * truncated the dashboard — the movies table alone is over that cap, meaning the
 * tail of the alphabet was invisible in admin and absent from any client-side
 * sort. Page through explicitly instead.
 *
 * Each query must carry a total ordering (a unique tiebreak) or rows can shift
 * between pages and be dropped or duplicated.
 */

type SortOrder = 'showtime_desc' | 'showtime_asc' | 'title_asc' | 'title_desc' | 'newest' | 'oldest';

/**
 * Staff work forward from what is playing next, so the default view is
 * chronological by showtime with the farthest-future dates first — not the old
 * Title A–Z.
 */
const DEFAULT_SORT: SortOrder = 'showtime_desc';

/**
 * `sold / capacity`, plus how many of those have been checked in, clickable to
 * open the attendee list for that showing.
 *
 * The check-in figure is only meaningful once someone has actually scanned, so
 * it stays hidden at zero rather than showing "· 0 in" against every future
 * showing on the schedule.
 */
function TicketCountBadge({
  sold,
  scanned,
  capacity,
  onClick,
}: {
  sold: number;
  scanned: number;
  capacity: number;
  onClick: () => void;
}) {
  const soldOut = capacity > 0 && sold >= capacity;
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        `${sold} of ${capacity} tickets sold${soldOut ? ' (sold out)' : ''}` +
        `${scanned > 0 ? `, ${scanned} checked in` : ''} — click to see attendees`
      }
      aria-label={`View ${sold} attendees`}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Badge
        variant={soldOut ? 'default' : 'secondary'}
        className="text-xs whitespace-nowrap cursor-pointer hover:bg-secondary/70 transition-colors"
      >
        {sold} / {capacity}
        {scanned > 0 && ` · ${scanned} in`}
      </Badge>
    </button>
  );
}

// Thin wrapper over the shared pager: this screen wants the rows bare and a
// failure logged rather than surfaced, which is local to the dashboard. The
// paging itself lives in one place so a fix to it reaches every caller.
async function fetchAllPages<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const { data, error } = await fetchAllRows<T, unknown>(makeQuery);
  if (error) console.error('AdminDashboard fetchAllPages:', error);
  return data;
}

/** The Listings sub-tabs that `?tab=` may name. */
const SCHEDULE_TABS = ['movies', 'live-events', 'venues'];

export default function AdminDashboard() {
  const { isAdmin, isStaff, isSuperadmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [movies, setMovies] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [concerts, setConcerts] = useState<any[]>([]);
  const [showings, setShowings] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketCount, setTicketCount] = useState(0);
  const [scheduleQuery, setScheduleQuery] = useState(() => searchParams.get('q') || '');
  /*
   * `?tab=` is a link somebody may have bookmarked, and "square" was one of its
   * values until the Square work moved inside Movies and Live Events. Radix
   * renders nothing for a value with no TabsContent, so an old link would open
   * the Listings tab onto a blank panel with no error to search for. Unknown
   * values land on Movies instead. (Same contract `adminSections.ts` keeps for
   * the top-level `?section=`.)
   */
  const [activeScheduleTab, setActiveScheduleTab] = useState(() => {
    const wanted = searchParams.get('tab');
    return wanted && SCHEDULE_TABS.includes(wanted) ? wanted : 'movies';
  });
  // Festival, Hiring and Press were each a top-level tab until the dashboard
  // grew past what a row of tabs can hold. They are all one job — editing a
  // specific public page — so they live under Pages now. Their old ?section=
  // values still work: an existing bookmark or a link in someone's notes lands
  // on Pages with the right sub-tab open rather than on a blank panel.
  const initialTabs = resolveAdminSection(searchParams.get('section'), searchParams.get('page'));
  const [activeTopTab, setActiveTopTab] = useState(initialTabs.section);
  const [activePagesTab, setActivePagesTab] = useState(initialTabs.pagesTab);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>(
    () => (searchParams.get('status') as any) || 'all'
  );
  const [ratingFilter, setRatingFilter] = useState<string>(() => searchParams.get('rating') || 'all');
  const [genreFilter, setGenreFilter] = useState<string>(() => searchParams.get('genre') || 'all');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>(() => searchParams.get('etype') || 'all');
  const [concertSubcategoryFilter, setConcertSubcategoryFilter] = useState<string>(
    () => searchParams.get('csub') || 'all'
  );
  const [liveEventKindFilter, setLiveEventKindFilter] = useState<'all' | 'event' | 'concert'>(
    () => (searchParams.get('kind') as any) || 'all'
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    () => (searchParams.get('sort') as any) || DEFAULT_SORT
  );
  // Public-drawer preview (#3) and attendee list (#2) — both stay in-page so
  // staff never lose their filters.
  const [previewProduction, setPreviewProduction] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [attendeeTarget, setAttendeeTarget] = useState<{
    title: string;
    showingIds: string[];
    capacity: number;
  } | null>(null);
  const [attendeeOpen, setAttendeeOpen] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDel = (key: string, value: string, fallback: string) => {
      if (value && value !== fallback) next.set(key, value);
      else next.delete(key);
    };
    setOrDel('q', scheduleQuery, '');
    setOrDel('tab', activeScheduleTab, 'movies');
    setOrDel('section', activeTopTab, 'listings');
    setOrDel('page', activePagesTab, DEFAULT_PAGES_TAB);
    setOrDel('status', statusFilter, 'all');
    setOrDel('rating', ratingFilter, 'all');
    setOrDel('genre', genreFilter, 'all');
    setOrDel('etype', eventTypeFilter, 'all');
    setOrDel('csub', concertSubcategoryFilter, 'all');
    setOrDel('kind', liveEventKindFilter, 'all');
    setOrDel('sort', sortOrder, DEFAULT_SORT);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [scheduleQuery, activeScheduleTab, activeTopTab, activePagesTab, statusFilter, ratingFilter, genreFilter, eventTypeFilter, concertSubcategoryFilter, liveEventKindFilter, sortOrder]);

  useEffect(() => {
    if (authLoading) return;
    if (!isStaff) { navigate('/'); return; }
    loadData();
  }, [isStaff, authLoading, navigate]);

  async function loadData() {
    const [moviesRes, eventsRes, concertsRes, showingsRes, venuesRes, ticketsRes] = await Promise.all([
      fetchAllPages((from, to) => supabase.from('movies').select('*').order('title').order('id').range(from, to)),
      fetchAllPages((from, to) => supabase.from('events').select('*').order('title').order('id').range(from, to)),
      fetchAllPages((from, to) =>
        supabase.from('live_performances').select('*').order('title').order('id').range(from, to)
      ),
      fetchAllPages((from, to) =>
        supabase
          .from('showings')
          .select('*, movies(title), events(title), live_performances(title), venues(name)')
          .order('start_time', { ascending: false })
          .order('id')
          .range(from, to)
      ),
      // Seat counts come along so the list can say whether a venue actually has
      // a map behind its flag — the two disagreed for months without anyone
      // being able to see it, because there was no Venues screen at all.
      supabase.from('venues').select('*, venue_seats(count)').order('name'),
      // Sold counts, so unpaid checkout attempts (pending) and declines
      // (failed) are excluded.
      // scanned_at comes along so the dashboard can report attendance, not only
      // sales. TicketScanner already writes it on check-in; until now nothing
      // outside the scanner ever read it back.
      fetchAllPages((from, to) => supabase.from('tickets').select('id, showing_id, scanned_at').eq('status', 'confirmed').order('id').range(from, to)),
    ]);
    setMovies(moviesRes);
    setEvents(eventsRes);
    setConcerts(concertsRes);
    setShowings(showingsRes);
    setVenues(venuesRes.data || []);
    setTickets(ticketsRes);
    setTicketCount(ticketsRes.length);
  }


  const getMovieShowings = (movieId: string) => showings.filter(s => s.movie_id === movieId);

  const getTicketsSoldForShowing = (showingId: string) =>
    tickets.filter(t => t.showing_id === showingId).length;

  /** Checked-in count for one showing — sold tickets that have been scanned. */
  const getScannedForShowing = (showingId: string) =>
    tickets.filter(t => t.showing_id === showingId && t.scanned_at).length;

  const getTicketsSoldForEvent = (eventId: string) => {
    const eventShowings = showings.filter(s => s.event_id === eventId);
    const own = tickets.filter(t => eventShowings.some((sh: any) => sh.id === t.showing_id));
    const capacity = eventShowings.reduce((sum, sh) => sum + (sh.total_seats || 0), 0);
    return { sold: own.length, scanned: own.filter(t => t.scanned_at).length, capacity };
  };

  const getTicketsSoldForConcert = (concertId: string) => {
    const concertShowings = showings.filter(s => s.live_performance_id === concertId);
    const own = tickets.filter(t => concertShowings.some((sh: any) => sh.id === t.showing_id));
    const capacity = concertShowings.reduce((sum, sh) => sum + (sh.total_seats || 0), 0);
    return { sold: own.length, scanned: own.filter(t => t.scanned_at).length, capacity };
  };

  const showingsForProduction = (type: 'movie' | 'event' | 'concert', productionId: string) => {
    const column = type === 'movie' ? 'movie_id' : type === 'event' ? 'event_id' : 'live_performance_id';
    return showings.filter(s => s[column] === productionId);
  };

  /**
   * Open the public ProductionDetailDrawer against an admin row, so staff see
   * exactly what a visitor sees. Mirrors the shape the calendar/home
   * `handleSelect` builds: the production record plus a `showings` array.
   * ticket_price is coerced because the drawer calls .toFixed() on it and
   * Postgres numeric arrives as a string.
   */
  const openPreview = (item: any, type: 'movie' | 'event' | 'concert') => {
    const productionShowings = showingsForProduction(type, item.id)
      .slice()
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .map(s => ({ id: s.id, start_time: s.start_time, ticket_price: Number(s.ticket_price) || 0 }));
    setPreviewProduction({ ...item, type, showings: productionShowings });
    setPreviewOpen(true);
  };

  const openAttendees = (title: string, showingIds: string[], capacity: number) => {
    setAttendeeTarget({ title, showingIds, capacity });
    setAttendeeOpen(true);
  };

  const uniqueRatings = Array.from(new Set(movies.map(m => m.rating).filter(Boolean))).sort();
  const uniqueMovieGenres = Array.from(new Set(movies.map(m => m.genre).filter(Boolean))).sort();
  const uniqueEventTypes = Array.from(new Set(events.map(e => e.ticket_type).filter(Boolean))).sort();
  const uniqueConcertSubcategories = Array.from(new Set(concerts.map(c => c.subcategory).filter(Boolean))).sort();
  const uniqueConcertGenres = Array.from(new Set(concerts.map(c => c.genre).filter(Boolean))).sort();

  const resetScheduleFilters = () => {
    setScheduleQuery('');
    setStatusFilter('all');
    setRatingFilter('all');
    setGenreFilter('all');
    setEventTypeFilter('all');
    setConcertSubcategoryFilter('all');
    setLiveEventKindFilter('all');
    setSortOrder(DEFAULT_SORT);
  };

  /**
   * Latest showtime per production, keyed by production id.
   *
   * A production has many showings, so ordering it by "showtime" needs one
   * representative timestamp. We use the max (latest) start_time, so a title
   * with an upcoming date sorts above one whose last screening was years ago.
   * Showing ids are UUIDs, so a single map across movies/events/performances
   * cannot collide.
   */
  const latestShowtimeByProduction = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of showings) {
      const productionId = s.movie_id || s.event_id || s.live_performance_id;
      if (!productionId) continue;
      const at = new Date(s.start_time).getTime();
      if (!Number.isFinite(at)) continue;
      const prev = map.get(productionId);
      if (prev === undefined || at > prev) map.set(productionId, at);
    }
    return map;
  }, [showings]);

  const byTitle = (a: any, b: any) => (a.title || '').localeCompare(b.title || '');

  // Productions with no showings have no showtime to compare, so they sink to
  // the bottom in both directions rather than masquerading as the oldest.
  const byShowtime = (a: any, b: any, direction: 'asc' | 'desc') => {
    const at = latestShowtimeByProduction.get(a.id);
    const bt = latestShowtimeByProduction.get(b.id);
    if (at === undefined && bt === undefined) return byTitle(a, b);
    if (at === undefined) return 1;
    if (bt === undefined) return -1;
    if (at === bt) return byTitle(a, b);
    return direction === 'desc' ? bt - at : at - bt;
  };

  const sortItems = (items: any[]) => {
    const sorted = [...items];
    switch (sortOrder) {
      case 'showtime_desc':
        sorted.sort((a, b) => byShowtime(a, b, 'desc'));
        break;
      case 'showtime_asc':
        sorted.sort((a, b) => byShowtime(a, b, 'asc'));
        break;
      case 'title_asc':
        sorted.sort(byTitle);
        break;
      case 'title_desc':
        sorted.sort((a, b) => byTitle(b, a));
        break;
      case 'newest':
        sorted.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
        break;
    }
    return sorted;
  };

  const matchesSearch = (title: string) =>
    !scheduleQuery || (title || '').toLowerCase().includes(scheduleQuery.toLowerCase());

  const matchesStatus = (isActive: boolean) =>
    statusFilter === 'all' ||
    (statusFilter === 'active' && isActive) ||
    (statusFilter === 'inactive' && !isActive);

  const filteredMovies = sortItems(movies.filter(m =>
    matchesSearch(m.title) &&
    matchesStatus(!!m.is_active) &&
    (ratingFilter === 'all' || m.rating === ratingFilter) &&
    (genreFilter === 'all' || m.genre === genreFilter)
  ));

  const liveEvents = useMemo(() => {
    const eventsWithKind = (events || []).map((e) => ({ ...e, kind: 'event' as const }));
    const concertsWithKind = (concerts || []).map((c) => ({ ...c, kind: 'concert' as const }));
    return [...eventsWithKind, ...concertsWithKind];
  }, [events, concerts]);

  const filteredLiveEvents = sortItems(liveEvents.filter((item) => {
    const isEvent = item.kind === 'event';
    const isConcert = item.kind === 'concert';
    return (
      matchesSearch(item.title) &&
      matchesStatus(!!item.is_active) &&
      (liveEventKindFilter === 'all' || item.kind === liveEventKindFilter) &&
      (eventTypeFilter === 'all' || !isEvent || item.ticket_type === eventTypeFilter) &&
      (concertSubcategoryFilter === 'all' || !isConcert || item.subcategory === concertSubcategoryFilter) &&
      (genreFilter === 'all' || !isConcert || item.genre === genreFilter)
    );
  }));

  // Venues get their own delete rather than the generic one: venue_seats is
  // ON DELETE CASCADE, so removing a venue takes its whole seat map with it,
  // and every seat-tier assignment hanging off those seats. A showing still
  // pointing at the venue blocks the delete at the foreign key — surfaced as
  // the error toast below rather than pre-empted, so the count shown here and
  // the database cannot disagree.
  const deleteVenue = async (venue: any, seatCount: number, showingCount: number) => {
    const consequences = [
      seatCount > 0 ? `its ${seatCount}-seat map and any seat pricing set against it` : null,
      showingCount > 0 ? `${showingCount} showing${showingCount === 1 ? '' : 's'} still reference it and will block the delete` : null,
    ].filter(Boolean);
    const detail = consequences.length ? `\n\nThis also removes ${consequences.join(', and ')}.` : '';
    if (!confirm(`Delete "${venue.name}"?${detail}`)) return;
    const { error } = await supabase.from('venues').delete().eq('id', venue.id);
    if (error) toast.error(error.message);
    else { toast.success('Venue deleted'); loadData(); }
  };

  const deleteItem = async (table: 'movies' | 'events' | 'live_performances' | 'showings', id: string, label: string) => {

    if (!confirm(`Delete this ${label}?`)) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(`${label} deleted`); loadData(); }
  };


  /*
   * The search and filter controls, rendered at the top of whichever listing
   * they filter rather than in a section of their own.
   *
   * They were briefly their own collapsible panel, which read as a separate
   * thing to open rather than as part of the table underneath — and every
   * control here narrows exactly one list, so the two belong together. The
   * conditionals inside still key off `activeScheduleTab`; Radix only mounts
   * the active TabsContent, so whichever copy is on screen is the right one.
   */
  const listingFilters = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
      <div className="relative w-full sm:w-56">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={scheduleQuery}
          onChange={e => setScheduleQuery(e.target.value)}
          placeholder="Search title…"
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {activeScheduleTab === 'movies' && (
          <>
            <Select value={ratingFilter} onValueChange={setRatingFilter}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ratings</SelectItem>
                {uniqueRatings.map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={genreFilter} onValueChange={setGenreFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Genre" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genres</SelectItem>
                {uniqueMovieGenres.map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        {activeScheduleTab === 'live-events' && (
          <>
            <Select value={liveEventKindFilter} onValueChange={v => setLiveEventKindFilter(v as any)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                <SelectItem value="event">Event</SelectItem>
                <SelectItem value="concert">Performance</SelectItem>
              </SelectContent>
            </Select>
            <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Ticket type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ticket types</SelectItem>
                {uniqueEventTypes.map(t => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={concertSubcategoryFilter} onValueChange={setConcertSubcategoryFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Subcategory" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subcategories</SelectItem>
                {uniqueConcertSubcategories.map(s => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={genreFilter} onValueChange={setGenreFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Genre" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genres</SelectItem>
                {uniqueConcertGenres.map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        <Select value={sortOrder} onValueChange={v => setSortOrder(v as SortOrder)}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="showtime_desc">Showtime (upcoming first)</SelectItem>
            <SelectItem value="showtime_asc">Showtime (past first)</SelectItem>
            <SelectItem value="title_asc">Title A–Z</SelectItem>
            <SelectItem value="title_desc">Title Z–A</SelectItem>
            {/* Everything was bulk-imported at once, so created_at barely
                varies — labelled plainly so the near-no-op isn't mistaken
                for a broken showtime sort. */}
            <SelectItem value="newest">Date added (newest)</SelectItem>
            <SelectItem value="oldest">Date added (oldest)</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="ghost" size="sm" onClick={resetScheduleFilters} className="h-9 px-2 text-muted-foreground">
          <X className="h-4 w-4 mr-1" /> Reset
        </Button>
      </div>
    </div>
  );

  if (authLoading) return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="container py-8 px-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <h1 className="font-display text-3xl font-bold">Admin Dashboard</h1>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/pos"><ShoppingCart className="h-4 w-4 mr-1" /> Staff POS</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/scanner"><ScanLine className="h-4 w-4 mr-1" /> Scanner</Link>
          </Button>
          {isAdmin && (
            <Button size="sm" variant="outline" asChild>
              <Link to="/admin/audit-log"><History className="h-4 w-4 mr-1" /> Activity Log</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <Film className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xl font-bold">{movies.length}</p>
              <p className="text-xs text-muted-foreground">Movies</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex -space-x-2">
              <PartyPopper className="h-6 w-6 text-primary" />
              <Music className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold">{events.length + concerts.length}</p>
              <p className="text-xs text-muted-foreground">Live Events</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <Calendar className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xl font-bold">{showings.length}</p>
              <p className="text-xs text-muted-foreground">Showings</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <Ticket className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xl font-bold">{ticketCount}</p>
              <p className="text-xs text-muted-foreground">Tickets Sold</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Above the tabs, and only when it has something to say. Delivery is
          fire-and-forget so a failed send is silent everywhere else — the buyer
          is charged, the tickets are valid, and nobody is told. This is the
          only screen that reads confirmation_error back. */}
      <UndeliveredOrdersCard />

      <Tabs value={activeTopTab} onValueChange={setActiveTopTab} className="space-y-4">
        {(() => {
          const topTabs = [
            { value: 'listings', label: 'Listings', icon: Calendar, show: true },
            { value: 'concessions', label: 'Concessions', icon: UtensilsCrossed, show: true },
            { value: 'passes', label: 'Passes', icon: CreditCard, show: true },
            { value: 'dvds', label: 'DVDs', icon: Disc, show: true },
            { value: 'rentals', label: 'Rentals', icon: KeyRound, show: true },
            { value: 'labor', label: 'Staff', icon: Clock, show: isAdmin },
            { value: 'sponsors', label: 'Sponsors', icon: Handshake, show: true },
            { value: 'pages', label: 'Pages', icon: Globe, show: isAdmin },
            { value: 'analytics', label: 'Analytics', icon: BarChart3, show: isAdmin },
            { value: 'mailchimp', label: 'Mailchimp', icon: Mail, show: isAdmin },
            { value: 'lgl', label: 'LGL', icon: Heart, show: isAdmin },
            { value: 'bor', label: 'BOR', icon: FileText, show: true },
          ].filter(t => t.show);
          const currentIdx = Math.max(0, topTabs.findIndex(t => t.value === activeTopTab));
          const current = topTabs[currentIdx] ?? topTabs[0];
          const goPrev = () => setActiveTopTab(topTabs[(currentIdx - 1 + topTabs.length) % topTabs.length].value);
          const goNext = () => setActiveTopTab(topTabs[(currentIdx + 1) % topTabs.length].value);
          const CurrentIcon = current.icon;
          return (
            <>
              {/* Mobile: arrow pager */}
              <div className="md:hidden flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={goPrev}
                  aria-label="Previous section"
                  className="shrink-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1 min-w-0 flex items-center justify-center gap-2 h-10 rounded-md border border-input bg-muted/40 px-3 font-display uppercase tracking-wider text-sm">
                  <CurrentIcon className="h-6 w-6 shrink-0 text-primary glow-icon" strokeWidth={2.5} />
                  <span className="truncate">{current.label}</span>
                  <span className="text-xs text-muted-foreground ml-1 shrink-0">
                    {currentIdx + 1}/{topTabs.length}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={goNext}
                  aria-label="Next section"
                  className="shrink-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Desktop: icon-only grid tabs.

                  The label leaves the surface, not the tab: every trigger keeps
                  an `aria-label` and gains a tooltip. Twelve unlabelled glyphs
                  would otherwise be a memory test, and a screen reader would
                  hear twelve buttons named nothing at all. */}
              <TabsList
                className="hidden md:grid w-full h-auto p-1.5"
                style={{ gridTemplateColumns: `repeat(${topTabs.length}, minmax(0, 1fr))` }}
              >
                {topTabs.map(t => {
                  const Icon = t.icon;
                  const isActive = activeTopTab === t.value;
                  /*
                   * The tooltip wraps the icon, NOT the trigger.
                   *
                   * `TooltipTrigger asChild` merges its props onto its child, and
                   * Radix Tabs and Radix Tooltip both write `data-state`. Put the
                   * tooltip on the trigger and the tooltip's open/closed wins, so
                   * every `data-[state=active]:` rule on that tab goes silently
                   * inert. It still *looks* right when the styling is driven from
                   * JS, which is exactly what makes it worth writing down.
                   */
                  return (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      aria-label={t.label}
                      /* The lit glyph is the selected state, so the default active
                         pill comes off: a lighter rectangle behind a glow reads as
                         two competing highlights. */
                      className="h-12 px-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center justify-center">
                            <Icon
                              aria-hidden="true"
                              /* Bolder while selected, which a stroke weight does
                                 and a font weight cannot: these are strokes, not text. */
                              strokeWidth={isActive ? 2.5 : 1.75}
                              className={
                                'shrink-0 transition-all duration-200 ' +
                                (isActive
                                  ? 'h-10 w-10 text-primary glow-icon'
                                  : 'h-8 w-8 text-muted-foreground')
                              }
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t.label}</TooltipContent>
                      </Tooltip>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </>
          );
        })()}

        {/* Listings Tab (Movies, Live Events) */}
        <TabsContent value="listings">
          <Tabs value={activeScheduleTab} onValueChange={setActiveScheduleTab} defaultValue="movies" className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <TabsList>
                <TabsTrigger value="movies">Movies</TabsTrigger>
                <TabsTrigger value="live-events">Live Events</TabsTrigger>
                <TabsTrigger value="venues">Venues</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="movies">
            <SquareLinkPanel scope="movies" title="Square catalog — movies" />
            {/* The showtime half of the old Square screen, scoped to this
                listing. Its own tab is gone: the work is about these titles,
                so it belongs beside them rather than one tab away. */}
            <CollapsibleSection
              id="listings.movies.square"
              title="Showtimes in Square"
              icon={Store}
            >
              <SquareCatalogTab showPasses={false} kinds={['movie']} />
            </CollapsibleSection>
            <CollapsibleSection
              id="listings.movies"
              title="Movies"
              count={filteredMovies.length}
              defaultOpen
              actions={
                <>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/admin/showings/new"><Plus className="h-4 w-4 mr-1" /> Add Showing</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link to="/admin/movies/new"><Plus className="h-4 w-4 mr-1" /> Add Movie</Link>
                  </Button>
                </>
              }
            >
            {listingFilters}
            <div className="space-y-4">
              {filteredMovies.map(movie => {
                const movieShowings = getMovieShowings(movie.id);
                return (
                  <Card key={movie.id} className="glass">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Film className="h-5 w-5 text-primary" />
                          <div>
                            <p className="font-medium">{movie.title}</p>
                            <div className="flex gap-2 mt-1">
                              {movie.rating && <Badge variant="secondary" className="text-xs">{movie.rating}</Badge>}
                              {movie.genre && <Badge variant="outline" className="text-xs">{movie.genre}</Badge>}
                              <Badge variant={movie.is_active ? 'default' : 'secondary'} className="text-xs">
                                {movie.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" title="Preview as public" onClick={() => openPreview(movie, 'movie')}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/admin/movies/${movie.id}`}><Edit className="h-4 w-4" /></Link>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteItem('movies', movie.id, 'Movie')}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {movieShowings.length > 0 && (
                        <div className="mt-3 pl-8 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Showings</p>
                          {movieShowings.map(showing => (
                            <div key={showing.id} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
                              <div className="flex gap-2 items-center flex-wrap">
                                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-sm">
                                  {formatShowtime(showing.start_time, 'MMM d, yyyy h:mm a')}
                                </span>
                                <span className="text-sm text-muted-foreground">• ${Number(showing.ticket_price).toFixed(2)}</span>
                                {showing.venues?.name && (
                                  <Badge variant="secondary" className="text-xs">{showing.venues.name}</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <TicketCountBadge
                                  sold={getTicketsSoldForShowing(showing.id)}
                                  scanned={getScannedForShowing(showing.id)}
                                  capacity={showing.total_seats || 0}
                                  onClick={() =>
                                    openAttendees(
                                      `${movie.title} — ${formatShowtime(showing.start_time, 'MMM d, yyyy h:mm a')}`,
                                      [showing.id],
                                      showing.total_seats || 0
                                    )
                                  }
                                />
                                <Button variant="ghost" size="sm" asChild>
                                  <Link to={`/admin/showings/${showing.id}`}><Edit className="h-3.5 w-3.5" /></Link>
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteItem('showings', showing.id, 'Showing')}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {filteredMovies.length === 0 && <p className="text-muted-foreground text-center py-8">No movies match the filters.</p>}
            </div>
            </CollapsibleSection>
            </TabsContent>
            <TabsContent value="live-events">
            <SquareLinkPanel scope="live_performances" title="Square catalog — live events" />
            {/* The showtime half of the old Square screen, scoped to this
                listing. Its own tab is gone: the work is about these titles,
                so it belongs beside them rather than one tab away. */}
            <CollapsibleSection
              id="listings.live-events.square"
              title="Showtimes in Square"
              icon={Store}
            >
              <SquareCatalogTab showPasses={false} kinds={['event', 'live_performance']} />
            </CollapsibleSection>
            <CollapsibleSection
              id="listings.live-events"
              title="Live Events"
              count={filteredLiveEvents.length}
              defaultOpen
              actions={
                <>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/admin/concerts/new"><Plus className="h-4 w-4 mr-1" /> Add Performance</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link to="/admin/events/new"><Plus className="h-4 w-4 mr-1" /> Add Event</Link>
                  </Button>
                </>
              }
            >
            {listingFilters}
            <div className="space-y-3">
              {filteredLiveEvents.map(item => {
                const isEvent = item.kind === 'event';
                const isConcert = item.kind === 'concert';
                const { sold, scanned, capacity } = isEvent
                  ? getTicketsSoldForEvent(item.id)
                  : getTicketsSoldForConcert(item.id);
                return (
                  <Card key={`${item.kind}-${item.id}`} className="glass">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isEvent ? <PartyPopper className="h-5 w-5 text-primary" /> : <Music className="h-5 w-5 text-primary" />}
                        <div>
                          <p className="font-medium">{item.title}</p>
                          <div className="flex gap-2 mt-1">
                            {isEvent && (
                              <Badge variant="outline" className="text-xs capitalize">{item.ticket_type.replace('_', ' ')}</Badge>
                            )}
                            {isConcert && item.subcategory && (
                              <Badge variant="outline" className="text-xs capitalize">
                                {item.subcategory.replace(/_/g, ' ')}
                              </Badge>
                            )}
                            {isConcert && item.genre && <Badge variant="outline" className="text-xs">{item.genre}</Badge>}
                            <Badge variant={item.is_active ? 'default' : 'secondary'} className="text-xs">
                              {item.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <TicketCountBadge
                          sold={sold}
                          scanned={scanned}
                          capacity={capacity}
                          onClick={() =>
                            openAttendees(
                              item.title,
                              showingsForProduction(item.kind, item.id).map(s => s.id),
                              capacity
                            )
                          }
                        />
                        <Button variant="ghost" size="sm" title="Preview as public" onClick={() => openPreview(item, item.kind)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" title="Export contacts" onClick={async () => {
                          const count = await exportContactsCsv(item.kind, item.id, item.title);
                          if (count === null) toast.info('No attendees found');
                          else toast.success(`Exported ${count} contacts`);
                        }}>
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/admin/${item.kind}s/${item.id}`}><Edit className="h-4 w-4" /></Link>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteItem(item.kind === 'event' ? 'events' : 'live_performances', item.id, item.kind === 'event' ? 'Event' : 'Live Performance')}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {filteredLiveEvents.length === 0 && <p className="text-muted-foreground text-center py-8">No live events match the filters.</p>}
            </div>
            </CollapsibleSection>
            </TabsContent>
            {/* Venues. Previously reachable only by typing /admin/venues/new,
                which is why the theatre ran for months with no venue row at all
                and an empty venue picker on every showing. */}
            <TabsContent value="venues">
            <CollapsibleSection
              id="listings.venues"
              title="Venues"
              count={venues.length}
              defaultOpen
              actions={
                <Button size="sm" asChild>
                  <Link to="/admin/venues/new"><Plus className="h-4 w-4 mr-1" /> Add Venue</Link>
                </Button>
              }
            >
            <div className="space-y-3">
              {venues.map(venue => {
                // venue_seats(count) comes back as [{ count: n }], or [] when the
                // venue has no seats. A venue flagged as having a seat map but
                // holding no seats is exactly the state this whole fix was about,
                // so it is called out rather than left to be inferred.
                const seatCount = venue.venue_seats?.[0]?.count ?? 0;
                const showingCount = showings.filter(s => s.venue_id === venue.id).length;
                const flaggedButEmpty = venue.has_assigned_seating && seatCount === 0;
                return (
                  <Card key={venue.id} className="glass">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Building2 className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">{venue.name}</p>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            <Badge variant="secondary" className="text-xs">
                              {venue.total_seats} seats
                            </Badge>
                            <Badge variant={venue.has_assigned_seating ? 'default' : 'outline'} className="text-xs">
                              {venue.has_assigned_seating ? `Seat map · ${seatCount}` : 'No seat map'}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {showingCount} {showingCount === 1 ? 'showing' : 'showings'}
                            </Badge>
                            <Badge variant={venue.is_active ? 'default' : 'secondary'} className="text-xs">
                              {venue.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          {flaggedButEmpty && (
                            <p className="text-xs text-amber-500 mt-1">
                              Marked as having a seat map, but no seats are attached — assigned
                              seating here would show an empty picker.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/admin/venues/${venue.id}`}><Edit className="h-4 w-4" /></Link>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteVenue(venue, seatCount, showingCount)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {venues.length === 0 && (
                <p className="text-muted-foreground text-center py-8">
                  No venues yet. Add one so showings have a room to sit in.
                </p>
              )}
            </div>
            </CollapsibleSection>
            </TabsContent>

          </Tabs>
        </TabsContent>

        {/* Concessions Tab */}
        <TabsContent value="concessions">
          <Tabs defaultValue="items" className="space-y-4">
            <TabsList>
              <TabsTrigger value="items">Items & combos</TabsTrigger>
              <TabsTrigger value="menus">Menu PDFs</TabsTrigger>
            </TabsList>
            <TabsContent value="items">
              <ConcessionItemsTab />
            </TabsContent>
            <TabsContent value="menus">
              <ConcessionMenusTab />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Film Passes Tab.
            The Square panel sits with the thing it is about rather than under
            Analytics, where someone editing a pass had to know to look. */}
        <TabsContent value="passes" className="space-y-4">
          <SquareLinkPanel scope="passes" title="Square catalog — passes" />
          <FilmPassesTab />
        </TabsContent>

        {/* DVDs Tab */}
        <TabsContent value="dvds">
          <DvdLibraryTab />
        </TabsContent>

        {/* Analytics Tab (with Accounting sub-tab) — admin only */}
        {isAdmin && (
        <TabsContent value="analytics">
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview"><BarChart3 className="h-4 w-4 mr-1 inline" />Overview</TabsTrigger>
              {FINANCIAL_IMPORTS_ENABLED && (
                <TabsTrigger value="accounting"><Wallet className="h-4 w-4 mr-1 inline" />Imports</TabsTrigger>
              )}
              <TabsTrigger value="coa">Chart of Accounts</TabsTrigger>
              <TabsTrigger value="mappings">Mappings</TabsTrigger>
              <TabsTrigger value="qbo-export">QBO Export</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <AnalyticsTab />
            </TabsContent>
            {/* Hidden, not deleted — the workbook import is not part of the
                workflow yet (see FINANCIAL_IMPORTS_ENABLED). */}
            {FINANCIAL_IMPORTS_ENABLED && (
              <TabsContent value="accounting">
                <AccountingTab />
              </TabsContent>
            )}
            <TabsContent value="coa"><ChartOfAccountsTab /></TabsContent>
            <TabsContent value="mappings"><AccountMappingsTab /></TabsContent>
            <TabsContent value="qbo-export"><QboExportTab /></TabsContent>
          </Tabs>
        </TabsContent>
        )}

        <TabsContent value="bor">
          <BoxOfficeReceiptsTab />
        </TabsContent>

        {/* Rentals Tab (with Hosts sub-tab) */}
        <TabsContent value="rentals">
          <Tabs defaultValue="requests" className="space-y-4">
            <TabsList>
              <TabsTrigger value="requests"><KeyRound className="h-4 w-4 mr-1 inline" />Requests</TabsTrigger>
              <TabsTrigger value="hosts"><Users className="h-4 w-4 mr-1 inline" />Hosts</TabsTrigger>
            </TabsList>
            <TabsContent value="requests">
              <RentalRequestsTab />
            </TabsContent>
            <TabsContent value="hosts">
              <HostManagementTab />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="labor">
            <LaborTab />
          </TabsContent>
        )}

        <TabsContent value="sponsors">
          <SponsorsTab />
        </TabsContent>

        {/* Pages — each sub-tab edits one public page. Admin-only, which is
            also what the RLS behind all three enforces. */}
        {isAdmin && (
          <TabsContent value="pages">
            <Tabs value={activePagesTab} onValueChange={setActivePagesTab} className="space-y-4">
              <TabsList>
                <TabsTrigger value="festival">
                  <Film className="h-4 w-4 mr-1 inline" />Silent Film Festival
                </TabsTrigger>
                <TabsTrigger value="hiring">
                  <Briefcase className="h-4 w-4 mr-1 inline" />Hiring
                </TabsTrigger>
                <TabsTrigger value="press">
                  <Newspaper className="h-4 w-4 mr-1 inline" />Press
                </TabsTrigger>
                <TabsTrigger value="backstage">
                  <Martini className="h-4 w-4 mr-1 inline" />Backstage
                </TabsTrigger>
              </TabsList>
              <TabsContent value="festival">
                <FestivalProgramsTab />
              </TabsContent>
              <TabsContent value="hiring">
                <HiringTab />
              </TabsContent>
              <TabsContent value="press">
                <PressTab />
              </TabsContent>
              <TabsContent value="backstage">
                <BackstageTab />
              </TabsContent>
            </Tabs>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="mailchimp">
            <MailchimpTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="lgl">
            <LglTab />
          </TabsContent>
        )}
      </Tabs>

      {/* The public drawer, reused verbatim so preview can't drift from the real thing. */}
      <ProductionDetailDrawer
        production={previewProduction}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />

      <AttendeeSheet
        open={attendeeOpen}
        onOpenChange={setAttendeeOpen}
        title={attendeeTarget?.title ?? ''}
        showingIds={attendeeTarget?.showingIds ?? []}
        capacity={attendeeTarget?.capacity ?? 0}
      />
    </div>
  );
}
