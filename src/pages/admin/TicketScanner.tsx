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
import { ScanLine, CheckCircle2, XCircle, AlertTriangle, Camera, Search } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

interface ScanResult {
  status: 'valid' | 'already_scanned' | 'invalid';
  ticket?: {
    id: string;
    movie_title: string;
    start_time: string;
    seat_row: string;
    seat_number: number;
    scanned_at: string | null;
    patron_status: string;
  };
  message: string;
}

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

  const validateTicket = useCallback(async (qrCode: string): Promise<ScanResult> => {
    const { data, error } = await supabase
      .from('tickets')
      .select(`
        id, status, scanned_at, qr_code,
        seats!inner(seat_row, seat_number),
        showings!inner(start_time, movies!inner(title))
      `)
      .eq('qr_code', qrCode)
      .maybeSingle();

    if (error || !data) {
      return { status: 'invalid', message: 'Ticket not found — invalid QR code' };
    }

    const ticket = {
      id: data.id,
      movie_title: (data as any).showings?.movies?.title || 'Unknown',
      start_time: (data as any).showings?.start_time || '',
      seat_row: (data as any).seats?.seat_row || '',
      seat_number: (data as any).seats?.seat_number || 0,
      scanned_at: data.scanned_at as string | null,
      patron_status: data.status,
    };

    if (data.scanned_at) {
      return {
        status: 'already_scanned',
        ticket,
        message: `Already scanned at ${format(new Date(data.scanned_at), 'h:mm:ss a')}`,
      };
    }

    // Mark as scanned
    const { error: updateError } = await supabase
      .from('tickets')
      .update({ scanned_at: new Date().toISOString() })
      .eq('id', data.id);

    if (updateError) {
      return { status: 'invalid', message: 'Failed to mark ticket as scanned' };
    }

    return {
      status: 'valid',
      ticket: { ...ticket, scanned_at: new Date().toISOString() },
      message: 'Ticket validated — enjoy the show!',
    };
  }, []);

  const handleScan = useCallback(async (qrCode: string) => {
    if (processing) return;
    if (qrCode === lastScannedRef.current) return;
    lastScannedRef.current = qrCode;

    setProcessing(true);
    const result = await validateTicket(qrCode);
    setLastResult(result);
    setScanCount(prev => prev + 1);
    playBeep(result.status === 'valid');
    setProcessing(false);

    // Allow re-scanning same code after 3 seconds
    setTimeout(() => {
      if (lastScannedRef.current === qrCode) lastScannedRef.current = '';
    }, 3000);
  }, [processing, validateTicket, playBeep]);

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

        {/* Scan result */}
        {lastResult && (
          <Card
            className={`border-2 transition-all animate-fade-in ${
              lastResult.status === 'valid'
                ? 'border-[hsl(var(--success))] bg-[hsl(var(--success))]/10'
                : lastResult.status === 'already_scanned'
                ? 'border-[hsl(var(--chart-1))] bg-[hsl(var(--chart-1))]/10'
                : 'border-destructive bg-destructive/10'
            }`}
          >
            <CardContent className="p-6 text-center space-y-3">
              {lastResult.status === 'valid' && (
                <CheckCircle2 className="h-16 w-16 text-[hsl(var(--success))] mx-auto" />
              )}
              {lastResult.status === 'already_scanned' && (
                <AlertTriangle className="h-16 w-16 text-[hsl(var(--chart-1))] mx-auto" />
              )}
              {lastResult.status === 'invalid' && (
                <XCircle className="h-16 w-16 text-destructive mx-auto" />
              )}

              <p className="text-xl font-bold font-display">{lastResult.message}</p>

              {lastResult.ticket && (
                <div className="text-sm space-y-1 text-muted-foreground">
                  <p className="font-medium text-foreground text-lg">{lastResult.ticket.movie_title}</p>
                  <p>{format(new Date(lastResult.ticket.start_time), 'MMM d, yyyy h:mm a')}</p>
                  <p>Row {lastResult.ticket.seat_row}, Seat {lastResult.ticket.seat_number}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="text-center text-sm text-muted-foreground">
          {scanCount} ticket(s) scanned this session
        </div>
      </div>
    </div>
  );
}
