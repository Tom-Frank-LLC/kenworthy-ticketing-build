import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

// The refund stance, written once.
//
// "Tickets are non-refundable. All sales are final." was asked for beneath
// every Pay button and on the ticket receipt. Terms §6 has promised a full
// refund when the Kenworthy cancels a performance since before this site
// existed, and that promise stays — refunds for a seller-cancelled event are
// what patrons expect and, in many places, what the law requires. So the
// exception ships in the same breath as the absolute line, rather than on a
// page nobody reads before paying. A pay button that says "final" over a
// policy page that says "refund" is the contradiction this component exists
// to prevent; the two must say the same thing, and §6 leads with these exact
// sentences.
//
// The ticket receipt (supabase/functions/_shared/notify.ts) repeats these
// strings by hand, because an edge function cannot import from src/. If one
// changes, change the other — the test in SalesFinalNote.test.tsx pins the
// wording so a drift here is at least a failing test and not a silent one.

export const TICKETS_FINAL = 'Tickets are non-refundable. All sales are final.';
export const TICKETS_FINAL_EXCEPTION =
  'If the Kenworthy cancels a performance, you will be refunded in full.';

// A pass is not a ticket, and §7 makes no cancellation promise for it — a
// pass outlives any one performance — so the pass line carries no exception.
export const PASSES_FINAL = 'Film passes are non-refundable. All sales are final.';

export const TICKET_POLICY_PATH = '/terms#refunds';
export const PASS_POLICY_PATH = '/terms#passes';

/**
 * The line beneath a Pay button. Same treatment as the "processed securely by
 * Square" line it sits under: small, muted, centred.
 */
export function SalesFinalNote({
  kind = 'ticket',
  className,
}: {
  kind?: 'ticket' | 'pass';
  className?: string;
}) {
  const isTicket = kind === 'ticket';
  return (
    <p className={cn('text-sm text-muted-foreground text-center', className)}>
      {isTicket ? `${TICKETS_FINAL} ${TICKETS_FINAL_EXCEPTION}` : PASSES_FINAL}{' '}
      <Link
        to={isTicket ? TICKET_POLICY_PATH : PASS_POLICY_PATH}
        className="text-primary underline underline-offset-4 hover:no-underline"
      >
        {isTicket ? 'Full ticket policy' : 'Full pass policy'}
      </Link>
      .
    </p>
  );
}
