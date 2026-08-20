import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScanLine, Search, Film, AlertTriangle, X } from 'lucide-react';
import { ScanResultOverlay, type ScanResult } from '@/components/admin/ScanResultOverlay';
import { QrScanner } from '@/components/admin/QrScanner';
import { formatShowtime } from '@/lib/datetime';
import { invokeFunction } from '@/lib/functions';

/**
 * The prefix minted onto every film-pass sticker.
 *
 * It exists so this file can branch without a speculative query against both
 * tickets and passes — and so a ticket QR held up at the wrong moment is
 * refused for the right reason instead of silently doing nothing.
 */
const PASS_PREFIX = 'PASS:';

/** How far either side of now counts as "tonight" for the showing list. */
const SHOWING_WINDOW_BEFORE_MS = 4 * 60 * 60 * 1000;
const SHOWING_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * How long the same code is ignored after it has been read.
 *
 * This guard has always been here, but it used to be belt-and-braces: a second
 * scan of a pass was refused by the server as `already_admitted`, so a sticker
 * held to the camera a beat too long cost nothing. That refusal is gone — a
 * pass admits a party now, and the server cannot tell the holder's friend from
 * the same sticker read twice — which makes this the *only* thing standing
 * between one slow hand and a double deduction.
 *
 * Set just longer than the success card's own 2.2s dismissal, so the cooldown
 * outlasts the confirmation staff are reading. A *different* code is never
 * held: the friend behind them scans immediately.
 */
const SAME_CODE_COOLDOWN_MS = 3000;

/** One eligibility row as the nested embed returns it. */
interface PassTagRow {
  film_pass_types: { name: string } | null;
}

interface ScannerShowing {
  id: string;
  start_time: string;
  title: string;
  /**
   * The passes this screening actually accepts, by name.
   *
   * Not a boolean any more, because "does this take passes" stopped having a
   * single answer: a festival screening takes the festival pass and refuses
   * the standard one, and a door told only "yes" would send staff to argue
   * with a patron holding the wrong pass. Listing them turns the refusal into
   * something readable before the scan rather than after it.
   */
  passTypeNames: string[];
}

/**
 * The door scanner.
 *
 * Rendered two ways, which is what `onExit` distinguishes. As the /admin/scanner
 * route it is the whole page and exiting means going back to the dashboard; as
 * an overlay opened from the POS it is a mode the till drops into and exiting
 * means returning to the sale that is still sitting there. Either way the
 * camera is full-screen and up on arrival, because a scanner boxed inside a
 * card asks staff to aim a phone at a postage stamp while a queue waits.
 */
export default function TicketScanner({ onExit }: { onExit?: () => void } = {}) {
  const { isStaff, isHost, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [processing, setProcessing] = useState(false);
  const [scanCount, setScanCount] = useState(0);

  // Which screening the door is currently working. A ticket carries its own
  // showing, so this only governs film passes — a pass is a balance, not a
  // seat, and nothing on the sticker says which film it is being spent on.
  const [showings, setShowings] = useState<ScannerShowing[]>([]);
  const [showingId, setShowingId] = useState('');

  const lastScannedRef = useRef<string>('');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processingRef = useRef(false);
  // True while a non-valid verdict is on screen waiting to be acknowledged.
  const awaitingAckRef = useRef(false);
  // The camera callback is handed to html5-qrcode once and keeps that closure
  // for the whole session, so the selected showing has to be read from a ref.
  // Reading it from state would admit passes against whatever was selected
  // when the camera started, for the rest of the night.
  const showingIdRef = useRef('');
  useEffect(() => { showingIdRef.current = showingId; }, [showingId]);

  useEffect(() => {
    if (authLoading) return;
    if (!isStaff && !isHost) { navigate('/'); return; }
  }, [isStaff, isHost, authLoading, navigate]);

  useEffect(() => {
    if (authLoading || (!isStaff && !isHost)) return;
    let cancelled = false;

    async function loadShowings() {
      const from = new Date(Date.now() - SHOWING_WINDOW_BEFORE_MS).toISOString();
      const to = new Date(Date.now() + SHOWING_WINDOW_AFTER_MS).toISOString();

      const { data } = await supabase
        .from('showings')
        .select(
          'id, start_time, movies(title), events(title), live_performances(title), ' +
            'pass_type_showings(film_pass_types(name))',
        )
        .eq('is_active', true)
        .gte('start_time', from)
        .lte('start_time', to)
        .order('start_time');

      if (cancelled) return;

      const rows: ScannerShowing[] = (data || []).map((s: any) => ({
        id: s.id,
        start_time: s.start_time,
        title:
          s.movies?.title || s.events?.title || s.live_performances?.title || 'Untitled',
        passTypeNames: ((s.pass_type_showings ?? []) as PassTagRow[])
          .map(p => p.film_pass_types?.name)
          .filter((n): n is string => !!n)
          .sort(),
      }));
      setShowings(rows);

      // Default to whatever is happening next, but never silently: the
      // selector below states the choice, because admitting a pass against the
      // wrong screening is a mistake nothing downstream can catch.
      const now = Date.now();
      const nearest = rows.reduce<ScannerShowing | null>((best, s) => {
        const d = Math.abs(new Date(s.start_time).getTime() - now);
        if (!best) return s;
        return d < Math.abs(new Date(best.start_time).getTime() - now) ? s : best;
      }, null);
      if (nearest) setShowingId(nearest.id);
    }

    loadShowings();
    return () => { cancelled = true; };
  }, [authLoading, isStaff, isHost]);

  const selectedShowing = useMemo(
    () => showings.find(s => s.id === showingId) ?? null,
    [showings, showingId],
  );

  const playBeep = useCallback((success: boolean) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = success ? 880 : 300;
      oscillator.type = success ? 'sine' : 'square';
      gainNode.gain.value = 0.3;
      oscillator.start();
      oscillator.stop(ctx.currentTime + (success ? 0.15 : 0.3));
    } catch {
      // Audio not supported
    }
  }, []);

  /**
   * Validate a QR and claim its check-in, in one server-side step.
   *
   * This used to read the ticket and then update scanned_at from the browser,
   * which was broken two ways.
   *
   * Authorisation: the only UPDATE policies on tickets are for admins and for
   * hosts of the showing, and until this change there was no staff SELECT
   * policy either. So a staff-only account — the account the box office is
   * meant to use — read no row and reported every valid ticket as "invalid QR
   * code"; and had it got past that, RLS filters an UPDATE rather than failing
   * it, so PostgREST answers 204 and supabase-js reports success. Check-in
   * would have looked like it worked and recorded nothing.
   *
   * Concurrency: read-then-write meant two devices scanning the same QR at
   * once could both see scanned_at IS NULL and both admit the holder. The RPC
   * claims the check-in with a conditional UPDATE, so exactly one caller wins
   * and the other is told the ticket is already scanned.
   *
   * The function also refuses to stamp a ticket that is not confirmed, which
   * the old path did not check at all — a refunded ticket used to scan as
   * valid.
   */
  const validateTicket = useCallback(async (qrCode: string): Promise<ScanResult> => {
    // The selected screening scopes the scan. Until this was passed, a ticket
    // for *any* screening scanned green here and was stamped used in the
    // process — so arriving on the wrong night both got you in and cost you the
    // ticket you actually held. The server does the comparison (see
    // 20260819191247) because by the time this code sees an answer the row has
    // already been written.
    //
    // Read from the ref, not the state: this callback is captured by the QR
    // reader for the life of the session, so the state it closed over is the
    // one from mount. Empty means no screening is selected, and the server
    // treats NULL as "don't scope" — the behaviour that existed before.
    const currentShowing = showingIdRef.current || null;

    const { data, error } = await supabase.rpc('check_in_ticket', {
      p_qr_code: qrCode,
      p_showing_id: currentShowing,
    });

    if (error || !data) {
      console.error('[TicketScanner] check_in_ticket failed', error);
      return { status: 'invalid', message: 'Could not reach the server — try again' };
    }

    const result = data as {
      verdict:
        | 'valid'
        | 'wrong_showing'
        | 'already_scanned'
        | 'not_confirmed'
        | 'not_found'
        | 'forbidden';
      ticket: {
        id: string;
        production_title: string | null;
        start_time: string | null;
        seat_row: string | null;
        seat_number: number | null;
        scanned_at: string | null;
        status: string;
      } | null;
    };

    // The overlay's vocabulary is narrower than the server's: anything that is
    // not a clean admission or a duplicate is a refusal to be acknowledged.
    if (result.verdict === 'not_found') {
      return { status: 'invalid', message: 'Ticket not found — invalid QR code' };
    }
    if (result.verdict === 'forbidden') {
      return { status: 'invalid', message: 'Your account cannot check in tickets' };
    }

    const t = result.ticket;
    const ticket = t
      ? {
          id: t.id,
          movie_title: t.production_title || 'Unknown',
          start_time: t.start_time || '',
          seat_row: t.seat_row,
          seat_number: t.seat_number,
          scanned_at: t.scanned_at,
          patron_status: t.status,
        }
      : undefined;

    // A different screening. The ticket has NOT been consumed, which is the
    // whole point — so name the night it is actually for, and the patron either
    // comes back then or hands over the right ticket now.
    if (result.verdict === 'wrong_showing') {
      return {
        status: 'invalid',
        ticket,
        message: t?.start_time
          ? `Wrong screening — this ticket is for ${t.production_title || 'another show'} on ${formatShowtime(t.start_time, 'EEE MMM d, h:mm a')}. It has not been used.`
          : 'Wrong screening — this ticket is for a different show. It has not been used.',
      };
    }

    if (result.verdict === 'not_confirmed') {
      return {
        status: 'invalid',
        ticket,
        message: `This ticket is ${t?.status ?? 'not confirmed'} — not valid for entry`,
      };
    }

    if (result.verdict === 'already_scanned') {
      return {
        status: 'already_scanned',
        ticket,
        message: t?.scanned_at
          ? `Already scanned at ${formatShowtime(t.scanned_at, 'h:mm:ss a')}`
          : 'Already scanned',
      };
    }

    return { status: 'valid', ticket, message: 'Ticket validated — enjoy the show!' };
  }, []);

  /**
   * A film pass at the door.
   *
   * Everything that decides the outcome happens server-side in one
   * transaction — eligibility, expiry, balance, and minting the seat. This
   * function only chooses the words, and the words matter: "no balance left"
   * and "not valid for this screening" send a patron to two very different
   * conversations at the counter.
   *
   * There is no longer an `already_admitted` verdict to translate. A pass
   * admits a party — the holder and whoever they brought — so a second scan for
   * the same screening is an ordinary admission and reads as one. What guards
   * against the *accidental* second scan is SAME_CODE_COOLDOWN_MS above, not a
   * refusal from the server.
   */
  const redeemPass = useCallback(async (qrCode: string): Promise<ScanResult> => {
    const currentShowing = showingIdRef.current;
    if (!currentShowing) {
      return {
        status: 'invalid',
        message: 'Choose which screening you are admitting for before scanning passes.',
      };
    }

    let verdict: Record<string, any>;
    try {
      verdict = await invokeFunction<Record<string, any>>('film-pass-checkout', {
        action: 'admit',
        qr_code: qrCode,
        showing_id: currentShowing,
      });
    } catch (err: any) {
      return { status: 'invalid', message: err?.message || 'The scan could not be completed.' };
    }

    const balance = (key: string) =>
      typeof verdict[key] === 'number' ? verdict[key] : Number(verdict[key] ?? NaN);
    const remaining = Number.isFinite(balance('remaining_balance'))
      ? balance('remaining_balance')
      : null;
    const left = Number.isFinite(balance('admissions_left')) ? balance('admissions_left') : null;
    const title = verdict.showing_title ?? selectedShowing?.title ?? null;

    switch (verdict.result) {
      case 'admitted': {
        // How many this sticker has now admitted to this screening. Shown from
        // the second onwards, because that is the moment staff need to know
        // whether the beep was the friend they meant to let in or the same
        // pass read twice — the reassurance the removed double-admit refusal
        // used to give them for free.
        const nth = Number(verdict.admitted_for_showing ?? 0);
        return {
          status: 'valid',
          message: 'Film pass accepted — enjoy the show!',
          pass: {
            title,
            remaining_balance: remaining,
            admissions_left: left,
            amount_deducted: Number(verdict.amount_deducted ?? 0),
            admission_number: Number.isFinite(nth) && nth > 1 ? nth : null,
          },
        };
      }

      // `ineligible` is the pre-20260814093200 name for the same refusal, kept
      // so a scanner running an older bundle against the new database still
      // says something true rather than falling through to "not one of our
      // passes" — which would send staff to the wrong conversation entirely.
      case 'not_eligible_for_pass':
      case 'ineligible': {
        const accepted = selectedShowing?.passTypeNames ?? [];
        return {
          status: 'invalid',
          message: accepted.length
            ? `${verdict.pass_type_name ?? 'This pass'} is not valid here — this screening takes ${accepted.join(' or ')}.`
            : 'This screening does not take passes.',
          pass: { title, remaining_balance: remaining, admissions_left: left },
        };
      }

      // The pass is good here and has money on it; it has simply already
      // admitted everyone this screening allows it to. Said precisely, because
      // "not enough balance" would be a lie the counter cannot resolve.
      case 'per_showing_limit_reached': {
        const limit = Number(verdict.per_showing_use_limit ?? 0);
        return {
          status: 'invalid',
          message: `This pass has already admitted ${verdict.admitted_for_showing ?? limit} to this screening — its limit is ${limit}.`,
          pass: { title, remaining_balance: remaining, admissions_left: left },
        };
      }

      case 'insufficient':
        return {
          status: 'invalid',
          message: `Not enough left on this pass — $${Number(
            verdict.remaining_balance ?? 0,
          ).toFixed(2)} against $${Number(verdict.redemption_price ?? 0).toFixed(2)} needed.`,
          pass: { title, remaining_balance: remaining },
        };

      case 'expired':
        return { status: 'invalid', message: 'This pass has expired.' };

      case 'not_activated':
        return {
          status: 'invalid',
          message: 'This sticker was never activated — send them to the box office.',
        };

      // The pass ran out on its previous scan, so the balance is zero and the
      // row is no longer active. Told as "used up" rather than "not active",
      // which would send staff looking for a fault that is not there.
      case 'not_active':
        return {
          status: 'invalid',
          message:
            verdict.status === 'depleted'
              ? 'This pass is used up — no admissions left.'
              : verdict.status === 'void'
                ? 'This pass has been cancelled.'
                : verdict.status === 'expired'
                  ? 'This pass has expired.'
                  : 'This pass is not valid.',
        };

      // The screening is over by more than the door's grace window. Almost
      // always the selector at the top of this page is still pointing at
      // yesterday, so the message names the screening rather than just
      // refusing — and says the pass is untouched, because "did that just cost
      // them $6?" is the question staff will otherwise ask.
      case 'showing_over':
        return {
          status: 'invalid',
          message: title
            ? `That screening of ${title} is over — check which showing is selected. Nothing was deducted.`
            : 'That screening is over — check which showing is selected. Nothing was deducted.',
          pass: { title, remaining_balance: remaining },
        };

      case 'sold_out':
        return {
          status: 'invalid',
          message: 'This screening is full — nothing was deducted from the pass.',
        };

      case 'no_showing_selected':
        return {
          status: 'invalid',
          message: 'Choose which screening you are admitting for before scanning passes.',
        };

      default:
        return { status: 'invalid', message: 'Not one of our film passes.' };
    }
  }, [selectedShowing]);

  /**
   * Dismissing the verdict is what unblocks the next scan after a problem.
   */
  const dismissResult = useCallback(() => {
    awaitingAckRef.current = false;
    setLastResult(null);
  }, []);

  const handleScan = useCallback(async (qrCode: string) => {
    // Guards read from refs, not state. The camera callback below is handed to
    // html5-qrcode once when the camera starts and keeps that closure for the
    // whole session, so a guard on state would be permanently stale.
    if (processingRef.current) return;
    // A rejected or duplicate ticket holds the gate until staff acknowledge it.
    if (awaitingAckRef.current) return;
    if (qrCode === lastScannedRef.current) return;
    lastScannedRef.current = qrCode;

    processingRef.current = true;
    setProcessing(true);
    const result = qrCode.startsWith(PASS_PREFIX)
      ? await redeemPass(qrCode)
      : await validateTicket(qrCode);
    setLastResult(result);
    // Valid scans clear themselves, so only problems block the next scan.
    awaitingAckRef.current = result.status !== 'valid';
    setScanCount(prev => prev + 1);
    playBeep(result.status === 'valid');
    processingRef.current = false;
    setProcessing(false);

    // Release the cooldown so the same code can be presented again on purpose —
    // a pass holder buying a second admission for the friend behind them holds
    // up the same sticker, and that has to work.
    setTimeout(() => {
      if (lastScannedRef.current === qrCode) lastScannedRef.current = '';
    }, SAME_CODE_COOLDOWN_MS);
  }, [validateTicket, redeemPass, playBeep]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    await handleScan(manualCode.trim());
    setManualCode('');
  };

  if (authLoading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    // Full-screen, and the camera underneath everything.
    //
    // This used to be a stack of cards in a 2xl container with the camera in
    // the middle one, behind a "Start Camera Scanner" button. On the phone this
    // actually runs on that meant two taps and a 250px viewfinder floating in a
    // page of chrome, with the manual-entry form pushed below the fold. The
    // door does exactly one thing, so the picture gets the whole screen and
    // everything else is laid over it.
    //
    // z-[55] sits above the sticky site header (z-50) and below the verdict
    // overlay (z-[60]), which must cover this the moment a scan resolves.
    <div className="fixed inset-0 z-[55] bg-black text-white overflow-hidden">
      <QrScanner onScan={handleScan} autoStart fill className="absolute inset-0" />

      {/* Top: who we are, how many, the way out, and which screening. The
          gradient is what keeps this legible over an arbitrary camera image. */}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/90 via-black/70 to-transparent p-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] space-y-3">
        <div className="flex items-center gap-2">
          <ScanLine className="h-6 w-6 text-primary shrink-0" />
          <h1 className="font-display text-xl font-bold">Ticket Scanner</h1>
          <Badge variant="secondary" className="shrink-0">
            {scanCount} scan{scanCount === 1 ? '' : 's'}
          </Badge>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => (onExit ? onExit() : navigate('/admin'))}
          >
            <X className="h-4 w-4 mr-1" />
            {onExit ? 'Back to POS' : 'Close'}
          </Button>
        </div>

        {/* Which screening film passes are being spent on. Tickets carry their
            own showing and ignore this entirely. */}
        <div className="space-y-2">
          <Select value={showingId} onValueChange={setShowingId}>
            <SelectTrigger
              aria-label="Screening being admitted"
              className="bg-black/60 border-white/25 text-white backdrop-blur"
            >
              <Film className="h-4 w-4 text-primary mr-2 shrink-0" />
              <SelectValue placeholder="Choose the screening you are admitting for..." />
            </SelectTrigger>
            {/* Radix portals this to the end of <body> at z-50, which would put
                it *under* this overlay. Lifted above both it and the verdict
                card, the only two things that can be on screen with it. */}
            <SelectContent className="z-[70]">
              {showings.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {formatShowtime(s.start_time, 'h:mm a')} — {s.title}
                  {s.passTypeNames.length === 0
                    ? ' (no passes)'
                    : ` (${s.passTypeNames.join(', ')})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showings.length === 0 ? (
            <p className="text-sm text-white/70">
              Nothing scheduled in the next day. Tickets still scan; film passes need a
              screening to be spent against.
            </p>
          ) : !showingId ? (
            <p className="text-sm text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              Pick a screening before scanning film passes.
            </p>
          ) : selectedShowing && selectedShowing.passTypeNames.length === 0 ? (
            <p className="text-sm text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              This screening does not take passes. Tickets scan normally.
            </p>
          ) : (
            <p className="text-xs text-white/70">
              Accepts {selectedShowing?.passTypeNames.join(' and ')}, spent on this screening
              {selectedShowing &&
                ` (${formatShowtime(selectedShowing.start_time, 'EEE MMM d, h:mm a')})`}
              . Tickets are unaffected.
            </p>
          )}
        </div>
      </div>

      {/* Bottom: the way in for a scuffed code or a handheld reader that types
          rather than scans. Kept on screen rather than behind a toggle — it is
          the fallback for exactly the moment the camera is not working, which
          is the worst moment to go looking for it. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-4 pt-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
            <Input
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              placeholder="Enter ticket QR code..."
              className="pl-9 bg-black/60 border-white/25 text-white placeholder:text-white/50 backdrop-blur"
            />
          </div>
          <Button type="submit" disabled={processing || !manualCode.trim()}>
            Validate
          </Button>
        </form>
      </div>

      {/* Verdict, centre-screen. Previously this rendered below the manual-entry
          form, which on a phone put it off the bottom of the screen — staff had
          to scroll to find out whether the scan worked. */}
      <ScanResultOverlay result={lastResult} onDismiss={dismissResult} />
    </div>
  );
}
