import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ContractsTab from './ContractsTab';

/**
 * A row's History lists that contract's versions, read only when it is opened
 * and only for that row, and each version opens the contract showing it.
 */

type Result = { data: unknown[] | null; error: null };
let rows: Record<string, unknown[]> = {};
// Every query asked of contract_versions: [column, value] of each .eq().
const versionQueries: [string, unknown][][] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const eqs: [string, unknown][] = [];
      if (table === 'contract_versions') versionQueries.push(eqs);
      const chain: Record<string, unknown> = {
        select: () => chain, order: () => chain, limit: () => chain, in: () => chain,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return chain; },
        // fetchAllRows pages with range; one short page ends it.
        range: () => chain,
        then: (ok: (r: Result) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok),
      };
      return chain;
    },
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  versionQueries.length = 0;
  window.localStorage.clear();
  rows = {
    rental_requests: [{
      id: 'req_1', event_title: 'Harvest Gala', proposed_date: '2026-11-14', contract_data: null,
      signed_at: '2026-10-16T18:00:00Z', signed_pdf_path: 'req_1/abc.pdf', assigned_to: null, invite_token: 'tok_1', status: 'approved',
    }],
    blank_contracts: [{ id: 'blank_1', title: 'Piano recital', event_date: '2026-11-20' }],
    contract_versions: [
      { id: 'v2', event: 'signed', saved_by: null, saved_at: '2026-10-16T18:00:00Z', signed_pdf_path: 'req_1/abc.pdf', contract_data: {}, request_snapshot: {}, signed_pdf_sha256: 'abc' },
      { id: 'v1', event: 'saved', saved_by: null, saved_at: '2026-10-15T18:00:00Z', signed_pdf_path: null, contract_data: {}, request_snapshot: {}, signed_pdf_sha256: null },
    ],
  };
});

function row(title: string) {
  return within(screen.getByText(title).closest('.glass') as HTMLElement);
}

describe('Contracts list History', () => {
  it('reads no versions until a row is expanded', async () => {
    render(<ContractsTab />);
    await screen.findByText('Harvest Gala');
    expect(versionQueries).toHaveLength(0);
  });

  it("expands one row to that contract's versions, each opening the contract at it", async () => {
    render(<ContractsTab />);
    await screen.findByText('Harvest Gala');
    const toggle = row('Harvest Gala').getByRole('button', { name: /^history$/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const list = await row('Harvest Gala').findByRole('list', { name: /versions/i });
    expect(versionQueries).toEqual([[['rental_request_id', 'req_1']]]);
    const opens = within(list).getAllByRole('link', { name: /open/i });
    expect(opens.map(a => a.getAttribute('href'))).toEqual(['/contract/tok_1?version=v2', '/contract/tok_1?version=v1']);
    // The signed version carries its file.
    expect(within(list).getAllByRole('button', { name: /signed pdf/i })).toHaveLength(1);
    // The other row stays shut.
    expect(row('Piano recital').queryByRole('list')).toBeNull();

    fireEvent.click(row('Harvest Gala').getByRole('button', { name: /hide history/i }));
    expect(row('Harvest Gala').queryByRole('list')).toBeNull();
  });

  it("asks a blank's history by its own id, and opens its own page", async () => {
    render(<ContractsTab />);
    await screen.findByText('Piano recital');
    fireEvent.click(row('Piano recital').getByRole('button', { name: /^history$/i }));
    const list = await row('Piano recital').findByRole('list', { name: /versions/i });
    expect(versionQueries).toEqual([[['blank_contract_id', 'blank_1']]]);
    expect(within(list).getAllByRole('link', { name: /open/i })[0].getAttribute('href')).toBe('/contract/blank/blank_1?version=v2');
  });
});
