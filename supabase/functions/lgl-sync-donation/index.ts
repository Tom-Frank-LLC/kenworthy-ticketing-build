// Little Green Light donation sync — HTTP wrapper.
//
// The sync itself lives in _shared/lgl.ts and is called in-process by
// square-donation and ticket-checkout, because a cross-function POST is how
// this integration silently did nothing for its whole life (see the note there).
// This endpoint remains for the one caller that genuinely is over HTTP: the
// admin dashboard's "sync now" / backfill buttons in LglTab.
//
// It also resends the donation emails on request, so an operator has one place
// to recover a gift whose receipt bounced.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';
import { donorEmailEditError, syncDonationToLgl } from '../_shared/lgl.ts';
import { deliverDonationEmails } from '../_shared/donations.ts';
import { logAudit } from '../_shared/audit.ts';

// Deno globals
declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const donationId: string | undefined = body?.donationId;
  const force: boolean = !!body?.force;
  if (!donationId) return json({ error: 'donationId required' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Admin-only. The function is deployed with verify_jwt, so a caller is
  // authenticated, but authenticated is not the same as allowed to write to the
  // theatre's donor database.
  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Sign in required' }, 401);
  const { data: isAdmin } = await admin.rpc('has_role', { _user_id: user.id, _role: 'admin' });
  if (!isAdmin) return json({ error: 'Admin only' }, 403);

  // Every branch below reaches a system outside this database — LGL has no
  // sandbox and shares one API key with production, so a sync writes a real
  // donor record that nothing here can reverse. That makes "who pushed this
  // gift, when" worth a log line of its own: the donations row diff the trigger
  // records shows what changed locally, not that we touched LGL at all.

  // Add or correct the donor's email on a gift that could not be synced.
  //
  // The only write in this function that touches the donations row itself, and
  // it exists because an emailless gift is otherwise stuck for good: LGL keys
  // constituents on an address, so syncDonationToLgl declines the gift on every
  // attempt, correctly. The online forms no longer produce one — a donation now
  // requires an email at checkout — but the gifts taken before that fix, and any
  // address typed wrong, still need a way back.
  //
  // Routed through here rather than a client-side table update so the change is
  // attributable: the row trigger records that donor_email changed, this records
  // which admin changed it and from what.
  if (body?.action === 'set_donor_email') {
    const email = String(body?.email ?? '');

    const { data: donation } = await admin
      .from('donations')
      .select('id, donor_email, lgl_gift_id')
      .eq('id', donationId)
      .maybeSingle();
    if (!donation) return json({ error: 'Donation not found' }, 404);

    const ruleError = donorEmailEditError(donation, email);
    if (ruleError) return json({ error: ruleError }, 400);

    const trimmed = email.trim();
    const { data: updated, error: updErr } = await admin
      .from('donations')
      .update({
        donor_email: trimmed,
        // The cached constituent, if there is one, was resolved from the old
        // address — or created from a typo of it. Clearing it makes the next
        // sync search LGL by the address we now have, so a corrected email
        // matches the donor's real record instead of the one the typo made.
        lgl_constituent_id: null,
        // The row currently reads "No donor email — recorded locally". Leaving
        // that in place would have the tab still showing the reason for a
        // failure that has just been fixed.
        lgl_sync_error: null,
      })
      .eq('id', donationId)
      // Re-checks the rule as a condition of the write, so two admins racing
      // cannot slip an edit past a sync that landed in between.
      .is('lgl_gift_id', null)
      .select('id, donor_email');
    // .select() and a row count because an RLS denial comes back as 204 with no
    // error. A blocked write would otherwise report success here and the
    // operator would press Sync on a gift that still has no address.
    if (updErr || updated?.length !== 1) {
      return json({ error: updErr?.message || 'Could not save that email address' }, 500);
    }

    await logAudit({
      action: 'donations.set_donor_email',
      entityType: 'donations',
      entityId: donationId,
      actorId: user.id,
      actorEmail: user.email ?? null,
      details: { from: donation.donor_email ?? null, to: trimmed },
    });
    return json({ ok: true, donor_email: trimmed });
  }

  // Resend the receipt / tribute notice for a gift whose email failed.
  if (body?.action === 'resend_emails') {
    const emails = await deliverDonationEmails(admin, donationId, { force: true });
    await logAudit({
      action: 'donations.resend_emails',
      entityType: 'donations',
      entityId: donationId,
      actorId: user.id,
      actorEmail: user.email ?? null,
      details: { ok: emails.errors.length === 0, errors: emails.errors },
    });
    return json({ ok: emails.errors.length === 0, emails });
  }

  const result = await syncDonationToLgl(admin, donationId, { force });
  await logAudit({
    action: result.ok ? 'donations.lgl_sync' : 'donations.lgl_sync.failed',
    entityType: 'donations',
    entityId: donationId,
    actorId: user.id,
    actorEmail: user.email ?? null,
    details: result.ok
      ? { forced: force }
      : { forced: force, error: result.error, status: result.status },
  });
  if (!result.ok) {
    return json({ error: result.error, detail: (result as any).detail }, result.status);
  }
  return json(result);
});
