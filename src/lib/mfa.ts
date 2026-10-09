import type { Factor } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Two-step sign-in (security audit 2026-10-06, M9; docs/briefs/BRIEF-admin-mfa.md).
 *
 * The browser only asks. Once the `mfa_required` switch is on, the server gives a
 * signed-in session that is not `aal2` nothing a signed-out visitor wouldn't
 * get, whatever its role. The database does that through has_role, is_host_of
 * and restrictive policies, the edge functions through requireRole. Everything
 * here is about getting a person to `aal2` without a dead end.
 *
 * Factor-agnostic on purpose. Nothing below assumes "one TOTP factor": factors
 * are listed and labelled by type, and the server only cares that the session
 * reached `aal2`. Adding passkeys later (Phase 2) means a new entry in
 * FACTOR_LABELS and a second way to verify, not a rewrite.
 */

export type AalLevel = 'aal1' | 'aal2';

export interface MfaState {
  currentLevel: AalLevel | null;
  nextLevel: AalLevel | null;
  /** Verified factors only: the ones that can raise a session to aal2. */
  verifiedFactors: Factor[];
}

export const NO_MFA: MfaState = { currentLevel: null, nextLevel: null, verifiedFactors: [] };

/**
 * Where the current session stands. Local: supabase-js reads the access token's
 * `aal` and the session's user record, with no network round trip, so this is
 * cheap enough to run on every auth change.
 */
export async function readMfaState(): Promise<MfaState> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return NO_MFA;
  const { data: session } = await supabase.auth.getSession();
  const verifiedFactors = (session.session?.user.factors ?? []).filter(f => f.status === 'verified');
  return {
    currentLevel: (data.currentLevel as AalLevel | null) ?? null,
    nextLevel: (data.nextLevel as AalLevel | null) ?? null,
    verifiedFactors,
  };
}

/**
 * This session could be raised to aal2 and has not been: the person has a
 * factor and signed in with the password only. Ask for the code before anything
 * else.
 */
export function needsCode(state: MfaState): boolean {
  return state.currentLevel === 'aal1' && state.nextLevel === 'aal2';
}

/** Plain names. Nobody at the box office should have to know what TOTP stands for. */
const FACTOR_LABELS: Record<string, string> = {
  totp: 'Authenticator app',
  phone: 'Text message',
  webauthn: 'Passkey',
};

export function factorTypeLabel(factor: Pick<Factor, 'factor_type'>): string {
  return FACTOR_LABELS[factor.factor_type] ?? factor.factor_type;
}

/**
 * Factors this browser can take a code for today. Only authenticator apps: a
 * passkey verifies with a tap instead of a code, and is Phase 2.
 */
export function codeFactors(factors: Factor[]): Factor[] {
  return factors.filter(f => f.factor_type === 'totp' && f.status === 'verified');
}

/**
 * Check a 6-digit code against a factor and, on success, raise the session to
 * aal2. supabase-js stores the upgraded session and fires onAuthStateChange
 * (MFA_CHALLENGE_VERIFIED), which is how the rest of the app finds out.
 */
export async function verifyCode(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw new Error(friendlyMfaError(error.message));
}

/** Six digits, spaces allowed: authenticator apps show "123 456". */
export function cleanCode(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function isCompleteCode(raw: string): boolean {
  return /^\d{6}$/.test(cleanCode(raw));
}

/**
 * Auth's messages are written for developers ("Invalid TOTP code entered"). Say
 * what to do instead.
 */
export function friendlyMfaError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid') && (m.includes('code') || m.includes('totp'))) {
    return "That code didn't match. Codes change every 30 seconds, so try the one showing now.";
  }
  if (m.includes('expired')) return 'That took too long. Please try again.';
  if (m.includes('aal2') || m.includes('assurance')) {
    return 'Enter a code from your authenticator app first, then try again.';
  }
  return message;
}

/** Is the server enforcing for this person right now? See my_mfa_required() in the migration. */
export async function fetchMfaRequired(): Promise<boolean> {
  const { data, error } = await supabase.rpc('my_mfa_required');
  return !error && data === true;
}
