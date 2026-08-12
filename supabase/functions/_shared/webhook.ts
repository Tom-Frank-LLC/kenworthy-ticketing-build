// Standard Webhooks signature verification.
//
// Supabase signs auth hook requests with the Standard Webhooks scheme
// (standardwebhooks.com). Implemented here against Web Crypto rather than
// pulling the npm package: the edge runtime is fussy about npm specifiers, and
// this is ~40 lines of HMAC.
//
// Without this check the hook endpoint is an open relay — anyone who found the
// URL could make it send password-reset emails to arbitrary addresses.

/** Requests older than this are rejected, so a captured request cannot be replayed. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Length-independent comparison, so a mismatch leaks no timing information. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Supabase presents the hook secret as `v1,whsec_<base64>`. Accept that, the
 * bare `whsec_<base64>` form, and raw base64 — pasting whichever the dashboard
 * shows should not silently break verification.
 */
export function normalizeSecret(secret: string): Uint8Array {
  let s = secret.trim();
  if (s.startsWith('v1,')) s = s.slice(3);
  if (s.startsWith('whsec_')) s = s.slice(6);
  return base64ToBytes(s);
}

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify a Standard Webhooks request.
 *
 * `nowSeconds` is injectable so the timestamp window can be tested without
 * depending on the wall clock.
 */
export async function verifyStandardWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing webhook headers' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad webhook timestamp' };
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'webhook timestamp outside tolerance' };
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = normalizeSecret(secret);
  } catch {
    return { ok: false, reason: 'hook secret is not valid base64' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = `${id}.${timestamp}.${rawBody}`;
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed)),
  );
  const expected = bytesToBase64(mac);

  // The header may carry several space-separated versioned signatures during
  // a secret rotation; any one matching is enough.
  for (const part of signature.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    if (timingSafeEqual(value, expected)) return { ok: true };
  }
  return { ok: false, reason: 'no matching signature' };
}
