// Per-caller rate limiting for the public edge functions.
//
// Why this exists here rather than at the edge: WAF rules attach to a zone, and
// every endpoint worth limiting is on `*.supabase.co` — behind Supabase's
// Cloudflare, not ours. No rule we could write would see the traffic, and the
// move to kenworthy.org does not change that. See 20260825143017.
//
// What it is: a fixed-window counter per (bucket, caller). It stops casual
// scripted abuse from one address. It does not stop a distributed attempt, and
// it cannot tell a library behind one NAT from one determined script — so the
// thresholds sit well above anything a person plausibly does, and this is a
// speed bump. Turnstile is the wall.

// Deno globals
declare const Deno: any;

/**
 * The client address, as seen by the Supabase edge runtime.
 *
 * `cf-connecting-ip` is the reliable one and it *is* present — verified against
 * a deployed probe on staging, which is worth stating because a per-caller
 * limiter that cannot see the caller is decoration. `x-forwarded-for` arrives
 * too but with the address repeated and a proxy hop appended
 * (`1.2.3.4,1.2.3.4, 99.82.172.149`), so it is only a fallback and only its
 * first entry.
 */
export function callerIp(req: Request): string | null {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const xff = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return xff || null;
}

/**
 * SHA-256 the address so the database never holds one.
 *
 * These rows would otherwise be a log of who visited and when, which is not
 * something a ticketing system needs to keep in order to count requests. The
 * digest is stable for a given address, which is all the counter requires.
 */
export async function hashIdentifier(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the current window closes. 0 when unknown. */
  retryAfter: number;
}

/**
 * Claim one request against `bucket`'s window.
 *
 * **Fails open.** If the database call errors, the request is allowed. That is
 * deliberate and it is the whole posture of this module: the counter exists to
 * blunt abuse, and a limiter that takes checkout down when the database hiccups
 * has cost more than the abuse ever would. Anything that must fail closed —
 * payment authorisation, the door scanner — does not belong here.
 */
export async function checkRateLimit(
  admin: any,
  req: Request,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  try {
    const ip = callerIp(req);
    if (!ip) return { allowed: true, retryAfter: 0 };

    const identifier = await hashIdentifier(ip);
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_identifier: identifier,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error || !data) {
      console.error('[rate-limit] check failed, allowing', bucket, error);
      return { allowed: true, retryAfter: 0 };
    }

    if (!data.allowed) {
      // The bucket and the count, never the identifier: logging the digest back
      // out would rebuild the trail the hashing exists to prevent.
      console.warn(`[rate-limit] ${bucket} refused a caller at ${data.count}/${data.limit}`);
    }

    return { allowed: Boolean(data.allowed), retryAfter: Number(data.retry_after) || 0 };
  } catch (err) {
    console.error('[rate-limit] threw, allowing', bucket, err);
    return { allowed: true, retryAfter: 0 };
  }
}

/**
 * The thresholds, in one place so they can be read against each other.
 *
 * Each is set at roughly ten times the busiest plausible human, so that nobody
 * real meets one. They bound cost and nuisance; they are not the thing standing
 * between an attacker and the money.
 */
export const LIMITS = {
  /**
   * The public donation form. A donor might reasonably retry a declined card
   * several times, and a family might give from one address at one event.
   */
  donation: { bucket: 'donation', limit: 15, windowSeconds: 600 },

  /**
   * The ticket page and its QR image. Generous on purpose: one ticket page load
   * fetches a QR per ticket, mail clients re-fetch images, and a party of four
   * refreshing on the pavement outside is ordinary. The order token is a random
   * UUID, so this bounds cost rather than protecting the token — guessing it was
   * never realistic.
   */
  ticketAccess: { bucket: 'ticket-access', limit: 120, windowSeconds: 60 },

  /**
   * The newsletter form. Anonymous callers are already forced to double opt-in,
   * so the exposure is Mailchimp sending confirmation mail to addresses someone
   * else typed. Tight, because there is no honest reason to subscribe twenty
   * addresses from one browser in ten minutes.
   */
  mailchimpSubscribe: { bucket: 'mailchimp-subscribe', limit: 10, windowSeconds: 600 },
} as const;
