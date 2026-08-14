import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mail, Loader2, Check } from 'lucide-react';
import {
  formatMailingAddress,
  passOrderBuyerLabel,
  describeAge,
  type AwaitingPostOrder,
} from '@/lib/passOrders';

/**
 * Mail orders activated but not yet posted.
 *
 * Shared verbatim by the counter (`FilmPassPOS`) and the admin dashboard
 * (`FilmPassesTab`) because — unlike activation, which needs a sticker under a
 * scanner — confirming a post needs nothing but somebody who knows the envelope
 * went out. That person may be at the counter or at a desk, so the two screens
 * want the identical control, and a second copy of it would drift.
 *
 * Marking is irreversible by design: a mis-marked order is recovered by voiding
 * the pass and issuing a new one, which is a path that already exists. What the
 * component owes that decision is a deliberate click — hence the inline
 * two-step confirm rather than a bare button. Not a modal: envelopes are done
 * in batches, and a dialog per row is friction on the common case.
 */
export function MailQueueCard({
  orders,
  loading,
  error,
  onRetry,
  onMarkPosted,
  hideWhenEmpty = false,
}: {
  orders: AwaitingPostOrder[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /**
   * Reports the outcome to the user and refreshes the queue on success. Owns
   * its own error reporting; this component only drives the button state.
   */
  onMarkPosted: (orderId: string) => Promise<void>;
  /** Counter hides an empty card to stay fast; admin shows "nothing to post". */
  hideWhenEmpty?: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Nothing outstanding and nothing to say about it.
  if (hideWhenEmpty && !loading && !error && orders.length === 0) return null;

  async function confirmPosted(orderId: string) {
    setSubmitting(orderId);
    try {
      await onMarkPosted(orderId);
    } catch {
      // The caller reports the failure; swallowing here only prevents an
      // unhandled rejection from a button click. The row stays put either way.
    } finally {
      // The row is gone on success and stays on failure; either way this
      // component should not hold a stale confirm open over it.
      setSubmitting(null);
      setConfirming(null);
    }
  }

  return (
    <Card className="glass">
      <CardContent className="p-4 space-y-3">
        <h2 className="font-display text-xl font-bold flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" /> To be posted
          {orders.length > 0 && <Badge variant="default">{orders.length}</Badge>}
        </h2>

        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : error ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Could not load the mail queue — {error}</p>
            <p className="text-xs text-muted-foreground">
              This is not the same as "nothing to post". Retry before assuming the desk is clear.
            </p>
            <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to post — every activated pass has gone in the mail.
          </p>
        ) : (
          <div className="space-y-3">
            {orders.map(o => {
              const address = formatMailingAddress(o.mailing_address);
              const isConfirming = confirming === o.id;
              const isSubmitting = submitting === o.id;

              return (
                <div key={o.id} className="p-4 rounded-lg bg-secondary/50 space-y-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-sm truncate">{passOrderBuyerLabel(o)}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.quantity} × {o.pass_type_name} · activated {describeAge(o.fulfilled_at)}
                        {o.fulfilled_by_name ? ` by ${o.fulfilled_by_name}` : ''}
                      </p>
                      {o.buyer_email && (
                        <p className="text-xs text-muted-foreground break-all">{o.buyer_email}</p>
                      )}
                      {/* The label the staff member writes on the envelope. */}
                      {address ? (
                        <p className="text-xs text-muted-foreground mt-1">Post to: {address}</p>
                      ) : (
                        <p className="text-xs text-destructive mt-1">
                          No address on file — contact the buyer before posting.
                        </p>
                      )}
                    </div>

                    <div className="shrink-0">
                      {isConfirming ? (
                        // Two steps, in place. The second click emails the
                        // patron and cannot be undone, so it should never be
                        // the same click that was aimed at something else.
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            Posted?
                          </span>
                          <Button
                            size="sm"
                            onClick={() => confirmPosted(o.id)}
                            disabled={isSubmitting}
                          >
                            {isSubmitting ? (
                              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending…</>
                            ) : (
                              <><Check className="h-4 w-4 mr-1" /> Yes, posted</>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirming(null)}
                            disabled={isSubmitting}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setConfirming(o.id)}>
                          <Mail className="h-4 w-4 mr-1" /> Mark posted
                        </Button>
                      )}
                    </div>
                  </div>

                  {isConfirming && !isSubmitting && (
                    <p className="text-xs text-muted-foreground">
                      This emails {o.buyer_email || 'the buyer'} to say it is on the way, and cannot
                      be undone.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
