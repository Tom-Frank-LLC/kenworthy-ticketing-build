// Who called this function — the server, a signed-in human, or nobody.
//
// The distinction matters because `verify_jwt = true` does *not* mean
// "authenticated". Supabase's gateway accepts the publishable anon key as a
// valid bearer, and that key is in the client bundle and in a public GitHub
// repository. So every function that is not meant to be world-callable has to
// establish the caller itself, and this is the one place that logic lives.
//
// Service-role identity is *proved*, never read off a claim (security audit
// 2026-10-06, L9). It used to accept any token whose payload said
// `"role": "service_role"`, unverified, on the grounds that the gateway checks
// signatures. It does — while `verify_jwt = true`. One `--no-verify-jwt` deploy,
// or a function moved into config.toml's `verify_jwt = false` list, would have
// turned a hand-written unsigned token into full service-role trust. The proof
// now lives in the function, so it holds whatever the gateway is configured to
// do.

// Deno globals
declare const Deno: any;

/** Length-independent comparison, so a mismatch leaks no timing information. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Every service key this function's environment holds.
 *
 * The platform injects `SUPABASE_SERVICE_ROLE_KEY` (on this project, in the
 * newer `sb_secret_` format — see 20260819020000) and `SUPABASE_SECRET_KEYS`, a
 * JSON object of named `sb_secret_` keys. A caller presenting any of them is
 * the server. Parsed defensively: an unreadable variable contributes nothing
 * rather than throwing on every request.
 */
export function serviceKeys(): string[] {
  const keys = new Set<string>();
  const primary = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (primary) keys.add(primary);

  const raw = (Deno.env.get('SUPABASE_SECRET_KEYS') ?? '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
      for (const v of values) if (typeof v === 'string' && v.trim()) keys.add(v.trim());
    } catch {
      // Not JSON: a single bare key.
      keys.add(raw);
    }
  }
  return [...keys];
}

function bearerOf(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

/**
 * True when the request presents one of this environment's service keys,
 * literally — another edge function forwarding its own key, or an operator
 * holding the secret key. Constant-time against every key.
 *
 * Synchronous and local, so it costs nothing. It does not recognise a service
 * credential in a *different* format from the one injected here (a legacy
 * `service_role` JWT from the dashboard when the environment holds an
 * `sb_secret_` key); `verifyServiceRoleCaller` covers that by asking auth.
 */
export function isServiceRoleCaller(req: Request): boolean {
  const keys = serviceKeys();
  if (keys.length === 0) return false;

  const presented = [bearerOf(req), (req.headers.get('apikey') ?? '').trim()].filter(Boolean);
  let match = false;
  // No early exit: every comparison runs whatever the outcome.
  for (const p of presented) for (const k of keys) if (timingSafeEqual(p, k)) match = true;
  return match;
}

/**
 * Read a JWT's payload WITHOUT checking its signature.
 *
 * Only ever used as a cheap filter in `verifyServiceRoleCaller`, to decide
 * whether a token is worth asking auth about. Nothing may be granted on what
 * this returns.
 */
function unverifiedJwtPayload(token: string): { role?: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** A user id that cannot exist, so the probe below reads nobody's record. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/**
 * True when the request is provably the service role.
 *
 * First the literal key comparison. Failing that, a bearer that claims
 * `service_role` is put to the one party that can verify every signing key this
 * project has ever had, legacy secret included: auth's admin API. Only a
 * genuine service-role token gets "user not found" for a user lookup; any other
 * token is refused with 401/403. The lookup is for the all-zero id, so no user
 * data is read either way.
 *
 * Fails closed. If auth cannot be reached, the caller is not the service role.
 */
export async function verifyServiceRoleCaller(
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (isServiceRoleCaller(req)) return true;

  const bearer = bearerOf(req);
  if (unverifiedJwtPayload(bearer)?.role !== 'service_role') return false;

  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') ?? '').trim();
  if (!base || !anonKey) return false;

  try {
    const res = await fetchImpl(`${base}/auth/v1/admin/users/${NOBODY}`, {
      method: 'GET',
      headers: { apikey: anonKey, Authorization: `Bearer ${bearer}` },
    });
    const body = await res.json().catch(() => ({}));
    return res.status === 404 && body?.error_code === 'user_not_found';
  } catch {
    return false;
  }
}

/**
 * The signed-in user behind this request, or null.
 *
 * Returns null for the anon key, which supabase-js sends as the bearer for
 * signed-out callers — treating that as a user would make every guest look
 * like an authenticated one.
 *
 * A user is not a role. Checkout mints an account for every guest buyer, so
 * "has a session" says nothing about being staff; pair this with
 * `callerHasRole` before trusting the caller with anything.
 */
export async function callerUser(
  createClient: any,
  req: Request,
): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return null;

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data } = await userClient.auth.getUser();
    return data?.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Whether `userId` holds `role`, asked through a service-role client.
 *
 * `has_role` is hierarchical (superadmin ⊇ admin ⊇ staff; host is separate).
 * Asked as service_role because a role check that RLS can starve fails in the
 * wrong direction. Returns null when the lookup itself failed, so a caller can
 * refuse with a retryable error instead of silently demoting someone.
 */
export async function callerHasRole(
  admin: any,
  userId: string,
  role: 'staff' | 'admin' | 'superadmin' | 'host',
): Promise<boolean | null> {
  const { data, error } = await admin.rpc('has_role', { _user_id: userId, _role: role });
  if (error) return null;
  return data === true;
}
