// The testable half of square-mobile: when a token needs refreshing, where
// Square's OAuth endpoints are, and the consent URL. index.ts calls Deno.serve
// at import time, so nothing in it can be imported by a unit test.

import type { SquareEnvironment } from '../_shared/square.ts';

/** Square's OAuth host (no /v2), per environment. */
export const OAUTH_HOST: Record<SquareEnvironment, string> = {
  sandbox: 'https://connect.squareupsandbox.com',
  production: 'https://connect.squareup.com',
};

/**
 * What the Stand needs and nothing more (developer.squareup.com/docs/
 * mobile-payments-sdk, "OAuth permissions"). No refunds, no catalog, no
 * customers: the token sits on an iPad.
 */
export const SCOPES = ['MERCHANT_PROFILE_READ', 'PAYMENTS_WRITE', 'PAYMENTS_WRITE_IN_PERSON'];

/** Where an admin lands when `return_to` is missing or refused. */
export const DEFAULT_RETURN_TO = '/staff/pos';

/**
 * Access tokens last 30 days; Square recommends refreshing every 7 or less.
 * Refreshing whenever fewer than 7 days remain means a token handed to the
 * iPad has at least a week left, and a till that sat unused for a month still
 * works, because a code-flow refresh token does not expire.
 */
export const REFRESH_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

export function needsRefresh(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return !Number.isFinite(t) || t - now < REFRESH_WITHIN_MS;
}

export function isExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return !Number.isFinite(t) || t <= now;
}

/** Square's consent screen. Code flow: the redirect is the one registered in
 *  the Developer Console, so none is sent. `session=false` makes a seller who
 *  is signed in to several accounts choose, rather than silently use one. */
export function authorizeUrl(env: SquareEnvironment, applicationId: string, state: string): string {
  const u = new URL('/oauth2/authorize', OAUTH_HOST[env]);
  u.searchParams.set('client_id', applicationId);
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('session', 'false');
  u.searchParams.set('state', state);
  return u.toString();
}
