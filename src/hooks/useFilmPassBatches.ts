import { useCallback, useEffect, useState } from 'react';
import { invokeFunction } from '@/lib/functions';

/** One past print run, as `film-pass-batch` summarises it. */
export interface BatchSummary {
  batch_id: string;
  pass_type_name: string;
  created_at: string;
  total: number;
  unassigned: number;
}

/**
 * The past print runs, and a way to re-read them.
 *
 * A hook rather than state inside PrintQrPanel because the Film Passes tab
 * needs the same list, for a reason the panel cannot serve:
 * `CollapsibleSection` does not mount its children until the section is first
 * opened, so a panel that owned the fetch could not fill the count badge on a
 * *closed* header. The tab calls this itself and hands the result down, which
 * keeps it at one request rather than the two a second fetch inside the panel
 * would cost.
 *
 * `enabled` is what stops that second fetch. It is fixed for the life of a
 * mount in practice — a caller either passes batches down or it does not, and
 * never switches — so there is no flicker to design around.
 *
 * `film-pass-batch` gates on `has_role(uid, 'staff')`, which admin and
 * superadmin satisfy too (migration 20260812063211_has_role_hierarchy.sql).
 */
export function useFilmPassBatches(enabled = true) {
  const [batches, setBatches] = useState<BatchSummary[]>([]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await invokeFunction<{ batches: BatchSummary[] }>('film-pass-batch', {
        action: 'batches',
      });
      setBatches(data.batches || []);
    } catch {
      // Not fatal: past runs are a convenience list, and failing to load them
      // must not take the generator down with it.
    }
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  return { batches, reload };
}
