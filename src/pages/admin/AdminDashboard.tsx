import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { collectGenres, hasGenre, parseGenres } from '@/lib/genres';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UndeliveredOrdersCard } from '@/components/admin/UndeliveredOrdersCard';
import { MarqueeFrame } from '@/components/MarqueeFrame';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Film, Plus, Calendar, Ticket, Edit, Trash2, Music, PartyPopper, BarChart3, UtensilsCrossed, CreditCard, Download, Users, Wallet, KeyRound, FileText, Clock, Handshake, History, Disc, Search, X, ChevronLeft, ChevronRight, Mail, Heart, Eye, Building2, Briefcase, Newspaper, Martini, Store, Receipt, Lock, LockOpen, Star
} from 'lucide-react';
import { ProductionDetailDrawer } from '@/components/ProductionDetailDrawer';
import { AttendeeSheet } from '@/components/admin/AttendeeSheet';
import { CollapsibleSection } from '@/components/admin/CollapsibleSection';
import { ProductionShowings, TicketCountBadge } from '@/components/admin/ProductionShowings';
import { liveEventTypeLabel, ticketingLabel } from '@/lib/liveEventTypes';
import AnalyticsTab from '@/components/admin/AnalyticsTab';
import TransactionsTab from '@/components/admin/TransactionsTab';
import ConcessionItemsTab from '@/components/admin/ConcessionItemsTab';
import ConcessionMenusTab from '@/components/admin/ConcessionMenusTab';
import FestivalProgramsTab from '@/components/admin/FestivalProgramsTab';
import { SquareLinkPanel } from '@/components/admin/SquareLinkPanel';
import SquareCatalogTab from '@/components/admin/SquareCatalogTab';
import {
  DEFAULT_PAGES_TAB,
  DEFAULT_SCHEDULE_TAB,
  resolveAdminSection,
} from '@/lib/adminSections';
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
import FeaturedSlidesTab from '@/components/admin/FeaturedSlidesTab';
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

export default function AdminDashboard() {
  const { isAdmin, isSuperadmin, loading: authLoading } = useAuth();
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
  /*
   * Every tab on this screen is a query parameter, so every value of one is a
   * link somebody may have bookmarked. Festival, Hiring and Press were each a
   * top-level tab until the dashboard outgrew a single row; the curator's-pick
   * editor was a sub-tab of Pages until it moved to Listings. Old links to all
   * of those still land on the right panel — the rule, and the reason it is a
   * rule, is `adminSections.ts`.
   */
  const initialTabs = resolveAdminSection(
    searchParams.get('section'),
    searchParams.get('page'),
    searchParams.get('tab'),
  );
  const [activeScheduleTab, setActiveScheduleTab] = useState(() => initialTabs.scheduleTab);
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
    setOrDel('tab', activeScheduleTab, DEFAULT_SCHEDULE_TAB);
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

  // Admin, not staff. This read `!isStaff` for as long as the dashboard was
  // the only door in the building — which is what put the till behind it. The
  // counter has /staff now, so this side is management only.
  //
  // The route is wrapped in AdminOnly too, which refuses before this component
  // mounts; this stays as the second half of the same statement, and as what
  // catches a role that changes under an open tab. It also means the
  // `show: isAdmin` flags on the tabs below are now always true — left alone
  // deliberately, so that widening the gate later cannot silently widen the
  // tabs with it.
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }
    loadData();
  }, [isAdmin, authLoading, navigate]);

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
  const uniqueMovieGenres = collectGenres(movies.map(m => m.genre));
  // Both tables carry both fields now, so the two filters read across both
  // rather than one applying to events and the other to performances.
  const uniqueEventTypes = Array.from(new Set(
    [...events, ...concerts].map((r: any) => r.ticket_type).filter(Boolean)
  )).sort();
  const uniqueConcertSubcategories = Array.from(new Set(
    [...events, ...concerts].map((r: any) => r.subcategory).filter(Boolean)
  )).sort();
  const uniqueConcertGenres = collectGenres([...events, ...concerts].map((r: any) => r.genre));

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
    (genreFilter === 'all' || hasGenre(m.genre, genreFilter))
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
      (eventTypeFilter === 'all' || item.ticket_type === eventTypeFilter) &&
      (concertSubcategoryFilter === 'all' || item.subcategory === concertSubcategoryFilter) &&
      (genreFilter === 'all' || hasGenre(item.genre, genreFilter))
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

  /**
   * Close a showing to online sales by hand, or reopen it.
   *
   * Operational, not editorial — the house fills through a phone call or a
   * block booking and somebody needs the website to stop selling within the
   * minute, so it lives on the row rather than three clicks into the edit
   * form. The form carries the same flag for whoever is already in there.
   *
   * This is NOT Deactivate. Deactivating hides the showing from the site
   * entirely; this leaves it listed, dated and readable, and only stops it
   * selling. Conflating the two is how a sold-out night disappears from the
   * calendar and the box office starts fielding "is it cancelled?" calls.
   *
   * The staff counter is deliberately unaffected: StaffPOS and comps insert
   * tickets straight through PostgREST and never pass the gate this sets. See
   * the migration for why that asymmetry is the point.
   *
   * `.select()` and a row-count assertion because an RLS denial comes back as
   * a 204 with no error — without this the button would report success while
   * changing nothing, which on this particular control means staff believing
   * the website is closed while it quietly keeps selling.
   */
  const toggleSoldOut = async (showing: any) => {
    const next = !showing.manually_sold_out;
    const { data, error } = await supabase
      .from('showings')
      .update({ manually_sold_out: next })
      .eq('id', showing.id)
      .select('id');

    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) {
      toast.error('That did not save — you may not have permission to change this showing.');
      return;
    }

    toast.success(next ? 'Marked sold out — online sales are closed' : 'Reopened — online sales have resumed');
    loadData();
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
                <SelectValue placeholder="Ticketing" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ticketing</SelectItem>
                {uniqueEventTypes.map(t => (
                  <SelectItem key={t} value={t}>{ticketingLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={concertSubcategoryFilter} onValueChange={setConcertSubcategoryFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {uniqueConcertSubcategories.map(s => (
                  <SelectItem key={s} value={s}>{liveEventTypeLabel(s)}</SelectItem>
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
    <div className="container py-8 px-4 md:py-10">
      {/* At a glance: the four running counts, and the way out to the audit log.

          The page used to open with an `h1 "Admin Dashboard"`. It named the
          screen you had already chosen and never named the section you were
          actually in, which is the orientation gap the framed title below
          closes — so the h1 moved there, and this row keeps a caption only.

          A caption and not an `h2`: the h1 now sits *below* this block, and a
          heading here would put an h2 above it and invert the document
          outline. The `section` still gets the name via `aria-labelledby`,
          which accepts any element, so the grouping survives without the
          heading. */}
      <section aria-labelledby="admin-glance" className="mb-10 md:mb-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <p
            id="admin-glance"
            className="font-display text-sm uppercase tracking-widest text-muted-foreground"
          >
            At a glance
          </p>
          {/* The box office and the door scanner used to be shortcuts here too.
              They are not admin work — they are the two things a volunteer does
              on a shift — and they already have a home on /staff, which is one
              click away in the header on every page. Two buttons pointing out of
              this screen made the row read as a launcher rather than as a
              heading. */}
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/admin/audit-log"><History className="h-4 w-4 mr-1" /> Activity Log</Link>
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
          <Card className="glass">
            <CardContent className="p-4 md:p-5 flex items-center gap-3">
              <Film className="h-6 w-6 text-primary" />
              <div>
                <p className="text-xl font-bold">{movies.length}</p>
                <p className="text-xs text-muted-foreground">Movies</p>
              </div>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardContent className="p-4 md:p-5 flex items-center gap-3">
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
            <CardContent className="p-4 md:p-5 flex items-center gap-3">
              <Calendar className="h-6 w-6 text-primary" />
              <div>
                <p className="text-xl font-bold">{showings.length}</p>
                <p className="text-xs text-muted-foreground">Showings</p>
              </div>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardContent className="p-4 md:p-5 flex items-center gap-3">
              <Ticket className="h-6 w-6 text-primary" />
              <div>
                <p className="text-xl font-bold">{ticketCount}</p>
                <p className="text-xs text-muted-foreground">Tickets Sold</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Above the tabs, and only when it has something to say. Delivery is
          fire-and-forget so a failed send is silent everywhere else — the buyer
          is charged, the tickets are valid, and nobody is told. This is the
          only screen that reads confirmation_error back. */}
      <UndeliveredOrdersCard />

      <Tabs value={activeTopTab} onValueChange={setActiveTopTab} className="space-y-6 md:space-y-8">
        {(() => {
          /* Twelve equal glyphs in one flat row was a memory test. The bar
             said nothing about which tools belong with which, so finding one
             meant scanning all of them — the "cluster to clarify" ask.

             Declared as groups and flattened for the pager, rather than kept
             flat and grouped at render time: the mobile ‹ › order and the
             desktop bar then read from one list and cannot drift apart.

             Filtering runs per group and then drops the empties. It has to be
             that way round for a non-admin: five of the twelve are `isAdmin`,
             and Site is all of Pages, so a plain filter would leave a "SITE"
             caption sitting over a divider with nothing under it. */
          const tabGroups = [
            {
              label: 'Programming',
              tabs: [
                { value: 'listings', label: 'Listings', icon: Calendar, show: true },
                { value: 'passes', label: 'Passes', icon: CreditCard, show: true },
                { value: 'concessions', label: 'Concessions', icon: UtensilsCrossed, show: true },
                { value: 'dvds', label: 'DVDs', icon: Disc, show: true },
              ],
            },
            {
              label: 'Operations',
              tabs: [
                { value: 'rentals', label: 'Rentals', icon: KeyRound, show: true },
                { value: 'labor', label: 'Staff', icon: Clock, show: isAdmin },
                { value: 'bor', label: 'BOR', icon: FileText, show: true },
              ],
            },
            {
              label: 'Audience & Growth',
              tabs: [
                { value: 'sponsors', label: 'Sponsors', icon: Handshake, show: true },
                { value: 'analytics', label: 'Analytics', icon: BarChart3, show: isAdmin },
                { value: 'mailchimp', label: 'Mailchimp', icon: Mail, show: isAdmin },
                { value: 'lgl', label: 'LGL', icon: Heart, show: isAdmin },
              ],
            },
            {
              label: 'Site',
              tabs: [
                { value: 'pages', label: 'Pages', icon: Globe, show: isAdmin },
              ],
            },
          ]
            .map(g => ({ ...g, tabs: g.tabs.filter(t => t.show) }))
            .filter(g => g.tabs.length > 0);
          const topTabs = tabGroups.flatMap(g => g.tabs);
          const currentIdx = Math.max(0, topTabs.findIndex(t => t.value === activeTopTab));
          const current = topTabs[currentIdx] ?? topTabs[0];
          const goPrev = () => setActiveTopTab(topTabs[(currentIdx - 1 + topTabs.length) % topTabs.length].value);
          const goNext = () => setActiveTopTab(topTabs[(currentIdx + 1) % topTabs.length].value);
          const CurrentIcon = current.icon;
          return (
            <>
              {/* You are here.

                  The desktop bar is glyphs only: the label lives in a tooltip,
                  so the name of the section you are *in* was never on screen —
                  the one thing a twelve-way switch has to tell you. This is
                  that name, in the ring of bulbs off the Kenworthy's own
                  marquee, directly above the bar it labels.

                  It is the page's `h1`. The old one read "Admin Dashboard",
                  naming the screen you had already chosen; this one changes
                  with the tab and answers the question the screen was actually
                  raising.

                  `MarqueeFrame` is reused, not rebuilt — same component as the
                  concessions menu, worn lighter through `.marquee-frame--title`
                  (see index.css). The ring is ornamental and `aria-hidden`
                  inside the component, so the heading is the whole accessible
                  name, and the frame is static: nothing here animates, so
                  there is no reduced-motion case to answer yet. */}
              <MarqueeFrame className="marquee-frame--title text-center">
                <h1 className="flex flex-wrap items-center justify-center gap-3 font-display text-2xl font-bold uppercase tracking-wider md:text-3xl">
                  {/* Desktop only. On a phone the glyph directly below this, in
                      the pager, is already the lit one for this section — the
                      title carries the name and the pager carries the mark, and
                      showing both twice in two inches read as a stutter. From
                      `md` the pager is gone and the bar is twelve glyphs, so the
                      title's own icon is the only thing tying the name to the
                      one that is lit. */}
                  <span className="relative hidden shrink-0 items-center justify-center md:flex">
                    <CurrentIcon
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="absolute h-7 w-7 text-accent opacity-70 blur-[4px] md:h-8 md:w-8"
                    />
                    <CurrentIcon
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="relative h-7 w-7 glyph-lit md:h-8 md:w-8"
                    />
                  </span>
                  {current.label}
                </h1>
              </MarqueeFrame>

              {/* Mobile: arrow pager.

                  Kept whole, label and counter included. The framed title above
                  says where you are; the pager says where you are in the run of
                  twelve and moves you, and stripping it to bare arrows would
                  have made the control stop describing itself on the one
                  surface with no tooltips to fall back on. */}
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
                {/* The lit glyph alone. The framed title directly above already
                    names the section, and repeating it here put the same word on
                    screen twice within an inch of itself.

                    Nothing accessible is lost with the text gone: this box is
                    not a control — the two arrows are, and they keep their own
                    labels — and the `h1` above is still the section's accessible
                    name. So the glyph is decorative here and marked as such. */}
                <div
                  aria-hidden="true"
                  className="flex-1 min-w-0 flex items-center justify-center h-10 rounded-md border border-input bg-muted/40 px-3"
                >
                  <span className="relative flex items-center justify-center shrink-0">
                    <CurrentIcon aria-hidden="true" strokeWidth={1.75} className="absolute h-7 w-7 text-accent opacity-70 blur-[4px]" />
                    <CurrentIcon aria-hidden="true" strokeWidth={1.75} className="relative h-7 w-7 glyph-lit" />
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
              <TabsList className="hidden md:flex w-full h-auto items-stretch gap-1 p-1.5">
                {tabGroups.map((group, groupIdx) => (
                  <Fragment key={group.label}>
                    {groupIdx > 0 && (
                      /* A rule, not just a gap. At these widths the run of
                         glyphs is tight enough that proximity alone did not
                         read as a break.

                         `aria-hidden`, and a sibling of the triggers rather
                         than one of them: a `tablist` may only own tabs, so
                         this stays out of the accessibility tree and out of
                         Radix's roving-focus order. Arrow keys still walk the
                         twelve tabs and skip the rules. */
                      <div aria-hidden="true" className="w-px self-stretch bg-border" />
                    )}
                    <div
                      className="min-w-0"
                      /* Grow by tab count on a zero basis, so a glyph is the
                         same size in every group. A plain `flex-1` per group
                         would give Site's one icon the same width as
                         Programming's four and stretch it four times over. */
                      style={{ flexGrow: group.tabs.length, flexBasis: 0 }}
                    >
                      {/* Fixed height, bottom-aligned, and it has to be both:
                          "Audience & Growth" wraps to two lines in a narrow
                          group while "Site" stays on one, and without a shared
                          height the wrapped caption pushed its own glyphs a
                          line lower than every other group's. The icon row has
                          to start at one y across the bar or the grouping reads
                          as a mistake.

                          The solid muted token, not a faded variant: the faded
                          ones fall under 4.5:1 on this background. */}
                      <p className="flex min-h-[2.25rem] items-end justify-center px-1 pb-1.5 text-center text-xs uppercase leading-tight tracking-wider text-muted-foreground">
                        {group.label}
                      </p>
                      {/* Capped and centred inside the group's share of the bar.

                          Without the cap the run stretches to fill its share, and
                          a four-glyph group on a wide screen spreads its icons
                          further apart than the gap to the next group — which
                          inverts the proximity the grouping is built on and
                          makes the clusters stop reading as clusters. Capping
                          the pitch spends the surplus width *between* groups
                          instead of inside them. Below the cap it stretches as
                          before, so nothing overflows on a narrow screen. */}
                      <div
                        className="mx-auto grid w-full"
                        style={{
                          gridTemplateColumns: `repeat(${group.tabs.length}, minmax(0, 1fr))`,
                          maxWidth: `${group.tabs.length * 4}rem`,
                        }}
                      >
                        {group.tabs.map(t => {
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
                              className="h-12 px-1 lg:px-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="relative flex items-center justify-center">
                                    {/* The glow is the icon, drawn a second time.
                                
                                        A radial gradient behind the glyph lit the *area*
                                        and read as a spotlight on a button. Light that
                                        follows the shape has to be drawn from the shape,
                                        so the back copy is the same glyph in gold, blurred;
                                        the front copy sits on top and masks the middle,
                                        which leaves the glow escaping around the strokes. */}
                                    {isActive && (
                                      <Icon
                                        aria-hidden="true"
                                        strokeWidth={1.75}
                                        className="absolute h-10 w-10 text-accent opacity-70 blur-[5px]"
                                      />
                                    )}
                                    <Icon
                                      aria-hidden="true"
                                      /* Bolder while selected, which a stroke weight does
                                         and a font weight cannot: these are strokes, not text. */
                                      /* One weight for both states now. Selection is
                                         carried by size, colour and the glow; a heavier
                                         stroke on top of those read as clotted at 45px. */
                                      strokeWidth={1.75}
                                      className={
                                        'relative shrink-0 transition-all duration-200 ' +
                                        /* The bar's own `bg-muted`, so the lit glyph reads as
                                           a cut-out with the background showing through the
                                           glow rather than as a black shape laid over it. */
                                        (isActive
                                          ? 'h-10 w-10 glyph-lit opacity-90 blur-[0.4px]'
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
                      </div>
                    </div>
                  </Fragment>
                ))}
              </TabsList>
            </>
          );
        })()}

        {/* Listings Tab (Movies, Live Events) */}
        <TabsContent value="listings" className="space-y-6">
          <Tabs value={activeScheduleTab} onValueChange={setActiveScheduleTab} defaultValue="movies" className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <TabsList>
                <TabsTrigger value="movies">Movies</TabsTrigger>
                <TabsTrigger value="live-events">Live Events</TabsTrigger>
                <TabsTrigger value="venues">Venues</TabsTrigger>
                {/* Not a fourth kind of listing — it is what the listings
                    promote. The flags that fill the home page's carousel are
                    set on the forms in the three tabs beside this one, so the
                    screen that gathers them belongs next to them rather than
                    among the page editors. */}
                <TabsTrigger value="featured">
                  <Star className="h-4 w-4 mr-1 inline" />Featured
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="movies" className="space-y-6">
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
                    <Link to="/admin/showings/new?kind=movie"><Plus className="h-4 w-4 mr-1" /> Add Showing</Link>
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
                            <div className="flex flex-wrap gap-2 mt-1">
                              {movie.rating && <Badge variant="secondary" className="text-xs">{movie.rating}</Badge>}
                              {parseGenres(movie.genre).map(g => <Badge key={g} variant="outline" className="text-xs">{g}</Badge>)}
                              <Badge variant={movie.is_active ? 'default' : 'secondary'} className="text-xs">
                                {movie.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" title="Add showing" asChild>
                            <Link to={`/admin/showings/new?kind=movie&movie=${movie.id}`}><Calendar className="h-4 w-4" /></Link>
                          </Button>
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
                      <ProductionShowings
                        showings={movieShowings}
                        productionTitle={movie.title}
                        getSold={getTicketsSoldForShowing}
                        getScanned={getScannedForShowing}
                        onOpenAttendees={openAttendees}
                        onToggleSoldOut={toggleSoldOut}
                        onDeleteShowing={id => deleteItem('showings', id, 'Showing')}
                      />
                    </CardContent>
                  </Card>
                );
              })}
              {filteredMovies.length === 0 && <p className="text-muted-foreground text-center py-8">No movies match the filters.</p>}
            </div>
            </CollapsibleSection>
            </TabsContent>
            <TabsContent value="live-events" className="space-y-6">
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
              /* Add Show and Add Event, mirroring Movies' Add Showing and Add
                 Movie. "Add Performance" is gone: a performance is a type of
                 event now, chosen inside the form, not a second button beside
                 it. Add Show is safe here in a way it wasn't before — ?kind
                 keeps the picker on events and performances, so it can no
                 longer land on a film. */
              actions={
                <>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/admin/showings/new?kind=live"><Plus className="h-4 w-4 mr-1" /> Add Show</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link to="/admin/events/new"><Plus className="h-4 w-4 mr-1" /> Add Event</Link>
                  </Button>
                </>
              }
            >
            {listingFilters}
            <div className="space-y-4">
              {filteredLiveEvents.map(item => {
                const isEvent = item.kind === 'event';
                const isConcert = item.kind === 'concert';
                const { sold, scanned, capacity } = isEvent
                  ? getTicketsSoldForEvent(item.id)
                  : getTicketsSoldForConcert(item.id);
                const itemShowings = showingsForProduction(item.kind, item.id);
                // Only a ticketed event can hold a showing — the showing form
                // lists ticketed events and nothing else, so offering the
                // button on an RSVP or info-only card would open a picker that
                // cannot reach the title it was opened from. Those are dated by
                // their RSVP link, or not dated at all.
                const canAddShowing = item.ticket_type === 'ticketed';
                const showingScope = isEvent ? `kind=live&event=${item.id}` : `kind=live&performance=${item.id}`;
                return (
                  <Card key={`${item.kind}-${item.id}`} className="glass">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isEvent ? <PartyPopper className="h-5 w-5 text-primary" /> : <Music className="h-5 w-5 text-primary" />}
                          <div>
                            <p className="font-medium">{item.title}</p>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {/* What it is, then how people get in — the two
                                  fields the create form now asks for, said in
                                  the same order on every card. An untyped row
                                  is one created before the type existed; it
                                  shows nothing rather than a guess. */}
                              {liveEventTypeLabel(item.subcategory) && (
                                <Badge variant="outline" className="text-xs">
                                  {liveEventTypeLabel(item.subcategory)}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs">
                                {ticketingLabel(item.ticket_type) ?? 'Ticketed'}
                              </Badge>
                              {parseGenres(item.genre).map(g => <Badge key={g} variant="outline" className="text-xs">{g}</Badge>)}
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
                                itemShowings.map(s => s.id),
                                capacity
                              )
                            }
                          />
                          {/* Scoped to this title, so the showing form opens on
                              it instead of on an empty Movie picker. */}
                          {canAddShowing && (
                            <Button variant="ghost" size="sm" title="Add show" asChild>
                              <Link to={`/admin/showings/new?${showingScope}`}><Calendar className="h-4 w-4" /></Link>
                            </Button>
                          )}
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
                      </div>
                      <ProductionShowings
                        showings={itemShowings}
                        productionTitle={item.title}
                        heading="Shows"
                        getSold={getTicketsSoldForShowing}
                        getScanned={getScannedForShowing}
                        onOpenAttendees={openAttendees}
                        onToggleSoldOut={toggleSoldOut}
                        onDeleteShowing={id => deleteItem('showings', id, 'Showing')}
                      />
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
            <TabsContent value="venues" className="space-y-6">
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

            <TabsContent value="featured" className="space-y-6">
              <FeaturedSlidesTab />
            </TabsContent>

          </Tabs>
        </TabsContent>

        {/* Concessions Tab */}
        <TabsContent value="concessions" className="space-y-6">
          <Tabs defaultValue="items" className="space-y-4">
            <TabsList>
              <TabsTrigger value="items">Items & combos</TabsTrigger>
              <TabsTrigger value="menus">Menu PDFs</TabsTrigger>
            </TabsList>
            <TabsContent value="items" className="space-y-6">
              <ConcessionItemsTab />
            </TabsContent>
            <TabsContent value="menus" className="space-y-6">
              <ConcessionMenusTab />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Film Passes Tab.
            The Square panel sits with the thing it is about rather than under
            Analytics, where someone editing a pass had to know to look. */}
        <TabsContent value="passes" className="space-y-6">
          <SquareLinkPanel scope="passes" title="Square catalog — passes" />
          <FilmPassesTab />
        </TabsContent>

        {/* DVDs Tab */}
        <TabsContent value="dvds" className="space-y-6">
          <DvdLibraryTab />
        </TabsContent>

        {/* Analytics Tab (with Accounting sub-tab) — admin only */}
        {isAdmin && (
        <TabsContent value="analytics" className="space-y-6">
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview"><BarChart3 className="h-4 w-4 mr-1 inline" />Overview</TabsTrigger>
              {/* Beside the Overview rather than as a thirteenth top-level tab:
                  the two read the same Square account for the same range, one
                  aggregated and one transaction by transaction, and they are
                  the pair you check against each other. */}
              <TabsTrigger value="transactions"><Receipt className="h-4 w-4 mr-1 inline" />Transactions</TabsTrigger>
              {FINANCIAL_IMPORTS_ENABLED && (
                <TabsTrigger value="accounting"><Wallet className="h-4 w-4 mr-1 inline" />Imports</TabsTrigger>
              )}
              <TabsTrigger value="coa">Chart of Accounts</TabsTrigger>
              <TabsTrigger value="mappings">Mappings</TabsTrigger>
              <TabsTrigger value="qbo-export">QBO Export</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-6">
              <AnalyticsTab />
            </TabsContent>
            <TabsContent value="transactions" className="space-y-6">
              <TransactionsTab />
            </TabsContent>
            {/* Hidden, not deleted — the workbook import is not part of the
                workflow yet (see FINANCIAL_IMPORTS_ENABLED). */}
            {FINANCIAL_IMPORTS_ENABLED && (
              <TabsContent value="accounting" className="space-y-6">
                <AccountingTab />
              </TabsContent>
            )}
            <TabsContent value="coa" className="space-y-6"><ChartOfAccountsTab /></TabsContent>
            <TabsContent value="mappings" className="space-y-6"><AccountMappingsTab /></TabsContent>
            <TabsContent value="qbo-export" className="space-y-6"><QboExportTab /></TabsContent>
          </Tabs>
        </TabsContent>
        )}

        <TabsContent value="bor" className="space-y-6">
          <BoxOfficeReceiptsTab />
        </TabsContent>

        {/* Rentals Tab (with Hosts sub-tab) */}
        <TabsContent value="rentals" className="space-y-6">
          <Tabs defaultValue="requests" className="space-y-4">
            <TabsList>
              <TabsTrigger value="requests"><KeyRound className="h-4 w-4 mr-1 inline" />Requests</TabsTrigger>
              <TabsTrigger value="hosts"><Users className="h-4 w-4 mr-1 inline" />Hosts</TabsTrigger>
            </TabsList>
            <TabsContent value="requests" className="space-y-6">
              <RentalRequestsTab />
            </TabsContent>
            <TabsContent value="hosts" className="space-y-6">
              <HostManagementTab />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="labor" className="space-y-6">
            <LaborTab />
          </TabsContent>
        )}

        <TabsContent value="sponsors" className="space-y-6">
          <SponsorsTab />
        </TabsContent>

        {/* Pages — each sub-tab edits one public page. Admin-only, which is
            also what the RLS behind all three enforces. */}
        {isAdmin && (
          <TabsContent value="pages" className="space-y-6">
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
              <TabsContent value="festival" className="space-y-6">
                <FestivalProgramsTab />
              </TabsContent>
              <TabsContent value="hiring" className="space-y-6">
                <HiringTab />
              </TabsContent>
              <TabsContent value="press" className="space-y-6">
                <PressTab />
              </TabsContent>
              <TabsContent value="backstage" className="space-y-6">
                <BackstageTab />
              </TabsContent>
            </Tabs>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="mailchimp" className="space-y-6">
            <MailchimpTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="lgl" className="space-y-6">
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
