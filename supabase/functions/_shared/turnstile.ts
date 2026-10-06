// Cloudflare Turnstile, verified on the server. One implementation for every
// public write that carries a token: the rental form, both checkouts and the
// donation form.
//
// The browser widget (src/components/Turnstile.tsx) produces a single-use
// token. On its own the token is worthless; this is the half that makes it a
// control, by handing it to Cloudflare's siteverify before anything is written.
//
// ---------------------------------------------------------------------------
// What happens when TURNSTILE_SECRET_KEY is unset — the caller decides
// ---------------------------------------------------------------------------
//
// The rental form was built before the secret existed and fails OPEN when it is
// unset: refusing every submission until somebody created a Cloudflare widget
// would have taken the form offline to close a spam hole. That reasoning still
// holds for a form that only writes a row staff read by hand, so it keeps that
// behaviour (`whenUnset: 'allow'`).
//
// The money paths fail CLOSED (`whenUnset: 'refuse'`). An unset secret on a
// checkout is not "not configured yet" any more — the secret is set on staging
// and production (verified 2026-10-06) — it is a deploy that lost a secret, and
// the thing it would silently re-open is card testing against the theatre's
// merchant account. A checkout that refuses with a loud log line is found in
// minutes; one that quietly stops checking is found by Square's risk team.
//
// Either way a verification that could not be *performed* (Cloudflare
// unreachable, a non-JSON answer) is a failure, not a pass: somebody decided the
// check should happen, and an outage is not a reason to skip it.

// Deno globals
declare const Deno: any;

export const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare documents tokens as at most 2048 characters and refuses longer
 * ones. Checked here so an oversized or non-string value costs no round trip.
 */
const MAX_TOKEN_LENGTH = 2048;

export type WhenUnset = 'allow' | 'refuse';

export type TurnstileVerdict =
  | { ok: true; reason: 'verified' | 'unconfigured' }
  | { ok: false; reason: 'unconfigured' | 'missing-token' | 'rejected' | 'unreachable'; codes?: string[] };

export interface VerifyOptions {
  /** What to do when TURNSTILE_SECRET_KEY is unset. See the header. */
  whenUnset: WhenUnset;
  /** The function name, for log lines. */
  label: string;
  /** Overrides the environment — tests only. */
  secret?: string;
  /** Overrides global fetch — tests only. */
  fetchImpl?: typeof fetch;
}

/**
 * Ask Cloudflare whether this token was solved by a person, once.
 *
 * Tokens are single-use: a second siteverify of the same token answers
 * `timeout-or-duplicate`. Callers therefore verify exactly once per request and
 * the browser fetches a fresh token after any failed attempt — a declined card
 * included — rather than resending the one it already spent.
 */
export async function verifyTurnstile(
  token: unknown,
  ip: string | null,
  opts: VerifyOptions,
): Promise<TurnstileVerdict> {
  // Read per call, not at module load, so the posture follows the environment
  // the request actually runs in (and so tests can vary it).
  const secret = opts.secret ?? (Deno.env.get('TURNSTILE_SECRET_KEY') || '');

  if (!secret) {
    if (opts.whenUnset === 'allow') {
      console.warn(
        `[${opts.label}] TURNSTILE_SECRET_KEY is not set — accepting without a bot check. ` +
          'Set the secret to arm this.',
      );
      return { ok: true, reason: 'unconfigured' };
    }
    console.error(
      `[${opts.label}] TURNSTILE_SECRET_KEY is not set — REFUSING. This path fails closed; ` +
        'set the secret with `supabase secrets set TURNSTILE_SECRET_KEY=...`.',
    );
    return { ok: false, reason: 'unconfigured' };
  }

  if (typeof token !== 'string' || token.trim() === '' || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'missing-token' };
  }

  try {
    const body = new FormData();
    body.append('secret', secret);
    body.append('response', token);
    // Cloudflare uses this to bind the token to the client that solved it.
    if (ip) body.append('remoteip', ip);

    const res = await (opts.fetchImpl ?? fetch)(VERIFY_URL, { method: 'POST', body });
    const outcome = await res.json().catch(() => null);
    if (!outcome) {
      console.error(`[${opts.label}] turnstile answered with no JSON (HTTP ${res.status})`);
      return { ok: false, reason: 'unreachable' };
    }
    if (!outcome.success) {
      const codes: string[] = Array.isArray(outcome['error-codes']) ? outcome['error-codes'] : [];
      console.warn(`[${opts.label}] turnstile rejected:`, JSON.stringify(codes));
      return { ok: false, reason: 'rejected', codes };
    }
    return { ok: true, reason: 'verified' };
  } catch (err) {
    console.error(`[${opts.label}] turnstile verification threw`, err);
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * What a patron is told when the check fails on a checkout or the donation
 * form. The page fetches a fresh token after any failure, so "try again" is an
 * instruction that works — unlike the rental form's "reload the page", which
 * predates that and would throw away a filled-in card form here.
 *
 * "If you don't see one, reload" is for the tab opened before the widget
 * shipped: a cached page has no check on it and can never send a token, and a
 * reload is the whole fix.
 */
export const BOT_CHECK_REFUSAL =
  "We couldn't confirm this came from a person. Please complete the check above the button and try again — if you don't see one, reload the page. If it keeps happening, call the box office on 208-882-4127.";
