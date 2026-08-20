// Who called this function — the server, a signed-in human, or nobody.
//
// The distinction matters because `verify_jwt = true` does *not* mean
// "authenticated". Supabase's gateway accepts the publishable anon key as a
// valid bearer, and that key is in the client bundle and in a public GitHub
// repository. So every function that is not meant to be world-callable has to
// establish the caller itself, and this is the one place that logic lives.

// Deno globals
declare const Deno: any;

/** Length-independent comparison, so a mismatch leaks no timing information. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Read the payload of an already-verified JWT.
 *
 * No signature check here on purpose — the edge gateway performs it before the
 * function is invoked. Never call this on a token that has not been through
 * the gateway.
 */
export function decodeJwtPayload(token: string): { role?: string; sub?: string } | null {
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

/**
 * True when the request carries the service role — another edge function, or
 * an operator with the secret key.
 *
 * Two accepted forms, because the gateway is inconsistent about what it hands
 * back. The `role` claim is the reliable one for a legacy JWT service key; the
 * literal comparison covers the newer `sb_secret_` format, which is not a JWT
 * and therefore has no claims to read. Both comparisons are constant-time.
 */
export function isServiceRoleCaller(req: Request): boolean {
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!serviceKey) return false;

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const apiKey = (req.headers.get('apikey') ?? '').trim();

  if (decodeJwtPayload(bearer)?.role === 'service_role') return true;
  if (bearer && timingSafeEqual(bearer, serviceKey)) return true;
  if (apiKey && timingSafeEqual(apiKey, serviceKey)) return true;
  return false;
}

/**
 * The signed-in user behind this request, or null.
 *
 * Returns null for the anon key, which supabase-js sends as the bearer for
 * signed-out callers — treating that as a user would make every guest look
 * like an authenticated one.
 */
export async function callerUser(
  createClient: any,
  req: Request,
): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return null;

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data } = await userClient.auth.getUser();
    return data?.user ? { id: data.user.id } : null;
  } catch {
    return null;
  }
}
