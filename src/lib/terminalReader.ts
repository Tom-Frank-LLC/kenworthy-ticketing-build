import { useCallback, useEffect, useState } from 'react';
import { invokeFunction } from '@/lib/functions';
import { DISPLAY_STAND_READER_ID, STAND_READER_ID, standAvailable } from '@/lib/standReader';

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
// Listed on every till, app or browser: the display iPad takes the card, so
// the till can be anything. Whether it is ready is the display's to say
// (useTillDisplay().stand), shown beside the picker.
const DISPLAY_STAND_ENTRY: TerminalReader = { id: DISPLAY_STAND_READER_ID, name: 'Square Stand at the patron-facing display', status: 'AVAILABLE' };

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
      res.devices = [DISPLAY_STAND_ENTRY, ...(standAvailable() ? [STAND_ENTRY] : []), ...res.devices];
      setReaders(res.devices);
      setError(null);
      // A station keeps what it chose. A fresh one starts on the usual setup,
      // the Stand at the patron-facing display; the Stand under this iPad and
      // the Terminals are there to pick for other setups.
      setChosenId((current) => {
        if (current && res.devices.some((d) => d.id === current)) return current;
        storeChosenReaderId(DISPLAY_STAND_READER_ID);
        return DISPLAY_STAND_READER_ID;
      });
    } catch (err) {
      // The Terminals could not be listed; neither Stand needs the list. A
      // station keeps its choice (it may be a Terminal we cannot check just
      // now); a fresh one still starts on the usual setup rather than on
      // nothing, which refused every card sale with "choose a reader first".
      setReaders([DISPLAY_STAND_ENTRY, ...(standAvailable() ? [STAND_ENTRY] : [])]);
      setChosenId((current) => {
        if (current) return current;
        storeChosenReaderId(DISPLAY_STAND_READER_ID);
        return DISPLAY_STAND_READER_ID;
      });
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
