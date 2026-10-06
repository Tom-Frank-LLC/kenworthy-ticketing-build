// Releasing a counter card sale that never happened.
//
// The POS writes a card sale's rows `pending` before it reaches the reader. If
// the reader is never reached, or the sale is cancelled on it, those rows have
// to become `failed` so the seats go back on sale.
//
// That used to be a direct `update tickets set status = 'failed'`. Staff have
// no UPDATE on tickets, so it matched no rows, supabase-js reported success,
// and the seats stayed held with the rows pending forever (security audit
// 2026-10-06, RLS-9). It now goes through release_pending_card_sale, which
// moves only pending card rows of this order and returns the ids it moved —
// and the count, not the absence of an error, is the answer.

export interface ReleaseResult {
  released: number;
  /** Why fewer rows were released than were written, or null if all were. */
  problem: string | null;
}

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function releaseCardSale(
  client: RpcClient,
  orderToken: string,
  expected: number,
  reason: string,
): Promise<ReleaseResult> {
  const { data, error } = await client.rpc('release_pending_card_sale', {
    p_order_token: orderToken,
    p_reason: reason.slice(0, 500),
  });
  const released = Array.isArray(data) ? data.length : 0;
  if (error) return { released, problem: error.message };
  if (released !== expected) return { released, problem: `${released} of ${expected} released` };
  return { released, problem: null };
}
