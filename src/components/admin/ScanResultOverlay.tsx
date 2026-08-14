import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatShowtime } from '@/lib/datetime';

export type ScanStatus = 'valid' | 'already_scanned' | 'invalid';

export interface ScanResult {
  status: ScanStatus;
  ticket?: {
    id: string;
    movie_title: string;
    start_time: string;
    seat_row: string | null;
    seat_number: number | null;
    scanned_at: string | null;
    patron_status: string;
  };
  /**
   * A film-pass admission, when that is what was scanned.
   *
   * Deliberately reuses the three-verdict vocabulary above rather than adding
   * a parallel one: at a door, under time pressure, there are only ever three
   * decisions — let them in, stop, or refuse — and a staff member should not
   * have to learn a second colour scheme for the other kind of QR. What is
   * *different* about a pass is the balance, and that is what this carries.
   */
  pass?: {
    /** Whose screening this was, for the same reassurance the ticket block gives. */
    title?: string | null;
    /** Money left after this scan, or before it when nothing was deducted. */
    remaining_balance?: number | null;
    /** Admissions that balance still buys. */
    admissions_left?: number | null;
    /** What this admission cost, present only when one actually happened. */
    amount_deducted?: number | null;
    /**
     * Which admission this was on this pass for this screening — 2 for the
     * first friend, 3 for the second, and null for the holder themselves.
     *
     * A pass admits a party, so the same sticker being scanned twice in a
     * minute is no longer an error the server refuses. It is either a friend
     * or a misfire, and only the person at the door can tell which, so they
     * are told the number rather than left to infer it from a balance that
     * dropped twice.
     */
    admission_number?: number | null;
  };
  message: string;
}

/**
 * How long a successful scan stays up before clearing itself.
 *
 * Long enough to read at arm's length, short enough that a queue at the door
 * keeps moving without staff tapping between every patron. Problems do not
 * auto-dismiss at all — see below.
 */
export const VALID_AUTO_DISMISS_MS = 2200;

/** "2nd", "3rd", "4th" — a count staff read at arm's length, not a bare digit. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

const STYLES: Record<
  ScanStatus,
  { icon: typeof CheckCircle2; ring: string; text: string; bar: string; label: string }
> = {
  valid: {
    icon: CheckCircle2,
    ring: 'border-[hsl(var(--success))] bg-[hsl(var(--success))]/15',
    text: 'text-[hsl(var(--success))]',
    bar: 'bg-[hsl(var(--success))]',
    label: 'Admit',
  },
  // Amber rather than a brand colour: at a door, under time pressure, "stop and
  // look" has to read as caution instantly and never be mistaken for the green.
  already_scanned: {
    icon: AlertTriangle,
    ring: 'border-amber-500 bg-amber-500/15',
    text: 'text-amber-500',
    bar: 'bg-amber-500',
    label: 'Already used',
  },
  invalid: {
    icon: XCircle,
    ring: 'border-destructive bg-destructive/15',
    text: 'text-destructive',
    bar: 'bg-destructive',
    label: 'Do not admit',
  },
};

/**
 * Full-screen scan feedback for the gate.
 *
 * Replaces a result card that rendered below the camera and the manual-entry
 * form — off-screen on a phone, so staff had to scroll to find out whether the
 * scan worked. This puts the verdict in the middle of the screen where it
 * cannot be missed.
 *
 * The asymmetry is deliberate: a valid ticket clears itself so the queue keeps
 * moving, while an already-scanned or invalid ticket stays until a human
 * acknowledges it. A problem that auto-dismissed could be missed entirely, and
 * letting someone in on a duplicate ticket is the failure that matters.
 */
export function ScanResultOverlay({
  result,
  onDismiss,
}: {
  result: ScanResult | null;
  onDismiss: () => void;
}) {
  const autoDismiss = result?.status === 'valid';
  const [countdownStarted, setCountdownStarted] = useState(false);

  // Auto-dismiss the success case. Keyed on the ticket id as well as the
  // status so two valid scans in a row each get their own full timer rather
  // than the second inheriting what is left of the first.
  const resultKey = result
    ? `${result.status}:${result.ticket?.id ?? result.message}`
    : '';

  useEffect(() => {
    if (!result || !autoDismiss) return;
    const timer = setTimeout(onDismiss, VALID_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [resultKey, result, autoDismiss, onDismiss]);

  // Drive the countdown bar by flipping width one frame after mount, so the
  // CSS transition has a start value to animate away from.
  useEffect(() => {
    if (!result || !autoDismiss) return;
    setCountdownStarted(false);
    const frame = requestAnimationFrame(() => setCountdownStarted(true));
    return () => cancelAnimationFrame(frame);
  }, [resultKey, result, autoDismiss]);

  // Escape dismisses, so a keyboard/manual-entry operator never gets stuck.
  useEffect(() => {
    if (!result) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, onDismiss]);

  if (!result) return null;

  const style = STYLES[result.status];
  const Icon = style.icon;
  const ticket = result.ticket;
  const pass = result.pass;
  const money = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      onClick={onDismiss}
      // z-[60] clears the sticky site header, which sits at z-50.
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in-0 duration-150"
    >
      <div
        // Stop clicks inside the card from dismissing by accident while staff
        // are reading seat details to a patron.
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm rounded-2xl border-4 ${style.ring} bg-background shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150`}
      >
        <div className="p-8 text-center space-y-4">
          <Icon className={`h-24 w-24 mx-auto ${style.text}`} strokeWidth={2.5} />

          <p className={`text-3xl font-display font-bold leading-tight ${style.text}`}>
            {style.label}
          </p>

          <p className="text-lg font-medium">{result.message}</p>

          {ticket && (
            <div className="pt-2 space-y-1 border-t">
              <p className="text-xl font-semibold pt-3">{ticket.movie_title}</p>
              {ticket.start_time && (
                <p className="text-sm text-muted-foreground">
                  {formatShowtime(ticket.start_time, 'MMM d, yyyy h:mm a')}
                </p>
              )}
              <p className="text-base font-medium">
                {ticket.seat_row
                  ? `Row ${ticket.seat_row}, Seat ${ticket.seat_number}`
                  : 'General Admission'}
              </p>
            </div>
          )}

          {pass && (
            <div className="pt-2 space-y-1 border-t">
              {pass.title && <p className="text-xl font-semibold pt-3">{pass.title}</p>}
              <p className="text-sm text-muted-foreground">Film pass</p>
              {typeof pass.remaining_balance === 'number' && (
                <p className="text-base font-medium pt-1">
                  {money(pass.remaining_balance)} left
                  {typeof pass.admissions_left === 'number' && (
                    <span className="text-muted-foreground">
                      {' · '}
                      {pass.admissions_left} more {pass.admissions_left === 1 ? 'film' : 'films'}
                    </span>
                  )}
                </p>
              )}
              {typeof pass.amount_deducted === 'number' && (
                <p className="text-sm text-muted-foreground">
                  {money(pass.amount_deducted)} deducted
                </p>
              )}
              {typeof pass.admission_number === 'number' && pass.admission_number > 1 && (
                <p className="text-sm font-medium text-amber-500">
                  {ordinal(pass.admission_number)} admission on this pass for this screening
                </p>
              )}
            </div>
          )}

          {autoDismiss ? (
            <p className="text-xs text-muted-foreground pt-1">Ready for the next ticket…</p>
          ) : (
            <Button className="w-full mt-2" size="lg" onClick={onDismiss} autoFocus>
              Dismiss
            </Button>
          )}
        </div>

        {autoDismiss && (
          <div
            aria-hidden="true"
            className={`absolute bottom-0 left-0 h-1.5 ${style.bar} transition-all ease-linear`}
            style={{
              width: countdownStarted ? '0%' : '100%',
              transitionDuration: `${VALID_AUTO_DISMISS_MS}ms`,
            }}
          />
        )}
      </div>
    </div>
  );
}
