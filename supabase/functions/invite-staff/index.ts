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
// asks `has_role()` who the caller is. The client route guards on /superadmin
// and /admin/accounts are not a boundary — hiding a dropdown entry stops
// nobody from calling `functions.invoke` directly.
//
// Since 2026-09-16 the gate is tiered rather than superadmin-only, to match
// the RLS on `user_roles` (migration 20260916080513):
//   superadmin  -> any invitable role, for anyone;
//   admin       -> staff or host only, and never onto an account that already
//                  holds admin or superadmin (a "protected user");
//   anyone else -> 403.
//
// The privileged work runs as service_role, which bypasses RLS on `user_roles`.
// That is deliberate and safe *only* because this handler applies the same rule
// the RLS policies apply, before the write, from `_shared/role_management.ts`.
// `user_roles` is the privilege-escalation table; the target check after the
// lookup is what stops an admin from using "invite" as a side door onto a
// superadmin's account.
//
// Email delivery is Supabase's own `inviteUserByEmail`. That is not the
// unbranded path it would have been a month ago: the Send Email Hook
// (`send-auth-email`) intercepts every auth email and renders it through the
// Kenworthy templates in `_shared/auth-email.ts`, which already carry copy for
// the `invite` action. So the simple call gets the branded email for free.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { EMAIL_RE, findUserIdByEmail } from '../_shared/buyers.ts';
import { SITE_URL } from '../_shared/brand.ts';
import { logAudit } from '../_shared/audit.ts';
import {
  type CallerTier,
  INVITABLE_ROLES,
  type InvitableRole,
  inviteRefusal,
  isInvitableRole,
} from '../_shared/role_management.ts';

// Deno globals
declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

    // --- Authorise: which tier is calling? ---------------------------------
    // has_role is hierarchical, so a superadmin answers true to 'admin' as
    // well; ask for the higher tier first and let it win.
    const [{ data: isSuper }, { data: isAdmin }] = await Promise.all([
      userClient.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
      userClient.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
    ]);
    const tier: CallerTier = isSuper ? 'superadmin' : isAdmin ? 'admin' : null;
    if (!tier) return json({ error: 'Admin access required' }, 403);

    // --- Validate the request ----------------------------------------------
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email) return json({ error: 'An email address is required' }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: 'That is not a valid email address' }, 400);

    const requested = String(body.role ?? 'staff').trim();
    if (!isInvitableRole(requested)) {
      return json({ error: `Role must be one of: ${INVITABLE_ROLES.join(', ')}` }, 400);
    }
    const role: InvitableRole = requested;

    // The role check needs no target, so refuse a bad one before any lookup.
    const early = inviteRefusal(tier, role, null);
    if (early) return json({ error: early.error }, early.status);

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

    if (userId) {
      // An existing account may be a protected one. This is the check RLS
      // would have made for a client-side grant; service_role has to make it
      // itself. Read with the service client — the caller's own SELECT policy
      // already lets admins see every role, but the boundary must not depend
      // on that staying true.
      const { data: held, error: heldError } = await admin
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      if (heldError) {
        console.error('[invite-staff] target role lookup failed:', heldError.message);
        return json({ error: 'Could not check that account' }, 500);
      }
      const refusal = inviteRefusal(tier, role, (held ?? []).map((r: { role: string }) => r.role));
      if (refusal) return json({ error: refusal.error }, refusal.status);
    }

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
    console.log(`[invite-staff] ${created ? 'created' : 'reused'} user, granted ${role} (by ${tier})`);

    // The audit trigger on user_roles saw a service_role write with no
    // auth.uid(), so it recorded nobody. This row is the one that names the
    // admin who did it, alongside their grants and revokes from the page.
    await logAudit({
      action: 'user_roles.invite',
      entityType: 'user_roles',
      entityId: userId,
      details: { role, created, invited_email: email, caller_tier: tier },
      actorId: user.id,
      actorEmail: user.email ?? null,
    });

    return json({ ok: true, created, userId, email, role });
  } catch (e) {
    // Generic on the wire, specific in the logs.
    console.error('[invite-staff] unhandled:', e instanceof Error ? e.message : String(e));
    return json({ error: 'Something went wrong sending that invitation' }, 500);
  }
});
