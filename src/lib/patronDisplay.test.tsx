import { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Every channel here is the in-memory bus below; the real client is never reached.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
// The app renders the display inside AuthProvider; here it is the signed-out website.
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, loading: false, isAdmin: false }) }));

import PatronDisplay from '@/pages/PatronDisplay';
import {
  acceptableProposal, CODE_LENGTH, DESCRIPTION_MAX, newPairingCode, normalizeCode,
  safePosterUrl, toDisplayDescription, useTillDisplay, useDisplayChannel, acceptablePay,
  type ChannelFactory, type ChargeRequest, type DisplayChannel, type DisplayState, type SaleSnapshot,
  type StandResult, type TillDisplay,
} from './patronDisplay';

/**
 * An in-memory Realtime: endpoints on the same topic hear each other's
 * broadcasts, never their own (the `self: false` the real channel is opened
 * with), and asynchronously, as over a network.
 */
function memoryBus() {
  const topics = new Map<string, Set<Endpoint>>();
  interface Endpoint {
    role: 'till' | 'display';
    handlers: Map<string, Array<(p: unknown) => void>>;
    presence: Array<(n: number) => void>;
    tracked: boolean;
  }
  const announcePresence = (topic: string) => {
    const peers = topics.get(topic) ?? new Set();
    const n = [...peers].filter((e) => e.role === 'display' && e.tracked).length;
    for (const e of peers) for (const h of e.presence) h(n);
  };
  const factory: ChannelFactory = (topic, role) => {
    const me: Endpoint = { role, handlers: new Map(), presence: [], tracked: false };
    const status: Array<(c: boolean) => void> = [];
    if (!topics.has(topic)) topics.set(topic, new Set());
    queueMicrotask(() => {
      topics.get(topic)!.add(me);
      for (const h of status) h(true);
      announcePresence(topic);
    });
    const ch: DisplayChannel = {
      send: (event, payload) => {
        const copy = JSON.parse(JSON.stringify(payload));
        queueMicrotask(() => {
          for (const peer of topics.get(topic) ?? []) {
            if (peer === me) continue;
            for (const h of peer.handlers.get(event) ?? []) h(copy);
          }
        });
      },
      on: (event, h) => { me.handlers.set(event, [...(me.handlers.get(event) ?? []), h]); },
      onStatus: (h) => { status.push(h); },
      track: () => { me.tracked = true; },
      onPresence: (h) => { me.presence.push(h); },
      close: () => { topics.get(topic)?.delete(me); announcePresence(topic); },
    };
    return ch;
  };
  return { factory };
}

const baseSale: SaleSnapshot = {
  saleId: 'sale-1',
  phase: 'open',
  payment: 'card',
  title: 'Nosferatu',
  showtime: '2026-10-31T02:00:00.000Z',
  production: {
    posterUrl: 'https://www.kenworthy.org/posters/nosferatu.jpg',
    rating: 'NR',
    genre: 'Horror, Silent',
    runtimeMinutes: 94,
    description: 'Murnau’s vampire, with a live score.',
  },
  ticketCount: 2,
  ticketsCents: 1908,
  donationCents: 0,
  totalCents: 1908,
};

/** The till's half, reduced to the state StaffPOS keeps for it. */
function Till({ factory, initial, expose }: {
  factory: ChannelFactory;
  initial: SaleSnapshot;
  expose: (api: { till: TillDisplay; set: (s: Partial<SaleSnapshot>) => void; donation: () => number }) => void;
}) {
  const [sale, setSale] = useState(initial);
  const snapshot = { ...sale, totalCents: sale.ticketsCents + sale.donationCents };
  const till = useTillDisplay(snapshot, (cents) => setSale((s) => ({ ...s, donationCents: cents })), factory);
  expose({ till, set: (p) => setSale((s) => ({ ...s, ...p })), donation: () => snapshot.donationCents });
  return <p data-testid="till-donation">{snapshot.donationCents}</p>;
}

function renderPair(initial: SaleSnapshot = baseSale) {
  const { factory } = memoryBus();
  let api!: Parameters<Parameters<typeof Till>[0]['expose']>[0];
  render(<Till factory={factory} initial={initial} expose={(a) => { api = a; }} />);
  act(() => api.till.pair());
  const code = api.till.code!;
  render(
    <MemoryRouter initialEntries={[`/pos/display?code=${code}`]}>
      <PatronDisplay factory={factory} />
    </MemoryRouter>,
  );
  return { api: () => api, code, factory };
}

beforeEach(() => localStorage.clear());

/** Long enough for the bus's microtasks and React's re-render to finish. */
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('pairing codes', () => {
  it('are six characters from an alphabet with no lookalikes', () => {
    for (let i = 0; i < 200; i++) {
      const c = newPairingCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    }
  });

  it('forgive case and spacing, and refuse anything else', () => {
    expect(normalizeCode(' ab3-k7q ')).toBe('AB3K7Q');
    expect(normalizeCode('AB3K7')).toBeNull();
    expect(normalizeCode('AB0K7Q')).toBeNull();
  });
});

describe('safePosterUrl', () => {
  it('takes posters from the theatre’s site and our storage', () => {
    expect(safePosterUrl('https://www.kenworthy.org/wp-content/uploads/a.jpg')).toBe('https://www.kenworthy.org/wp-content/uploads/a.jpg');
    expect(safePosterUrl('https://vlmslygnimfbamrtwvyo.supabase.co/storage/v1/object/public/posters/a.jpg')).toContain('/storage/v1/');
  });
  it('refuses anything else a stranger on the channel could send', () => {
    expect(safePosterUrl('https://example.com/a.jpg')).toBeNull();
    expect(safePosterUrl('http://www.kenworthy.org/a.jpg')).toBeNull();
    expect(safePosterUrl('https://www.kenworthy.org.evil.com/a.jpg')).toBeNull();
    expect(safePosterUrl('https://x.supabase.co/rest/v1/movies')).toBeNull();
    expect(safePosterUrl('javascript:alert(1)')).toBeNull();
    expect(safePosterUrl(42)).toBeNull();
  });
});

describe('toDisplayDescription', () => {
  it('collapses whitespace and leaves a short one whole', () => {
    expect(toDisplayDescription('  A  silent\n film. ')).toBe('A silent film.');
    expect(toDisplayDescription('')).toBeNull();
  });
  it('cuts a long one at a word', () => {
    const out = toDisplayDescription('word '.repeat(200))!;
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX + 1);
    expect(out.endsWith('word…')).toBe(true);
  });
});

describe('acceptableProposal', () => {
  const open = { saleId: 's', phase: 'open' as const };
  it('takes nothing, or a gift the counter could take', () => {
    expect(acceptableProposal({ saleId: 's', cents: 0 }, open)).toBe(true);
    expect(acceptableProposal({ saleId: 's', cents: 500 }, open)).toBe(true);
    expect(acceptableProposal({ saleId: 's', cents: 100_000 }, open)).toBe(true);
  });
  it('refuses amounts the server would refuse', () => {
    expect(acceptableProposal({ saleId: 's', cents: 50 }, open)).toBe(false);
    expect(acceptableProposal({ saleId: 's', cents: 100_001 }, open)).toBe(false);
    expect(acceptableProposal({ saleId: 's', cents: -500 }, open)).toBe(false);
    expect(acceptableProposal({ saleId: 's', cents: 5.5 }, open)).toBe(false);
    expect(acceptableProposal({ saleId: 's', cents: '500' }, open)).toBe(false);
    expect(acceptableProposal(null, open)).toBe(false);
  });
  it('refuses a proposal for another sale, or once the sale is paying', () => {
    expect(acceptableProposal({ saleId: 'old', cents: 500 }, open)).toBe(false);
    expect(acceptableProposal({ saleId: 's', cents: 500 }, { saleId: 's', phase: 'paying' })).toBe(false);
    expect(acceptableProposal({ saleId: 's', cents: 500 }, { saleId: 's', phase: 'idle' })).toBe(false);
    expect(acceptableProposal({ saleId: 's', cents: 500 }, { saleId: 's', phase: 'open', payment: 'cash' })).toBe(false);
    expect(acceptableProposal({ saleId: 's', cents: 500 }, { saleId: 's', phase: 'open', payment: 'card' })).toBe(true);
  });
});

describe('till ↔ display', () => {
  it('mirrors the sale on the display, with the show’s poster and details', async () => {
    renderPair();
    expect(await screen.findByText('Nosferatu')).toBeInTheDocument();
    expect(document.querySelector('img[src="https://www.kenworthy.org/posters/nosferatu.jpg"]')).not.toBeNull();
    expect(screen.getByText('NR')).toBeInTheDocument();
    expect(screen.getByText('Silent')).toBeInTheDocument();
    expect(screen.getByText('Murnau’s vampire, with a live score.')).toBeInTheDocument();
    expect(screen.getByText('2 tickets, with tax')).toBeInTheDocument();
    expect(screen.getAllByText('$19.08').length).toBeGreaterThan(0);
  });

  it('a gift the patron taps becomes the till’s donation, and the screen moves to the final total', async () => {
    const { api } = renderPair();
    fireEvent.click(await screen.findByRole('button', { name: '$5' }));
    await waitFor(() => expect(screen.getByTestId('till-donation')).toHaveTextContent(/^500$/));
    // The prompt is gone: the patron has answered it.
    expect(screen.queryByRole('button', { name: '$5' })).not.toBeInTheDocument();
    // Figures shown because the till said so, not because the button was tapped.
    expect(await screen.findByText('$24.08')).toBeInTheDocument();
    expect(screen.getByText('Thank you for your $5.00 gift!')).toBeInTheDocument();
    expect(screen.getByText(/getting your payment ready/)).toBeInTheDocument();
    expect(api().donation()).toBe(500);
  });

  it('“No thanks” moves on to the final total too, with no gift', async () => {
    renderPair();
    fireEvent.click(await screen.findByRole('button', { name: 'No thanks' }));
    expect(await screen.findByText(/getting your payment ready/)).toBeInTheDocument();
    expect(screen.queryByText(/Thank you for your/)).not.toBeInTheDocument();
    expect(screen.getByTestId('till-donation')).toHaveTextContent(/^0$/);
  });

  it('the patron can change their mind until the sale goes to the reader', async () => {
    const { api } = renderPair();
    fireEvent.click(await screen.findByRole('button', { name: '$10' }));
    await waitFor(() => expect(screen.getByTestId('till-donation')).toHaveTextContent(/^1000$/));
    fireEvent.click(screen.getByRole('button', { name: 'Change my donation' }));
    fireEvent.click(await screen.findByRole('button', { name: '$1' }));
    await waitFor(() => expect(screen.getByTestId('till-donation')).toHaveTextContent(/^100$/));

    act(() => api().set({ phase: 'paying' }));
    expect(await screen.findByText('Please pay on the card reader at the window.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change my donation' })).not.toBeInTheDocument();
  });

  it('a typed amount is sent only when the patron adds it, not a keystroke at a time', async () => {
    renderPair();
    const field = await screen.findByLabelText('Custom donation amount');
    fireEvent.change(field, { target: { value: '2' } });
    fireEvent.change(field, { target: { value: '25' } });
    await act(async () => { await settle(); });
    expect(screen.getByTestId('till-donation')).toHaveTextContent(/^0$/);
    fireEvent.click(screen.getByRole('button', { name: 'Add $25.00' }));
    await waitFor(() => expect(screen.getByTestId('till-donation')).toHaveTextContent(/^2500$/));
    expect(await screen.findByText('Thank you for your $25.00 gift!')).toBeInTheDocument();
  });

  // The control for the two refusals below: the same out-of-band send, for
  // the current sale while it is open, does land. Without it those tests
  // would pass just as well if the send never arrived.
  it('a proposal from any screen on the code lands while the sale is open', async () => {
    const { factory, code } = renderPair();
    await screen.findByText('Nosferatu');
    const other = factory(`pos-display:${code}`, 'display');
    await act(async () => { other.send('donation', { saleId: 'sale-1', cents: 1000 }); await settle(); });
    expect(screen.getByTestId('till-donation')).toHaveTextContent(/^1000$/);
  });

  it('once the sale is paying, the display offers no gift and the till takes none', async () => {
    const { api, factory, code } = renderPair();
    await screen.findByText('Nosferatu');
    act(() => api().set({ phase: 'paying' }));
    expect(await screen.findByText('Please pay on the card reader at the window.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '$5' })).not.toBeInTheDocument();

    // A proposal sent anyway — by a stale screen, or by anyone who has the code.
    const rogue = factory(`pos-display:${code}`, 'display');
    await act(async () => { rogue.send('donation', { saleId: 'sale-1', cents: 1000 }); await settle(); });
    expect(screen.getByTestId('till-donation')).toHaveTextContent(/^0$/);
  });

  it('a tap meant for the last sale does not land on the next one', async () => {
    const { api, factory, code } = renderPair();
    await screen.findByText('Nosferatu');
    act(() => api().set({ saleId: 'sale-2' }));
    const late = factory(`pos-display:${code}`, 'display');
    await act(async () => { late.send('donation', { saleId: 'sale-1', cents: 1000 }); await settle(); });
    expect(screen.getByTestId('till-donation')).toHaveTextContent(/^0$/);
  });

  it('a completed sale thanks the patron, then the cleared till shows welcome', async () => {
    const { api } = renderPair({ ...baseSale, donationCents: 500 });
    await screen.findByText('Nosferatu');
    act(() => {
      api().till.announceComplete({ ...baseSale, donationCents: 500, totalCents: 2408 });
      api().set({ saleId: 'sale-2', phase: 'idle', title: null, ticketCount: 0, ticketsCents: 0, donationCents: 0 });
    });
    expect(await screen.findByText('Thank you!')).toBeInTheDocument();
    expect(screen.getByText('Your $5.00 gift keeps the marquee lit.')).toBeInTheDocument();
    // The next patron's sale ends the thank-you.
    act(() => api().set({ phase: 'open', title: 'Metropolis', ticketCount: 1, ticketsCents: 954 }));
    expect(await screen.findByText('Metropolis')).toBeInTheDocument();
  });

  it('between sales the display just says welcome', async () => {
    renderPair({ ...baseSale, phase: 'idle', title: null, ticketCount: 0, ticketsCents: 0 });
    expect(await screen.findByText('Welcome')).toBeInTheDocument();
    expect(screen.queryByText(/will appear here/)).toBeNull();
  });

  it('a cash sale asks for no gift: the patron sees the total to pay at the window', async () => {
    const { api } = renderPair({ ...baseSale, payment: 'cash' });
    await screen.findByText('Nosferatu');
    expect(screen.getByText('Please pay at the window.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /no thanks/i })).toBeNull();
    expect(screen.queryByText(/change my donation/i)).toBeNull();
    expect(api().donation()).toBe(0);
  });

  it('staff options stay behind the logo until it is tapped', async () => {
    renderPair();
    await screen.findByText('Nosferatu');
    expect(screen.queryByText('Use a different code')).toBeNull();
    const logo = screen.getByRole('button', { name: /staff options/i });
    fireEvent.click(logo);
    expect(screen.getByText('Use a different code')).toBeInTheDocument();
    fireEvent.click(logo);
    expect(screen.queryByText('Use a different code')).toBeNull();
  });

  it('the till sees the display join', async () => {
    const { api } = renderPair();
    await screen.findByText('Nosferatu');
    await waitFor(() => expect(api().till.displays).toBe(1));
  });

  it('another station’s code hears nothing from this till', async () => {
    const { factory } = memoryBus();
    let api!: Parameters<Parameters<typeof Till>[0]['expose']>[0];
    render(<Till factory={factory} initial={baseSale} expose={(a) => { api = a; }} />);
    act(() => api.till.pair());
    const other = api.till.code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
    render(
      <MemoryRouter initialEntries={[`/pos/display?code=${other}`]}>
        <PatronDisplay factory={factory} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Connecting to the box office/)).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByText('Nosferatu')).not.toBeInTheDocument();
  });

  it('a poster from anywhere else is not shown', async () => {
    renderPair({ ...baseSale, production: { ...baseSale.production!, posterUrl: 'https://example.com/x.jpg' } });
    await screen.findByText('Nosferatu');
    expect(document.querySelector('img[src="https://example.com/x.jpg"]')).toBeNull();
  });

  it('an unpaired till opens no channel at all', () => {
    let opened = 0;
    const counting: ChannelFactory = (...args) => { opened++; return memoryBus().factory(...args); };
    render(<Till factory={counting} initial={baseSale} expose={() => {}} />);
    expect(opened).toBe(0);
  });
});


// ── The Stand at the patron-facing display (BRIEF-stand-at-patron-display.md) ──

describe('the Stand at the display', () => {
  const standSale: SaleSnapshot = { ...baseSale, standAtDisplay: true };

  function wire(initial: SaleSnapshot) {
    const { factory } = memoryBus();
    const paid: number[] = [];
    const results: StandResult[] = [];
    const charges: ChargeRequest[] = [];
    let till!: TillDisplay;
    let display!: DisplayState;
    let setSale!: (s: SaleSnapshot) => void;
    function TillSide() {
      const [sale, set] = useState(initial);
      setSale = set;
      till = useTillDisplay(sale, () => {}, factory, {
        onPay: () => paid.push(1),
        onStandResult: (r) => results.push(r),
      });
      return null;
    }
    render(<TillSide />);
    act(() => till.pair());
    const code = till.code!;
    function DisplaySide() {
      display = useDisplayChannel(code, factory, { onCharge: (r) => charges.push(r) });
      return null;
    }
    render(<DisplaySide />);
    return { till: () => till, display: () => display, setSale: (s: SaleSnapshot) => act(() => setSale(s)), paid, results, charges };
  }

  it('Pay starts the till only for a card sale on the display’s Stand, while open', () => {
    expect(acceptablePay({ saleId: 'sale-1' }, standSale)).toBe(true);
    expect(acceptablePay({ saleId: 'sale-1' }, { ...standSale, standAtDisplay: false })).toBe(false);
    expect(acceptablePay({ saleId: 'sale-1' }, { ...standSale, payment: 'cash' })).toBe(false);
    expect(acceptablePay({ saleId: 'sale-1' }, { ...standSale, phase: 'paying' })).toBe(false);
    expect(acceptablePay({ saleId: 'other' }, standSale)).toBe(false);
  });

  it('a Pay tap reaches the till', async () => {
    const w = wire(standSale);
    await act(settle);
    act(() => w.display().pay());
    await act(settle);
    expect(w.paid).toEqual([1]);
  });

  it('a Pay tap for a till not on the display’s Stand is ignored', async () => {
    const w = wire(baseSale);
    await act(settle);
    act(() => w.display().pay());
    await act(settle);
    expect(w.paid).toEqual([]);
  });

  it('the till’s charge reaches the display, carrying only the sale and the Square Order', async () => {
    const w = wire(standSale);
    await act(settle);
    act(() => w.till().charge({ saleId: 'sale-1', squareOrderId: 'ORDER_1' }));
    await act(settle);
    expect(w.charges).toEqual([{ saleId: 'sale-1', squareOrderId: 'ORDER_1' }]);
  });

  it('the display’s result reaches the till for the current sale only', async () => {
    const w = wire(standSale);
    await act(settle);
    act(() => w.display().sendStandResult({ saleId: 'old-sale', outcome: 'paid', paymentId: 'P0' }));
    act(() => w.display().sendStandResult({ saleId: 'sale-1', outcome: 'paid', paymentId: 'P1' }));
    act(() => w.display().sendStandResult({ saleId: 'sale-1', outcome: 'bogus' } as unknown as StandResult));
    await act(settle);
    expect(w.results).toEqual([{ saleId: 'sale-1', outcome: 'paid', paymentId: 'P1' }]);
  });

  it('the till hears whether the display’s Stand is ready', async () => {
    const w = wire(standSale);
    await act(settle);
    expect(w.till().stand).toBeNull();
    act(() => w.display().sendStandStatus({ ready: true, line: 'ready' }));
    await act(settle);
    expect(w.till().stand).toEqual({ ready: true, line: 'ready' });
  });
});
