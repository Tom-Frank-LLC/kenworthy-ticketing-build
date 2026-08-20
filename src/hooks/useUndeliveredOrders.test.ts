import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

/**
 * The dismissal write, and the one way it can fail without saying so.
 *
 * Only admins hold UPDATE on `tickets`. PostgREST does not treat a
 * policy-blocked update as an error — it matches no rows, answers 204, and
 * supabase-js reports success. A staff member would click Dismiss, watch
 * nothing happen, and click again. So the write selects its ids back and an
 * empty result is raised as the failure it is.
 */

const update = vi.fn();
const select = vi.fn();
const getUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: () => getUser() },
    from: () => ({
      // The read the hook does on mount. Empty is fine — these tests are about
      // the write.
      select: () => ({
        eq: () => ({
          lt: () => ({
            is: () => ({
              or: () => ({
                order: () => ({
                  range: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
      update: (fields: unknown) => {
        update(fields);
        return { eq: () => ({ select: () => select() }) };
      },
    }),
  },
}));

const { useUndeliveredOrders } = await import('./useUndeliveredOrders');

describe('useUndeliveredOrders().dismiss', () => {
  beforeEach(() => {
    update.mockClear();
    select.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
  });

  it('records who dismissed it and when', async () => {
    select.mockResolvedValue({ data: [{ id: 'ticket-1' }], error: null });
    const { result } = renderHook(() => useUndeliveredOrders());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.dismiss('order-1'); });

    const fields = update.mock.calls[0][0] as Record<string, unknown>;
    expect(fields.confirmation_dismissed_by).toBe('admin-1');
    expect(typeof fields.confirmation_dismissed_at).toBe('string');
    // Dismissing hides the order; it must never claim delivery happened.
    expect(fields).not.toHaveProperty('confirmation_sent_at');
    expect(fields).not.toHaveProperty('confirmation_error');
  });

  it('treats an update that changed nothing as a failure', async () => {
    // What RLS looks like from the client: no error, no rows.
    select.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useUndeliveredOrders());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.dismiss('order-1')).rejects.toThrow(/admin account/i);
  });

  it('refuses to dismiss when nobody is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useUndeliveredOrders());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.dismiss('order-1')).rejects.toThrow(/not signed in/i);
    expect(update).not.toHaveBeenCalled();
  });
});
