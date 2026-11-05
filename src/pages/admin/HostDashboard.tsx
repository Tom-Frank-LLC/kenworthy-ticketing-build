import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Ticket, Calendar, Music, PartyPopper, Film, ScanLine, Plus, Trash2, Save, Gift, Users, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { exportContactsCsv } from '@/lib/exportContacts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatShowtime } from '@/lib/datetime';
import { trailerUrlError } from '@/lib/trailer';

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

/** One row of host_ticket_counts(): confirmed tickets on a showing. */
interface ShowingCounts {
  sold: number;
  comps: number;
  checkedIn: number;
}

const NO_COUNTS: ShowingCounts = { sold: 0, comps: 0, checkedIn: 0 };

/**
 * The host's window on their own production.
 *
 * Two audiences (docs/briefs/BRIEF-host-magic-link-view.md):
 *   - a host signs in by emailed link (/host/login) and sees sales, the
 *     schedule and who is coming, read-only. The database gives that session
 *     nothing to change (migration 20261105025356), so the controls are not
 *     shown either: a host should never meet a dead button.
 *   - staff (staff, admin, superadmin) get the controls as before: edit the
 *     production, add and hide showings, issue comps, export contacts. A
 *     privileged session is aal2 by the time it is here (MfaGate).
 */
export default function HostDashboard() {
  const { user, isHost, isAdmin, isStaff, isHostOnly, mfa, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [showings, setShowings] = useState<any[]>([]);
  const [ticketCounts, setTicketCounts] = useState<Record<string, ShowingCounts>>({});
  const [loading, setLoading] = useState(true);
  const canManage = isStaff;
  // The door scanner checks tickets in, which is a write: the database refuses
  // it to a host's emailed-link (aal1) session. Offer it only where it works.
  const canScan = !isHostOnly || mfa.currentLevel === 'aal2';

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/host/login', { replace: true }); return; }
    if (!isHost && !isAdmin) { navigate('/'); return; }
    loadData();
  }, [user, isHost, isAdmin, authLoading, navigate]);

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

    // Filtered by production on the server. Unfiltered, this read every
    // showing the caller could see and filtered here, and past showings are
    // visible to everyone: ~1,800 rows, cut to 1,000 by PostgREST without a
    // word, so a host's own showings could silently be missing.
    const productionFilter = [
      eventIds.length ? `event_id.in.(${eventIds.join(',')})` : null,
      lpIds.length ? `live_performance_id.in.(${lpIds.join(',')})` : null,
      movieIds.length ? `movie_id.in.(${movieIds.join(',')})` : null,
    ].filter(Boolean).join(',');
    const { data: showingsData } = await supabase
      .from('showings')
      .select('*')
      .or(productionFilter)
      .order('start_time');

    const relevantShowings = showingsData || [];
    setShowings(relevantShowings);

    // One call for every showing, and it answers a host's emailed-link session,
    // which may not read the tickets table itself.
    const counts: Record<string, ShowingCounts> = {};
    if (relevantShowings.length) {
      const { data: countRows, error: countError } = await supabase.rpc('host_ticket_counts', {
        p_showing_ids: relevantShowings.map(s => s.id),
      });
      if (countError) {
        console.error('host_ticket_counts:', countError);
        toast.error("Couldn't load ticket counts. Try reloading the page.");
      }
      for (const r of (countRows ?? []) as { showing_id: string; sold: number; comps: number; checked_in: number }[]) {
        counts[r.showing_id] = { sold: Number(r.sold), comps: Number(r.comps), checkedIn: Number(r.checked_in) };
      }
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
        {canScan && (
          <Button asChild variant="outline" size="sm">
            <Link to="/staff/scanner"><ScanLine className="h-4 w-4 mr-1" /> Open Door Scanner</Link>
          </Button>
        )}
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
            const totals = productionShowings.reduce<ShowingCounts>((t, s) => {
              const c = ticketCounts[s.id] ?? NO_COUNTS;
              return { sold: t.sold + c.sold, comps: t.comps + c.comps, checkedIn: t.checkedIn + c.checkedIn };
            }, NO_COUNTS);

            return (
              <Card key={a.id} className="glass">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-3">
                    <Icon className="h-6 w-6 text-primary" />
                    <CardTitle className="font-display text-xl">{a.production?.title}</CardTitle>
                  </div>
                  {/* Contact export is staff work: a host's view has names, not
                      addresses, and the database gives it no contact details. */}
                  {canManage && (
                    <Button variant="outline" size="sm" onClick={() => handleExport(a)}>
                      <Download className="h-4 w-4 mr-1" /> Export Contacts
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-3 flex-wrap">
                    <Badge variant="secondary" className="text-sm">
                      <Ticket className="h-3.5 w-3.5 mr-1" /> {totals.sold} tickets sold
                    </Badge>
                    {totals.comps > 0 && (
                      <Badge variant="outline" className="text-sm">
                        <Gift className="h-3.5 w-3.5 mr-1" /> {totals.comps} comps
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-sm">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {totals.checkedIn} checked in
                    </Badge>
                    <Badge variant="outline" className="text-sm">
                      <Calendar className="h-3.5 w-3.5 mr-1" /> {productionShowings.length} showings
                    </Badge>
                  </div>

                  {a.production && (canManage ? (
                    <ProductionManager
                      assignment={a}
                      production={a.production}
                      showings={productionShowings}
                      ticketCounts={ticketCounts}
                      onChanged={loadData}
                    />
                  ) : (
                    <ProductionView showings={productionShowings} ticketCounts={ticketCounts} />
                  ))}
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
  ticketCounts: Record<string, ShowingCounts>;
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

/**
 * What a host sees: the schedule with per-showing sales, and who is coming.
 * Read-only on purpose; see the note on HostDashboard.
 */
function ProductionView({ showings, ticketCounts }: { showings: any[]; ticketCounts: Record<string, ShowingCounts> }) {
  return (
    <Tabs defaultValue="showings" className="w-full">
      <TabsList className="grid grid-cols-2 w-full">
        <TabsTrigger value="showings">Showings</TabsTrigger>
        <TabsTrigger value="attendees">Attendees</TabsTrigger>
      </TabsList>
      <TabsContent value="showings" className="pt-4">
        {showings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No showings scheduled yet.</p>
        ) : (
          <div className="space-y-2">
            {showings.map(s => {
              const c = ticketCounts[s.id] ?? NO_COUNTS;
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50 flex-wrap">
                  <span className="text-sm">{formatShowtime(s.start_time, 'EEE MMM d, yyyy • h:mm a')}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{c.sold} sold</Badge>
                    {c.comps > 0 && <Badge variant="outline">{c.comps} comps</Badge>}
                    <Badge variant="outline">{c.checkedIn} checked in</Badge>
                    {s.cancelled_at ? (
                      <Badge variant="outline">Cancelled</Badge>
                    ) : (
                      !s.is_active && <Badge variant="outline">Not on sale</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
    const trailerError = trailerUrlError(trailerUrl);
    if (trailerError) { toast.error(trailerError); return; }
    setSaving(true);
    // .select() so an RLS-filtered write (204, no error) can't pass as saved.
    const { data, error } = await supabase
      .from(tableForType(production.type))
      .update({
        description: description || null,
        poster_url: posterUrl || null,
        trailer_url: trailerUrl.trim() || null,
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
        <Label htmlFor="host-description">Description</Label>
        <RichTextEditor
          id="host-description"
          value={description}
          onChange={setDescription}
          rows={5}
        />
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
            Off by default. Standard Kenworthy ticket sales charge the ticket price and tax only — the
            theatre absorbs Square's card fee. Turn this on only where a rental agreement says the fee
            should be added to the buyer's total instead of coming out of your share.
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
  ticketCounts: Record<string, ShowingCounts>;
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
              <span className="text-sm">{formatShowtime(s.start_time, 'EEE MMM d, yyyy • h:mm a')}</span>
              <Badge variant="secondary">${Number(s.ticket_price).toFixed(2)}</Badge>
              <Badge variant="outline">{(ticketCounts[s.id] ?? NO_COUNTS).sold} sold</Badge>
              {s.cancelled_at ? (
                <Badge variant="outline">Cancelled</Badge>
              ) : (
                !s.is_active && <Badge variant="outline">Hidden</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Not offered on a cancelled showing: showing it again would make
                  it active while cancelled, which the database refuses
                  (showings_cancelled_is_inactive). Restoring is done from the
                  admin dashboard. */}
              {!s.cancelled_at && (
                <Button variant="ghost" size="sm" onClick={() => toggleActive(s)}>
                  {s.is_active ? 'Hide' : 'Show'}
                </Button>
              )}
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
    // Written by the same function every ticket row goes through. There is
    // no INSERT policy on tickets any more; the function checks that the
    // caller is staff or the host of this showing, and the showing's own
    // rules (no ticket needed, already happened) apply to a comp as to a sale.
    const { data, error } = await supabase.rpc('create_ticket_order', {
      p_showing_id: showingId,
      p_tickets: Array.from({ length: count }, () => ({})),
      p_payment_method: 'comp',
      p_user_id: user.id,
      p_comp_recipient_name: name,
      p_comp_recipient_email: email || null,
    });
    setIssuing(false);
    if (!error && (data ?? []).length !== count) {
      toast.error(`Only ${(data ?? []).length} of ${count} comps were recorded.`);
      onChanged();
      return;
    }
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
                {formatShowtime(s.start_time, 'MMM d, yyyy • h:mm a')}
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

interface AttendeeRow {
  ticket_id: string;
  attendee_name: string;
  ticket_type: string | null;
  is_comp: boolean;
  checked_in: boolean;
  purchased_at: string | null;
}

/**
 * Confirmed tickets for one showing: name, ticket type, checked in.
 *
 * From host_attendees(), for staff and hosts alike. It returns no email or
 * phone: the list is for knowing who is coming, and contacts are staff work
 * (Export Contacts, or the attendee drawer on the admin dashboard). A host's
 * emailed-link session cannot read the tickets table at all.
 */
function AttendeesList({ showings }: { showings: any[] }) {
  const [showingId, setShowingId] = useState<string>(showings[0]?.id || '');
  const [rows, setRows] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!showingId) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    supabase.rpc('host_attendees', { p_showing_id: showingId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('host_attendees:', error);
        setFailed(true);
      }
      setRows((data ?? []) as AttendeeRow[]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [showingId]);

  if (showings.length === 0) {
    return <p className="text-sm text-muted-foreground">No showings yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="attendees-showing" className="text-xs">Showing</Label>
        <select
          id="attendees-showing"
          className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          value={showingId}
          onChange={e => setShowingId(e.target.value)}
        >
          {showings.map(s => (
            <option key={s.id} value={s.id}>
              {formatShowtime(s.start_time, 'MMM d, yyyy • h:mm a')}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : failed ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          Couldn't load the attendee list. Try reloading the page.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tickets for this showing yet.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {rows.length} ticket{rows.length === 1 ? '' : 's'}
          </p>
          {rows.map(r => (
            <div key={r.ticket_id} className="flex items-center justify-between gap-2 p-2 rounded bg-muted/40 text-sm flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{r.attendee_name}</span>
                <span className="text-muted-foreground">{r.is_comp ? 'Comp' : (r.ticket_type || 'General admission')}</span>
              </div>
              {r.checked_in ? (
                <Badge variant="secondary">Checked in</Badge>
              ) : (
                <Badge variant="outline">Not checked in</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
