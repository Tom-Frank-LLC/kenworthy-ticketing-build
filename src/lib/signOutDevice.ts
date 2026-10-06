import type { SupabaseClient } from '@supabase/supabase-js';

type AuthClient = SupabaseClient['auth'];

/**
 * Sign out, and make sure this device no longer holds the session — whatever
 * the network does.
 *
 * `supabase.auth.signOut()` asks the server to revoke the session first and
 * only then deletes it from localStorage. If that request fails (offline, a
 * 5xx, a timeout) it returns the error *before* deleting anything
 * (@supabase/auth-js 2.96.0, GoTrueClient `_signOut`). The header used to log
 * that error and send the browser to /auth regardless, so the screen looked
 * signed out while the token stayed stored — and the next person at a shared
 * box-office or scanner device was signed in as the last staff member
 * (audit 2026-10-06, L12).
 *
 * The audit suggested falling back to `signOut({ scope: 'local' })`. That alone
 * does not work: in this version `scope: 'local'` still calls /logout first,
 * and bails out on the same network error the same way. What does work is
 * removing the stored session ourselves; `signOut({ scope: 'local' })` then
 * finds no session, makes no request, and does the rest of its cleanup (the
 * `-user` and `-code-verifier` keys) and emits SIGNED_OUT, which is what tells
 * AuthProvider the user is gone.
 *
 * `storage` and `storageKey` are protected fields on GoTrueClient, not public
 * API, so they are read defensively. If a future auth-js renames them, the
 * second signOut makes its network call again, fails again, and this throws —
 * the caller then keeps showing the person as signed in, which is the true
 * state, rather than pretending.
 *
 * Resolves `{ revoked: true }` when the server confirmed, `{ revoked: false }`
 * when only this device was cleared (the server-side session then lapses at
 * its expiry; nobody holds the token). Throws only when the session is still
 * stored here.
 */
export async function signOutDevice(auth: AuthClient): Promise<{ revoked: boolean }> {
  let serverError: unknown = null;
  try {
    ({ error: serverError } = await auth.signOut());
  } catch (e) {
    serverError = e;
  }
  if (!serverError) return { revoked: true };

  console.warn('[auth] server sign-out failed; clearing this device only', serverError);

  const internals = auth as unknown as {
    storage?: { getItem(k: string): unknown; removeItem(k: string): unknown };
    storageKey?: string;
  };
  const { storage, storageKey } = internals;
  if (storage && storageKey) await storage.removeItem(storageKey);

  const { error: localError } = await auth.signOut({ scope: 'local' });
  if (localError) throw localError;
  if (storage && storageKey && (await storage.getItem(storageKey)) != null) {
    throw new Error('Sign-out did not clear the session from this device');
  }
  return { revoked: false };
}

/** Shown when signOutDevice throws: the person is still signed in on this device. */
export const SIGN_OUT_FAILED = 'Could not sign out. You are still signed in on this device — check the connection and try again.';
