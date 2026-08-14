import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Is the Hiring page public right now?
 *
 * Backed by `app_config.hiring_enabled`, which carries `{"enabled": bool}`.
 * That row is the one key in app_config an anonymous visitor is allowed to
 * read — see the RLS note in 20260813220000_hiring_job_postings.sql.
 *
 * Three separate consumers ask this on the same render (the desktop header,
 * the mobile menu inside it, and /hiring itself), so the fetch is shared at
 * module scope rather than re-issued per component. The value changes about
 * as often as the Kenworthy's hiring season does; a full page load is a fine
 * refresh interval, and the admin tab busts the cache explicitly after a
 * toggle so it does not have to be.
 */

type State = { enabled: boolean; loading: boolean };

let cached: Promise<boolean> | null = null;
const subscribers = new Set<(v: boolean) => void>();

async function fetchFlag(): Promise<boolean> {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'hiring_enabled')
    .maybeSingle();
  // Default ON when the row is missing or unreadable. A failed read must not
  // silently unpublish a page that is linked from the site header — the
  // visible failure (an empty postings list) is recoverable by a reader; an
  // invisible one is not.
  const value = data?.value as { enabled?: boolean } | null | undefined;
  return value?.enabled !== false;
}

function load(): Promise<boolean> {
  if (!cached) cached = fetchFlag();
  return cached;
}

/** Drop the cache and push the fresh value to every mounted consumer. */
export async function refreshHiringEnabled() {
  cached = null;
  const next = await load();
  subscribers.forEach(fn => fn(next));
  return next;
}

export function useHiringEnabled(): State {
  const [state, setState] = useState<State>({ enabled: true, loading: true });

  useEffect(() => {
    let alive = true;
    const onChange = (enabled: boolean) => {
      if (alive) setState({ enabled, loading: false });
    };
    subscribers.add(onChange);
    load().then(onChange);
    return () => {
      alive = false;
      subscribers.delete(onChange);
    };
  }, []);

  return state;
}
