/**
 * Is the theatre still in its hundredth year?
 *
 * The Kenworthy opened in January 1926, so 2026 is the centenary and the
 * "Celebrating 100 Years" lockup is used until it ends.
 *
 * MIRRORS `CENTENARY_ENDS` in `supabase/functions/_shared/brand.ts`. The two
 * cannot share a module — that one runs in Deno with extensioned imports and is
 * bundled per edge function, this one is compiled into the Vite app — so if the
 * date ever moves, move it in both. Same reason the email palette mirrors the
 * CSS tokens rather than importing them.
 *
 * Expressed as 08:00 UTC on Jan 1 2027, which is midnight in
 * America/Los_Angeles — the zone the rest of the codebase treats as the venue's
 * own. Plain UTC would retire the lockup at 4pm on New Year's Eve, local time.
 */
export const CENTENARY_ENDS = Date.UTC(2027, 0, 1, 8, 0, 0);

export function isCentenary(now: Date = new Date()): boolean {
  return now.getTime() < CENTENARY_ENDS;
}
