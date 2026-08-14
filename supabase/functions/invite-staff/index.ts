// Invite a staff member — create the account and stamp the role in one step.
//
// Why this exists: self-signup is off, so the only code path that still mints
// an auth user is checkout (`_shared/buyers.ts`). That left no in-app way to
// onboard someone who has never bought a ticket — they had no auth user, no
// profile, and so never appeared on /superadmin to be granted a role. The only
// remaining route was handing out Supabase dashboard access.
//
// Authorisation is the whole point of this function, so it is spelled out
// twice: `verify_jwt` is left at its default (true) by keeping this function
// OUT of the `verify_jwt = false` list in config.toml, and the handler then
// checks `has_role(caller, 'superadmin')` itself. The client route guard on
// /superadmin is not a boundary — hiding the button stops nobody from calling
// `functions.invoke` directly.
//
// The privileged work runs as service_role, which bypasses RLS on `user_roles`.
// That is deliberate and safe *only* because of the superadmin gate above:
// `user_roles` is the privilege-escalation table, and its RLS write policies are
// superadmin-only (verified on both projects, 2026-08-14).
//
// Email delivery is Supabase's own `inviteUserByEmail`. That is not the
// unbranded path it would have been a month ago: the Send Email Hook
// (`send-auth-email`) intercepts every auth email and renders it through the
// Kenworthy templates in `_shared/auth-email.ts`, which already carry copy for
// the `invite` action. So the simple call gets the branded email for free.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { EMAIL_RE } from '../_shared/buyers.ts';
import { SITE_URL } from '../_shared/brand.ts';

// Deno globals
declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Roles this function will grant.
 *
 * `regular_user` is excluded on purpose — it is the default the
 * `on_auth_user_created` trigger already stamps, so asking for it here means
 * "invite a staff member who is not staff", which is a mistake worth rejecting
 * rather than honouring.
 */
const INVITABLE_ROLES = ['staff', 'admin', 'host', 'superadmin'] as const;
type InvitableRole = typeof INVITABLE_ROLES[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Find an existing account for this email, or null.
 *
 * `profiles` first because it is a single indexed lookup and the
 * `on_auth_user_created` trigger fills `email` for every user it creates. The
 * `listUsers` fallback covers accounts that predate that trigger, and pages
 * properly — `listUsers()` with no arguments returns only the first 50, which
 * would silently report "no such user" for anyone further down the list and
 * then fail the invite with "already registered".
 */
async function findUserIdByEmail(admin: any, email: string): Promise<string | null> {
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (profile?.id) return profile.id;

  const PER_PAGE = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) break;
    const users = data?.users ?? [];
    const hit = users.find((u: any) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < PER_PAGE) break;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // --- Authenticate the caller -------------------------------------------
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    // --- Authorise: superadmin only ----------------------------------------
    const { data: isSuper } = await userClient.rpc('has_role', {
      _user_id: user.id,
      _role: 'superadmin',
    });
    if (!isSuper) return json({ error: 'Superadmin access required' }, 403);

    // --- Validate the request ----------------------------------------------
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email) return json({ error: 'An email address is required' }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: 'That is not a valid email address' }, 400);

    const role = String(body.role ?? 'staff').trim() as InvitableRole;
    if (!INVITABLE_ROLES.includes(role)) {
      return json({ error: `Role must be one of: ${INVITABLE_ROLES.join(', ')}` }, 400);
    }

    const displayName = String(body.display_name ?? '').trim() || null;

    // --- Privileged work ----------------------------------------------------
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // Reuse rather than duplicate. Someone who once bought a ticket already has
    // an account (checkout made one silently); inviting them must grant the role
    // to *that* account, not fail and not fork their history into a second one.
    let userId = await findUserIdByEmail(admin, email);
    let created = false;

    if (!userId) {
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
        email,
        {
          data: displayName ? { display_name: displayName } : undefined,
          redirectTo: `${SITE_URL.replace(/\/$/, '')}/reset-password`,
        },
      );

      if (inviteError || !invited?.user) {
        // The one error worth recovering from: the account exists but neither
        // lookup found it (no profile row, and beyond the listUsers scan).
        // Anything else is a real failure.
        const message = inviteError?.message ?? 'unknown error';
        if (!/already.*regist|already.*exist/i.test(message)) {
          console.error('[invite-staff] invite failed:', message);
          return json({ error: 'Could not send the invitation' }, 502);
        }
        console.warn('[invite-staff] invite reported an existing user the lookups missed');
        return json({ error: 'That account already exists but could not be located' }, 409);
      }

      userId = invited.user.id;
      created = true;
    }

    // The trigger has already stamped `regular_user`; this adds the real role.
    // `ignoreDuplicates` makes re-inviting somebody a no-op rather than a 409.
    const { error: roleError } = await admin
      .from('user_roles')
      .upsert({ user_id: userId, role }, { onConflict: 'user_id,role', ignoreDuplicates: true });

    if (roleError) {
      console.error('[invite-staff] role grant failed:', roleError.message);
      return json({
        error: created
          ? 'The account was created but the role could not be assigned — grant it from the list below'
          : 'Could not assign that role',
      }, 500);
    }

    // Deliberately no email address in this log line — see the security brief.
    console.log(`[invite-staff] ${created ? 'created' : 'reused'} user, granted ${role}`);

    return json({ ok: true, created, userId, email, role });
  } catch (e) {
    // Generic on the wire, specific in the logs.
    console.error('[invite-staff] unhandled:', e instanceof Error ? e.message : String(e));
    return json({ error: 'Something went wrong sending that invitation' }, 500);
  }
});
