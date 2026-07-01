import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Film, Plus, Calendar, Ticket, Edit, Trash2, ShoppingCart, ScanLine, Music, PartyPopper, BarChart3, UtensilsCrossed, CreditCard, Download, Users, Archive, Wallet, KeyRound, FileText, Clock, Handshake, History, Disc, Search, X, ChevronLeft, ChevronRight, Mail, Heart } from 'lucide-react';
import AnalyticsTab from '@/components/admin/AnalyticsTab';
import ConcessionItemsTab from '@/components/admin/ConcessionItemsTab';
import ConcessionMenusTab from '@/components/admin/ConcessionMenusTab';
import FilmPassesTab from '@/components/admin/FilmPassesTab';
import HostManagementTab from '@/components/admin/HostManagementTab';
import ArchiveTab from '@/components/admin/ArchiveTab';
import AccountingTab from '@/components/admin/AccountingTab';
import ChartOfAccountsTab from '@/components/admin/accounting/ChartOfAccountsTab';
import AccountMappingsTab from '@/components/admin/accounting/AccountMappingsTab';
import QboExportTab from '@/components/admin/accounting/QboExportTab';
import RentalRequestsTab from '@/components/admin/RentalRequestsTab';
import BoxOfficeReceiptsTab from '@/components/admin/BoxOfficeReceiptsTab';
import LaborTab from '@/components/admin/LaborTab';
import SponsorsTab from '@/components/admin/SponsorsTab';
import DvdLibraryTab from '@/components/admin/DvdLibraryTab';
import MailchimpTab from '@/components/admin/MailchimpTab';
import LglTab from '@/components/admin/LglTab';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { exportContactsCsv } from '@/lib/exportContacts';

export default function AdminDashboard() {
  const { isAdmin, isStaff, isSuperadmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [movies, setMovies] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [concerts, setConcerts] = useState<any[]>([]);
  const [showings, setShowings] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketCount, setTicketCount] = useState(0);
  const [scheduleQuery, setScheduleQuery] = useState(() => searchParams.get('q') || '');
  const [activeScheduleTab, setActiveScheduleTab] = useState(() => searchParams.get('tab') || 'movies');
  const [activeTopTab, setActiveTopTab] = useState(() => searchParams.get('section') || 'listings');
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
  const [sortOrder, setSortOrder] = useState<'title_asc' | 'title_desc' | 'newest' | 'oldest'>(
    () => (searchParams.get('sort') as any) || 'title_asc'
  );

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDel = (key: string, value: string, fallback: string) => {
      if (value && value !== fallback) next.set(key, value);
      else next.delete(key);
    };
    setOrDel('q', scheduleQuery, '');
    setOrDel('tab', activeScheduleTab, 'movies');
    setOrDel('section', activeTopTab, 'listings');
    setOrDel('status', statusFilter, 'all');
    setOrDel('rating', ratingFilter, 'all');
    setOrDel('genre', genreFilter, 'all');
    setOrDel('etype', eventTypeFilter, 'all');
    setOrDel('csub', concertSubcategoryFilter, 'all');
    setOrDel('kind', liveEventKindFilter, 'all');
    setOrDel('sort', sortOrder, 'title_asc');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [scheduleQuery, activeScheduleTab, activeTopTab, statusFilter, ratingFilter, genreFilter, eventTypeFilter, concertSubcategoryFilter, liveEventKindFilter, sortOrder]);

  useEffect(() => {
    if (authLoading) return;
    if (!isStaff) { navigate('/'); return; }
    loadData();
  }, [isStaff, authLoading, navigate]);

  async function loadData() {
    const [moviesRes, eventsRes, concertsRes, showingsRes, ticketsRes] = await Promise.all([
      supabase.from('movies').select('*').order('title'),
      supabase.from('events').select('*').order('title'),
      supabase.from('live_performances').select('*').order('title'),
      supabase.from('showings').select('*, movies(title), events(title), live_performances(title), venues(name)').order('start_time', { ascending: false }),
      supabase.from('tickets').select('id, showing_id'),
    ]);
    setMovies(moviesRes.data || []);
    setEvents(eventsRes.data || []);
    setConcerts(concertsRes.data || []);
    setShowings(showingsRes.data || []);
    setTickets(ticketsRes.data || []);
    setTicketCount(ticketsRes.data?.length || 0);
  }


  const getMovieShowings = (movieId: string) => showings.filter(s => s.movie_id === movieId);

  const getTicketsSoldForShowing = (showingId: string) =>
    tickets.filter(t => t.showing_id === showingId).length;

  const getTicketsSoldForEvent = (eventId: string) => {
    const eventShowings = showings.filter(s => s.event_id === eventId);
    const sold = tickets.filter(t => eventShowings.some((sh: any) => sh.id === t.showing_id)).length;
    const capacity = eventShowings.reduce((sum, sh) => sum + (sh.total_seats || 0), 0);
    return { sold, capacity };
  };

  const getTicketsSoldForConcert = (concertId: string) => {
    const concertShowings = showings.filter(s => s.live_performance_id === concertId);
    const sold = tickets.filter(t => concertShowings.some((sh: any) => sh.id === t.showing_id)).length;
    const capacity = concertShowings.reduce((sum, sh) => sum + (sh.total_seats || 0), 0);
    return { sold, capacity };
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
    setSortOrder('title_asc');
  };

  const sortItems = (items: any[]) => {
    const sorted = [...items];
    switch (sortOrder) {
      case 'title_asc':
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'title_desc':
        sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
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

  const TicketCountBadge = ({ sold, capacity }: { sold: number; capacity: number }) => (
    <Badge variant="secondary" className="text-xs whitespace-nowrap" title={`${sold} of ${capacity} tickets sold`}>
      {sold} / {capacity}
    </Badge>
  );

  const deleteItem = async (table: 'movies' | 'events' | 'live_performances' | 'showings', id: string, label: string) => {

    if (!confirm(`Delete this ${label}?`)) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(`${label} deleted`); loadData(); }
  };


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
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/audit-log"><History className="h-4 w-4 mr-1" /> Activity Log</Link>
          </Button>
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
            { value: 'analytics', label: 'Analytics', icon: BarChart3, show: isAdmin },
            { value: 'mailchimp', label: 'Mailchimp', icon: Mail, show: isAdmin },
            { value: 'lgl', label: 'LGL', icon: Heart, show: isAdmin },
            { value: 'bor', label: 'BOR', icon: FileText, show: true },
            { value: 'archive', label: 'Archive', icon: Archive, show: isSuperadmin },
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
                  <CurrentIcon className="h-4 w-4 text-primary" />
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

              {/* Desktop: grid tabs */}
              <TabsList
                className="hidden md:grid w-full"
                style={{ gridTemplateColumns: `repeat(${topTabs.length}, minmax(0, 1fr))` }}
              >
                {topTabs.map(t => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger key={t.value} value={t.value}>
                      <Icon className="h-4 w-4 mr-1 inline" />{t.label}
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
              </TabsList>
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

                  <Select value={sortOrder} onValueChange={v => setSortOrder(v as any)}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="title_asc">Title A–Z</SelectItem>
                      <SelectItem value="title_desc">Title Z–A</SelectItem>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="oldest">Oldest first</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button variant="ghost" size="sm" onClick={resetScheduleFilters} className="h-9 px-2 text-muted-foreground">
                    <X className="h-4 w-4 mr-1" /> Reset
                  </Button>
                </div>
              </div>
            </div>
            <TabsContent value="movies">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold">Movies</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link to="/admin/showings/new"><Plus className="h-4 w-4 mr-1" /> Add Showing</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/admin/movies/new"><Plus className="h-4 w-4 mr-1" /> Add Movie</Link>
              </Button>
            </div>
          </div>
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
                                {format(new Date(showing.start_time), 'MMM d, yyyy h:mm a')}
                              </span>
                              <span className="text-sm text-muted-foreground">• ${Number(showing.ticket_price).toFixed(2)}</span>
                              {showing.venues?.name && (
                                <Badge variant="secondary" className="text-xs">{showing.venues.name}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <TicketCountBadge sold={getTicketsSoldForShowing(showing.id)} capacity={showing.total_seats || 0} />
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
            </TabsContent>
            <TabsContent value="live-events">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold">Live Events</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link to="/admin/concerts/new"><Plus className="h-4 w-4 mr-1" /> Add Performance</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/admin/events/new"><Plus className="h-4 w-4 mr-1" /> Add Event</Link>
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {filteredLiveEvents.map(item => {
              const isEvent = item.kind === 'event';
              const isConcert = item.kind === 'concert';
              const { sold, capacity } = isEvent
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
                      <TicketCountBadge sold={sold} capacity={capacity} />
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

        {/* Film Passes Tab */}
        <TabsContent value="passes">
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
              <TabsTrigger value="accounting"><Wallet className="h-4 w-4 mr-1 inline" />Imports</TabsTrigger>
              <TabsTrigger value="coa">Chart of Accounts</TabsTrigger>
              <TabsTrigger value="mappings">Mappings</TabsTrigger>
              <TabsTrigger value="qbo-export">QBO Export</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <AnalyticsTab />
            </TabsContent>
            <TabsContent value="accounting">
              <AccountingTab />
            </TabsContent>
            <TabsContent value="coa"><ChartOfAccountsTab /></TabsContent>
            <TabsContent value="mappings"><AccountMappingsTab /></TabsContent>
            <TabsContent value="qbo-export"><QboExportTab /></TabsContent>
          </Tabs>
        </TabsContent>
        )}

        {/* Archive Tab — superadmin only */}
        {isSuperadmin && (
          <TabsContent value="archive">
            <ArchiveTab />
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
    </div>
  );
}
