// Recovery for two-step sign-in: the superadmin's view of who has an
// authenticator, and the reset for someone who lost theirs
// (security audit 2026-10-06, M9; docs/briefs/BRIEF-admin-mfa.md,
// docs/RUNBOOK-admin-mfa.md).
//
//   { action: 'status' }                 every staff, host, admin and superadmin
//                                        account with its count of verified factors
//   { action: 'reset', user_id: uuid }   remove every factor that account has; it
//                                        sets up a new app at its next sign-in
//
// Superadmin only, and the reset needs an aal2 session even while the switch is
// off. Removing someone's second factor is the one action here that weakens an
// account, so a password alone must never be enough to do it, whatever the
// switch says. The superadmin enrolls first.
//
// Not for the superadmin's own account. Their own factors are managed on
// /account/security. If the only superadmin is locked out, the break-glass is
// the Supabase dashboard (Authentication → Users → MFA factors). See the runbook.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders, json, preflight } from '../_shared/http.ts';
import { mfaRequiredResponse, requireRole } from '../_shared/callers.ts';
import { logAudit } from '../_shared/audit.ts';

// Deno globals
declare const Deno: any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LISTED_ROLES = ['staff', 'host', 'admin', 'superadmin'];

function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = serviceClient();
  const caller = await requireRole(req, admin, 'superadmin', {
    headers: corsHeaders,
    forbidden: 'Superadmin access required',
  });
  if (caller instanceof Response) return caller;

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'status') {
    const { data: roleRows, error } = await admin
      .from('user_roles')
      .select('user_id, role')
      .in('role', LISTED_ROLES);
    if (error) return json({ error: 'Could not load accounts' }, 500);

    const roles = new Map<string, string[]>();
    for (const r of roleRows ?? []) {
      roles.set(r.user_id, [...(roles.get(r.user_id) ?? []), r.role]);
    }
    // One lookup per role holder: a few dozen accounts, and the admin API's
    // user record carries its factors. Paging every user (checkout creates
    // one per buyer) to find them would read thousands.
    const accounts = await Promise.all(
      [...roles.entries()].map(async ([userId, userRoles]) => {
        const { data } = await admin.auth.admin.getUserById(userId);
        const factors = (data?.user?.factors ?? []) as Array<{ status: string; factor_type: string }>;
        const verified = factors.filter(f => f.status === 'verified');
        return {
          user_id: userId,
          email: data?.user?.email ?? null,
          roles: userRoles,
          verified_factors: verified.length,
          factor_types: [...new Set(verified.map(f => f.factor_type))],
          // Whether this user could be looked up at all. A false here is a
          // gap in the report, not "no factors".
          known: Boolean(data?.user),
        };
      }),
    );
    const { data: sw } = await admin
      .from('app_config')
      .select('value')
      .eq('key', 'mfa_required_for_admins')
      .maybeSingle();
    return json({ required: sw?.value?.enabled === true, accounts });
  }

  if (action === 'reset') {
    // Even with the switch off: see the header.
    if (caller.aal !== 'aal2') return mfaRequiredResponse(corsHeaders);

    const userId = String(body?.user_id ?? '');
    if (!UUID.test(userId)) return json({ error: 'user_id is required' }, 400);
    if (userId === caller.id) {
      return json({ error: 'Manage your own sign-in methods on the Sign-in security page.' }, 400);
    }

    const { data: target, error: lookupErr } = await admin.auth.admin.getUserById(userId);
    if (lookupErr || !target?.user) return json({ error: 'No such account' }, 404);

    const { data: list, error: listErr } = await admin.auth.admin.mfa.listFactors({ userId });
    if (listErr) return json({ error: 'Could not read that account\'s sign-in methods' }, 502);

    const removed: Array<{ id: string; type: string; name: string | null }> = [];
    const failed: string[] = [];
    for (const f of list?.factors ?? []) {
      const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      if (delErr) failed.push(f.id);
      else removed.push({ id: f.id, type: f.factor_type, name: f.friendly_name ?? null });
    }

    await logAudit({
      action: 'auth.mfa_reset',
      entityType: 'auth',
      entityId: userId,
      actorId: caller.id,
      actorEmail: caller.email,
      details: { target_email: target.user.email ?? null, removed, failed },
    });

    if (failed.length > 0) {
      return json({ error: `Removed ${removed.length}, but ${failed.length} could not be removed. Try again.`, removed: removed.length }, 502);
    }
    return json({ removed: removed.length });
  }

  return json({ error: 'Unknown action' }, 400);
});
