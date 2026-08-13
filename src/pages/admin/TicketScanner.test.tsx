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

// The film-pass door scan is a server call — every rule it applies lives in one
// database transaction, so the browser only chooses the words for a verdict.
const admit = vi.fn();
vi.mock('@/lib/functions', () => ({
  invokeFunction: (name: string, body: any) => admit(name, body),
}));

// Supabase mock. Two chains now:
//   tickets:  .select(...).eq(...).maybeSingle()   /  .update(...).eq(...)
//   showings: .select(...).eq(...).gte(...).lte(...).order(...)
// The showings query is what feeds the screening selector a film pass is spent
// against; it is awaited directly rather than through maybeSingle.
const updateEq = vi.fn().mockResolvedValue({ error: null });
const update = vi.fn(() => ({ eq: updateEq }));

let selectResponse: any = { data: null, error: null };
let showingsResponse: any = { data: [], error: null };

const maybeSingle = vi.fn(() => Promise.resolve(selectResponse));

const showingsChain: any = {
  eq: () => showingsChain,
  gte: () => showingsChain,
  lte: () => showingsChain,
  order: () => Promise.resolve(showingsResponse),
};

const selectEq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq: selectEq }));
const from = vi.fn((table: string) =>
  table === 'showings'
    ? { select: () => showingsChain, update }
    : { select, update },
);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => from(table) },
}));

// AudioContext stub
beforeEach(() => {
  updateEq.mockClear();
  update.mockClear();
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
  it('accepts a general-admission movie ticket and marks it scanned', async () => {
    selectResponse = {
      data: {
        id: 'ticket-ga-1',
        status: 'confirmed',
        scanned_at: null,
        qr_code: 'QR-GA-MOVIE',
        seats: null,
        showings: {
          start_time: '2026-07-10T19:00:00Z',
          movies: { title: 'Casablanca' },
          events: null,
          live_performances: null,
        },
      },
      error: null,
    };

    renderScanner();
    await scanCode('QR-GA-MOVIE');

    await waitFor(() =>
      expect(screen.getByText(/Ticket validated/i)).toBeInTheDocument()
    );
    expect(screen.getByText('Casablanca')).toBeInTheDocument();
    expect(screen.getByText(/General Admission/i)).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ scanned_at: expect.any(String) })
    );
    expect(updateEq).toHaveBeenCalledWith('id', 'ticket-ga-1');
  });

  it('accepts an event ticket (no movie) and marks it scanned', async () => {
    selectResponse = {
      data: {
        id: 'ticket-event-1',
        status: 'confirmed',
        scanned_at: null,
        qr_code: 'QR-EVENT',
        seats: null,
        showings: {
          start_time: '2026-08-01T18:30:00Z',
          movies: null,
          events: { title: 'Silent Film Gala' },
          live_performances: null,
        },
      },
      error: null,
    };

    renderScanner();
    await scanCode('QR-EVENT');

    await waitFor(() =>
      expect(screen.getByText(/Ticket validated/i)).toBeInTheDocument()
    );
    expect(screen.getByText('Silent Film Gala')).toBeInTheDocument();
    expect(updateEq).toHaveBeenCalledWith('id', 'ticket-event-1');
  });

  it('accepts a live performance (concert) ticket and marks it scanned', async () => {
    selectResponse = {
      data: {
        id: 'ticket-concert-1',
        status: 'confirmed',
        scanned_at: null,
        qr_code: 'QR-CONCERT',
        seats: null,
        showings: {
          start_time: '2026-09-12T20:00:00Z',
          movies: null,
          events: null,
          live_performances: { title: 'Palouse Jazz Quartet' },
        },
      },
      error: null,
    };

    renderScanner();
    await scanCode('QR-CONCERT');

    await waitFor(() =>
      expect(screen.getByText(/Ticket validated/i)).toBeInTheDocument()
    );
    expect(screen.getByText('Palouse Jazz Quartet')).toBeInTheDocument();
    expect(updateEq).toHaveBeenCalledWith('id', 'ticket-concert-1');
  });

  it('reports already-scanned tickets without re-updating', async () => {
    selectResponse = {
      data: {
        id: 'ticket-used',
        status: 'confirmed',
        scanned_at: '2026-07-09T18:00:00Z',
        qr_code: 'QR-USED',
        seats: null,
        showings: {
          start_time: '2026-07-09T19:00:00Z',
          movies: null,
          events: { title: 'Community Night' },
          live_performances: null,
        },
      },
      error: null,
    };

    renderScanner();
    await scanCode('QR-USED');

    await waitFor(() =>
      expect(screen.getByText(/Already scanned/i)).toBeInTheDocument()
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects unknown QR codes as invalid', async () => {
    selectResponse = { data: null, error: null };

    renderScanner();
    await scanCode('QR-NOPE');

    await waitFor(() =>
      expect(screen.getByText(/invalid QR code/i)).toBeInTheDocument()
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('TicketScanner - centre-screen verdict', () => {
  const validTicket = (qr: string, id: string) => ({
    data: {
      id,
      status: 'confirmed',
      scanned_at: null,
      qr_code: qr,
      seats: null,
      showings: {
        start_time: '2026-07-10T19:00:00Z',
        movies: { title: 'Casablanca' },
        events: null,
        live_performances: null,
      },
    },
    error: null,
  });

  it('shows an unmissable verdict, not something staff must scroll to find', async () => {
    selectResponse = validTicket('QR-OK', 'ticket-ok');
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
      selectResponse = validTicket('QR-OK', 'ticket-ok');
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
    selectResponse = {
      data: {
        id: 'ticket-dupe',
        status: 'confirmed',
        scanned_at: '2026-07-09T18:00:00Z',
        qr_code: 'QR-DUPE',
        seats: null,
        showings: {
          start_time: '2026-07-09T19:00:00Z',
          movies: null,
          events: { title: 'Community Night' },
          live_performances: null,
        },
      },
      error: null,
    };

    renderScanner();
    await scanCode('QR-DUPE');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Already used/i);

    // A problem must never auto-clear — letting someone through on a duplicate
    // is the failure that matters, so it waits for a human.
    await new Promise(r => setTimeout(r, VALID_AUTO_DISMISS_MS + 150));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // ...and the next ticket is not processed until it is acknowledged.
    selectResponse = validTicket('QR-NEXT', 'ticket-next');
    await scanCode('QR-NEXT');
    expect(screen.getByRole('alert')).toHaveTextContent(/Already used/i);
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());

    // Gate is open again.
    await scanCode('QR-NEXT');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Admit/i));
    expect(updateEq).toHaveBeenCalledWith('id', 'ticket-next');
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
    // And a pass admission must never be mistaken for a ticket update.
    expect(update).not.toHaveBeenCalled();
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

  it('holds a second scan of the same pass at the same screening', async () => {
    admit.mockResolvedValue({
      result: 'already_admitted',
      showing_title: 'Casablanca',
      remaining_balance: 54,
    });

    renderScanner();
    await showingReady();
    await scanCode('PASS:abc-123');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Already used/i);
    // A problem must never auto-clear.
    await new Promise(r => setTimeout(r, VALID_AUTO_DISMISS_MS + 150));
    expect(screen.getByRole('alert')).toBeInTheDocument();
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

  it('still scans ordinary tickets while a screening is selected', async () => {
    selectResponse = {
      data: {
        id: 'ticket-mixed',
        status: 'confirmed',
        scanned_at: null,
        qr_code: 'QR-MIXED',
        seats: null,
        showings: {
          start_time: '2026-07-10T19:00:00Z',
          movies: { title: 'Casablanca' },
          events: null,
          live_performances: null,
        },
      },
      error: null,
    };

    renderScanner();
    await scanCode('QR-MIXED');

    await waitFor(() => expect(screen.getByText(/Ticket validated/i)).toBeInTheDocument());
    // A ticket carries its own showing; the selector must not touch it.
    expect(admit).not.toHaveBeenCalled();
    expect(updateEq).toHaveBeenCalledWith('id', 'ticket-mixed');
  });
});
