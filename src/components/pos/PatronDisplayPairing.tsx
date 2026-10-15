import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { MonitorSmartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { displayUrl, type TillDisplay } from '@/lib/patronDisplay';

/**
 * Pair the patron-facing screen outside the glass with this station. Sits in
 * the POS header next to the card reader, because like the reader it belongs
 * to the counter and is set once a shift.
 *
 * The code is shown as letters and as a QR of the display's link: the QR is
 * the fast path for a phone, the letters are for a tablet in a stand that
 * cannot point its camera back at the till.
 */
export function PatronDisplayPairing({ display }: { display: TillDisplay }) {
  const { code, connected, displays, pair, unpair } = display;
  const [showCode, setShowCode] = useState(false);

  if (!code) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
        <MonitorSmartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm">Patron-facing display</span>
        <span className="text-sm text-muted-foreground">Not paired — the donation prompt stays on this screen.</span>
        <Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={() => { pair(); setShowCode(true); }}>
          Pair a patron-facing display
        </Button>
      </div>
    );
  }

  const status = !connected
    ? 'Connecting…'
    : displays > 0
      ? 'Patron-facing display connected — the patron chooses the donation there.'
      : 'Waiting for the patron-facing display to join.';

  return (
    <div className="rounded-md border border-border px-3 py-2 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <MonitorSmartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm">Patron-facing display</span>
        <span className="text-sm text-muted-foreground" role="status">{status}</span>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowCode((v) => !v)} aria-expanded={showCode}>
            {showCode ? 'Hide code' : 'Show code'}
          </Button>
          {/* A new code drops whatever display holds the old one. */}
          <Button type="button" variant="ghost" size="sm" onClick={pair}>New code</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { unpair(); setShowCode(false); }}>Turn off</Button>
        </div>
      </div>
      {showCode && (
        <div className="flex flex-wrap items-center gap-4">
          <div className="bg-white rounded-lg p-2">
            <QRCodeSVG value={displayUrl(window.location.origin, code)} size={120} />
          </div>
          <div className="text-sm space-y-1">
            <p>On the patron&rsquo;s device, scan this, or open <span className="font-mono">{window.location.host}/pos/display</span> and enter:</p>
            <p className="font-mono text-3xl tracking-[0.3em]" aria-label={`Pairing code ${code.split('').join(' ')}`}>{code}</p>
            <p className="text-muted-foreground">Good for today. The patron-facing display needs no sign-in.</p>
          </div>
        </div>
      )}
    </div>
  );
}
