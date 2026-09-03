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

/**
 * The auth user id for an email address, or null.
 *
 * `listUsers()` with no arguments returns **the first page only** — 50 users.
 * Everyone registered after that is invisible to it, so the lookup reports "no
 * such user", `findOrCreateBuyer` tries to create one, and Supabase refuses with
 * *"A user with this email address has already been registered"*. Checkout then
 * dies on the last step, after the buyer has typed a card number.
 *
 * That is not hypothetical: it took down a real purchase on kenworthy.org on
 * 2026-09-03, and it had been failing every returning customer past the 50th
 * account for as long as there have been more than fifty.
 *
 * `profiles` first because it is one indexed lookup and the
 * `on_auth_user_created` trigger fills `email` for every user it creates. The
 * paged `listUsers` scan behind it covers accounts that predate that trigger.
 *
 * This is the canonical implementation. `invite-staff` grew its own correct
 * copy of it in July while this one stayed broken, which is exactly how one bug
 * gets fixed in one place and left standing in another — so it now imports this
 * rather than keeping a twin.
 */
export async function findUserIdByEmail(admin: any, email: string): Promise<string | null> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', normalised)
    .limit(1)
    .maybeSingle();
  if (profile?.id) return profile.id;

  const PER_PAGE = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) break;
    const users = data?.users ?? [];
    const hit = users.find((u: any) => u.email?.toLowerCase() === normalised);
    if (hit) return hit.id;
    // A short page is the last page. Without this the loop always runs 50
    // round trips, on the checkout path, for every guest.
    if (users.length < PER_PAGE) break;
  }
  return null;
}

/** Find an existing account by email, then phone. Returns null if neither hits. */
export async function findUserByContact(
  admin: any,
  email: string | null,
  phone: string | null,
): Promise<string | null> {
  if (email) {
    const existing = await findUserIdByEmail(admin, email);
    if (existing) return existing;
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
    // Falls back rather than storing '', now that the name is optional at
    // checkout. A blank display_name reads as a broken record everywhere it
    // surfaces — the attendee list, the admin search, the pass counter — and
    // the contact we were given is a more useful handle than nothing.
    user_metadata: {
      display_name: contact.name || contact.email || contact.phone || 'Kenworthy patron',
    },
  };
  if (contact.email) createPayload.email = contact.email.toLowerCase();
  if (contact.phone) createPayload.phone = contact.phone;

  const { data: newUser, error } = await admin.auth.admin.createUser(createPayload);

  if (error || !newUser?.user) {
    const message = error?.message ?? 'unknown error';

    // "Already registered" means the lookup above missed somebody who is
    // demonstrably there — so ask again rather than failing the sale. This is
    // belt-and-braces behind the paging fix in findUserIdByEmail, and it is here
    // because of how this failed in production: the buyer had already typed a
    // card number, and the last thing they saw was a raw account-creation error
    // for an account they did not ask for and already had.
    //
    // Whatever the next cause turns out to be, a returning customer must not be
    // the one who pays for it.
    if (/already.*(regist|exist)/i.test(message) && contact.email) {
      const found = await findUserIdByEmail(admin, contact.email);
      if (found) {
        console.warn('[buyers] createUser said already-registered; recovered by re-lookup');
        return { userId: found, created: false };
      }
    }

    throw new Error(`Failed to create account: ${message}`);
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
  return {
    name,
    email: emailRaw || null,
    phone: phoneRaw || null,
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
  };
}
