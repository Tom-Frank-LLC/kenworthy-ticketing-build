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
 * to mock. `from('tickets')` deliberately throws: reading and writing `tickets`
 * from the browser is exactly the bug this replaced — a staff-only account has
 * no SELECT or UPDATE policy on that table, so the old path reported every
 * valid ticket as an invalid QR code, and its write was filtered by RLS into a
 * silent no-op. If someone reaches for the table again, these tests fail loudly.
 *
 * `showings` is a different matter and is served rather than refused: the
 * screening selector reads it to know which film a *pass* is being spent on,
 * which is public, aggregate-free data the seat map already displays.
 */
let rpcResponse: any = { data: null, error: null };
let showingsResponse: any = { data: [], error: null };

const rpc = vi.fn((_fn?: string, _args?: unknown) => Promise.resolve(rpcResponse));

const showingsChain: any = {
  eq: () => showingsChain,
  gte: () => showingsChain,
  lte: () => showingsChain,
  order: () => Promise.resolve(showingsResponse),
};

const from = vi.fn((table: string) => {
  if (table === 'showings') return { select: () => showingsChain };
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

/** The guard upstream expressed as `expect(from).not.toHaveBeenCalled()`. */
function expectNoTicketTableAccess() {
  expect(from.mock.calls.map(([t]) => t)).not.toContain('tickets');
}

// The film-pass door scan is a server call — every rule it applies lives in one
// database transaction, so the browser only chooses the words for a verdict.
const admit = vi.fn();
vi.mock('@/lib/functions', () => ({
  invokeFunction: (name: string, body: any) => admit(name, body),
}));

// AudioContext stub
beforeEach(() => {
  rpc.mockClear();
  from.mockClear();
  admit.mockReset();
  showingsResponse = {
    data: [
      {
        id: 'showing-1',
        start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        film_pass_eligible: true,
        movies: { title: 'Casablanca' },
        events: null,
        live_performances: null,
      },
    ],
    error: null,
  };
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

/**
 * Wait until the screening selector has actually settled on a showing.
 *
 * The list is fetched on mount, so scanning a pass before it lands is the
 * "no screening selected" path — which is a real behaviour with its own test,
 * and would otherwise silently mask every other pass assertion.
 */
async function showingReady() {
  await waitFor(() =>
    expect(screen.getByText(/Film passes scanned now are spent on this screening/i))
      .toBeInTheDocument(),
  );
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
    expectNoTicketTableAccess();
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
    expectNoTicketTableAccess();
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

describe('TicketScanner - film passes at the door', () => {
  // A pass is a balance, not a seat: nothing on the sticker says which film it
  // is being spent on, so the screening has to come from the scanner.
  const passScan = () =>
    admit.mock.calls.find(([name, body]) => name === 'film-pass-checkout' && body.action === 'admit');

  it('spends a pass against the selected screening and shows what is left', async () => {
    admit.mockResolvedValue({
      result: 'admitted',
      showing_title: 'Casablanca',
      amount_deducted: 6,
      remaining_balance: 54,
      admissions_left: 9,
    });

    renderScanner();
    await showingReady();
    await scanCode('PASS:abc-123');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Admit/i);
    expect(alert).toHaveTextContent(/\$54\.00 left/);
    expect(alert).toHaveTextContent(/9 more films/);

    // The showing came from the selector, not from the code.
    expect(passScan()?.[1]).toMatchObject({ qr_code: 'PASS:abc-123', showing_id: 'showing-1' });
    // A pass admission is not a ticket check-in and must not claim one.
    expect(rpc).not.toHaveBeenCalled();
    expectNoTicketTableAccess();
  });

  it('refuses a pass at a screening that does not take them, and says so', async () => {
    admit.mockResolvedValue({
      result: 'ineligible',
      showing_title: 'Met Live: Tosca',
      remaining_balance: 54,
    });

    renderScanner();
    await showingReady();
    await scanCode('PASS:abc-123');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Do not admit/i);
    expect(alert).toHaveTextContent(/not valid for this screening/i);
    // Nothing was spent — staff need to see the balance is intact.
    expect(alert).toHaveTextContent(/\$54\.00 left/);
  });

  it('calls a depleted pass used up rather than "not active"', async () => {
    // The balance hits zero on the tenth admission and the row stops being
    // active, so the eleventh scan arrives as not_active/depleted. "Not active"
    // would send staff hunting for a fault that is not there.
    admit.mockResolvedValue({ result: 'not_active', status: 'depleted' });

    renderScanner();
    await showingReady();
    await scanCode('PASS:spent');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/used up/i);
  });

  // A pass is a balance, not a season ticket: the holder brings a friend, each
  // scan admits one more person, and the balance is the only limit. The
  // `already_admitted` refusal that used to sit here — backed by a unique index
  // on (pass_id, showing_id) — turned the theatre's own product into an error.
  it('admits a second person on the same pass at the same screening', async () => {
    admit.mockResolvedValue({
      result: 'admitted',
      showing_title: 'Casablanca',
      amount_deducted: 6,
      remaining_balance: 48,
      admissions_left: 8,
      admitted_for_showing: 2,
    });

    renderScanner();
    await showingReady();
    await scanCode('PASS:abc-123');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Admit/i);
    expect(alert).toHaveTextContent(/\$48\.00 left/);
    // Staff are told which admission this was, because the server can no longer
    // tell a friend from the same sticker read twice and they can.
    expect(alert).toHaveTextContent(/2nd admission on this pass/i);
  });

  it('says nothing about a count on the first admission of the night', async () => {
    admit.mockResolvedValue({
      result: 'admitted',
      showing_title: 'Casablanca',
      amount_deducted: 6,
      remaining_balance: 54,
      admissions_left: 9,
      admitted_for_showing: 1,
    });

    renderScanner();
    await showingReady();
    await scanCode('PASS:abc-123');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Admit/i);
    expect(alert).not.toHaveTextContent(/admission on this pass/i);
  });

  // The only thing left guarding against one sticker held to the camera a beat
  // too long, now that the server accepts a repeat scan as a real admission.
  it('ignores a re-read of the identical code inside the cooldown', async () => {
    admit.mockResolvedValue({
      result: 'admitted',
      showing_title: 'Casablanca',
      amount_deducted: 6,
      remaining_balance: 54,
      admissions_left: 9,
      admitted_for_showing: 1,
    });

    renderScanner();
    await showingReady();
    await scanCode('PASS:abc-123');
    await waitFor(() => expect(admit).toHaveBeenCalledTimes(1));

    // The same sticker, immediately: nothing reaches the server, so nothing is
    // deducted twice.
    await scanCode('PASS:abc-123');
    expect(admit).toHaveBeenCalledTimes(1);

    // A different code is the friend behind them and must not be held at all.
    await scanCode('PASS:def-456');
    await waitFor(() => expect(admit).toHaveBeenCalledTimes(2));
  });

  it('refuses to spend a pass when no screening is selected', async () => {
    showingsResponse = { data: [], error: null };

    renderScanner();
    await waitFor(() => expect(from).toHaveBeenCalledWith('showings'));
    await scanCode('PASS:abc-123');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Choose which screening/i);
    // Nothing reached the server: an admission with no showing is not a request
    // worth making.
    expect(admit).not.toHaveBeenCalled();
  });

  it('still checks in ordinary tickets while a screening is selected', async () => {
    rpcResponse = verdict('valid', ticketRow({ id: 'ticket-mixed' }));

    renderScanner();
    await showingReady();
    await scanCode('QR-MIXED');

    await waitFor(() => expect(screen.getByText(/Ticket validated/i)).toBeInTheDocument());
    // A ticket carries its own showing; the selector must not touch it.
    expect(admit).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('check_in_ticket', { p_qr_code: 'QR-MIXED' });
  });
});
