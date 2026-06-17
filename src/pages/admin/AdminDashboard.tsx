import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Film, Plus, Calendar, Ticket, Edit, Trash2, ShoppingCart, ScanLine, Music, PartyPopper, BarChart3, UtensilsCrossed, CreditCard, Download, Users, Archive, Wallet, KeyRound, FileText, Clock } from 'lucide-react';
import AnalyticsTab from '@/components/admin/AnalyticsTab';
import ConcessionItemsTab from '@/components/admin/ConcessionItemsTab';
import ConcessionMenusTab from '@/components/admin/ConcessionMenusTab';
import FilmPassesTab from '@/components/admin/FilmPassesTab';
import HostManagementTab from '@/components/admin/HostManagementTab';
import ArchiveTab from '@/components/admin/ArchiveTab';
import AccountingTab from '@/components/admin/AccountingTab';
import RentalRequestsTab from '@/components/admin/RentalRequestsTab';
import BoxOfficeReceiptsTab from '@/components/admin/BoxOfficeReceiptsTab';
import LaborTab from '@/components/admin/LaborTab';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { exportContactsCsv } from '@/lib/exportContacts';

export default function AdminDashboard() {
  const { isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [movies, setMovies] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [concerts, setConcerts] = useState<any[]>([]);
  const [showings, setShowings] = useState<any[]>([]);
  const [ticketCount, setTicketCount] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }
    loadData();
  }, [isAdmin, authLoading, navigate]);

  async function loadData() {
    const [moviesRes, eventsRes, concertsRes, showingsRes, ticketsRes] = await Promise.all([
      supabase.from('movies').select('*').order('created_at', { ascending: false }),
      supabase.from('events').select('*').order('created_at', { ascending: false }),
      supabase.from('live_performances').select('*').order('created_at', { ascending: false }),
      supabase.from('showings').select('*, movies(title), events(title), live_performances(title), venues(name)').order('start_time', { ascending: false }),
      supabase.from('tickets').select('id', { count: 'exact' }),
    ]);
    setMovies(moviesRes.data || []);
    setEvents(eventsRes.data || []);
    setConcerts(concertsRes.data || []);
    setShowings(showingsRes.data || []);
    setTicketCount(ticketsRes.count || 0);
  }

  const getMovieShowings = (movieId: string) => showings.filter(s => s.movie_id === movieId);

  const deleteItem = async (table: 'movies' | 'events' | 'live_performances' | 'showings', id: string, label: string) => {
    if (!confirm(`Delete this ${label}?`)) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(`${label} deleted`); loadData(); }
  };


  if (authLoading) return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="container py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-3xl font-bold">Admin Dashboard</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/pos"><ShoppingCart className="h-4 w-4 mr-1" /> Staff POS</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/scanner"><ScanLine className="h-4 w-4 mr-1" /> Scanner</Link>
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
            <PartyPopper className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xl font-bold">{events.length}</p>
              <p className="text-xs text-muted-foreground">Events</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <Music className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xl font-bold">{concerts.length}</p>
              <p className="text-xs text-muted-foreground">Live Performances</p>
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

      <Tabs defaultValue="movies" className="space-y-4">
        <TabsList className="grid w-full grid-cols-10">
          <TabsTrigger value="movies">Movies</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="concerts">Performances</TabsTrigger>
          <TabsTrigger value="concessions"><UtensilsCrossed className="h-4 w-4 mr-1 inline" />Concessions</TabsTrigger>
          <TabsTrigger value="passes"><CreditCard className="h-4 w-4 mr-1 inline" />Passes</TabsTrigger>
          <TabsTrigger value="rentals"><KeyRound className="h-4 w-4 mr-1 inline" />Rentals</TabsTrigger>
          <TabsTrigger value="labor"><Clock className="h-4 w-4 mr-1 inline" />Staff</TabsTrigger>
          <TabsTrigger value="analytics"><BarChart3 className="h-4 w-4 mr-1 inline" />Analytics</TabsTrigger>
          <TabsTrigger value="bor"><FileText className="h-4 w-4 mr-1 inline" />BOR</TabsTrigger>
          <TabsTrigger value="archive"><Archive className="h-4 w-4 mr-1 inline" />Archive</TabsTrigger>
        </TabsList>

        {/* Movies Tab */}
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
            {movies.map(movie => {
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
                            <div className="flex gap-1">
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
            {movies.length === 0 && <p className="text-muted-foreground text-center py-8">No movies yet.</p>}
          </div>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold">Events</h2>
            <Button size="sm" asChild>
              <Link to="/admin/events/new"><Plus className="h-4 w-4 mr-1" /> Add Event</Link>
            </Button>
          </div>
          <div className="space-y-3">
            {events.map(event => (
              <Card key={event.id} className="glass">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <PartyPopper className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">{event.title}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="outline" className="text-xs capitalize">{event.ticket_type.replace('_', ' ')}</Badge>
                        <Badge variant={event.is_active ? 'default' : 'secondary'} className="text-xs">
                          {event.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" title="Export contacts" onClick={async () => {
                      const count = await exportContactsCsv('event', event.id, event.title);
                      if (count === null) toast.info('No attendees found');
                      else toast.success(`Exported ${count} contacts`);
                    }}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/admin/events/${event.id}`}><Edit className="h-4 w-4" /></Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteItem('events', event.id, 'Event')}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {events.length === 0 && <p className="text-muted-foreground text-center py-8">No events yet.</p>}
          </div>
        </TabsContent>

        {/* Live Performances Tab */}
        <TabsContent value="concerts">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold">Performances</h2>
            <Button size="sm" asChild>
              <Link to="/admin/concerts/new"><Plus className="h-4 w-4 mr-1" /> Add Performance</Link>
            </Button>
          </div>
          <div className="space-y-3">
            {concerts.map(concert => (
              <Card key={concert.id} className="glass">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Music className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">{concert.title}</p>
                      <div className="flex gap-2 mt-1">
                        {concert.subcategory && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {concert.subcategory.replace(/_/g, ' ')}
                          </Badge>
                        )}
                        {concert.genre && <Badge variant="outline" className="text-xs">{concert.genre}</Badge>}
                        <Badge variant={concert.is_active ? 'default' : 'secondary'} className="text-xs">
                          {concert.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" title="Export contacts" onClick={async () => {
                      const count = await exportContactsCsv('concert', concert.id, concert.title);
                      if (count === null) toast.info('No attendees found');
                      else toast.success(`Exported ${count} contacts`);
                    }}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/admin/concerts/${concert.id}`}><Edit className="h-4 w-4" /></Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteItem('live_performances', concert.id, 'Live Performance')}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {concerts.length === 0 && <p className="text-muted-foreground text-center py-8">No live performances yet.</p>}
          </div>
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

        {/* Analytics Tab (with Accounting sub-tab) */}
        <TabsContent value="analytics">
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview"><BarChart3 className="h-4 w-4 mr-1 inline" />Overview</TabsTrigger>
              <TabsTrigger value="accounting"><Wallet className="h-4 w-4 mr-1 inline" />Accounting</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <AnalyticsTab />
            </TabsContent>
            <TabsContent value="accounting">
              <AccountingTab />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Archive Tab */}
        <TabsContent value="archive">
          <ArchiveTab />
        </TabsContent>

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

        <TabsContent value="labor">
          <LaborTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
