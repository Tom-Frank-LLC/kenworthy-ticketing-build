import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Ticket, Calendar, Music, PartyPopper, Film, ScanLine, Plus, Trash2, Save, Gift } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { exportContactsCsv } from '@/lib/exportContacts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface Assignment {
  id: string;
  event_id: string | null;
  live_performance_id: string | null;
  movie_id: string | null;
  production?: ProductionRecord;
}

type ProductionType = 'event' | 'concert' | 'movie';

interface ProductionRecord {
  id: string;
  title: string;
  type: ProductionType;
  description: string | null;
  poster_url: string | null;
  trailer_url: string | null;
  pass_processing_fee: boolean;
}

export default function HostDashboard() {
  const { user, isHost, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [showings, setShowings] = useState<any[]>([]);
  const [ticketCounts, setTicketCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!isHost && !isAdmin) { navigate('/'); return; }
    loadData();
  }, [isHost, isAdmin, authLoading, navigate]);

  async function loadData() {
    if (!user) return;
    setLoading(true);

    const { data: assignmentData } = await supabase
      .from('host_event_assignments')
      .select('*')
      .eq('user_id', user.id);

    if (!assignmentData || assignmentData.length === 0) {
      setAssignments([]);
      setLoading(false);
      return;
    }

    const eventIds = assignmentData.filter(a => a.event_id).map(a => a.event_id!);
    const lpIds = assignmentData.filter(a => a.live_performance_id).map(a => a.live_performance_id!);
    const movieIds = assignmentData.filter(a => a.movie_id).map(a => a.movie_id!);

    const cols = 'id, title, description, poster_url, trailer_url, pass_processing_fee';
    const [eventsRes, lpRes, moviesRes] = await Promise.all([
      eventIds.length ? supabase.from('events').select(cols).in('id', eventIds) : { data: [] },
      lpIds.length ? supabase.from('live_performances').select(cols).in('id', lpIds) : { data: [] },
      movieIds.length ? supabase.from('movies').select(cols).in('id', movieIds) : { data: [] },
    ]);

    const enriched: Assignment[] = assignmentData.map(a => {
      let production: ProductionRecord | undefined;
      const wrap = (row: any, type: ProductionType): ProductionRecord => ({
        id: row?.id,
        title: row?.title || 'Unknown',
        type,
        description: row?.description ?? null,
        poster_url: row?.poster_url ?? null,
        trailer_url: row?.trailer_url ?? null,
        pass_processing_fee: !!row?.pass_processing_fee,
      });
      if (a.event_id) {
        const ev = (eventsRes.data || []).find((e: any) => e.id === a.event_id);
        if (ev) production = wrap(ev, 'event');
      } else if (a.live_performance_id) {
        const c = (lpRes.data || []).find((c: any) => c.id === a.live_performance_id);
        if (c) production = wrap(c, 'concert');
      } else if (a.movie_id) {
        const m = (moviesRes.data || []).find((m: any) => m.id === a.movie_id);
        if (m) production = wrap(m, 'movie');
      }
      return { ...a, production };
    });

    setAssignments(enriched);

    const { data: showingsData } = await supabase
      .from('showings')
      .select('*')
      .order('start_time');

    const relevantShowings = (showingsData || []).filter(s =>
      assignmentData.some(a =>
        (a.event_id && s.event_id === a.event_id) ||
        (a.live_performance_id && s.live_performance_id === a.live_performance_id) ||
        (a.movie_id && s.movie_id === a.movie_id)
      )
    );
    setShowings(relevantShowings);

    const counts: Record<string, number> = {};
    for (const s of relevantShowings) {
      const { count } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('showing_id', s.id);
      counts[s.id] = count || 0;
    }
    setTicketCounts(counts);
    setLoading(false);
  }

  const handleExport = async (a: Assignment) => {
    if (!a.production) return;
    const productionId = a.event_id || a.live_performance_id || a.movie_id;
    if (!productionId) return;

    const count = await exportContactsCsv(a.production.type, productionId, a.production.title);
    if (count === null) {
      toast.info('No attendees found for this production');
    } else {
      toast.success(`Exported ${count} contacts`);
    }
  };

  const getIcon = (type?: string) => {
    if (type === 'event') return PartyPopper;
    if (type === 'concert') return Music;
    return Film;
  };

  if (authLoading || loading) return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="container py-8 px-4 max-w-4xl">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <h1 className="font-display text-3xl font-bold">Host Dashboard</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/scanner"><ScanLine className="h-4 w-4 mr-1" /> Open Door Scanner</Link>
        </Button>
      </div>

      {assignments.length === 0 ? (
        <Card className="glass p-12 text-center">
          <p className="text-muted-foreground text-lg">No events assigned to you yet.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {assignments.map(a => {
            const Icon = getIcon(a.production?.type);
            const productionShowings = showings.filter(s =>
              (a.event_id && s.event_id === a.event_id) ||
              (a.live_performance_id && s.live_performance_id === a.live_performance_id) ||
              (a.movie_id && s.movie_id === a.movie_id)
            );
            const totalTickets = productionShowings.reduce((sum, s) => sum + (ticketCounts[s.id] || 0), 0);

            return (
              <Card key={a.id} className="glass">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-3">
                    <Icon className="h-6 w-6 text-primary" />
                    <CardTitle className="font-display text-xl">{a.production?.title}</CardTitle>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleExport(a)}>
                    <Download className="h-4 w-4 mr-1" /> Export Contacts
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-4">
                    <Badge variant="secondary" className="text-sm">
                      <Ticket className="h-3.5 w-3.5 mr-1" /> {totalTickets} tickets sold
                    </Badge>
                    <Badge variant="outline" className="text-sm">
                      <Calendar className="h-3.5 w-3.5 mr-1" /> {productionShowings.length} showings
                    </Badge>
                  </div>

                  {a.production && (
                    <ProductionManager
                      assignment={a}
                      production={a.production}
                      showings={productionShowings}
                      ticketCounts={ticketCounts}
                      onChanged={loadData}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function tableForType(type: ProductionType): 'events' | 'live_performances' | 'movies' {
  if (type === 'event') return 'events';
  if (type === 'concert') return 'live_performances';
  return 'movies';
}

function ProductionManager({
  assignment,
  production,
  showings,
  ticketCounts,
  onChanged,
}: {
  assignment: Assignment;
  production: ProductionRecord;
  showings: any[];
  ticketCounts: Record<string, number>;
  onChanged: () => void;
}) {
  return (
    <Tabs defaultValue="details" className="w-full">
      <TabsList className="grid grid-cols-4 w-full">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="showings">Showings</TabsTrigger>
        <TabsTrigger value="comps">Comp Tickets</TabsTrigger>
        <TabsTrigger value="attendees">Attendees</TabsTrigger>
      </TabsList>

      <TabsContent value="details" className="pt-4">
        <DetailsEditor production={production} onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="showings" className="pt-4">
        <ShowingsManager
          assignment={assignment}
          production={production}
          showings={showings}
          ticketCounts={ticketCounts}
          onChanged={onChanged}
        />
      </TabsContent>
      <TabsContent value="comps" className="pt-4">
        <CompTicketIssuer showings={showings} onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="attendees" className="pt-4">
        <AttendeesList showings={showings} />
      </TabsContent>
    </Tabs>
  );
}

function DetailsEditor({ production, onChanged }: { production: ProductionRecord; onChanged: () => void }) {
  const [description, setDescription] = useState(production.description || '');
  const [posterUrl, setPosterUrl] = useState(production.poster_url || '');
  const [trailerUrl, setTrailerUrl] = useState(production.trailer_url || '');
  const [passFee, setPassFee] = useState(production.pass_processing_fee);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    // .select() so an RLS-filtered write (204, no error) can't pass as saved.
    const { data, error } = await supabase
      .from(tableForType(production.type))
      .update({
        description: description || null,
        poster_url: posterUrl || null,
        trailer_url: trailerUrl || null,
        pass_processing_fee: passFee,
      })
      .eq('id', production.id)
      .select('id');
    setSaving(false);
    if (error) toast.error(error.message);
    else if (!data || data.length === 0) toast.error('Nothing was saved — your account may not have permission to edit this.');
    else { toast.success('Saved'); onChanged(); }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Poster URL</Label>
          <Input value={posterUrl} onChange={e => setPosterUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="space-y-2">
          <Label>Trailer URL</Label>
          <Input value={trailerUrl} onChange={e => setTrailerUrl(e.target.value)} placeholder="YouTube, Vimeo, or .mp4" />
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 p-4 rounded-lg border bg-muted/30">
        <div className="space-y-1">
          <Label className="text-base">Pass processing fee to buyer</Label>
          <p className="text-sm text-muted-foreground">
            When on, the credit-card processing fee Square charges is added to the buyer's total instead of coming out of your share.
          </p>
        </div>
        <Switch checked={passFee} onCheckedChange={setPassFee} />
      </div>

      <Button onClick={save} disabled={saving}>
        <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save Details'}
      </Button>
    </div>
  );
}

function ShowingsManager({
  assignment,
  production,
  showings,
  ticketCounts,
  onChanged,
}: {
  assignment: Assignment;
  production: ProductionRecord;
  showings: any[];
  ticketCounts: Record<string, number>;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newStart, setNewStart] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newSeats, setNewSeats] = useState('100');

  async function addShowing() {
    if (!newStart || !newPrice) { toast.error('Enter date/time and price'); return; }
    setAdding(true);
    const row: any = {
      start_time: new Date(newStart).toISOString(),
      ticket_price: parseFloat(newPrice),
      total_seats: parseInt(newSeats || '100', 10),
      is_active: true,
      requires_seat_selection: false,
    };
    if (assignment.event_id) row.event_id = assignment.event_id;
    else if (assignment.live_performance_id) row.live_performance_id = assignment.live_performance_id;
    else if (assignment.movie_id) row.movie_id = assignment.movie_id;

    const { error } = await supabase.from('showings').insert(row);
    setAdding(false);
    if (error) toast.error(error.message);
    else { toast.success('Showing added'); setNewStart(''); setNewPrice(''); onChanged(); }
  }

  async function removeShowing(id: string) {
    if (!confirm('Remove this showing? This cannot be undone.')) return;
    const { error } = await supabase.from('showings').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Showing removed'); onChanged(); }
  }

  async function toggleActive(s: any) {
    const { error } = await supabase.from('showings').update({ is_active: !s.is_active }).eq('id', s.id);
    if (error) toast.error(error.message);
    else onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {showings.length === 0 && (
          <p className="text-sm text-muted-foreground">No showings yet.</p>
        )}
        {showings.map(s => (
          <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm">{format(new Date(s.start_time), 'EEE MMM d, yyyy • h:mm a')}</span>
              <Badge variant="secondary">${Number(s.ticket_price).toFixed(2)}</Badge>
              <Badge variant="outline">{ticketCounts[s.id] || 0} tickets</Badge>
              {!s.is_active && <Badge variant="outline">Hidden</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => toggleActive(s)}>
                {s.is_active ? 'Hide' : 'Show'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => removeShowing(s.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <p className="font-medium text-sm">Add a showing</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2 space-y-1">
            <Label className="text-xs">Date & time</Label>
            <Input type="datetime-local" value={newStart} onChange={e => setNewStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ticket price ($)</Label>
            <Input type="number" step="0.01" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="10.00" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Seats</Label>
            <Input type="number" value={newSeats} onChange={e => setNewSeats(e.target.value)} />
          </div>
        </div>
        <Button size="sm" onClick={addShowing} disabled={adding}>
          <Plus className="h-4 w-4 mr-1" /> {adding ? 'Adding…' : 'Add Showing'}
        </Button>
      </div>
    </div>
  );
}

function CompTicketIssuer({ showings, onChanged }: { showings: any[]; onChanged: () => void }) {
  const { user } = useAuth();
  const [showingId, setShowingId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [qty, setQty] = useState('1');
  const [issuing, setIssuing] = useState(false);

  async function issue() {
    if (!user) return;
    if (!showingId || !name) { toast.error('Pick a showing and enter a name'); return; }
    const count = Math.max(1, parseInt(qty, 10) || 1);
    setIssuing(true);
    const rows = Array.from({ length: count }).map(() => ({
      user_id: user.id,
      showing_id: showingId,
      payment_method: 'comp',
      qr_code: `COMP-${crypto.randomUUID()}`,
      comp_recipient_name: name,
      comp_recipient_email: email || null,
      issued_by_user_id: user.id,
      price: 0,
      tax_rate: 0,
      tax_amount: 0,
      total_price: 0,
      status: 'confirmed',
    }));
    const { error } = await supabase.from('tickets').insert(rows);
    setIssuing(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Issued ${count} comp ticket${count > 1 ? 's' : ''}`);
      setName(''); setEmail(''); setQty('1');
      onChanged();
    }
  }

  if (showings.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a showing first, then you can issue comp tickets.</p>;
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="font-medium text-sm flex items-center gap-2"><Gift className="h-4 w-4 text-primary" /> Issue comp tickets</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Showing</Label>
          <select
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            value={showingId}
            onChange={e => setShowingId(e.target.value)}
          >
            <option value="">Select…</option>
            {showings.map(s => (
              <option key={s.id} value={s.id}>
                {format(new Date(s.start_time), 'MMM d, yyyy • h:mm a')}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Quantity</Label>
          <Input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Guest name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Guest email (optional)</Label>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" />
        </div>
      </div>
      <Button size="sm" onClick={issue} disabled={issuing}>
        <Gift className="h-4 w-4 mr-1" /> {issuing ? 'Issuing…' : 'Issue Comp Ticket(s)'}
      </Button>
    </div>
  );
}

function AttendeesList({ showings }: { showings: any[] }) {
  const [showingId, setShowingId] = useState<string>(showings[0]?.id || '');
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!showingId) { setTickets([]); return; }
    setLoading(true);
    supabase
      .from('tickets')
      .select('id, status, scanned_at, payment_method, comp_recipient_name, comp_recipient_email, user_id, purchased_at')
      .eq('showing_id', showingId)
      .order('purchased_at', { ascending: false })
      .then(async ({ data }) => {
        const t = data || [];
        const userIds = Array.from(new Set(t.map(x => x.user_id).filter(Boolean)));
        let profiles: Record<string, any> = {};
        if (userIds.length) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('id, display_name, email')
            .in('id', userIds);
          profiles = Object.fromEntries((prof || []).map(p => [p.id, p]));
        }
        setTickets(t.map(x => ({ ...x, profile: profiles[x.user_id] })));
        setLoading(false);
      });
  }, [showingId]);

  if (showings.length === 0) {
    return <p className="text-sm text-muted-foreground">No showings yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Showing</Label>
        <select
          className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          value={showingId}
          onChange={e => setShowingId(e.target.value)}
        >
          {showings.map(s => (
            <option key={s.id} value={s.id}>
              {format(new Date(s.start_time), 'MMM d, yyyy • h:mm a')}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tickets for this showing yet.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{tickets.length} ticket(s)</p>
          {tickets.map(t => {
            const name = t.comp_recipient_name || t.profile?.display_name || 'Guest';
            const email = t.comp_recipient_email || t.profile?.email;
            return (
              <div key={t.id} className="flex items-center justify-between p-2 rounded bg-muted/40 text-sm">
                <div>
                  <span className="font-medium">{name}</span>
                  {email && <span className="text-muted-foreground ml-2">{email}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {t.payment_method === 'comp' && <Badge variant="outline">Comp</Badge>}
                  {t.scanned_at ? (
                    <Badge variant="secondary">Scanned</Badge>
                  ) : (
                    <Badge variant="outline">Not scanned</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
