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
 */
export function memberAccountsEnabled(): boolean {
  return (Deno.env.get('MEMBER_ACCOUNTS') ?? '').trim().toLowerCase() === 'true';
}
