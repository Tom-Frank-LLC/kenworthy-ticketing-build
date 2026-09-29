import { useEffect, useState } from 'react';
import { fetchSquareConfig, type SquareEnvironment } from '@/lib/square';

/**
 * Which Square environment the edge functions are using, or null while it is
 * loading or could not be read.
 *
 * The same server-side decision (`SQUARE_ENV`, resolved by `squareEnvironment()`
 * in `_shared/square.ts`) that the Timecards tab reports through
 * `square-labor` and the card form reads to pick its SDK bundle — never a
 * browser-side flag, so the POS cannot disagree with them.
 *
 * Unknown is null, not sandbox. The POS used to say "Sandbox mode" in
 * production because nothing asked; a failed read that fell back to sandbox
 * would repeat that on every hiccup, and production is the normal state.
 *
 * Fetched once per page and shared: three POS surfaces render the payment
 * selector, and the answer only changes with a redeploy of the functions.
 */

let cached: Promise<SquareEnvironment | null> | null = null;

function load(): Promise<SquareEnvironment | null> {
  if (!cached) {
    cached = fetchSquareConfig('square-donation')
      .then(cfg => cfg.environment)
      .catch(err => {
        console.warn('[pos] Square environment unknown:', err);
        // Let a later mount try again rather than pinning the failure.
        cached = null;
        return null;
      });
  }
  return cached;
}

/** Test-only: forget the shared answer. */
export function resetSquareEnvironmentCache() {
  cached = null;
}

export function useSquareEnvironment(): SquareEnvironment | null {
  const [environment, setEnvironment] = useState<SquareEnvironment | null>(null);

  useEffect(() => {
    let alive = true;
    load().then(env => { if (alive) setEnvironment(env); });
    return () => { alive = false; };
  }, []);

  return environment;
}
