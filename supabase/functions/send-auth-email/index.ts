// Supabase Send Email Hook -> Resend.
//
// With this hook enabled, Supabase stops sending auth email itself and calls
// this function instead, handing over the user and a token. We render the
// email and send it over Resend's HTTP API. That covers password resets,
// signup confirmations, magic links and email changes, so no SMTP is
// configured anywhere and Supabase's rate-limited built-in mailer is never
// used.
//
// Requires:
//   verify_jwt = false        (Supabase calls this without a JWT; see below)
//   SEND_EMAIL_HOOK_SECRET    the `v1,whsec_...` secret from Auth -> Hooks
//   RESEND_API_KEY
//
// verify_jwt is off because the caller is Supabase's auth service, which
// authenticates with a Standard Webhooks signature rather than a bearer token.
// That signature is the only thing standing between this endpoint and an open
// password-reset relay, so an unverified request is refused before anything
// else happens.

import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2/cors';
import { verifyStandardWebhook } from '../_shared/webhook.ts';
import { buildAuthEmailHtml, buildAuthEmailText, buildVerifyUrl, copyFor } from '../_shared/auth-email.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const FROM_EMAIL = Deno.env.get('TICKET_FROM_EMAIL') || 'Kenworthy <tickets@kenworthy.org>';
const REPLY_TO = Deno.env.get('TICKET_REPLY_TO') || 'events@kenworthy.org';

/**
 * The hook expects this shape on failure; anything else and Supabase reports a
 * generic error to the user with no detail in the logs.
 */
function hookError(message: string, httpCode = 500) {
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: httpCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Fail closed. An unset secret must never mean "skip verification".
  if (!HOOK_SECRET) {
    console.error('[send-auth-email] SEND_EMAIL_HOOK_SECRET is not set — refusing');
    return hookError('Email hook is not configured', 500);
  }

  const raw = await req.text();

  const verdict = await verifyStandardWebhook(
    raw,
    {
      id: req.headers.get('webhook-id'),
      timestamp: req.headers.get('webhook-timestamp'),
      signature: req.headers.get('webhook-signature'),
    },
    HOOK_SECRET,
  );
  if (!verdict.ok) {
    console.error('[send-auth-email] rejected unverified request:', verdict.reason);
    return hookError('Invalid webhook signature', 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return hookError('Malformed hook payload', 400);
  }

  const email: string = payload?.user?.email ?? '';
  const data = payload?.email_data ?? {};
  const action: string = data.email_action_type ?? 'magiclink';

  if (!email) {
    console.error('[send-auth-email] payload had no user email');
    return hookError('No recipient address in hook payload', 400);
  }

  // An email change sends two messages — one to the old address, one to the
  // new — and the second uses the *_new token pair.
  const useNewToken = action === 'email_change_new';
  const tokenHash: string = (useNewToken ? data.token_hash_new : data.token_hash) ?? data.token_hash ?? '';
  const token: string = (useNewToken ? data.token_new : data.token) ?? data.token ?? '';

  const verifyUrl = buildVerifyUrl(SUPABASE_URL, tokenHash, action, data.redirect_to ?? '');
  const subject = copyFor(action).subject;

  if (!RESEND_API_KEY) {
    console.error('[send-auth-email] RESEND_API_KEY is not set');
    return hookError('Email provider is not configured', 500);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      reply_to: REPLY_TO,
      subject,
      html: buildAuthEmailHtml({ action, verifyUrl, token }),
      text: buildAuthEmailText({ action, verifyUrl, token }),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[send-auth-email] Resend ${res.status}: ${detail.slice(0, 400)}`);
    // Surfacing this to Supabase makes the failure visible to the user instead
    // of silently pretending the email went out.
    return hookError(`Email provider rejected the send (${res.status})`, 502);
  }

  console.log(`[send-auth-email] sent ${action} to ${email.replace(/(.).*(@.*)/, '$1***$2')}`);
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
