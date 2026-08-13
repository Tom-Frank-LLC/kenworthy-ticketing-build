// Public ticket access — the endpoint behind emailed/texted ticket links.
//
// Two responses, one token check:
//   GET ?token=<order_token>              -> JSON describing the whole order
//   GET ?token=<order_token>&qr=<ticket>  -> image/png of that ticket's QR
//
// Both are unauthenticated by design: the recipient of a ticket email or SMS
// has no account session, and for a phone-only purchase may never have one.
// The order_token is the bearer credential. It is a random UUID that RLS never
// exposes to anon, so the only way to hold one is to have been sent it.
// Holding the link is equivalent to holding the ticket — the same property
// every emailed ticket has.
//
// Keeping the JSON and the PNG in one function is deliberate: the token check
// and the ticket lookup exist exactly once, so the page and the QR image can
// never disagree about who is allowed to see what.
//
// Requires verify_jwt = false (see supabase/config.toml).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2/cors';
import { loadOrder, renderQrPng, ticketPageUrl, type Order } from '../_shared/tickets.ts';
import { buildIcs } from '../_shared/calendar.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_URL =
  Deno.env.get('SITE_URL') || 'https://kenworthy-ticketing-build.mrtomfrank.workers.dev';

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
    const url = new URL(req.url);
    const token = (url.searchParams.get('token') || '').trim();
    const qrTicketId = (url.searchParams.get('qr') || '').trim();
    const wantsIcs = ['1', 'true', 'yes'].includes((url.searchParams.get('ics') || '').trim().toLowerCase());

    if (!token) return json({ error: 'Missing ticket token' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let order: Order | null;
    try {
      order = await loadOrder(admin, token);
    } catch {
      return json({ error: 'Internal server error' }, 500);
    }

    // Same 404 for an unknown token and a well-formed-but-wrong one.
    if (!order) return json({ error: 'Ticket not found' }, 404);

    if (wantsIcs) {
      // One calendar event for the whole order's showing. Bearer-safe: the
      // token already gated access above.
      const ticketUrl = ticketPageUrl(SITE_URL, token);
      const ics = buildIcs(order, ticketUrl, new Date().toISOString());
      return new Response(ics, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="kenworthy-ticket.ics"',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (qrTicketId) {
      // Scoped to this order: a valid token cannot render another order's QR.
      const ticket = order.tickets.find((t) => t.id === qrTicketId);
      if (!ticket) return json({ error: 'Ticket not found' }, 404);

      const png = await renderQrPng(ticket.qr_code);
      return new Response(png, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          // The QR payload never changes for a given ticket, so let Gmail's
          // image proxy and mobile browsers cache it hard.
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      });
    }

    // The page renders what the door sees, minus anything the holder does not
    // need: user_id and the send bookkeeping stay server-side.
    const { user_id: _u, confirmation_sent_at: _c, ...publicOrder } = order;
    return json({ order: publicOrder });
  } catch (err) {
    console.error('[ticket-access] unexpected error', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
