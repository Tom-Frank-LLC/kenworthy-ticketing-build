import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock auth to grant staff access
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isAdmin: true, isStaff: true, isHost: false, loading: false }),
}));

// Mock html5-qrcode (jsdom has no camera)
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * Check-in goes through the `check_in_ticket` RPC, so that is the whole surface
 * to mock. `from` deliberately throws: reading and writing `tickets` from the
 * browser is exactly the bug this replaced — a staff-only account has no SELECT
 * or UPDATE policy on that table, so the old path reported every valid ticket
 * as an invalid QR code, and its write was filtered by RLS into a silent no-op.
 * If someone reaches for the table again, these tests fail loudly.
 */
let rpcResponse: any = { data: null, error: null };
const rpc = vi.fn((_fn?: string, _args?: unknown) => Promise.resolve(rpcResponse));
const from = vi.fn((table: string) => {
  throw new Error(
    `TicketScanner must not touch ${table} directly — check-in goes through check_in_ticket`
  );
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => rpc(fn, args),
    from: (table: string) => from(table),
  },
}));

// AudioContext stub
beforeEach(() => {
  rpc.mockClear();
  from.mockClear();
  (globalThis as any).AudioContext = class {
    currentTime = 0;
    destination = {};
    createOscillator() {
      return { connect: () => {}, frequency: { value: 0 }, type: '', start: () => {}, stop: () => {} };
    }
    createGain() { return { connect: () => {}, gain: { value: 0 } }; }
  };
});

import TicketScanner from './TicketScanner';
import { VALID_AUTO_DISMISS_MS } from '@/components/admin/ScanResultOverlay';

function renderScanner() {
  return render(
    <MemoryRouter>
      <TicketScanner />
    </MemoryRouter>
  );
}

async function scanCode(code: string) {
  const input = screen.getByPlaceholderText(/Enter ticket QR code/i);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /Validate/i }));
}

/** A verdict as check_in_ticket returns it. */
function verdict(
  v: 'valid' | 'already_scanned' | 'not_confirmed' | 'not_found' | 'forbidden',
  ticket: Record<string, unknown> | null
) {
  return { data: { verdict: v, ticket }, error: null };
}

function ticketRow(over: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    production_title: 'Casablanca',
    start_time: '2026-07-10T19:00:00Z',
    seat_row: null,
    seat_number: null,
    scanned_at: '2026-07-10T18:45:00Z',
    status: 'confirmed',
    ...over,
  };
}

describe('TicketScanner - GA, event, and concert tickets', () => {
  it('accepts a general-admission movie ticket and claims its check-in', async () => {
    rpcResponse = verdict('valid', ticketRow({ id: 'ticket-ga-1' }));

    renderScanner();
    await scanCode('QR-GA-MOVIE');

    await waitFor(() =>
      expect(screen.getByText(/Ticket validated/i)).toBeInTheDocument()
    );
    expect(screen.getByText('Casablanca')).toBeInTheDocument();
    expect(screen.getByText(/General Admission/i)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('check_in_ticket', { p_qr_code: 'QR-GA-MOVIE' });
    // The claim is the server's job; the client must not write the table.
    expect(from).not.toHaveBeenCalled();
  });

  it('accepts an event ticket (no movie)', async () => {
    rpcResponse = verdict(
      'valid',
      ticketRow({ id: 'ticket-event-1', production_title: 'Silent Film Gala' })
    );

    renderScanner();
    await scanCode('QR-EVENT');

    await waitFor(() =>
      expect(screen.getByText(/Ticket validated/i)).toBeInTheDocument()
    );
    expect(screen.getByText('Silent Film Gala')).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('check_in_ticket', { p_qr_code: 'QR-EVENT' });
  });

  it('accepts a live performance (concert) ticket', async () => {
    rpcResponse = verdict(
      'valid',
      ticketRow({ id: 'ticket-concert-1', production_title: 'Palouse Jazz Quartet' })
    );

    renderScanner();
    await scanCode('QR-CONCERT');

    await waitFor(() =>
      expect(screen.getByText(/Ticket validated/i)).toBeInTheDocument()
    );
    expect(screen.getByText('Palouse Jazz Quartet')).toBeInTheDocument();
  });

  it('shows a seat when the ticket has one', async () => {
    rpcResponse = verdict('valid', ticketRow({ seat_row: 'F', seat_number: 12 }));

    renderScanner();
    await scanCode('QR-SEATED');

    await waitFor(() => expect(screen.getByText(/Row F, Seat 12/i)).toBeInTheDocument());
  });

  it('reports already-scanned tickets, with the time they were used', async () => {
    rpcResponse = verdict(
      'already_scanned',
      ticketRow({ id: 'ticket-used', scanned_at: '2026-07-09T18:00:00Z' })
    );

    renderScanner();
    await scanCode('QR-USED');

    await waitFor(() =>
      expect(screen.getByText(/Already scanned/i)).toBeInTheDocument()
    );
    // One call, and no direct table write to "re-scan" it.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects unknown QR codes as invalid', async () => {
    rpcResponse = verdict('not_found', null);

    renderScanner();
    await scanCode('QR-NOPE');

    await waitFor(() =>
      expect(screen.getByText(/invalid QR code/i)).toBeInTheDocument()
    );
  });

  it('refuses a ticket that is not confirmed rather than admitting it', async () => {
    // The old client path never checked status, so a refunded ticket scanned as
    // valid and was stamped as used. The server refuses it now.
    rpcResponse = verdict(
      'not_confirmed',
      ticketRow({ id: 'ticket-refunded', status: 'refunded', scanned_at: null })
    );

    renderScanner();
    await scanCode('QR-REFUNDED');

    await waitFor(() =>
      expect(screen.getByText(/refunded — not valid for entry/i)).toBeInTheDocument()
    );
  });

  it('reports a permission refusal as a refusal, not a missing ticket', async () => {
    rpcResponse = verdict('forbidden', null);

    renderScanner();
    await scanCode('QR-ANY');

    await waitFor(() =>
      expect(screen.getByText(/cannot check in tickets/i)).toBeInTheDocument()
    );
  });

  it('surfaces a transport failure instead of silently admitting', async () => {
    rpcResponse = { data: null, error: { message: 'network down' } };

    renderScanner();
    await scanCode('QR-BOOM');

    await waitFor(() =>
      expect(screen.getByText(/Could not reach the server/i)).toBeInTheDocument()
    );
  });
});

describe('TicketScanner - centre-screen verdict', () => {
  it('shows an unmissable verdict, not something staff must scroll to find', async () => {
    rpcResponse = verdict('valid', ticketRow({ id: 'ticket-ok' }));
    renderScanner();
    await scanCode('QR-OK');

    // role=alert is what makes this announce to screen readers and what marks
    // it as the overlay rather than page content.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Admit/i);
    expect(alert).toHaveTextContent(/Casablanca/i);
  });

  it('a valid ticket clears itself so the queue keeps moving', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      rpcResponse = verdict('valid', ticketRow({ id: 'ticket-ok' }));
      renderScanner();
      await scanCode('QR-OK');

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(VALID_AUTO_DISMISS_MS + 100);
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a duplicate ticket holds the gate until staff acknowledge it', async () => {
    rpcResponse = verdict(
      'already_scanned',
      ticketRow({ id: 'ticket-dupe', scanned_at: '2026-07-09T18:00:00Z' })
    );

    renderScanner();
    await scanCode('QR-DUPE');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Already used/i);

    // A problem must never auto-clear — letting someone through on a duplicate
    // is the failure that matters, so it waits for a human.
    await new Promise(r => setTimeout(r, VALID_AUTO_DISMISS_MS + 150));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // ...and the next ticket is not processed until it is acknowledged.
    rpcResponse = verdict('valid', ticketRow({ id: 'ticket-next' }));
    const callsBefore = rpc.mock.calls.length;
    await scanCode('QR-NEXT');
    expect(screen.getByRole('alert')).toHaveTextContent(/Already used/i);
    expect(rpc.mock.calls.length).toBe(callsBefore);

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());

    // Gate is open again.
    await scanCode('QR-NEXT');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Admit/i));
    expect(rpc).toHaveBeenCalledWith('check_in_ticket', { p_qr_code: 'QR-NEXT' });
  });
});
