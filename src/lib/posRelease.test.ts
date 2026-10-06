import { describe, expect, it, vi } from 'vitest';
import { releaseCardSale } from './posRelease';

const client = (data: unknown, error: { message: string } | null = null) => ({
  rpc: vi.fn().mockResolvedValue({ data, error }),
});

describe('releaseCardSale', () => {
  it('calls the release function for the order, not a direct table update', async () => {
    const c = client(['a', 'b']);
    const r = await releaseCardSale(c, 'tok-1', 2, 'Canceled on the terminal');
    expect(c.rpc).toHaveBeenCalledWith('release_pending_card_sale', {
      p_order_token: 'tok-1',
      p_reason: 'Canceled on the terminal',
    });
    expect(r).toEqual({ released: 2, problem: null });
  });

  it('treats "no error, no rows" as a failure — the RLS-9 shape', async () => {
    const r = await releaseCardSale(client([]), 'tok-1', 2, 'x');
    expect(r.problem).toBe('0 of 2 released');
  });

  it('reports a partial release', async () => {
    expect((await releaseCardSale(client(['a']), 'tok-1', 2, 'x')).problem).toBe('1 of 2 released');
  });

  it('reports the error when the function refuses', async () => {
    const r = await releaseCardSale(client(null, { message: 'Staff access required' }), 'tok-1', 1, 'x');
    expect(r).toEqual({ released: 0, problem: 'Staff access required' });
  });

  it('caps the reason at the column length', async () => {
    const c = client(['a']);
    await releaseCardSale(c, 't', 1, 'y'.repeat(900));
    expect((c.rpc.mock.calls[0][1] as { p_reason: string }).p_reason).toHaveLength(500);
  });
});
