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
 *
 * The two surfaces want different shapes, which is what `fill` and `autoStart`
 * are for. The counter wants a small box behind a button, because scanning is
 * one of three ways in and the staff member may not want the camera at all. The
 * door wants the camera up and filling the screen the moment the page loads,
 * because scanning is the *only* thing that happens there.
 */
export function QrScanner({
  onScan,
  startLabel = 'Start Camera Scanner',
  stopLabel = 'Stop Camera',
  className,
  autoStart = false,
  fill = false,
}: {
  onScan: (decodedText: string) => void;
  startLabel?: string;
  stopLabel?: string;
  className?: string;
  /** Open the camera on mount rather than waiting for a tap. */
  autoStart?: boolean;
  /**
   * Let the video cover the container instead of sitting in a fixed box, and
   * leave stopping to the parent — a full-screen scanner exits by leaving, not
   * by turning the camera off and staring at a black rectangle.
   */
  fill?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  // Distinguishes "not started yet" from "tried and could not" — without it a
  // denied camera permission on a full-screen scanner shows the same neutral
  // button as a fresh load, and staff tap it forever.
  const [failed, setFailed] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = useRef(`qr-reader-${Math.random().toString(36).slice(2, 10)}`);

  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const start = useCallback(async () => {
    // Re-entry guard. autoStart fires from an effect and the retry button from
    // a tap; both landing would leave two Html5Qrcode instances on one element,
    // and only the second would ever be stopped.
    if (scannerRef.current) return;
    try {
      const instance = new Html5Qrcode(containerId.current);
      scannerRef.current = instance;
      await instance.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          // A fixed 250px box is right in a card and wrong on a phone held
          // full-screen, where it becomes a postage stamp in the middle of a
          // large picture and staff have to bring the code unnaturally close.
          qrbox: fill
            ? (w: number, h: number) => {
                const edge = Math.max(160, Math.floor(Math.min(w, h) * 0.7));
                return { width: edge, height: edge };
              }
            : { width: 250, height: 250 },
        },
        (decodedText) => onScanRef.current(decodedText),
        () => {}, // per-frame decode misses are normal; only failures to start matter
      );
      setScanning(true);
      setFailed(false);
    } catch {
      // Leave nothing half-constructed behind, or the guard above will refuse
      // every retry on the strength of an instance that never started.
      scannerRef.current = null;
      setFailed(true);
      toast.error('Unable to access camera. Please check permissions.');
    }
  }, [fill]);

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

  useEffect(() => {
    if (autoStart) void start();
    // Deliberately mount-only. `start` is stable, but re-running this on any
    // change would reopen a camera the operator had just closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release the camera if the surface unmounts mid-scan.
  useEffect(() => {
    return () => {
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
    };
  }, []);

  if (fill) {
    return (
      <div className={`relative ${className ?? ''}`}>
        <div
          id={containerId.current}
          // html5-qrcode sizes the <video> itself with inline styles computed
          // from the stream, so covering the container has to override them.
          className="absolute inset-0 [&_video]:!w-full [&_video]:!h-full [&_video]:!object-cover"
        />
        {!scanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-white/80">
              {failed
                ? 'The camera could not be opened. Check the browser’s camera permission for this site.'
                : 'Starting the camera…'}
            </p>
            {failed && (
              <Button type="button" onClick={start} size="lg">
                <Camera className="h-4 w-4 mr-2" />
                Try again
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

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
