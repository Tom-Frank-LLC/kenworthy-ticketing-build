// The OAuth `state` that carries an admin from oauth_start, through Intuit,
// back to oauth_callback — and the rules for where that admin lands afterwards.
//
// Hardened before qbo-sync's first deploy (security audit 2026-10-06, L4):
//
// - Signed with its own secret, QBO_STATE_SECRET. It used to be HMAC'd with
//   SUPABASE_SERVICE_ROLE_KEY: key reuse, so anything that leaked an HMAC
//   oracle here would be working against the key that bypasses all RLS. No
//   secret, no state — oauth_start and oauth_callback refuse rather than fall
//   back to another key.
// - Compared in constant time (the shared `timingSafeEqual`), not with `!==`.
// - Single use. The nonce inside is recorded server-side by oauth_start
//   (`qbo_oauth_states`) and deleted by the callback that consumes it, so a
//   captured callback URL cannot be replayed inside the ten-minute window.
//   That half lives in index.ts, because it needs the database.
// - `return_to` is a path on this site and nothing else, by the same rule as
//   the browser's `safeRedirectPath` (src/lib/safeUrl.ts). `"@evil.tld"` used
//   to be appended to the origin and go off-site.

import { timingSafeEqual } from '../_shared/callers.ts';

// Deno globals
declare const Deno: any;

/** How long an admin has to finish Intuit's consent screen. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Where an admin lands when `return_to` is missing or refused. */
export const DEFAULT_RETURN_TO = '/admin?tab=accounting';

export interface StateBody {
  /** The admin who started the flow. */
  u: string;
  /** QBO environment: sandbox | production. */
  e: string;
  /** Path to return to, already passed through safeReturnPath. */
  r: string;
  /** Single-use nonce, recorded in qbo_oauth_states. */
  n: string;
  /** Issued at, epoch ms. */
  t: number;
}

/** The dedicated signing secret, or null when it is not set. Never a fallback. */
export function stateSecret(): string | null {
  const s = (Deno.env.get('QBO_STATE_SECRET') ?? '').trim();
  return s ? s : null;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}

export async function makeState(body: StateBody, secret: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(body)));
  return `${payload}.${await hmacSign(payload, secret)}`;
}

/**
 * Check a state's signature and age, and return what it carries.
 *
 * Throws with a short reason on any failure. Does NOT consume the nonce — the
 * caller must, before acting on the state.
 */
export async function verifyState(
  state: string,
  secret: string,
  now: number = Date.now(),
): Promise<StateBody> {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Malformed state');
  const [payload, sig] = parts;
  const expected = await hmacSign(payload, secret);
  if (!timingSafeEqual(sig, expected)) throw new Error('State signature mismatch');

  let body: StateBody;
  try {
    body = JSON.parse(fromB64url(payload));
  } catch {
    throw new Error('Malformed state');
  }
  if (
    typeof body?.u !== 'string' || typeof body.e !== 'string' || typeof body.r !== 'string' ||
    typeof body.n !== 'string' || typeof body.t !== 'number'
  ) {
    throw new Error('Malformed state');
  }
  if (now - body.t > STATE_TTL_MS || body.t - now > 60_000) throw new Error('State expired');
  // Signed by us, but re-checked: the return path is the one part a future
  // change to oauth_start could forget to sanitise.
  if (safeReturnPath(body.r, '') !== body.r) throw new Error('Malformed state');
  return body;
}

function isRootedPath(s: string): boolean {
  return /^\/(?![/\\])/.test(s);
}

/**
 * A `return_to` value, accepted only when it is a path on this site.
 *
 * The same rule as `safeRedirectPath` in src/lib/safeUrl.ts, which explains
 * each clause: one leading `/` not followed by `/` or `\`, no backslash or
 * control character anywhere, still same-origin after URL parsing, and the
 * parsed form re-checked because parsing collapses `..`. Anything else becomes
 * `fallback`.
 */
export function safeReturnPath(raw: unknown, fallback = DEFAULT_RETURN_TO): string {
  if (typeof raw !== 'string' || !raw) return fallback;
  if (!isRootedPath(raw) || /[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;

  const base = 'https://same-origin.invalid';
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return fallback;
  }
  if (parsed.origin !== base) return fallback;

  const path = parsed.pathname + parsed.search + parsed.hash;
  return isRootedPath(path) ? path : fallback;
}

/**
 * `origin` + `path` with `params` added to its query string.
 *
 * Built with URL, so a path that already has a query gets `&`, one that has
 * none gets `?`, and a fragment stays at the end. (The callback used to glue
 * `&qbo=error` onto the path whether or not it had a `?`.)
 */
export function returnUrl(origin: string, path: string, params: Record<string, string>): string {
  const u = new URL(safeReturnPath(path), new URL(origin).origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
