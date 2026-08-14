import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { memberAccountsEnabled } from './flags.ts';

/**
 * The default matters more than the flag does.
 *
 * `memberAccountsEnabled()` decides whether a ticket receipt carries a
 * "set your password" link. Get the default backwards and an unset secret — a
 * fresh project, a missed `supabase secrets set`, a typo in the name — starts
 * mailing account-recovery links to every buyer, for accounts they never asked
 * for and a sign-in page that is staff-only. That failure would look like
 * nothing at all from the deploy side, so it is pinned here instead.
 *
 * Read per call rather than at module load, so these cases can set the variable
 * between them and so a secrets change takes effect on the next cold start.
 */

function withEnv(value: string | null, run: () => void) {
  const previous = Deno.env.get('MEMBER_ACCOUNTS');
  if (value === null) Deno.env.delete('MEMBER_ACCOUNTS');
  else Deno.env.set('MEMBER_ACCOUNTS', value);
  try {
    run();
  } finally {
    if (previous === undefined) Deno.env.delete('MEMBER_ACCOUNTS');
    else Deno.env.set('MEMBER_ACCOUNTS', previous);
  }
}

Deno.test('member accounts are off when the secret is unset', () => {
  withEnv(null, () => assertEquals(memberAccountsEnabled(), false));
});

Deno.test('only an explicit true turns member accounts on', () => {
  withEnv('true', () => assertEquals(memberAccountsEnabled(), true));
  withEnv('TRUE', () => assertEquals(memberAccountsEnabled(), true));
  withEnv(' true ', () => assertEquals(memberAccountsEnabled(), true));
});

Deno.test('anything else leaves member accounts off', () => {
  // Notably '1' and 'yes': plausible things to type into a secrets prompt that
  // must not silently half-enable the feature.
  for (const value of ['', 'false', '0', '1', 'yes', 'on', 'enabled']) {
    withEnv(value, () =>
      assertEquals(memberAccountsEnabled(), false, `expected "${value}" to read as off`),
    );
  }
});
