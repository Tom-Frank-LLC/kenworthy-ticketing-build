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
import { syncDonationToLgl } from '../_shared/lgl.ts';
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
