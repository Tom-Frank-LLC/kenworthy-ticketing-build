import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { invokeFunction } from '@/lib/functions';
import { useUndeliveredOrders } from '@/hooks/useUndeliveredOrders';
import type { UndeliveredOrder } from '@/lib/undelivered';

/**
 * Paid orders that never reached the buyer.
 *
 * The card exists because the failure it reports is invisible everywhere else.
 * Delivery is fire-and-forget so it can never fail a purchase, which means a
 * send that dies leaves the customer charged, the tickets valid, and nobody
 * told. The outcome is written to the ticket rows and, until now, nothing read
 * it back — the standing advice was "watch `orders.confirmation_error`", a
 * column no screen displayed.
 *
 * Renders nothing when there is nothing wrong. That is the point: it is not a
 * dashboard to check, it is an alarm. Anything permanently on screen gets
 * looked past, and this has to be believed on the day it finally appears.
 */
export function UndeliveredOrdersCard() {
  const { orders, loading, error, reload } = useUndeliveredOrders();
  const [sending, setSending] = useState<string | null>(null);

  async function resend(order: UndeliveredOrder) {
    setSending(order.orderToken);
    try {
      const result = await invokeFunction<{
        delivered?: boolean;
        channel?: string;
        partial_error?: string;
        reason?: string;
      }>('send-ticket-confirmation', {
        order_token: order.orderToken,
        // A partial delivery already has confirmation_sent_at, and the retry
        // guard would skip it — the same guard that stops a double-send. Only
        // that case gets force, and it does mean the channel that worked sends
        // again, which is why the button says so.
        force: order.partial,
      });
      if (result?.delivered) {
        toast.success(
          result.partial_error
            ? `Sent by ${result.channel}, but one channel still failed: ${result.partial_error}`
            : `Sent by ${result.channel}.`,
          { duration: result.partial_error ? 12000 : 5000 },
        );
      } else {
        toast.warning(`Not sent: ${result?.reason ?? 'no reason given'}`, { duration: 10000 });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      // Left on screen rather than cleared: a failed resend is still an
      // undelivered order, and the row disappearing would read as success.
      toast.error(`Resend failed: ${reason}`, { duration: 12000 });
    } finally {
      setSending(null);
      void reload();
    }
  }

  // Nothing wrong, nothing to say. Errors still surface — a query that cannot
  // run is not the same as a queue that is empty, and silently showing nothing
  // would recreate the exact blindness this card is here to end.
  if (!loading && !error && orders.length === 0) return null;

  return (
    <Card className="glass border-destructive/40 mb-8">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium">
                {loading && orders.length === 0
                  ? 'Checking ticket delivery…'
                  : `${orders.length} order${orders.length === 1 ? '' : 's'} not delivered`}
              </p>
              <p className="text-xs text-muted-foreground">
                Paid for, tickets are valid, and the confirmation never reached the buyer.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1 hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {error && (
          <p className="text-sm text-destructive">
            Could not check delivery: {error}
          </p>
        )}

        {orders.map(order => (
          <div
            key={order.orderToken}
            className="rounded-lg border border-border p-3 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium truncate">{order.title}</span>
                <Badge variant="outline" className="text-xs">
                  {order.ticketCount} ticket{order.ticketCount === 1 ? '' : 's'}
                </Badge>
                {order.partial && (
                  <Badge variant="secondary" className="text-xs">Partly delivered</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {order.name ? `${order.name} · ` : ''}
                {order.contact ?? 'no contact on file'}
                {' · bought '}
                {new Date(order.purchasedAt).toLocaleString()}
              </p>
              <p className="text-xs text-destructive break-words">
                {/* No error and nothing sent is the silent case: the dispatch
                    never ran, or died before it could record why. Say that
                    rather than leaving the line blank. */}
                {order.error ?? 'No delivery was attempted — nothing was recorded.'}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => void resend(order)}
              disabled={sending === order.orderToken || !order.contact}
              title={order.contact
                ? undefined
                : 'No email or phone on file for this buyer — nothing to send to.'}
            >
              {sending === order.orderToken
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
              <span className="ml-1">
                {order.partial ? 'Resend both' : 'Send'}
              </span>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
