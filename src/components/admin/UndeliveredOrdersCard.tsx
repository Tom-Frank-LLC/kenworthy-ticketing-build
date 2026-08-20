import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw, Send, X } from 'lucide-react';
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
 * told. The outcome is written to the ticket rows and, until this card, nothing
 * read it back — the standing advice was "watch `orders.confirmation_error`", a
 * column no screen displayed.
 *
 * Renders nothing when there is nothing wrong, and stays one line when there
 * is. The first version listed every order at full height, so the worse the
 * problem got the further it shoved the dashboard down the page — which is a
 * good way to teach people to collapse the thing permanently. It is an alarm,
 * not a report: a count, and the detail on request, inside a fixed height.
 *
 * Two ways off the list, and only one of them is a send. See the migration
 * behind `dismiss` for why an undeliverable order needs an exit that does not
 * claim it was delivered.
 */
export function UndeliveredOrdersCard() {
  const { orders, loading, error, reload, dismiss } = useUndeliveredOrders();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function resend(order: UndeliveredOrder) {
    setBusy(order.orderToken);
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
      setBusy(null);
      void reload();
    }
  }

  async function confirmDismiss(order: UndeliveredOrder) {
    setBusy(order.orderToken);
    try {
      await dismiss(order.orderToken);
      toast.success('Dismissed. The order still reads as undelivered in the record.');
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      toast.error(`Could not dismiss: ${reason}`, { duration: 12000 });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  // Nothing wrong, nothing to say. Errors still surface — a query that cannot
  // run is not the same as a queue that is empty, and silently showing nothing
  // would recreate the exact blindness this card is here to end.
  if (!loading && !error && orders.length === 0) return null;

  return (
    <Card className="glass border-destructive/40 mb-4">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm font-medium">
            {loading && orders.length === 0
              ? 'Checking ticket delivery…'
              : `${orders.length} order${orders.length === 1 ? '' : 's'} not delivered`}
          </p>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Paid for, tickets valid, confirmation never arrived.
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void reload()}
              disabled={loading}
              aria-label="Refresh"
            >
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
            </Button>
            {orders.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setExpanded(v => !v)}>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                <span className="ml-1">{expanded ? 'Hide' : 'Review'}</span>
              </Button>
            )}
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">Could not check delivery: {error}</p>
        )}

        {/* Capped and scrolled rather than allowed to grow. Ten bad orders and
            a hundred take the same room on the dashboard. */}
        {expanded && (
          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {orders.map(order => (
              <div
                key={order.orderToken}
                className="rounded-md border border-border p-2 flex flex-col sm:flex-row sm:items-center gap-2"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{order.title}</span>
                    <Badge variant="outline" className="text-xs">
                      {order.ticketCount} ticket{order.ticketCount === 1 ? '' : 's'}
                    </Badge>
                    {order.partial && (
                      <Badge variant="secondary" className="text-xs">Partly delivered</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {order.name ? `${order.name} · ` : ''}
                    {order.contact ?? 'no contact on file'}
                    {' · '}
                    {new Date(order.purchasedAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-destructive break-words">
                    {/* No error and nothing sent is the silent case: the
                        dispatch never ran, or died before it could record why.
                        Say that rather than leaving the line blank. */}
                    {order.error ?? 'No delivery was attempted — nothing was recorded.'}
                  </p>
                </div>

                {confirming === order.orderToken ? (
                  // Inline rather than a dialog: dismissing is a judgement about
                  // a customer not getting what they paid for, so it wants a
                  // second deliberate click — but not a modal per row.
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground">Stop showing this?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void confirmDismiss(order)}
                      disabled={busy === order.orderToken}
                    >
                      {busy === order.orderToken
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : 'Yes'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      No
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => void resend(order)}
                      disabled={busy === order.orderToken || !order.contact}
                      title={order.contact
                        ? undefined
                        : 'No email or phone on file for this buyer — nothing to send to.'}
                    >
                      {busy === order.orderToken
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Send className="h-4 w-4" />}
                      <span className="ml-1">{order.partial ? 'Resend both' : 'Send'}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirming(order.orderToken)}
                      disabled={busy === order.orderToken}
                      title="Take this off the list without sending anything"
                      aria-label="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
