import { useCallback, useEffect, useState } from 'react';
import { invokeFunction } from '@/lib/functions';
import { STAND_READER_ID, standAvailable } from '@/lib/standReader';

/**
 * Which Square Terminal this station sends card sales to.
 *
 * The theatre has two readers — box office and concessions — and a Terminal
 * checkout is addressed to one of them, so every card sale from this browser
 * carries the reader chosen here. The choice is a property of the STATION
 * (this browser on this counter), not of the staff member or the sale, which
 * is why it lives in localStorage and not in the database: the box-office
 * laptop picks its reader once and keeps it across logins.
 *
 * localStorage can be empty or throw (private window, cleared site data), so
 * a missing choice is simply "not chosen yet" and the picker asks.
 */

export interface TerminalReader {
  id: string;
  name: string;
  status: string;
}

const KEY = 'kenworthy.pos.terminalReaderId';

const STAND_ENTRY: TerminalReader = { id: STAND_READER_ID, name: 'Square Stand (this iPad)', status: 'AVAILABLE' };

export function readChosenReaderId(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function storeChosenReaderId(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch { /* a station that cannot remember will be asked again */ }
}

export function useTerminalReader() {
  const [readers, setReaders] = useState<TerminalReader[]>([]);
  const [chosenId, setChosenId] = useState<string | null>(() => readChosenReaderId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invokeFunction<{ devices: TerminalReader[]; default_id: string | null }>('square-terminal', { action: 'list_devices' });
      // In the iOS app, the Stand the iPad sits in is a reader too. It is not
      // a Square device id: card sales to it go through the app, not the
      // Terminal API (src/lib/standReader.ts).
      if (standAvailable()) res.devices = [STAND_ENTRY, ...res.devices];
      setReaders(res.devices);
      setError(null);
      // A fresh station takes the configured default, if there is one and it is
      // a reader we can see; otherwise it waits to be told. In the app the
      // default is the Stand: the app is on the counter for that reason.
      setChosenId((current) => {
        if (current && res.devices.some((d) => d.id === current)) return current;
        const fallback = standAvailable()
          ? STAND_READER_ID
          : res.default_id && res.devices.some((d) => d.id === res.default_id) ? res.default_id : null;
        storeChosenReaderId(fallback);
        return fallback;
      });
    } catch (err) {
      // The Terminals could not be listed; the Stand needs no list.
      if (standAvailable()) setReaders([STAND_ENTRY]);
      setError(err instanceof Error ? err.message : 'Could not list the card readers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const choose = useCallback((id: string | null) => {
    storeChosenReaderId(id);
    setChosenId(id);
  }, []);

  const chosen = readers.find((r) => r.id === chosenId) ?? null;
  return { readers, chosen, chosenId, choose, loading, error, refresh };
}
