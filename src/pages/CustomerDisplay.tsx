import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Heart, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DonationPrompt } from '@/components/DonationPrompt';
import { formatShowtime } from '@/lib/datetime';
import {
  CODE_LENGTH, normalizeCode, useDisplayChannel,
  type ChannelFactory, type SaleSnapshot,
} from '@/lib/customerDisplay';

/**
 * The patron's own screen at the box office — the device outside the glass.
 * See docs/briefs/BRIEF-pos-customer-display.md and @/lib/customerDisplay.
 *
 * It is handed to the public, so it is built to be safe in anyone's hands:
 * no sign-in, no site chrome, no links off the page, and no call to anything
 * privileged. It shows what the till sends and can propose one thing, a
 * donation amount; the till decides, charges and records.
 */

const DEVICE_KEY = 'kenworthy.pos.displayCode';

function readDeviceCode(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}
function storeDeviceCode(code: string | null) {
  try {
    if (code) localStorage.setItem(DEVICE_KEY, code);
    else localStorage.removeItem(DEVICE_KEY);
  } catch { /* the display asks for the code again after a reload */ }
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** How long to wait for the till before saying the code found nothing. */
const NOT_FOUND_AFTER_MS = 6000;
/** How long the thank-you stays up when no new sale replaces it. */
const THANKS_FOR_MS = 10000;

export default function CustomerDisplay({ factory }: { factory?: ChannelFactory }) {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState<string | null>(() => {
    const fromLink = normalizeCode(params.get('code') ?? '');
    if (fromLink) storeDeviceCode(fromLink);
    return fromLink ?? readDeviceCode();
  });

  // Out of the address bar once remembered: a reload rejoins from storage.
  useEffect(() => {
    if (params.has('code')) setParams({}, { replace: true });
  }, [params, setParams]);

  useWakeLock(!!code);

  const join = (c: string) => { storeDeviceCode(c); setCode(c); };
  const leave = () => { storeDeviceCode(null); setCode(null); };

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col px-4 py-6">
      <div className="w-full max-w-xl mx-auto flex-1 flex flex-col">
        <p className="font-display text-2xl tracking-wide text-center mb-6">The Kenworthy</p>
        {code
          ? <PairedDisplay code={code} factory={factory} onLeave={leave} />
          : <CodeEntry onJoin={join} />}
      </div>
    </main>
  );
}

function CodeEntry({ onJoin }: { onJoin: (code: string) => void }) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex-1 flex flex-col justify-center gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const c = normalizeCode(raw);
        if (!c) { setError(`The code is ${CODE_LENGTH} letters and numbers, shown on the box office screen.`); return; }
        onJoin(c);
      }}
    >
      <label htmlFor="pairing-code" className="text-xl text-center">Enter the code from the box office screen</label>
      <Input
        id="pairing-code"
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setError(null); }}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={CODE_LENGTH + 2}
        className="h-16 text-3xl text-center font-mono tracking-[0.3em]"
        aria-describedby={error ? 'pairing-error' : undefined}
      />
      {error && <p id="pairing-error" role="alert" className="text-center">{error}</p>}
      <Button type="submit" size="lg" className="h-14 text-lg">Connect</Button>
    </form>
  );
}

function PairedDisplay({ code, factory, onLeave }: { code: string; factory?: ChannelFactory; onLeave: () => void }) {
  const { connected, snapshot, thanks, propose } = useDisplayChannel(code, factory);
  const [notFound, setNotFound] = useState(false);
  const [thanksShown, setThanksShown] = useState(false);

  useEffect(() => {
    setNotFound(false);
    if (snapshot || !connected) return;
    const t = setTimeout(() => setNotFound(true), NOT_FOUND_AFTER_MS);
    return () => clearTimeout(t);
  }, [snapshot, connected]);

  useEffect(() => {
    if (!thanks) { setThanksShown(false); return; }
    setThanksShown(true);
    const t = setTimeout(() => setThanksShown(false), THANKS_FOR_MS);
    return () => clearTimeout(t);
  }, [thanks]);

  let body: React.ReactNode;
  if (thanks && thanksShown) {
    body = <ThankYou donationCents={thanks.donationCents} />;
  } else if (snapshot) {
    body = <Sale snapshot={snapshot} onPropose={propose} />;
  } else if (notFound) {
    body = (
      <div className="flex-1 flex flex-col justify-center text-center gap-4">
        <p className="text-xl">No box office screen is using code <span className="font-mono">{code}</span>.</p>
        <p className="text-muted-foreground">Check the code on the till, or ask staff for a new one.</p>
      </div>
    );
  } else {
    body = (
      <div className="flex-1 flex items-center justify-center gap-2 text-lg" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Connecting to the box office…
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex flex-col" aria-live="polite">{body}</div>
      {/* For staff setting the device up. A patron who taps it unpairs a
          screen and nothing else; the till carries on with its own prompt. */}
      <div className="pt-8 text-center">
        <button type="button" onClick={onLeave} className="text-sm text-muted-foreground underline underline-offset-2">
          Use a different code
        </button>
      </div>
    </>
  );
}

function Sale({ snapshot, onPropose }: { snapshot: SaleSnapshot; onPropose: (cents: number) => void }) {
  if (snapshot.phase === 'idle') {
    return (
      <div className="flex-1 flex flex-col justify-center text-center gap-3">
        <p className="font-display text-4xl">Welcome</p>
        <p className="text-lg text-muted-foreground">Your order will appear here.</p>
      </div>
    );
  }

  const paying = snapshot.phase === 'paying';
  return (
    <div className="space-y-6">
      <div>
        <p className="font-display text-3xl">{snapshot.title}</p>
        {snapshot.showtime && (
          <p className="text-lg text-muted-foreground">{formatShowtime(snapshot.showtime, 'EEEE, MMMM d · h:mm a')}</p>
        )}
      </div>

      <dl className="text-lg space-y-2">
        <div className="flex justify-between">
          <dt>{snapshot.ticketCount} {snapshot.ticketCount === 1 ? 'ticket' : 'tickets'}, with tax</dt>
          <dd>{dollars(snapshot.ticketsCents)}</dd>
        </div>
        {/* Always laid out, hidden at zero: the line appearing under a
            patron's finger would push the gift buttons down mid-tap. */}
        <div
          className={`flex justify-between ${snapshot.donationCents > 0 ? '' : 'invisible'}`}
          aria-hidden={snapshot.donationCents > 0 ? undefined : true}
        >
          <dt className="flex items-center gap-2"><Heart className="h-5 w-5 text-primary" aria-hidden="true" /> Your donation</dt>
          <dd>{dollars(snapshot.donationCents)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-3 text-2xl font-bold">
          <dt>Total</dt>
          <dd>{dollars(snapshot.totalCents)}</dd>
        </div>
      </dl>

      {paying ? (
        <div className="rounded-lg border border-border p-4 flex items-center gap-3 text-lg" role="status">
          <CreditCard className="h-6 w-6 shrink-0" aria-hidden="true" />
          {snapshot.payment === 'card'
            ? 'Please pay on the card reader at the window.'
            : 'Please pay at the window.'}
        </div>
      ) : (
        // Keyed on the sale so a half-typed amount never carries over to the
        // next patron. The value shown is the till's, not this screen's: a
        // choice lights up once the till has taken it.
        <DonationPrompt
          key={snapshot.saleId}
          variant="display"
          valueCents={snapshot.donationCents}
          onChange={onPropose}
        />
      )}
      {!paying && snapshot.donationCents > 0 && (
        <p className="text-lg text-center">Thank you! Your gift is added to this purchase.</p>
      )}
    </div>
  );
}

function ThankYou({ donationCents }: { donationCents: number }) {
  return (
    <div className="flex-1 flex flex-col justify-center text-center gap-3">
      <p className="font-display text-4xl">Thank you!</p>
      {donationCents > 0 && (
        <p className="text-xl">Your {dollars(donationCents)} gift keeps the marquee lit.</p>
      )}
      <p className="text-lg text-muted-foreground">Enjoy the show.</p>
    </div>
  );
}

/**
 * Keep the screen on while paired. A display that dims between patrons is a
 * display staff have to wake. Best effort: Safari has had the API since 16.4,
 * the lock is dropped whenever the page is hidden, and nothing breaks without it.
 */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      nav.wakeLock!.request('screen')
        .then((l) => { if (cancelled) void l.release(); else lock = l; })
        .catch(() => { /* low battery mode, or not allowed: the screen just sleeps */ });
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active]);
}
