import { useCallback, useEffect, useState } from 'react';
import { Link2, RefreshCw, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { invokeFunction } from '@/lib/functions';
import { describeStand, ensureStandAuthorized, StandReader, standOf, type StandStatus } from '@/lib/standReader';

/**
 * What the counter needs to know about the Stand, under the reader picker:
 * whether it is ready, and the two things that fix it when it is not —
 * Square's own reader settings, and (admins, once) connecting the theatre's
 * Square account so the app may take payments at all.
 */
export function StandReaderStatus({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<StandStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await ensureStandAuthorized());
      setProblem(null);
      setNotConnected(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotConnected(/not connected/i.test(message));
      setProblem(message);
      try { setStatus(await StandReader.getStatus()); } catch { /* keep the last */ }
    }
  }, []);

  useEffect(() => {
    void refresh();
    let remove: (() => void) | undefined;
    StandReader.addListener('readersChanged', () => {
      StandReader.getStatus().then(setStatus).catch(() => {});
    }).then((h) => { remove = () => void h.remove(); }).catch(() => {});
    return () => remove?.();
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await invokeFunction<{ url: string }>('square-mobile', { action: 'connect_start', return_to: '/staff/pos' });
      // Off the app's origin, so the app hands it to Safari: Square's approval
      // page, then back to the website. The app picks the token up on refresh.
      window.open(url, '_blank');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the Square connection');
    } finally {
      setBusy(false);
    }
  };

  const ready = standOf(status)?.status === 'ready';
  const line = problem && !notConnected ? `Stand: ${problem}` : notConnected ? 'Square is not connected for the Stand yet' : `Stand ${describeStand(status)}`;

  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite">
      <span className={ready ? 'text-foreground' : 'text-muted-foreground'}>{line}</span>
      <Button type="button" variant="ghost" size="icon" aria-label="Check the Stand again" onClick={() => refresh()}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      {status?.authorized && (
        <Button type="button" variant="outline" size="sm" onClick={() => StandReader.showSettings().catch(() => {})}>
          <Settings className="mr-1 h-4 w-4" aria-hidden="true" />
          Reader settings
        </Button>
      )}
      {status?.authorized && status.environment === 'sandbox' && (
        <Button type="button" variant="outline" size="sm" onClick={() => StandReader.showMockReader().catch((e) => toast.error(String(e?.message ?? e)))}>
          Mock reader (sandbox)
        </Button>
      )}
      {notConnected && isAdmin && (
        <Button type="button" size="sm" onClick={connect} disabled={busy}>
          <Link2 className="mr-1 h-4 w-4" aria-hidden="true" />
          Connect Square
        </Button>
      )}
      {notConnected && !isAdmin && <span className="text-muted-foreground">An admin needs to connect it once.</span>}
    </div>
  );
}
