// Who is buying — resolved server-side, never taken on trust from the body.
//
// Two callers need the same answer (ticket-checkout, film-pass-checkout) and
// must agree on it, or a patron ends up with two accounts and their tickets
// split between them.
//
// Rules:
//   * A valid JWT wins. If the request carries a signed-in user, the purchase
//     is theirs regardless of what the body claims.
//   * Otherwise the buyer is identified by email, then phone, and an account is
//     created only if neither matches. That silent account is what makes the
//     ticket retrievable later.

// Deno globals
declare const Deno: any;

export interface BuyerContact {
  name: string;
  email: string | null;
  phone: string | null;
  /**
   * Whether the buyer left the marketing box ticked at checkout. Opt-out: the
   * box is ticked by default, so this is normally true. Absent means the caller
   * never asked, which is not the same as consent — see `readContact`.
   */
  marketingOptIn: boolean;
}

export interface ResolvedBuyer {
  userId: string;
  contact: BuyerContact;
  /** True when the buyer was signed in — used to decide auth-only affordances. */
  authenticated: boolean;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The user behind this request's Authorization header, or null.
 *
 * supabase-js sends the anon key as a bearer token for signed-out callers, so
 * the anon key is filtered out explicitly — treating it as a JWT makes every
 * guest look like a failed auth attempt.
 */
export async function authenticatedUser(
  createClient: any,
  req: Request,
): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get('Authorization');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  if (!authHeader || authHeader.includes(anonKey)) return null;

  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await userClient.auth.getUser();
    if (!data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

/** Find an existing account by email, then phone. Returns null if neither hits. */
export async function findUserByContact(
  admin: any,
  email: string | null,
  phone: string | null,
): Promise<string | null> {
  if (email) {
    const { data: usersData } = await admin.auth.admin.listUsers();
    const existing = usersData?.users?.find(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (existing) return existing.id;
  }

  if (phone) {
    const { data: profileData } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();
    if (profileData) return profileData.id;
  }

  return null;
}

/**
 * Resolve the buyer for a guest purchase: match an existing account, or create
 * one. The password is random and never disclosed — the customer claims the
 * account through the password-set link in their confirmation email.
 *
 * `created` says whether this call actually made the account. The confirmation
 * email needs it: it should offer "set your password" to someone who has just
 * had an account made for them silently, and must not tell a returning
 * customer that an account was created for them when it wasn't.
 */
export async function findOrCreateBuyer(
  admin: any,
  contact: BuyerContact,
): Promise<{ userId: string; created: boolean }> {
  const existing = await findUserByContact(admin, contact.email, contact.phone);
  if (existing) return { userId: existing, created: false };

  const createPayload: Record<string, unknown> = {
    password: crypto.randomUUID() + 'Aa1!',
    email_confirm: true,
    user_metadata: { display_name: contact.name },
  };
  if (contact.email) createPayload.email = contact.email.toLowerCase();
  if (contact.phone) createPayload.phone = contact.phone;

  const { data: newUser, error } = await admin.auth.admin.createUser(createPayload);
  if (error || !newUser?.user) {
    throw new Error(`Failed to create account: ${error?.message ?? 'unknown error'}`);
  }

  // The profile trigger does not carry the phone across.
  if (contact.phone) {
    await admin.from('profiles').update({ phone: contact.phone }).eq('id', newUser.user.id);
  }

  return { userId: newUser.user.id, created: true };
}

/** Normalise and validate the contact block from a request body. */
export function readContact(body: Record<string, any>): BuyerContact {
  const name = String(body.name ?? body.guest_name ?? '').trim();
  const emailRaw = String(body.email ?? body.guest_email ?? '').trim();
  const phoneRaw = String(body.phone ?? body.guest_phone ?? '').trim();
  // Consent has to be stated, not assumed. The checkbox ships ticked, so a
  // client that asked sends `true` explicitly; a body with no field at all is a
  // caller that never put the question to the buyer, and inferring "yes" from
  // silence is the one reading that subscribes people who were never asked.
  const marketingOptIn = body.marketing_opt_in === true || body.newsletter === true;
  return {
    name,
    email: emailRaw || null,
    phone: phoneRaw || null,
    marketingOptIn,
  };
}

/** Fill in whatever the signed-in buyer did not type, from their own records. */
export async function contactForUser(
  admin: any,
  userId: string,
  provided: BuyerContact,
): Promise<BuyerContact> {
  if (provided.name && (provided.email || provided.phone)) return provided;

  const [{ data: profile }, { data: authUser }] = await Promise.all([
    admin.from('profiles').select('display_name, phone').eq('id', userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);

  return {
    name: provided.name || profile?.display_name || 'Kenworthy patron',
    email: provided.email || authUser?.user?.email || null,
    phone: provided.phone || profile?.phone || null,
    // Backfilled from records, but consent is not a record to backfill — it is
    // whatever the buyer just said on the form.
    marketingOptIn: provided.marketingOptIn,
  };
}
