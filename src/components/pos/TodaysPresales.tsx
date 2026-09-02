/**
 * TodaysPresales
 *
 * The door-and-will-call reference for tonight's programming: every showing on
 * today's schedule, how many seats have gone, and how many of those holders
 * have actually walked in. Clicking a showing opens the existing
 * `AttendeeSheet` for the full roster — this panel deliberately owns the
 * counts and nothing else, because the roster, its contact columns and its CSV
 * export are already solved there and a second implementation would be a
 * second thing to keep correct.
 *
 * Read-only. Check-in happens at the scanner, not here.
 *
 * ## Why this fetches showings rather than reusing StaffPOS's list
 *
 * StaffPOS loads showings with `start_time >= now()`, because its job is to
 * sell a seat and you cannot sell into a screening that has begun. This panel's
 * job is the opposite: at 7 PM the thing staff most need is the 2 PM matinee
 * they are still tearing tickets for. Reusing that list would have quietly
 * dropped every showing as it started — the panel would have looked fine and
 * emptied out over the course of exactly the evening it exists for.
 *
 * ## Why the day boundaries go through venueLocalToInstant
 *
 * "Today" is a venue-local calendar day, and `start_time` is a UTC instant. A
 * naive `new Date(); setHours(0,0,0,0)` builds midnight in the *viewer's* zone,
 * so a staff laptop set to Mountain would start the day an hour early and pull
 * in the previous night's 11 PM show. Both bounds are therefore built as venue
 * wall-clock and converted, which also makes the two DST days come out right.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CalendarDays, Loader2, RefreshCw, Users } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { AttendeeSheet } from '@/components/admin/AttendeeSheet';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { formatShowtime, venueDayKey, venueLocalToInstant } from '@/lib/datetime';

interface PresaleShowing {
  id: string;
  start_time: string;
  title: string;
  capacity: number;
  no_ticket_required: boolean;
  sold: number;
  scanned: number;
}

/** The venue-local day containing `now`, as a pair of real instants. */
function venueDayBounds(now: Date) {
  const dayKey = venueDayKey(now);
  const [y, m, d] = dayKey.split('-').map(Number);
  // Calendar arithmetic on the *components*, then back through the zone —
  // adding 24h to the start instant would be an hour out on the two DST days.
  const nextKey = format(addDays(new Date(y, m - 1, d), 1), 'yyyy-MM-dd');
  return {
    start: venueLocalToInstant(`${dayKey}T00:00`),
    end: venueLocalToInstant(`${nextKey}T00:00`),
  };
}

export function TodaysPresales() {
  const [showings, setShowings] = useState<PresaleShowing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openShowing, setOpenShowing] = useState<PresaleShowing | null>(null);

  // Recomputed per load rather than held in state: the POS stays open across a
  // whole shift, and a `today` captured at mount would still say "yesterday"
  // after midnight on a late event night.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { start, end } = venueDayBounds(new Date());

    const { data: showingRows, error: showingErr } = await fetchAllRows<any, any>((from, to) =>
      supabase
        .from('showings')
        .select(
          'id, start_time, total_seats, no_ticket_required, ' +
            'movies(title), events(title), live_performances(title)',
        )
        .eq('is_active', true)
        .gte('start_time', start.toISOString())
        .lt('start_time', end.toISOString())
        .order('start_time')
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: any[] | null; error: any }>,
    );

    if (showingErr) {
      console.error('TodaysPresales showings:', showingErr);
      setError('Could not load today’s schedule');
      setShowings([]);
      setLoading(false);
      return;
    }

    const ids = (showingRows ?? []).map((s: any) => s.id);
    if (ids.length === 0) {
      setShowings([]);
      setLoading(false);
      return;
    }

    // Confirmed only. A pending row is an unpaid hold from a checkout still in
    // progress and admits nobody; a refunded one has already been given back.
    // Counting either would overstate the house to the person on the door.
    //
    // Paged, because a sold-out day of several screenings is well within reach
    // of the 1,000-row cap that PostgREST applies without an error.
    const { data: ticketRows, error: ticketErr } = await fetchAllRows<
      { showing_id: string; scanned_at: string | null },
      any
    >((from, to) =>
      supabase
        .from('tickets')
        .select('showing_id, scanned_at')
        .in('showing_id', ids)
        .eq('status', 'confirmed')
        .order('id')
        .range(from, to) as unknown as PromiseLike<{
        data: { showing_id: string; scanned_at: string | null }[] | null;
        error: any;
      }>,
    );

    if (ticketErr) {
      console.error('TodaysPresales tickets:', ticketErr);
      setError('Could not load today’s ticket sales');
      setShowings([]);
      setLoading(false);
      return;
    }

    const sold = new Map<string, number>();
    const scanned = new Map<string, number>();
    for (const t of ticketRows ?? []) {
      sold.set(t.showing_id, (sold.get(t.showing_id) ?? 0) + 1);
      if (t.scanned_at) scanned.set(t.showing_id, (scanned.get(t.showing_id) ?? 0) + 1);
    }

    setShowings(
      (showingRows ?? []).map((s: any) => ({
        id: s.id,
        start_time: s.start_time,
        title: s.movies?.title || s.events?.title || s.live_performances?.title || 'Untitled',
        capacity: s.total_seats ?? 0,
        no_ticket_required: !!s.no_ticket_required,
        sold: sold.get(s.id) ?? 0,
        scanned: scanned.get(s.id) ?? 0,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const todayLabel = useMemo(() => formatShowtime(new Date(), 'EEEE, MMMM d'), []);
  const totalSold = showings.reduce((n, s) => n + s.sold, 0);
  const totalScanned = showings.reduce((n, s) => n + s.scanned, 0);

  return (
    <div className="space-y-6">
      <Card className="glass">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" /> Today’s Presales
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{todayLabel}</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Loading today’s showings…
            </p>
          ) : error ? (
            <p className="text-sm text-destructive py-8 text-center">{error}</p>
          ) : showings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nothing is scheduled for today.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">
                  {totalSold} {totalSold === 1 ? 'ticket' : 'tickets'} sold today
                </Badge>
                <Badge variant="outline">{totalScanned} checked in</Badge>
                <Badge variant="outline">
                  {showings.length} {showings.length === 1 ? 'showing' : 'showings'}
                </Badge>
              </div>

              <div className="space-y-3">
                {showings.map(s => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-4 flex-wrap rounded-lg border border-border/50 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{s.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatShowtime(s.start_time, 'h:mm a')}
                        {s.no_ticket_required && ' · free, no ticket required'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={s.sold > 0 ? 'default' : 'secondary'}>
                        {s.sold}
                        {s.capacity > 0 && ` / ${s.capacity}`} sold
                      </Badge>
                      <Badge variant="outline">{s.scanned} in</Badge>
                      {/* Disabled at zero rather than hidden: a button that
                          vanishes reads as "this showing is different", when
                          all that has happened is nobody has bought yet. */}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={s.sold === 0}
                        onClick={() => setOpenShowing(s)}
                      >
                        <Users className="h-4 w-4 mr-1" />
                        {s.sold === 0 ? 'No presales' : 'Attendees'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AttendeeSheet
        open={openShowing !== null}
        onOpenChange={open => !open && setOpenShowing(null)}
        title={
          openShowing
            ? `${openShowing.title} — ${formatShowtime(openShowing.start_time, 'MMM d, yyyy h:mm a')}`
            : ''
        }
        showingIds={openShowing ? [openShowing.id] : []}
        capacity={openShowing?.capacity ?? 0}
      />
    </div>
  );
}
