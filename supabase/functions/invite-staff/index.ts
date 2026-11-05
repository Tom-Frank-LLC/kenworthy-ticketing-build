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
// asks `requireRole` (`_shared/callers.ts`) who the caller is, which is also
// where an admin without their authenticator code is stopped. The client route
// guards on /superadmin and the admin dashboard are not a boundary — hiding a dropdown entry stops
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
// Host invites (BRIEF-host-magic-link-view). With role 'host' and a
// `host_assignment`, this onboards a one-off renter in one step: the account
// (created with no password and no invitation email), the host role, the
// assignment to their production, and optionally their first sign-in email.
// They never set a password: they sign in at /host/login by emailed link or
// code, and that session can read their production's sales and change nothing
// (migration 20261105025356). Without `host_assignment` a host invite is the
// password invite it always was.
//
// Email delivery is Supabase's own `inviteUserByEmail`. That is not the
// unbranded path it would have been a month ago: the Send Email Hook
// (`send-auth-email`) intercepts every auth email and renders it through the
// Kenworthy templates in `_shared/auth-email.ts`, which already carry copy for
// the `invite` action. So the simple call gets the branded email for free.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { EMAIL_RE, findUserIdByEmail } from '../_shared/buyers.ts';
import { SITE_URL } from '../_shared/brand.ts';
import { logAudit } from '../_shared/audit.ts';
import { requireRole, roleGate } from '../_shared/callers.ts';
import { inviteTargetMatches } from './target.ts';
import { type HostAssignment, parseHostAssignment } from './host_assignment.ts';
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

const PRIVILEGED = ['staff', 'admin', 'superadmin'];

/**
 * The rest of a host invite, once the account exists and holds `host`: the
 * assignment, the first sign-in email, and the audit row naming the admin.
 */
async function finishHostInvite(o: {
  admin: any;
  userId: string;
  email: string;
  tier: CallerTier;
  created: boolean;
  heldRoles: string[];
  hostAssignment: HostAssignment;
  sendSignInLink: boolean;
  actor: { id: string; email: string | null };
}): Promise<Response> {
  const { admin, userId, email, hostAssignment: ha } = o;

  // No unique constraint on host_event_assignments, so look before inserting:
  // re-inviting a host must not give them the same production twice.
  const { data: existing, error: existingError } = await admin
    .from('host_event_assignments')
    .select('id')
    .eq('user_id', userId)
    .eq(ha.column, ha.id)
    .limit(1);
  if (existingError) {
    console.error('[invite-staff] assignment lookup failed:', existingError.message);
    return json({ error: 'The host role was granted, but the production could not be assigned — assign it from the list below' }, 500);
  }
  let assignmentCreated = false;
  if (!existing?.length) {
    const { data: inserted, error: assignError } = await admin
      .from('host_event_assignments')
      .insert({ user_id: userId, [ha.column]: ha.id })
      .select('id');
    if (assignError || !inserted?.length) {
      console.error('[invite-staff] assignment insert failed:', assignError?.message ?? 'no row');
      return json({ error: 'The host role was granted, but the production could not be assigned — assign it from the list below' }, 500);
    }
    assignmentCreated = true;
  }

  // A privileged account's emailed-link session is aal1, which the database
  // gives nothing: they use the staff sign-in, password and code, as before.
  const privileged = o.heldRoles.some(r => PRIVILEGED.includes(r));
  const siteBase = SITE_URL.replace(/\/$/, '');
  let linkSent = false;
  let linkError: string | null = null;
  if (o.sendSignInLink && !privileged) {
    // Through GoTrue's ordinary /otp, so the Send Email Hook renders it (link
    // and code) and Supabase's own rate limit applies. The account holds `host`
    // by now, which is what the hook checks before delivering.
    const { error } = await admin.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${siteBase}/host` },
    });
    if (error) {
      console.error('[invite-staff] sign-in email failed:', error.message);
      linkError = /seconds|rate/i.test(error.message)
        ? 'A sign-in email went to this address moments ago; wait a minute before sending another.'
        : 'The sign-in email could not be sent. They can request one at the host sign-in page.';
    } else {
      linkSent = true;
    }
  }

  await logAudit({
    action: 'host.invite',
    entityType: 'host_event_assignments',
    entityId: userId,
    details: {
      created: o.created,
      reused_existing_account: !o.created,
      production_table: ha.table,
      production_id: ha.id,
      assignment_created: assignmentCreated,
      sign_in_email_sent: linkSent,
      invited_email: email,
      caller_tier: o.tier,
    },
    actorId: o.actor.id,
    actorEmail: o.actor.email,
  });

  return json({
    ok: true,
    created: o.created,
    reused_existing_account: !o.created,
    assignment_created: assignmentCreated,
    sign_in_link_sent: linkSent,
    sign_in_url: `${siteBase}/host/login`,
    ...(privileged ? {
      notice: 'This account already holds a staff role, so it signs in with the staff sign-in ' +
        '(password and authenticator code), not an emailed link. No sign-in email was sent.',
    } : {}),
    ...(linkError ? { notice: linkError } : {}),
    userId,
    email,
    role: 'host',
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // The service client also asks the role gate, which only service_role may
    // call.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // --- Authenticate and authorise: which tier is calling? -----------------
    // Admin is the floor. The gate is hierarchical, so a superadmin passes it
    // too, and the second question tells the two apart. It is a plain role test
    // by then: the MFA check already ran in the first.
    const user = await requireRole(req, admin, 'admin', {
      headers: corsHeaders,
      forbidden: 'Admin access required',
    });
    if (user instanceof Response) return user;

    const superGate = await roleGate(admin, user, 'superadmin');
    // A failed lookup is not a demotion to admin: refuse, retryably.
    if (superGate === null) return json({ error: 'Could not check your access. Please try again.' }, 503);
    const tier: CallerTier = superGate === 'ok' ? 'superadmin' : 'admin';

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

    // --- A host invite: which production, checked before any account exists --
    const hostAssignment = parseHostAssignment(body.host_assignment);
    if (hostAssignment === 'invalid') {
      return json({ error: 'host_assignment must name an event, live performance or movie by id' }, 400);
    }
    if (hostAssignment && role !== 'host') {
      return json({ error: 'host_assignment only goes with the host role' }, 400);
    }
    const sendSignInLink = hostAssignment ? body.send_sign_in_link !== false : false;
    if (hostAssignment) {
      const { data: prod, error: prodError } = await admin
        .from(hostAssignment.table)
        .select('id, title')
        .eq('id', hostAssignment.id)
        .maybeSingle();
      if (prodError) {
        console.error('[invite-staff] production lookup failed:', prodError.message);
        return json({ error: 'Could not check that production' }, 500);
      }
      if (!prod) return json({ error: 'That production does not exist' }, 404);
    }

    // --- Privileged work ----------------------------------------------------
    // Reuse rather than duplicate. Someone who once bought a ticket already has
    // an account (checkout made one silently); inviting them must grant the role
    // to *that* account, not fail and not fork their history into a second one.
    let userId = await findUserIdByEmail(admin, email);
    let created = false;
    let heldRoles: string[] = [];

    if (userId) {
      // The resolved account must be the address that was invited, as auth
      // knows it. findUserIdByEmail reads auth.users now, but this grant is
      // where a wrong answer becomes an admin, so it is checked again at the
      // point of use rather than trusted from the lookup (security audit H1:
      // the lookup used to read profiles.email, which its owner could rewrite
      // to an address an admin was about to invite).
      const { data: found, error: foundError } = await admin.auth.admin.getUserById(userId);
      if (!inviteTargetMatches(email, found, foundError)) {
        console.error('[invite-staff] resolved account does not carry the invited address; refusing');
        return json({ error: 'That address could not be matched to a single account. Nothing was granted.' }, 409);
      }

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
      heldRoles = (held ?? []).map((r: { role: string }) => r.role);
      const refusal = inviteRefusal(tier, role, heldRoles);
      if (refusal) return json({ error: refusal.error }, refusal.status);
    }

    if (!userId && hostAssignment) {
      // No password and no invitation email: the renter's way in is the sign-in
      // email below, or /host/login. Confirmed, because an admin typed the
      // address for this person; the first sign-in still proves the inbox.
      const { data: made, error: makeError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: displayName ? { display_name: displayName } : undefined,
      });
      if (makeError || !made?.user) {
        const message = makeError?.message ?? 'unknown error';
        if (/already.*regist|already.*exist/i.test(message)) {
          console.warn('[invite-staff] createUser reported an existing user the lookups missed');
          return json({ error: 'That account already exists but could not be located' }, 409);
        }
        console.error('[invite-staff] createUser failed:', message);
        return json({ error: 'Could not create the account' }, 502);
      }
      userId = made.user.id;
      created = true;
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

    if (hostAssignment) {
      return await finishHostInvite({
        admin, userId, email, tier, created, heldRoles, hostAssignment, sendSignInLink,
        actor: { id: user.id, email: user.email ?? null },
      });
    }

    // The audit trigger on user_roles saw a service_role write with no
    // auth.uid(), so it recorded nobody. This row is the one that names the
    // admin who did it, alongside their grants and revokes from the page.
    await logAudit({
      action: 'user_roles.invite',
      entityType: 'user_roles',
      entityId: userId,
      details: { role, created, reused_existing_account: !created, invited_email: email, caller_tier: tier },
      actorId: user.id,
      actorEmail: user.email ?? null,
    });

    // Reuse is said out loud. A reused account gets no invitation email (it
    // already exists), so the person has to take "Forgot password?" on /auth to
    // set a password -- which works now that they hold a role.
    return json({
      ok: true,
      created,
      reused_existing_account: !created,
      ...(created ? {} : {
        notice: 'This address already had an account (usually from a ticket purchase). ' +
          'The role was added to it and no invitation email was sent: they should use ' +
          '"Forgot password?" on the staff sign-in page to set a password.',
      }),
      userId,
      email,
      role,
    });
  } catch (e) {
    // Generic on the wire, specific in the logs.
    console.error('[invite-staff] unhandled:', e instanceof Error ? e.message : String(e));
    return json({ error: 'Something went wrong sending that invitation' }, 500);
  }
});
