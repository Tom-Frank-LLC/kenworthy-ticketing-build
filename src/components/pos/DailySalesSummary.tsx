import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, ShoppingCart, RotateCcw } from 'lucide-react';

interface DailySalesProps {
  revenue: number;
  ticketCount: number;
  refundCount: number;
}

export function DailySalesSummary({ revenue, ticketCount, refundCount }: DailySalesProps) {
  // Stacked on a phone: three icon+text cards cannot share 375px, and the
  // third one spilled past the viewport. The box office does open this on a
  // small screen, so it wraps rather than overflowing.
  return (
    <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-2.5">
            <DollarSign className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Today's Revenue</p>
            <p className="text-xl font-bold">${revenue.toFixed(2)}</p>
          </div>
        </CardContent>
      </Card>
      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-2.5">
            <ShoppingCart className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tickets Sold</p>
            <p className="text-xl font-bold">{ticketCount}</p>
          </div>
        </CardContent>
      </Card>
      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-center gap-3">
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
