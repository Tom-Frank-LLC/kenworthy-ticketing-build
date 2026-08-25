/**
 * Server-side capability flags.
 *
 * The counterpart to `src/lib/flags.ts` — see the long note there for why
 * patron accounts are switched off rather than removed.
 *
 * Read through a function rather than captured at module load so a test can
 * set the variable per case, and so a `supabase secrets set` takes effect on
 * the next cold start rather than the next deploy.
 *
 * Default **off**: an unset secret means no member accounts. A missing
 * variable must not be the thing that mails a stranger a password link.
 *
 * **No server-side consumer as of 2026-08-24.** This gated one thing — the
 * "set your password" section of the ticket receipt — and that section has
 * been deleted, not just switched off, because there is no patron sign-in for
 * it to lead to. Setting MEMBER_ACCOUNTS=true will therefore not bring it
 * back; the copy would have to be written again. Kept because the frontend
 * counterpart in `src/lib/flags.ts` still reads as the paired switch.
 */
export function memberAccountsEnabled(): boolean {
  return (Deno.env.get('MEMBER_ACCOUNTS') ?? '').trim().toLowerCase() === 'true';
}

/**
 * Whether the concessions admin may write back to the Square catalog.
 *
 * **Off**, and the code it gates is still here — the same reasoning as member
 * accounts. Admins editing concession items so the register picks up the change
 * is a real feature the Kenworthy wants; it is phase 2, and the architecture is
 * not settled yet.
 *
 * Off until then, because on 2026-08-14 that write destroyed 906 live catalog
 * objects: `pushItem` rebuilt the Square object from our four columns, and
 * Square's UpsertCatalogObject replaces rather than merges. That specific fault
 * is fixed (it is read-modify-write now), but the direction stays shut until
 * someone has decided what our four columns are allowed to mean to a register.
 *
 * Today the website's concessions menu is display-only and Square is the source
 * of truth, so pulling is sufficient and pushing has nothing to accomplish.
 *
 * Default **off**: an unset secret must not be the thing that reprices a till.
 */
export function concessionSquarePushEnabled(): boolean {
  return (Deno.env.get('CONCESSION_SQUARE_PUSH') ?? '').trim().toLowerCase() === 'true';
}
