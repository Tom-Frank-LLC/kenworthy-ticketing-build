import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The camera QR reader, in one place.
 *
 * Two surfaces need to scan: the door (a ticket or a film pass) and the box
 * office (a blank sticker being activated). They had one implementation between
 * them — the door's — which left the counter with a text field and no way to
 * scan at all unless the till has a handheld keyboard-wedge reader plugged in.
 *
 * Extracted rather than copied for the reason SquareCardForm was: an SDK with a
 * start/stop lifecycle copied twice is two places to get the teardown wrong,
 * and a camera that is never released holds the device torch on and blocks the
 * next reader from opening.
 *
 * Two details that are load-bearing rather than incidental:
 *
 *   The container id is unique per instance. html5-qrcode attaches by element
 *   id, and the door's copy hard-coded "qr-reader"; two mounted at once would
 *   have raced for the same node.
 *
 *   `onScan` is held in a ref. The callback is handed to html5-qrcode once when
 *   the camera starts and is kept for the whole session, so reading it from
 *   props would freeze whatever the parent's state was at that moment — the
 *   same staleness the door scanner already guards against with refs.
 */
export function QrScanner({
  onScan,
  startLabel = 'Start Camera Scanner',
  stopLabel = 'Stop Camera',
  className,
}: {
  onScan: (decodedText: string) => void;
  startLabel?: string;
  stopLabel?: string;
  className?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = useRef(`qr-reader-${Math.random().toString(36).slice(2, 10)}`);

  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const start = useCallback(async () => {
    try {
      const instance = new Html5Qrcode(containerId.current);
      scannerRef.current = instance;
      await instance.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => onScanRef.current(decodedText),
        () => {}, // per-frame decode misses are normal; only failures to start matter
      );
      setScanning(true);
    } catch {
      toast.error('Unable to access camera. Please check permissions.');
    }
  }, []);

  const stop = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Already stopped, or the element is gone — nothing left to release.
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // Release the camera if the surface unmounts mid-scan.
  useEffect(() => {
    return () => {
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
    };
  }, []);

  return (
    <div className={className}>
      <div
        id={containerId.current}
        className={`w-full rounded-lg overflow-hidden ${scanning ? 'min-h-[300px]' : 'h-0'}`}
      />
      <Button
        type="button"
        className="w-full"
        variant={scanning ? 'destructive' : 'default'}
        onClick={scanning ? stop : start}
      >
        <Camera className="h-4 w-4 mr-2" />
        {scanning ? stopLabel : startLabel}
      </Button>
    </div>
  );
}
