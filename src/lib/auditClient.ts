// Activity-log writes from the browser.
//
// Almost everything in admin_audit_log is written by the log_audit_event()
// trigger, which sees row changes. A sign-in is not a row change anywhere, so
// it has to be recorded deliberately, and the browser is the only place that
// knows one happened.
//
// Two paths, because a failed sign-in has no session:
//
//   signed in  -> insert directly. The INSERT policy on admin_audit_log
//                 (20260617072515) requires actor_id = auth.uid() AND a staff
//                 or admin role, so this cannot be used to write an entry
//                 about anybody else.
//   failed     -> log_failed_staff_login(), a SECURITY DEFINER function, since
//                 there is no session for RLS to check. It records nothing
//                 unless the address belongs to a real staff account, so it
//                 cannot be used to inject arbitrary text into the log either.
//
// Members and ticket buyers are not logged at all. This is an operations log
// about who ran the theatre's systems, not a record of who watched a film.

import { supabase } from '@/integrations/supabase/client';

/**
 * Record a staff or admin sign-in / sign-out.
 *
 * Called only after roles are known — a login is worth a line when the account
 * can change something, and the role check is what decides that. Failures are
 * swallowed: a missing log line must never be the reason someone cannot get
 * into the admin screens during a show.
 */
export async function logAuthEvent(
  action: 'auth.login' | 'auth.logout',
  user: { id: string; email?: string | null },
): Promise<void> {
  try {
    const { error } = await (supabase as any).from('admin_audit_log').insert({
      actor_id: user.id,
      actor_email: user.email ?? null,
      action,
      entity_type: 'auth',
      entity_id: user.id,
      details: {},
    });
    if (error) console.error(`[audit] ${action} not recorded`, error);
  } catch (e) {
    console.error(`[audit] ${action} not recorded`, e);
  }
}

/**
 * Record a failed sign-in, but only for addresses that belong to staff.
 *
 * Fired on every rejected password attempt. The function on the other side
 * decides whether it is worth recording; the browser deliberately does not
 * know, because telling it would mean telling an anonymous caller which
 * addresses are staff accounts.
 */
export async function logFailedLogin(email: string): Promise<void> {
  try {
    await (supabase as any).rpc('log_failed_staff_login', { p_email: email });
  } catch (e) {
    console.error('[audit] failed-login not recorded', e);
  }
}
