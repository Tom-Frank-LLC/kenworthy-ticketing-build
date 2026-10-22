// qbo-sync's OAuth state: the shared rules (_shared/oauth_state.ts) bound to
// QuickBooks' own signing secret and default landing page. The hardening notes
// (security audit 2026-10-06, L4) are in the shared module.

import {
  makeState,
  returnUrl as sharedReturnUrl,
  safeReturnPath as sharedSafeReturnPath,
  STATE_TTL_MS,
  stateSecretFrom,
  verifyState,
  type StateBody,
} from '../_shared/oauth_state.ts';

export { makeState, STATE_TTL_MS, verifyState, type StateBody };

/** Where an admin lands when `return_to` is missing or refused. */
export const DEFAULT_RETURN_TO = '/admin?tab=accounting';

/** QBO_STATE_SECRET, or null when it is not set. Never a fallback. */
export function stateSecret(): string | null {
  return stateSecretFrom('QBO_STATE_SECRET');
}

export function safeReturnPath(raw: unknown, fallback = DEFAULT_RETURN_TO): string {
  return sharedSafeReturnPath(raw, fallback);
}

export function returnUrl(origin: string, path: string, params: Record<string, string>): string {
  return sharedReturnUrl(origin, path, params, DEFAULT_RETURN_TO);
}
