import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Heart, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DonationPrompt } from '@/components/DonationPrompt';
import { KenworthyLogo } from '@/components/brand/KenworthyLogo';
import { MarqueeFrame } from '@/components/MarqueeFrame';
import { ProductionMetaBadges } from '@/components/ProductionMedia';
import { formatShowtime } from '@/lib/datetime';
import {
  CODE_LENGTH, normalizeCode, safePosterUrl, useDisplayChannel,
  type ChannelFactory, type SaleSnapshot,
} from '@/lib/patronDisplay';

/**
 * The patron-facing display at the box office — the device outside the glass.
 * See docs/briefs/BRIEF-pos-patron-facing-display.md and @/lib/patronDisplay.
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

export default function PatronDisplay({ factory }: { factory?: ChannelFactory }) {
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
    <main className="min-h-screen bg-background text-foreground flex flex-col px-2 sm:px-4 py-3 sm:py-6">
      <div className="w-full max-w-2xl mx-auto flex-1 flex flex-col">
        <KenworthyLogo size="custom" loading="eager" className="h-10 sm:h-16 mx-auto mb-3 sm:mb-6" />
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
      className="flex-1 flex flex-col justify-center gap-4 w-full max-w-xl mx-auto"
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
  // Which sale the patron has made their choice for. Keyed on the sale, so the
  // next patron starts at the prompt without anything having to reset it.
  const [decidedFor, setDecidedFor] = useState<string | null>(null);

  if (snapshot.phase === 'idle') {
    return (
      <div className="flex-1 flex flex-col justify-center text-center gap-3">
        <p className="font-display text-4xl">Welcome</p>
        <p className="text-lg text-muted-foreground">Your order will appear here.</p>
      </div>
    );
  }

  // Once the patron has chosen — or the till has gone to the reader without
  // waiting — the gift is settled and the screen says what will be charged.
  if (decidedFor === snapshot.saleId || snapshot.phase === 'paying') {
    return (
      <FinalTotal
        snapshot={snapshot}
        onChange={snapshot.phase === 'open' ? () => setDecidedFor(null) : undefined}
      />
    );
  }

  return (
    <SaleFrame>
      <ShowCard snapshot={snapshot} />
      <Breakdown snapshot={snapshot} />
      {/* Keyed on the sale so a half-typed amount never carries over to the
          next patron. The value shown is the till's, not this screen's. */}
      <DonationPrompt
        key={snapshot.saleId}
        variant="display"
        valueCents={snapshot.donationCents}
        onChange={(cents) => { onPropose(cents); setDecidedFor(snapshot.saleId); }}
      />
    </SaleFrame>
  );
}

/**
 * The transaction, framed in the marquee's ring of bulbs — the same
 * `MarqueeFrame` the concessions menu and the booth note wear. The inset is
 * brought in from the panel weight: that is sized for a wide page, and here
 * the frame is the whole screen of a phone.
 */
function SaleFrame({ children }: { children: React.ReactNode }) {
  return (
    <MarqueeFrame className="bg-card/30 rounded-sm space-y-4 sm:space-y-6 [--mq-inset:1.25rem] sm:[--mq-inset:4rem]">
      {children}
    </MarqueeFrame>
  );
}

/**
 * The show the tickets are for: its poster, title, time, rating / genre /
 * runtime, and — while the patron is still choosing — a few lines of what it
 * is. The same facts the public showing page prints.
 *
 * The poster URL is checked again here, not only at the till: this screen
 * renders whatever arrives on its channel. A broken image hides itself rather
 * than leaving a torn-picture icon in front of a patron.
 */
function ShowCard({ snapshot, compact }: { snapshot: SaleSnapshot; compact?: boolean }) {
  const p = snapshot.production;
  const poster = safePosterUrl(p?.posterUrl);
  const [posterFailed, setPosterFailed] = useState(false);
  useEffect(() => setPosterFailed(false), [poster]);
  return (
    <div>
      <div className="flex gap-3 sm:gap-4 items-start">
        {poster && !posterFailed && (
          <img
            src={poster}
            alt=""
            onError={() => setPosterFailed(true)}
            className={`${compact ? 'w-14 sm:w-28' : 'w-16 sm:w-40'} aspect-[2/3] shrink-0 rounded-sm object-cover shadow-lg`}
          />
        )}
        <div className="min-w-0 space-y-2">
          <p className="font-display text-2xl sm:text-3xl leading-tight break-words">{snapshot.title}</p>
          {snapshot.showtime && (
            <p className="text-base sm:text-lg text-muted-foreground">
              {formatShowtime(snapshot.showtime, 'EEE, MMM d · h:mm a')}
            </p>
          )}
          <ProductionMetaBadges rating={p?.rating} genre={p?.genre} durationMinutes={p?.runtimeMinutes} />
          {/* Text, never HTML: see toDisplayDescription. Not on a phone:
              measured at 375 × 812, it pushed the donation buttons ~170px
              below the fold, and the gift is what this screen is for. */}
          {!compact && p?.description && (
            // The breakpoint toggles a wrapper, not the paragraph: `sm:block`
            // on the paragraph overrides the -webkit-box that line-clamp
            // needs, and the clamp silently stops clamping.
            <div className="hidden sm:block">
              <p className="text-base text-muted-foreground line-clamp-4">{p.description}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Breakdown({ snapshot, large }: { snapshot: SaleSnapshot; large?: boolean }) {
  return (
    <dl className="text-base sm:text-lg space-y-1 sm:space-y-2">
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
      <div className={`flex justify-between border-t border-border pt-2 sm:pt-3 font-bold ${large ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'}`}>
        <dt>Total</dt>
        <dd>{dollars(snapshot.totalCents)}</dd>
      </div>
    </dl>
  );
}

/**
 * The patron's last screen before paying: what will be charged, and what
 * happens next. It holds from the moment the gift is chosen until the till
 * says the sale went through, so the patron is never left on a prompt they
 * have already answered. Its figures are still the till's, live — if staff
 * add a ticket, the total here follows.
 */
function FinalTotal({ snapshot, onChange }: { snapshot: SaleSnapshot; onChange?: () => void }) {
  const paying = snapshot.phase === 'paying';
  return (
    <SaleFrame>
      <ShowCard snapshot={snapshot} compact />
      <Breakdown snapshot={snapshot} large />
      {snapshot.donationCents > 0 && (
        <p className="text-xl text-center">Thank you for your {dollars(snapshot.donationCents)} gift!</p>
      )}
      <div className="rounded-lg border border-border p-4 flex items-center gap-3 text-lg" role="status">
        {paying
          ? <CreditCard className="h-6 w-6 shrink-0" aria-hidden="true" />
          : <Loader2 className="h-6 w-6 shrink-0 animate-spin" aria-hidden="true" />}
        {paying
          ? snapshot.payment === 'card'
            ? 'Please pay on the card reader at the window.'
            : 'Please pay at the window.'
          : 'One moment — the box office is getting your payment ready.'}
      </div>
      {/* Until the sale goes to the reader, a mis-tap can be undone here
          rather than by asking through the glass. */}
      {onChange && (
        <div className="text-center">
          <button type="button" onClick={onChange} className="text-lg underline underline-offset-4">
            Change my donation
          </button>
        </div>
      )}
    </SaleFrame>
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
