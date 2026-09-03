import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, ShoppingCart, RotateCcw } from 'lucide-react';

interface DailySalesProps {
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

export function DailySalesSummary({
  revenue,
  ticketRevenue,
  filmPassRevenue,
  concessionRevenue,
  todaysTicketCount,
  refundCount,
}: DailySalesProps) {
  // Stacked on a phone: three icon+text cards cannot share 375px, and the
  // third one spilled past the viewport. The box office does open this on a
  // small screen, so it wraps rather than overflowing.
  return (
    <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2.5">
            <DollarSign className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Today's Revenue</p>
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
  );
}
