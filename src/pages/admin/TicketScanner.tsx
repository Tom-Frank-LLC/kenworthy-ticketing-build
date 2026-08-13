import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ScanLine, Camera, Search } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { ScanResultOverlay, type ScanResult } from '@/components/admin/ScanResultOverlay';
import { formatShowtime } from '@/lib/datetime';

export default function TicketScanner() {
  const { isAdmin, isStaff, isHost, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [processing, setProcessing] = useState(false);
  const [scanCount, setScanCount] = useState(0);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'qr-reader';
  const lastScannedRef = useRef<string>('');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processingRef = useRef(false);
  // True while a non-valid verdict is on screen waiting to be acknowledged.
  const awaitingAckRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isStaff && !isHost) { navigate('/'); return; }
  }, [isStaff, isHost, authLoading, navigate]);

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
    const { data, error } = await supabase.rpc('check_in_ticket', { p_qr_code: qrCode });

    if (error || !data) {
      console.error('[TicketScanner] check_in_ticket failed', error);
      return { status: 'invalid', message: 'Could not reach the server — try again' };
    }

    const result = data as {
      verdict: 'valid' | 'already_scanned' | 'not_confirmed' | 'not_found' | 'forbidden';
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
    const result = await validateTicket(qrCode);
    setLastResult(result);
    // Valid scans clear themselves, so only problems block the next scan.
    awaitingAckRef.current = result.status !== 'valid';
    setScanCount(prev => prev + 1);
    playBeep(result.status === 'valid');
    processingRef.current = false;
    setProcessing(false);

    // Allow re-scanning same code after 3 seconds
    setTimeout(() => {
      if (lastScannedRef.current === qrCode) lastScannedRef.current = '';
    }, 3000);
  }, [validateTicket, playBeep]);

  const startScanner = useCallback(async () => {
    try {
      const html5Qrcode = new Html5Qrcode(scannerContainerId);
      scannerRef.current = html5Qrcode;

      await html5Qrcode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleScan(decodedText),
        () => {} // ignore errors during scanning
      );
      setScanning(true);
    } catch (err) {
      toast.error('Unable to access camera. Please check permissions.');
    }
  }, [handleScan]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

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
    <div className="container py-8 px-4 max-w-2xl">
      <div className="flex items-center gap-3 mb-2">
        <ScanLine className="h-7 w-7 text-primary" />
        <h1 className="font-display text-3xl font-bold">Ticket Scanner</h1>
        <Badge variant="secondary">Gate</Badge>
      </div>
      <p className="text-muted-foreground mb-8">Scan QR codes to validate entry</p>

      {/* Scanner controls */}
      <div className="space-y-6">
        {/* Camera scanner */}
        <Card className="glass overflow-hidden">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" /> Camera Scanner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              id={scannerContainerId}
              className={`w-full rounded-lg overflow-hidden ${!scanning ? 'h-0' : 'min-h-[300px]'}`}
            />
            <Button
              className="w-full"
              variant={scanning ? 'destructive' : 'default'}
              onClick={scanning ? stopScanner : startScanner}
            >
              <Camera className="h-4 w-4 mr-2" />
              {scanning ? 'Stop Camera' : 'Start Camera Scanner'}
            </Button>
          </CardContent>
        </Card>

        {/* Manual entry */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" /> Manual Entry
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <Input
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                placeholder="Enter ticket QR code..."
                className="flex-1"
              />
              <Button type="submit" disabled={processing || !manualCode.trim()}>
                Validate
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="text-center text-sm text-muted-foreground">
          {scanCount} ticket(s) scanned this session
        </div>
      </div>

      {/* Verdict, centre-screen. Previously this rendered below the manual-entry
          form, which on a phone put it off the bottom of the screen — staff had
          to scroll to find out whether the scan worked. */}
      <ScanResultOverlay result={lastResult} onDismiss={dismissResult} />
    </div>
  );
}
