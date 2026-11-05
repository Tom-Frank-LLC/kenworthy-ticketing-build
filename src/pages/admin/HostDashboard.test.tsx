import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * What a host sees of their production on /host: the poster, runtime and
 * description, and the executed rental contract when one is linked.
 */

let rows: Record<string, unknown[]> = {};
let contracts: unknown[] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, order: () => chain, in: () => chain, eq: () => chain, or: () => chain,
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok),
      };
      return chain;
    },
    rpc: (name: string) => Promise.resolve({
      data: name === 'host_production_contracts' ? contracts : [],
      error: null,
    }),
  },
}));
// One object for every render: the page reloads when `user` changes identity.
const AUTH = {
  user: { id: 'host_1' }, isHost: true, isAdmin: false, isStaff: false, isHostOnly: true,
  mfa: { currentLevel: 'aal1' }, loading: false,
};
vi.mock('@/lib/auth', () => ({ useAuth: () => AUTH }));
const openPdf = vi.fn();
vi.mock('@/lib/signedContractPdf', () => ({ openSignedContractPdf: (p: string) => openPdf(p) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import HostDashboard from './HostDashboard';

const SIGNED = {
  request_id: 'req_1', event_id: 'ev_1', live_performance_id: null, movie_id: null,
  signed: true, signed_at: '2026-10-16T18:00:00Z', signed_by_name: 'Rita Renter', signed_pdf_path: 'req_1/abc.pdf',
};

beforeEach(() => {
  openPdf.mockReset();
  contracts = [];
  rows = {
    host_event_assignments: [{ id: 'a_1', user_id: 'host_1', event_id: 'ev_1', live_performance_id: null, movie_id: null }],
    events: [{
      id: 'ev_1', title: 'Harvest Gala', description: '<p>A night of music.</p>',
      poster_url: 'https://img.example/gala.jpg', trailer_url: null, pass_processing_fee: false,
      duration_minutes: 90, show_runtime: true,
    }],
    showings: [],
  };
});

function renderPage() {
  return render(<MemoryRouter><HostDashboard /></MemoryRouter>);
}

describe('HostDashboard, as a host', () => {
  it('heads the page Theatre Rental Host Dashboard, with Theatre Rental in the brand colour', async () => {
    renderPage();
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Theatre Rental Host Dashboard');
    expect(screen.getByText('Theatre Rental').className).toContain('text-primary');
  });

  it('shows the poster, the runtime and the description', async () => {
    renderPage();
    const poster = await screen.findByRole('img', { name: 'Poster for Harvest Gala' });
    expect(poster.getAttribute('src')).toBe('https://img.example/gala.jpg');
    expect(screen.getByText('1 hour 30 minutes')).toBeTruthy();
    expect(screen.getByText('A night of music.')).toBeTruthy();
  });

  it('leaves the runtime out when the production hides it', async () => {
    (rows.events[0] as Record<string, unknown>).show_runtime = false;
    renderPage();
    await screen.findByText('A night of music.');
    expect(screen.queryByText('1 hour 30 minutes')).toBeNull();
  });

  it('shows no contract when none is linked', async () => {
    renderPage();
    await screen.findByText('A night of music.');
    expect(screen.queryByText(/rental contract/i)).toBeNull();
  });

  it('opens the executed contract', async () => {
    contracts = [SIGNED];
    renderPage();
    expect(await screen.findByText(/Rental contract — signed/)).toBeTruthy();
    expect(screen.getByText(/by Rita Renter/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /view signed contract/i }));
    expect(openPdf).toHaveBeenCalledWith('req_1/abc.pdf');
  });

  it('says so when the signing predates the archive and kept no file', async () => {
    contracts = [{ ...SIGNED, signed_pdf_path: null }];
    renderPage();
    expect(await screen.findByText(/ask the kenworthy for a copy/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /view signed contract/i })).toBeNull();
  });

  it('says not signed yet for a linked contract without a signature', async () => {
    contracts = [{ ...SIGNED, signed: false, signed_at: null, signed_by_name: null, signed_pdf_path: null }];
    renderPage();
    expect(await screen.findByText(/not signed yet/i)).toBeTruthy();
  });

  it("ignores another production's contract", async () => {
    contracts = [{ ...SIGNED, event_id: 'ev_other' }];
    renderPage();
    await screen.findByText('A night of music.');
    expect(screen.queryByText(/rental contract/i)).toBeNull();
  });
});
