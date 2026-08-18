// HTTP entry point for resending a ticket confirmation.
//
// The sending itself lives in _shared/deliver.ts, which guest-checkout calls
// in-process. This function exists so an operator (or the authenticated
// checkout path in the browser) can trigger a send over HTTP. It is a thin
// authorization wrapper and nothing more.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2/cors';
import { loadOrder } from '../_shared/tickets.ts';
import { deliverConfirmation } from '../_shared/deliver.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/**
 * Read the payload of an already-verified JWT.
 *
 * No signature check here on purpose — the edge gateway performs it before the
 * function is invoked (verify_jwt = true). Never call this on a token that has
 * not been through the gateway.
 */
function decodeJwtPayload(token: string): { role?: string; sub?: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    // Two legitimate callers, with different privileges:
    //
    //   service role   -- an operator resending. Fully trusted, and the only
    //                     caller allowed to redirect delivery to a different
    //                     address via the email/phone overrides.
    //   signed-in user -- the authenticated checkout path in Showing.tsx.
    //                     Allowed only for their own order, overrides ignored.
    //
    // The anon key is not enough: anyone holding it plus an order_token could
    // otherwise trigger a resend and redirect the ticket to an address of
    // their choosing.
    //
    // Identity comes from the token's role claim, not from string-comparing
    // the bearer against SUPABASE_SERVICE_ROLE_KEY — the gateway does not
    // reliably hand the function back the value the caller sent. The literal
    // comparison is kept as a second accepted path for when it does.
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const apiKeyHeader = (req.headers.get('apikey') ?? '').trim();

    const claims = decodeJwtPayload(bearer);
    const isServiceRole =
      claims?.role === 'service_role' ||
      (bearer.length > 0 && bearer === SERVICE_ROLE_KEY) ||
      (apiKeyHeader.length > 0 && apiKeyHeader === SERVICE_ROLE_KEY);

    let callerId: string | null = null;
    if (!isServiceRole) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: caller } = await userClient.auth.getUser();
      callerId = caller?.user?.id ?? null;
      if (!callerId) return json({ error: 'Not authorised' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const orderToken = String(body.order_token || '').trim();
    if (!orderToken) return json({ error: 'order_token is required' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (!isServiceRole) {
      // Same 404 as an unknown token: a signed-in user probing for other
      // people's orders learns nothing about whether the token exists.
      const order = await loadOrder(admin, orderToken);
      if (!order || order.user_id !== callerId) return json({ error: 'Order not found' }, 404);
    }

    const result = await deliverConfirmation(admin, orderToken, {
      // Overrides are honoured only for the service role.
      email: isServiceRole ? String(body.email || '') : '',
      phone: isServiceRole ? String(body.phone || '') : '',
      name: isServiceRole ? String(body.name || '') : '',
      accountCreated: body.account_created === true,
      force: body.force === true,
    });

    switch (result.status) {
      case 'delivered':
        // `partial_error` is present when one channel got through and the
        // other did not. The order is delivered either way — an operator
        // resending should not be told it failed — but the reason the text or
        // the email did not go is the whole point of asking from here.
        return json({
          delivered: true,
          channel: result.channel,
          ...(result.partialError ? { partial_error: result.partialError } : {}),
        });
      case 'skipped':
        return json({ delivered: false, reason: result.reason, sent_at: result.sentAt });
      case 'not_found':
        return json({ error: 'Order not found' }, 404);
      case 'failed':
        return json(
          { delivered: false, channel: result.channel, error: result.error },
          result.httpStatus,
        );
    }
  } catch (err) {
    console.error('[send-ticket-confirmation] unexpected error', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
