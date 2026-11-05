import { supabase } from '@/integrations/supabase/client';
import { appBaseUrl } from '@/lib/site';

/**
 * Passwordless sign-in for one-off event hosts (docs/briefs/BRIEF-host-magic-link-view.md).
 *
 * A renter gets an email with a link and a code, and either one signs them in.
 * That session is aal1 and proves only that they hold the inbox, so the
 * database gives it their production's sales to read and nothing to change
 * (migration 20261105025356). Staff sign in with a password and a code on /auth.
 *
 * Who actually gets an email is decided on the server, not here. The Send Email
 * Hook (send-auth-email) delivers a sign-in link only to an account holding a
 * sign-in role, and answers "sent" either way, and `shouldCreateUser: false`
 * stops this from minting an account for an unknown address.
 */

const UNREACHABLE = "We couldn't reach the sign-in service. Check your connection and try again.";

/** What the form says after a request, whoever the address belongs to. */
export const LINK_SENT_MESSAGE =
  "If that address is set up as a host, we've emailed it a sign-in link and a code.";

/**
 * Ask for a sign-in email.
 *
 * Non-enumerating: an unknown address ("Signups not allowed for otp"), a buyer's
 * account, a host and a rate-limited repeat all get the same answer. A rate
 * limit only ever trips for an address that has an account, so reporting it
 * would say which addresses do. Only a failure that has nothing to do with the
 * address (offline, the auth server down) is reported, because then nothing
 * was sent to anyone and saying so is the truth.
 *
 * Returns null when the form should say "sent", or the message to show instead.
 * (A nullable rather than a union: the app is not strict, so it cannot narrow.)
 */
export async function requestHostSignInLink(rawEmail: string): Promise<string | null> {
  const email = rawEmail.trim().toLowerCase();
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${appBaseUrl()}/host` },
    });
    if (error && isTransportFailure(error)) {
      return UNREACHABLE;
    }
    return null;
  } catch {
    return UNREACHABLE;
  }
}

/** A failure of the request itself, not an answer about the address. */
function isTransportFailure(error: { status?: number; name?: string; message?: string }): boolean {
  if (error.name === 'AuthRetryableFetchError') return true;
  // Auth captcha is off on both projects. If it is ever turned on, every request
  // from this form fails the same way for every address, so say so rather than
  // telling everyone a link is on its way.
  if (/captcha/i.test(error.message ?? '')) return true;
  return typeof error.status === 'number' && error.status >= 500;
}

/** Supabase email codes are six digits by default; the project can set up to ten. */
export function isSignInCode(raw: string): boolean {
  return /^\d{6,10}$/.test(raw.replace(/\s+/g, ''));
}

/**
 * Exchange the emailed code for a session. supabase-js stores it and fires
 * onAuthStateChange, so useAuth picks up the roles on its own.
 */
export async function verifyHostSignInCode(rawEmail: string, rawCode: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: rawEmail.trim().toLowerCase(),
    token: rawCode.replace(/\s+/g, ''),
    type: 'email',
  });
  if (error) {
    // The access-token hook refuses an account with no sign-in role, with a
    // message written for buyers. Everything else here is a bad or used code.
    if (/staff|confirmation email/i.test(error.message)) throw new Error(error.message);
    throw new Error("That code didn't work. It may have expired or already been used — request a new one.");
  }
}
