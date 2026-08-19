import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import { CheckCircle2 } from 'lucide-react';

/**
 * A ticket's QR, stamped once the ticket has been scanned at the door.
 *
 * Follows what every major ticketing app does with a redeemed ticket: change
 * the state visibly and kill the code. A used ticket that still shows a clean,
 * scannable QR can be screenshotted and passed on, and it leaves the holder
 * with no way to tell whether their ticket worked.
 *
 * The code stays rendered underneath rather than being removed, so the box
 * office can still read it off the patron's phone when sorting out a dispute.
 */
export function RedeemedQr({
  value,
  scannedAt,
  className = '',
}: {
  value: string;
  scannedAt: string | null;
  className?: string;
}) {
  const used = !!scannedAt;

  return (
    <div className={`relative mx-auto bg-white rounded-lg p-3 ${className}`}>
      <QRCodeSVG
        value={value}
        level="M"
        marginSize={0}
        title={used ? 'Ticket QR code (already used)' : 'Ticket QR code'}
        className={`w-full h-full block transition-opacity ${used ? 'opacity-15' : ''}`}
      />

      {used && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
          <CheckCircle2 className="h-10 w-10 text-neutral-700" strokeWidth={2.5} />
          <span className="text-base font-bold uppercase tracking-widest text-neutral-800">
            Used
          </span>
          <span className="text-sm leading-tight text-neutral-600">
            Scanned {format(new Date(scannedAt!), 'MMM d, h:mm a')}
          </span>
        </div>
      )}
    </div>
  );
}

/** Short "Used · 7:42 PM" / "Valid" line for ticket list rows. */
export function RedemptionBadge({ scannedAt }: { scannedAt: string | null }) {
  if (!scannedAt) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <CheckCircle2 className="h-3 w-3" />
      Used · {format(new Date(scannedAt), 'MMM d, h:mm a')}
    </span>
  );
}
