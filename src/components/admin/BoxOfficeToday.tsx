/**
 * BoxOfficeToday — what this build's own counter took today.
 *
 * Admin-only, because the whole dashboard is: staff run the till, they do not
 * review the theatre's revenue. This started life on the staff POS and moved
 * here for exactly that reason.
 *
 * ## This is the counter's number, not the theatre's
 *
 * It sits above `AnalyticsTab`, which reads SQUARE and reports the whole
 * theatre — the register, Square Online, invoices. This card reads our own
 * tables and reports only what was rung through this build. The two answer
 * different questions and will never agree; that is why this one says so on
 * its face rather than being folded into the Square figures below.
 *
 * ## Two different "todays", deliberately
 *
 * The revenue lines are scoped by *when the money arrived* — `purchased_at` /
 * `created_at` inside today — because that is what a day's takings means.
 * `todaysTicketCount` is scoped by *when the showing is*, because that is the
 * house. A seat bought last week for tonight belongs to the second and not the
 * first. Both were once labelled "today" on one screen and were read against
 * each other, so they are labelled apart now.
 *
 * Day bounds come from the shared `venueDayBounds`, never `setHours(0,0,0,0)`:
 * that builds midnight in the *viewer's* zone, so a laptop set to Mountain
 * starts the theatre's day an hour early.
 *
 * ## What is counted, and what is not
 *
 * Three streams, each filtered to its settled state — `confirmed` tickets,
 * `paid` pass orders — because a pending row is an unfinished checkout and
 * counting it would overstate the day. A film-pass *admission* carries no
 * `total_price`, so it adds nothing to the ticket line; that money is counted
 * on the pass line, on the day the pass was actually sold.
 *
 * Not counted: rentals and donations. Rentals are invoiced through Square and
 * this build never learns they were paid — `square_invoice_status` is stamped
 * once at creation, there is no Square webhook, and no paid-at column exists —
 * so any figure here would be "invoiced", not "received". Both are visible in
 * Square, which is what `AnalyticsTab` below reads. Donations are admin-only
 * and could be shown here, but are left out so this card keeps meaning one
 * thing: money taken at the counter. See docs/FINDINGS-pos-revenue-sources.md.
 *
 * Concessions reads $0.00 while CONCESSION_POS_ENABLED is off — the real
 * concession stand rings up on the theatre's own Square register, and that
 * money shows in the Square-sourced card below, not here.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { venueDayBounds } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, ShoppingCart, RotateCcw, RefreshCw, Loader2 } from 'lucide-react';

interface Totals {
  /** The day's takings at this counter: the three lines below, summed. */
  revenue: number;
  ticketRevenue: number;
  filmPassRevenue: number;
  concessionRevenue: number;
  /** Seats sold for *today's showings*, whenever they were bought. */
  todaysTicketCount: number;
  refundCount: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

const EMPTY: Totals = {
  revenue: 0,
  ticketRevenue: 0,
  filmPassRevenue: 0,
  concessionRevenue: 0,
  todaysTicketCount: 0,
  refundCount: 0,
};

export function BoxOfficeToday() {
  const [t, setTotals] = useState<Totals>(EMPTY);
  const [loading, setLoading] = useState(true);

  // Recomputed per load rather than captured at mount: the dashboard is left
  // open, and a `today` fixed at render would still say yesterday after
  // midnight on a late event night.
  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = venueDayBounds(new Date());
    const from = start.toISOString();
    const to = end.toISOString();

    const [ticketsRes, passRes, concessionRes, showingsRes] = await Promise.all([
      supabase.from('tickets').select('total_price, status')
        .gte('purchased_at', from).lt('purchased_at', to),
      supabase.from('film_pass_orders').select('amount_paid, status')
        .gte('created_at', from).lt('created_at', to),
      supabase.from('concession_sales').select('total')
        .gte('created_at', from).lt('created_at', to),
      supabase.from('showings').select('id').eq('is_active', true)
        .gte('start_time', from).lt('start_time', to),
    ]);

    const tickets = ticketsRes.data ?? [];
    const confirmed = tickets.filter(r => r.status === 'confirmed');
    const ticketRevenue = confirmed.reduce((sum, r) => sum + Number(r.total_price ?? 0), 0);
    const filmPassRevenue = (passRes.data ?? [])
      .filter(o => o.status === 'paid')
      .reduce((sum, o) => sum + Number(o.amount_paid ?? 0), 0);
    const concessionRevenue = (concessionRes.data ?? [])
      .reduce((sum, c) => sum + Number(c.total ?? 0), 0);

    let todaysTicketCount = 0;
    const showingIds = (showingsRes.data ?? []).map(r => r.id);
    if (showingIds.length > 0) {
      const { data } = await supabase.from('tickets').select('id')
        .in('showing_id', showingIds).eq('status', 'confirmed');
      todaysTicketCount = data?.length ?? 0;
    }

    setTotals({
      revenue: ticketRevenue + filmPassRevenue + concessionRevenue,
      ticketRevenue,
      filmPassRevenue,
      concessionRevenue,
      todaysTicketCount,
      refundCount: tickets.filter(r => r.status === 'refunded').length,
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const {
    revenue, ticketRevenue, filmPassRevenue,
    concessionRevenue, todaysTicketCount, refundCount,
  } = t;
  // Stacked on a phone: three icon+text cards cannot share 375px, and the
  // third one spilled past the viewport. The dashboard does get opened on a
  // small screen, so it wraps rather than overflowing.
  return (
    <section className="mb-8 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-lg">Box office today</h3>
          {/* Says its source out loud. The Square-sourced Overview sits
              directly beneath, reports the whole theatre, and will not match
              this. Unlabelled, that reads as one of them being broken. */}
          <p className="text-xs text-muted-foreground">
            Rung through this build. The Square figures below cover the whole theatre.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2.5">
            <DollarSign className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Today's Revenue — this counter</p>
            <p className="text-xl font-bold">{money(revenue)}</p>
            {/* The three streams this counter can actually take money through.
                Rentals are invoiced in Square and the build never learns they
                were paid; donations are admin-only, so a staff-only account
                would silently total them as zero. Neither is shown rather than
                shown wrong. Concessions stays at $0.00 while the tab is off. */}
            <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              <div className="flex justify-between gap-4">
                <dt>Tickets</dt>
                <dd className="tabular-nums">{money(ticketRevenue)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Film passes</dt>
                <dd className="tabular-nums">{money(filmPassRevenue)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Concessions</dt>
                <dd className="tabular-nums">{money(concessionRevenue)}</dd>
              </div>
            </dl>
          </div>
        </CardContent>
      </Card>
      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2.5">
            <ShoppingCart className="h-5 w-5 text-primary" />
          </div>
          <div>
            {/* Tonight's house, not today's sales. The revenue card beside this
                one is scoped by when the money arrived; this is scoped by when
                the showing is, so a seat bought last week for tonight counts
                here and not there. They are near-certain to differ, and the
                labels are what stop that reading as a bug. */}
            <p className="text-xs text-muted-foreground">Tickets for Today</p>
            <p className="text-xl font-bold">{todaysTicketCount}</p>
            <p className="mt-2 text-xs text-muted-foreground">Sold for today's showings</p>
          </div>
        </CardContent>
      </Card>
      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2.5">
            <RotateCcw className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Refunds</p>
            <p className="text-xl font-bold">{refundCount}</p>
          </div>
        </CardContent>
      </Card>
    </div>
    </section>
  );
}
