/**
 * Build-time capability flags.
 *
 * `MEMBER_ACCOUNTS_ENABLED` is the one switch that decides whether patrons have
 * accounts at all. It is **off**, and everything it gates is still here: the
 * signup form, the account nav, the patron pages, the DVD reserve path, the
 * set-password email. None of it was deleted, because the Kenworthy expects to
 * launch a membership programme and turn it all back on.
 *
 * What it does NOT gate — deliberately — is the data model. `findOrCreateBuyer`
 * still mints an auth user and a profile for every buyer during checkout, and
 * tickets and film passes still hang off that profile. There is simply no
 * patron session to read any of it with. Flip this on and the rows are already
 * there waiting; flip it off and they accumulate invisibly. That asymmetry is
 * the whole point of turning the feature off rather than removing it.
 *
 * Staff, admin, superadmin and host auth are untouched by this flag. `/auth`
 * stays live either way — it is the staff door.
 *
 * Server-side counterpart: the `MEMBER_ACCOUNTS` secret, read by
 * `supabase/functions/_shared/flags.ts`. The two must be set together; the
 * client flag hides the signup UI, the server flag stops the email that tells
 * people to go use it.
 *
 * There is a third switch that lives in neither place: Supabase Auth's "Allow
 * new users to sign up", turned off by hand in both projects. That one is belt
 * and braces — `createUser` on the admin API bypasses it, so guest checkout is
 * unaffected, but a hand-rolled `auth.signUp` from a console is refused.
 */
export const MEMBER_ACCOUNTS_ENABLED =
  import.meta.env.VITE_MEMBER_ACCOUNTS === 'true';
