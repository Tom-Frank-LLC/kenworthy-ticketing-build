import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MAX_BUNDLED_DONATION_CENTS } from '@/components/DonationPrompt';

/**
 * The patron-facing screen at the box office: the iPhone or iPad outside the
 * glass that mirrors the sale and lets the patron choose their own donation.
 * See docs/briefs/BRIEF-pos-patron-facing-display.md.
 *
 * The two screens talk over a Supabase Realtime *broadcast* channel named by a
 * pairing code. Nothing is stored: a sale is transient, and the till already
 * owns it. Which shapes everything below:
 *
 * - **The till is the only source of truth.** The display renders what the
 *   till last sent and nothing else — not even the button the patron just
 *   tapped. A tap is a *proposal*; the till decides whether to take it, and
 *   the display lights up only when the till's next snapshot says it did. So
 *   the display can never show a donation the till is not about to charge.
 *
 * - **A public channel is readable and writable by anyone who can name it.**
 *   The anon key is in the bundle, and Realtime admits any topic on it
 *   (verified on staging and production, 15 Oct 2026). The pairing code is
 *   therefore the only thing scoping a channel, so it is random, not short
 *   enough to sweep, and expires. What a stranger who guessed one could do is
 *   bounded anyway: read a show title and a total (no names, emails or seats),
 *   or propose a gift — which the till shows to staff, refuses outside the
 *   amounts the counter could take anyway, and refuses once the sale has gone
 *   to the reader. The card reader then shows the patron the full amount
 *   before they tap. Nothing on this channel can charge, record or refund.
 *
 * - **A proposal names the sale it belongs to.** A tap that arrives after the
 *   sale cleared would otherwise land on the next patron's sale.
 */

/** No 0/O, 1/I/L: read off one screen and typed into another. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/**
 * How long a station's code lives. Long enough for a full day at the window
 * (matinee to late show), so the display is paired once a shift; short enough
 * that a code someone photographed yesterday is dead today.
 */
export const CODE_TTL_MS = 16 * 60 * 60 * 1000;

export function newPairingCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 248 is the largest multiple of 31 under 256; rejecting above it keeps
  // every character equally likely.
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const b of bytes) {
      if (out.length === CODE_LENGTH) break;
      if (b < 248) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
    crypto.getRandomValues(bytes);
  }
  return out;
}

/**
 * What a person typed, made comparable: case and spacing forgiven. The
 * alphabet has no lookalike pairs, so nothing else needs guessing.
 */
export function normalizeCode(raw: string): string | null {
  const cleaned = raw.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) if (!CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

export function topicFor(code: string): string {
  return `pos-display:${code}`;
}

export function displayUrl(origin: string, code: string): string {
  return `${origin}/pos/display?code=${code}`;
}

// ── The messages ─────────────────────────────────────────────────────────────

export interface DisplayLine {
  label: string;
  cents: number;
}

/**
 * The show being sold, as the patron-facing display presents it — the same
 * facts the public showing page prints, nothing a patron could not read there.
 */
export interface DisplayProduction {
  /** Checked with `safePosterUrl` on both ends; null when there is none. */
  posterUrl: string | null;
  rating: string | null;
  genre: string | null;
  /** Null when the admin hid the runtime (`show_runtime = false`). */
  runtimeMinutes: number | null;
  /** Plain text, never HTML, and cut short — see `toDisplayDescription`. */
  description: string | null;
}

/** What the till sends. Deliberately free of anything that names the patron. */
export interface SaleSnapshot {
  /** Changes when the till clears; a proposal must carry the current one. */
  saleId: string;
  /**
   * idle — no tickets selected yet.
   * open — tickets selected; the patron may choose a gift.
   * paying — sent to the reader or being rung up; the gift is fixed.
   */
  phase: 'idle' | 'open' | 'paying';
  /** Card sales are paid on the reader; cash is paid at the window. */
  payment: 'card' | 'cash';
  title: string | null;
  showtime: string | null;
  production: DisplayProduction | null;
  ticketCount: number;
  /** Tickets with tax, discount and any card fee — everything but the gift. */
  ticketsCents: number;
  donationCents: number;
  totalCents: number;
  /**
   * The till takes this sale's card on the Square Stand the display sits in
   * (BRIEF-stand-at-patron-display.md), so the display offers the patron a
   * Pay button once the gift is chosen. Absent from older tills: false.
   */
  standAtDisplay?: boolean;
}

export interface DonationProposal {
  saleId: string;
  cents: number;
}

/**
 * Where poster art may come from. The display renders whatever arrives on its
 * channel, and anyone who has the code can send to it, so it will not load an
 * image from just anywhere — a public screen is the wrong place to find out
 * what a stranger can put on it. The two hosts are where every poster in
 * production lives (checked 15 Oct 2026): the theatre's own site and the
 * project's Supabase storage.
 */
export function safePosterUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.hostname === 'www.kenworthy.org' || url.hostname === 'kenworthy.org') return url.href;
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/')) return url.href;
  return null;
}

/** Long enough to say what the show is; short enough to sit beside a total. */
export const DESCRIPTION_MAX = 320;

/**
 * A production's description as the display shows it: plain text, never HTML
 * (the display renders it as text, so nothing on the channel is ever markup),
 * cut at a word boundary.
 */
export function toDisplayDescription(plain: string | null | undefined): string | null {
  const text = (plain ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), DESCRIPTION_MAX - 40)).trimEnd()}…`;
}

export const EVENTS = {
  snapshot: 'sale',
  /** The till's sale went through; the display says thank you. */
  complete: 'complete',
  /** The display asks for the current snapshot (on join, on wake). */
  hello: 'hello',
  donation: 'donation',
  // The Stand at the display (BRIEF-stand-at-patron-display.md):
  /** display → till: the patron tapped Pay. A request; the till decides. */
  pay: 'pay',
  /** till → display: take the card for this Square Order. */
  charge: 'charge',
  /** till → display: staff cancelled; stop the Stand if it is waiting. */
  chargeCancel: 'charge-cancel',
  /** display → till: how the card went. */
  standResult: 'stand-result',
  /** display → till: whether the display has a Stand that can take a card. */
  standStatus: 'stand-status',
} as const;

/**
 * till → display. Only the Square Order's id: anyone with the pairing code can
 * read and write this channel, so neither the amount (which the display gets
 * from the server, for this order) nor the order token (which opens the
 * tickets) is ever sent on it.
 */
export interface ChargeRequest {
  saleId: string;
  squareOrderId: string;
}

/**
 * display → till. `paid` carries the payment id; the till confirms it with the
 * server, which reads it from Square, so a forged `paid` confirms nothing.
 */
export interface StandResult {
  saleId: string;
  outcome: 'paid' | 'declined' | 'canceled' | 'error';
  paymentId?: string | null;
  message?: string | null;
}

/** display → till: whether this display can take a card on its Stand. */
export interface StandStatusMessage {
  ready: boolean;
  /** One line for the till's reader picker. */
  line: string;
}

/**
 * Whether a proposal may set the till's donation. The same bounds the
 * staff-side prompt can produce: nothing, or a whole-cent gift of at least a
 * dollar (the donations table refuses less) and at most the bundled cap (the
 * server refuses more).
 */
export function acceptableProposal(
  p: unknown,
  current: Pick<SaleSnapshot, 'saleId' | 'phase'>,
): p is DonationProposal {
  if (!p || typeof p !== 'object') return false;
  const { saleId, cents } = p as Record<string, unknown>;
  if (saleId !== current.saleId) return false;
  if (current.phase !== 'open') return false;
  if (typeof cents !== 'number' || !Number.isInteger(cents)) return false;
  return cents === 0 || (cents >= 100 && cents <= MAX_BUNDLED_DONATION_CENTS);
}

/** Whether a Pay tap may start the till's card sale. */
export function acceptablePay(
  p: unknown,
  current: Pick<SaleSnapshot, 'saleId' | 'phase' | 'payment' | 'standAtDisplay'>,
): boolean {
  if (!p || typeof p !== 'object') return false;
  return (p as Record<string, unknown>).saleId === current.saleId
    && current.phase === 'open' && current.payment === 'card' && current.standAtDisplay === true;
}

export function isStandResult(p: unknown): p is StandResult {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  return typeof r.saleId === 'string' && ['paid', 'declined', 'canceled', 'error'].includes(r.outcome as string)
    && (r.paymentId == null || typeof r.paymentId === 'string')
    && (r.message == null || typeof r.message === 'string');
}

export function isChargeRequest(p: unknown): p is ChargeRequest {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  return typeof r.saleId === 'string' && typeof r.squareOrderId === 'string' && r.squareOrderId.length > 0;
}

function isStandStatus(p: unknown): p is StandStatusMessage {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  return typeof r.ready === 'boolean' && typeof r.line === 'string';
}

// ── Transport ────────────────────────────────────────────────────────────────

/**
 * The slice of a Realtime channel the two screens use. An interface so the
 * tests can wire a till to a display in memory, with the same code paths.
 */
export interface DisplayChannel {
  send(event: string, payload: unknown): void;
  on(event: string, handler: (payload: unknown) => void): void;
  /** Called with true once joined, false when the connection drops. */
  onStatus(handler: (connected: boolean) => void): void;
  /** Present on the display side: announce this screen to the till. */
  track?(): void;
  /** Present on the till side: how many displays are listening. */
  onPresence?(handler: (displays: number) => void): void;
  close(): void;
}

export type ChannelFactory = (topic: string, role: 'till' | 'display') => DisplayChannel;

export const realtimeChannel: ChannelFactory = (topic, role) => {
  const ch = supabase.channel(topic, {
    config: { broadcast: { self: false }, presence: { key: role } },
  });
  const statusHandlers: Array<(c: boolean) => void> = [];
  let presenceHandler: ((n: number) => void) | null = null;
  let wantTrack = false;

  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState();
    presenceHandler?.((state.display ?? []).length);
  });

  // Handlers must be attached before subscribe(); the till and display both
  // register theirs synchronously after construction, and subscribe is
  // deferred a tick so they are all in place first.
  queueMicrotask(() => {
    ch.subscribe((status) => {
      const connected = status === 'SUBSCRIBED';
      if (connected && wantTrack) void ch.track({ at: Date.now() });
      for (const h of statusHandlers) h(connected);
    });
  });

  return {
    send: (event, payload) => { void ch.send({ type: 'broadcast', event, payload }); },
    on: (event, handler) => { ch.on('broadcast', { event }, (msg) => handler(msg.payload)); },
    onStatus: (h) => { statusHandlers.push(h); },
    track: () => { wantTrack = true; },
    onPresence: (h) => { presenceHandler = h; },
    close: () => { void supabase.removeChannel(ch); },
  };
};

// ── The till's side ──────────────────────────────────────────────────────────

const STATION_KEY = 'kenworthy.pos.displayPairing';

interface StoredPairing {
  code: string;
  createdAt: number;
}

/**
 * The pairing is a property of the station, like its card reader (see
 * @/lib/terminalReader), so it lives in localStorage: a reload of the till
 * does not unpair the display outside the glass.
 */
function readPairing(now: number): StoredPairing | null {
  try {
    const raw = localStorage.getItem(STATION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredPairing;
    if (typeof p.code !== 'string' || typeof p.createdAt !== 'number') return null;
    if (now - p.createdAt > CODE_TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}

function storePairing(p: StoredPairing | null) {
  try {
    if (p) localStorage.setItem(STATION_KEY, JSON.stringify(p));
    else localStorage.removeItem(STATION_KEY);
  } catch { /* a station that cannot remember is paired again after a reload */ }
}

export interface TillDisplay {
  /** The station's code, or null when no display is paired. */
  code: string | null;
  connected: boolean;
  /** Displays currently listening on this station's channel. */
  displays: number;
  pair: () => void;
  unpair: () => void;
  /** Tell the display the sale went through. Call before clearing the sale. */
  announceComplete: (snapshot: SaleSnapshot) => void;
  /** What the display last said about its Stand; null if it never has. */
  stand: StandStatusMessage | null;
  /** Ask the display to take the card for this order on its Stand. */
  charge: (request: ChargeRequest) => void;
  /** Staff cancelled: the display stops the Stand if it is waiting. */
  cancelCharge: (saleId: string) => void;
}

/** What the till does when the display's Stand speaks. */
export interface TillStandHandlers {
  /** The patron tapped Pay; already checked against the current sale. */
  onPay?: () => void;
  onStandResult?: (result: StandResult) => void;
}

/**
 * Run the till's end of the channel.
 *
 * `snapshot` is sent whenever it changes. `onProposal` is called with a gift the
 * patron chose, already checked against the current sale; the caller sets its
 * donation from it. With no pairing this opens nothing and does nothing, which
 * is what keeps an unpaired till exactly as it was.
 */
export function useTillDisplay(
  snapshot: SaleSnapshot,
  onProposal: (cents: number) => void,
  factory: ChannelFactory = realtimeChannel,
  standHandlers: TillStandHandlers = {},
): TillDisplay {
  const [pairing, setPairing] = useState<StoredPairing | null>(() => readPairing(Date.now()));
  const [connected, setConnected] = useState(false);
  const [displays, setDisplays] = useState(0);
  const [stand, setStand] = useState<StandStatusMessage | null>(null);
  const standHandlersRef = useRef(standHandlers);
  standHandlersRef.current = standHandlers;
  const channelRef = useRef<DisplayChannel | null>(null);

  // Read by the channel's handlers, which are attached once per pairing.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onProposalRef = useRef(onProposal);
  onProposalRef.current = onProposal;

  const code = pairing?.code ?? null;

  useEffect(() => {
    if (!pairing) return;
    // Expire on schedule even if the till is never reloaded.
    const left = pairing.createdAt + CODE_TTL_MS - Date.now();
    const t = setTimeout(() => { storePairing(null); setPairing(null); }, Math.max(0, left));
    return () => clearTimeout(t);
  }, [pairing]);

  useEffect(() => {
    if (!code) return;
    const ch = factory(topicFor(code), 'till');
    channelRef.current = ch;
    ch.on(EVENTS.hello, () => ch.send(EVENTS.snapshot, snapshotRef.current));
    ch.on(EVENTS.donation, (p) => {
      if (acceptableProposal(p, snapshotRef.current)) onProposalRef.current(p.cents);
    });
    ch.on(EVENTS.pay, (p) => {
      if (acceptablePay(p, snapshotRef.current)) standHandlersRef.current.onPay?.();
    });
    ch.on(EVENTS.standResult, (p) => {
      if (isStandResult(p) && p.saleId === snapshotRef.current.saleId) standHandlersRef.current.onStandResult?.(p);
    });
    ch.on(EVENTS.standStatus, (p) => { if (isStandStatus(p)) setStand(p); });
    ch.onStatus((c) => {
      setConnected(c);
      // A display that joined while the till was reconnecting asked into the
      // void; answer it now.
      if (c) ch.send(EVENTS.snapshot, snapshotRef.current);
    });
    ch.onPresence?.(setDisplays);
    return () => {
      ch.close();
      channelRef.current = null;
      setConnected(false);
      setDisplays(0);
      setStand(null);
    };
  }, [code, factory]);

  // A display that leaves takes its Stand with it.
  useEffect(() => { if (displays === 0) setStand(null); }, [displays]);

  // Serialised so a re-render that changes nothing sends nothing.
  const wire = JSON.stringify(snapshot);
  useEffect(() => {
    channelRef.current?.send(EVENTS.snapshot, JSON.parse(wire));
  }, [wire, code]);

  const pair = useCallback(() => {
    const p = { code: newPairingCode(), createdAt: Date.now() };
    storePairing(p);
    setPairing(p);
  }, []);

  const unpair = useCallback(() => {
    storePairing(null);
    setPairing(null);
  }, []);

  const announceComplete = useCallback((s: SaleSnapshot) => {
    channelRef.current?.send(EVENTS.complete, { totalCents: s.totalCents, donationCents: s.donationCents });
  }, []);

  const charge = useCallback((request: ChargeRequest) => {
    channelRef.current?.send(EVENTS.charge, request);
  }, []);
  const cancelCharge = useCallback((saleId: string) => {
    channelRef.current?.send(EVENTS.chargeCancel, { saleId });
  }, []);

  return { code, connected, displays, pair, unpair, announceComplete, stand, charge, cancelCharge };
}

// ── The display's side ───────────────────────────────────────────────────────

export interface DisplayState {
  connected: boolean;
  /** Null until the till has answered — or forever, for a wrong code. */
  snapshot: SaleSnapshot | null;
  /** Set when the till announces a completed sale; cleared by the next sale. */
  thanks: { totalCents: number; donationCents: number } | null;
  propose: (cents: number) => void;
  /** The patron tapped Pay. */
  pay: () => void;
  sendStandStatus: (status: StandStatusMessage) => void;
  sendStandResult: (result: StandResult) => void;
}

/** What the display does when the till asks its Stand for something. */
export interface DisplayStandHandlers {
  onCharge?: (request: ChargeRequest) => void;
  onChargeCancel?: (saleId: string) => void;
  /** Called on every (re)join, so the till hears the Stand's state afresh. */
  onJoined?: () => void;
}

export function useDisplayChannel(
  code: string | null,
  factory: ChannelFactory = realtimeChannel,
  standHandlers: DisplayStandHandlers = {},
): DisplayState {
  const standHandlersRef = useRef(standHandlers);
  standHandlersRef.current = standHandlers;
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<SaleSnapshot | null>(null);
  const [thanks, setThanks] = useState<DisplayState['thanks']>(null);
  const channelRef = useRef<DisplayChannel | null>(null);
  const snapshotRef = useRef<SaleSnapshot | null>(null);

  useEffect(() => {
    setSnapshot(null);
    setThanks(null);
    snapshotRef.current = null;
    if (!code) return;
    const ch = factory(topicFor(code), 'display');
    channelRef.current = ch;
    ch.on(EVENTS.snapshot, (p) => {
      const s = p as SaleSnapshot;
      // A new sale with tickets in it ends the thank-you screen.
      if (s.phase !== 'idle') setThanks(null);
      snapshotRef.current = s;
      setSnapshot(s);
    });
    ch.on(EVENTS.complete, (p) => setThanks(p as { totalCents: number; donationCents: number }));
    ch.on(EVENTS.charge, (p) => { if (isChargeRequest(p)) standHandlersRef.current.onCharge?.(p); });
    ch.on(EVENTS.chargeCancel, (p) => {
      const saleId = (p as { saleId?: unknown } | null)?.saleId;
      if (typeof saleId === 'string') standHandlersRef.current.onChargeCancel?.(saleId);
    });
    ch.track?.();
    ch.onStatus((c) => {
      setConnected(c);
      if (c) {
        ch.send(EVENTS.hello, {});
        standHandlersRef.current.onJoined?.();
      }
    });

    // A phone that slept has missed whatever the till sent meanwhile.
    const wake = () => { if (document.visibilityState === 'visible') ch.send(EVENTS.hello, {}); };
    document.addEventListener('visibilitychange', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      ch.close();
      channelRef.current = null;
      setConnected(false);
    };
  }, [code, factory]);

  const propose = useCallback((cents: number) => {
    const s = snapshotRef.current;
    if (!s) return;
    channelRef.current?.send(EVENTS.donation, { saleId: s.saleId, cents } satisfies DonationProposal);
  }, []);

  const pay = useCallback(() => {
    const s = snapshotRef.current;
    if (s) channelRef.current?.send(EVENTS.pay, { saleId: s.saleId });
  }, []);
  const sendStandStatus = useCallback((status: StandStatusMessage) => {
    channelRef.current?.send(EVENTS.standStatus, status);
  }, []);
  const sendStandResult = useCallback((result: StandResult) => {
    channelRef.current?.send(EVENTS.standResult, result);
  }, []);

  return { connected, snapshot, thanks, propose, pay, sendStandStatus, sendStandResult };
}
