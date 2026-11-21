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
// speed bump. Turnstile is the wall (_shared/turnstile.ts), and every public
// path that moves money or books seats carries both.

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
 * Has this caller already reached `limit` in `bucket`'s current window?
 * Reads the counter without claiming anything.
 *
 * For limits that count only some outcomes. promo-quote counts failed code
 * lookups (a patron re-pricing their basket with a code that works should
 * never be limited), but a caller who has used up their failures must be
 * refused before the next answer, valid or not. Otherwise a 429 would mean
 * "wrong code" and an answer would mean "right code", and the limit would
 * protect nothing. checkRateLimit cannot do that alone: it claims as it
 * checks.
 *
 * Fails open, like checkRateLimit.
 */
export async function rateLimitReached(
  admin: any,
  req: Request,
  bucket: string,
  limit: number,
): Promise<boolean> {
  try {
    const ip = callerIp(req);
    if (!ip) return false;
    const identifier = await hashIdentifier(ip);
    const { data, error } = await admin
      .from('rate_limits')
      .select('count, expires_at')
      .eq('bucket', bucket)
      .eq('identifier', identifier)
      .maybeSingle();
    if (error) {
      console.error('[rate-limit] peek failed, allowing', bucket, error);
      return false;
    }
    if (!data || new Date(data.expires_at).getTime() <= Date.now()) return false;
    return Number(data.count) >= limit;
  } catch (err) {
    console.error('[rate-limit] peek threw, allowing', bucket, err);
    return false;
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

  /**
   * Online ticket checkout, paid and free alike — counted per attempt, so a
   * declined card and its retry are two.
   *
   * The highest of the four because one address is most often many people
   * here. A family buying on one phone uses two or three attempts. The case
   * that sets the number is a crowd behind one NAT: patrons on the lobby Wi-Fi
   * buying for tonight's show, a campus network ahead of a popular screening,
   * a phone carrier's CGNAT. Sixty in ten minutes is one attempt every ten
   * seconds, sustained — well past any of those — while a single-address card
   * tester is held to a few hundred an hour instead of thousands. The box
   * office never comes through here (the counter uses square-terminal and
   * square-cash-sale), so a busy night at the till cannot trip it.
   *
   * Turnstile is the control that actually stops scripted checkouts; this
   * bounds what one address can cost us if it gets past it.
   */
  ticketCheckout: { bucket: 'ticket-checkout', limit: 60, windowSeconds: 600 },

  /**
   * Online film-pass orders. A pass is a once-a-season purchase with up to ten
   * on one order, so even a household buying gifts on separate cards makes a
   * handful of attempts. Twenty leaves room for declines and a shared address
   * without giving a card tester a useful rate.
   */
  filmPassOrder: { bucket: 'film-pass-order', limit: 20, windowSeconds: 600 },

  /**
   * Promo-code lookups that failed (BRIEF-promo-codes). Counted on failure
   * only; checked before every coded quote with rateLimitReached, so once a
   * caller is over it every answer stops, right or wrong.
   *
   * A person mistypes a code once or twice; a lobby on one Wi-Fi might have a
   * handful of people doing it at once. Twenty in ten minutes covers that and
   * holds one address to ~120 guesses an hour. Codes still need to be hard to
   * guess (the admin form says so): this slows a guesser, it does not stop one.
   */
  promoCodeMiss: { bucket: 'promo-code-miss', limit: 20, windowSeconds: 600 },

  /**
   * Every coded quote, successful or not. A patron with a working code
   * re-prices on each change to their basket, so this is generous; it bounds
   * what one address can cost, nothing more.
   */
  promoQuote: { bucket: 'promo-quote', limit: 300, windowSeconds: 600 },
} as const;

/**
 * What a refused caller is told. One sentence for every public money path, with
 * a way to finish the purchase that does not depend on waiting.
 */
export const RATE_LIMIT_REFUSAL =
  'That is a lot of attempts in a short time. Please wait a few minutes and try again, or call the box office on 208-882-4127.';
