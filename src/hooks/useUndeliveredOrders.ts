import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  toUndeliveredOrders,
  type BuyerProfile,
  type UndeliveredOrder,
  type UndeliveredRow,
} from '@/lib/undelivered';

/**
 * The query behind `UndeliveredOrdersCard`.
 *
 * Split from `@/lib/undelivered` rather than living beside it: importing this
 * module constructs the Supabase client, which needs `VITE_SUPABASE_URL` at
 * import time and throws "supabaseUrl is required" without it. That is fine in
 * the app and fatal in a unit test, so the classification logic stays in a
 * module a test can import and this one is never pulled in.
 */

/**
 * A dispatch is in flight for a moment after the purchase, so anything younger
 * than this is not yet evidence of anything. Fifteen minutes is far longer than
 * a send takes and short enough that a real failure surfaces the same shift.
 */
const GRACE_MINUTES = 15;

export function useUndeliveredOrders() {
  const [orders, setOrders] = useState<UndeliveredOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const cutoff = new Date(Date.now() - GRACE_MINUTES * 60_000).toISOString();

    // `confirmed` only. A pending or failed row is an abandoned or declined
    // checkout, not an undelivered order, and loadOrder hides those from the
    // buyer for the same reason.
    const { data, error: err } = await fetchAllRows<UndeliveredRow>((from, to) =>
      supabase
        .from('tickets')
        .select(`
          order_token, purchased_at, status,
          confirmation_sent_at, confirmation_channel, confirmation_error, user_id,
          showings(start_time, movies(title), events(title), live_performances(title))
        `)
        .eq('status', 'confirmed')
        .lt('purchased_at', cutoff)
        // Dismissed orders are still undelivered and the columns still say so;
        // an admin has just decided no further send is coming. See the
        // migration for why this hides rather than rewrites.
        .is('confirmation_dismissed_at', null)
        .or('confirmation_error.not.is.null,confirmation_sent_at.is.null')
        .order('purchased_at', { ascending: false })
        .range(from, to),
    );

    if (err) {
      setOrders([]);
      setError(err.message);
      setLoading(false);
      return;
    }

    // Contact comes from profiles rather than the ticket, which carries none.
    const userIds = [...new Set(data.map(r => r.user_id).filter(Boolean))] as string[];
    const profiles = new Map<string, BuyerProfile>();
    if (userIds.length) {
      const { data: profileRows } = await fetchAllRows<BuyerProfile & { id: string }>((from, to) =>
        supabase
          .from('profiles')
          .select('id, email, phone, display_name')
          .in('id', userIds)
          .range(from, to),
      );
      for (const p of profileRows) profiles.set(p.id, p);
    }

    setOrders(toUndeliveredOrders(data, profiles));
    setError(null);
    setLoading(false);
  }, []);

  /**
   * Take an order off the card without pretending it was delivered.
   *
   * Only admins hold UPDATE on `tickets`. A policy-blocked update is not an
   * error in PostgREST — it matches no rows, returns 204, and supabase-js
   * reports success — so this selects the ids back and treats an empty result
   * as the failure it is. Without that a staff member would click Dismiss, see
   * nothing happen, and click again.
   */
  const dismiss = useCallback(async (orderToken: string) => {
    const { data: auth } = await supabase.auth.getUser();
    const actor = auth?.user?.id;
    if (!actor) throw new Error('Not signed in');

    const { data, error: err } = await supabase
      .from('tickets')
      .update({
        confirmation_dismissed_at: new Date().toISOString(),
        confirmation_dismissed_by: actor,
      })
      .eq('order_token', orderToken)
      .select('id');

    if (err) throw new Error(err.message);
    if (!data?.length) {
      throw new Error('Nothing was updated — dismissing needs an admin account.');
    }
    await reload();
  }, [reload]);

  useEffect(() => { void reload(); }, [reload]);

  return { orders, loading, error, reload, dismiss };
}
