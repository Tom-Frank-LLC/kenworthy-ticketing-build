import { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Every channel here is the in-memory bus below; the real client is never reached.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import PatronDisplay from '@/pages/PatronDisplay';
import {
  acceptableProposal, CODE_LENGTH, newPairingCode, normalizeCode, useTillDisplay,
  type ChannelFactory, type DisplayChannel, type SaleSnapshot, type TillDisplay,
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
  });
});

describe('till ↔ display', () => {
  it('mirrors the sale on the display', async () => {
    renderPair();
    expect(await screen.findByText('Nosferatu')).toBeInTheDocument();
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

  it('an unpaired till opens no channel at all', () => {
    let opened = 0;
    const counting: ChannelFactory = (...args) => { opened++; return memoryBus().factory(...args); };
    render(<Till factory={counting} initial={baseSale} expose={() => {}} />);
    expect(opened).toBe(0);
  });
});
