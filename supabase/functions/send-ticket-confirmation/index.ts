// Transactional ticket delivery.
//
// This is the step that was missing entirely: tickets were created and stored
// correctly, but nothing ever handed them to the customer. Mailchimp was being
// called at checkout, but that is marketing list management — it does not
// deliver a ticket.
//
// One entry point, branching on how the customer identified themselves:
//   has an email  -> transactional email with an embedded, scannable QR per
//                    ticket, plus a link to set a password on the account that
//                    guest checkout silently created for them
//   phone only    -> SMS with the essentials and a link to the mobile ticket
//                    page, because an SMS cannot carry a scannable QR
//
// Email wins when a customer supplied both: it carries the QR inline, so it
// works at the door even with no signal in the lobby.
//
// Callers invoke this fire-and-forget so delivery can never fail a purchase.
// That makes silent failure the real risk, so every outcome is written back to
// the ticket rows (confirmation_sent_at / confirmation_error) instead of only
// being logged.

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { loadOrder, ticketPageUrl, ticketQrUrl } from '../_shared/tickets.ts';
import {
  toE164,
  buildSubject,
  buildEmailHtml,
  buildEmailText,
  buildSmsBody,
} from '../_shared/notify.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const TICKET_FROM_EMAIL =
  Deno.env.get('TICKET_FROM_EMAIL') || 'The Kenworthy <tickets@kenworthy.org>';
const TICKET_REPLY_TO = Deno.env.get('TICKET_REPLY_TO') || 'events@kenworthy.org';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER') || '';
const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') || '';

const SITE_URL =
  Deno.env.get('SITE_URL') || 'https://kenworthy-ticketing-build.mrtomfrank.workers.dev';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

type SendResult = { ok: true } | { ok: false; error: string };

async function sendViaResend(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: TICKET_FROM_EMAIL,
      to: [to],
      reply_to: TICKET_REPLY_TO,
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 400)}` };
  }
  return { ok: true };
}

async function sendViaTwilio(to: string, body: string): Promise<SendResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { ok: false, error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured' };
  }
  if (!TWILIO_FROM_NUMBER && !TWILIO_MESSAGING_SERVICE_SID) {
    return { ok: false, error: 'TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID must be set' };
  }

  const form = new URLSearchParams({ To: to, Body: body });
  // A messaging service handles number pooling and compliance; prefer it when
  // configured, fall back to a single sending number.
  if (TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', TWILIO_FROM_NUMBER);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Twilio ${res.status}: ${detail.slice(0, 400)}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let orderToken = '';

  /** Record the delivery outcome on every ticket in the order. */
  const record = async (fields: Record<string, unknown>) => {
    if (!orderToken) return;
    const { error } = await admin.from('tickets').update(fields).eq('order_token', orderToken);
    if (error) console.error('[send-ticket-confirmation] failed to record outcome', error);
  };

  try {
    const body = await req.json().catch(() => ({}));
    orderToken = String(body.order_token || '').trim();
    const force = body.force === true;

    if (!orderToken) return json({ error: 'order_token is required' }, 400);

    const order = await loadOrder(admin, orderToken);
    if (!order) return json({ error: 'Order not found' }, 404);

    // Guards against a retry or a double-invoke texting someone twice.
    if (order.confirmation_sent_at && !force) {
      return json({ delivered: false, reason: 'already_sent', sent_at: order.confirmation_sent_at });
    }

    // Resolve the recipient. Explicit overrides in the request win — that is
    // how a comp ticket reaches a recipient who is not the account holder —
    // otherwise fall back to the account the tickets belong to.
    let email = String(body.email || '').trim();
    let phone = String(body.phone || '').trim();
    let name = String(body.name || '').trim();

    if (!email || !phone || !name) {
      const { data: userData } = await admin.auth.admin.getUserById(order.user_id);
      const authUser = userData?.user;
      if (authUser) {
        email = email || authUser.email || '';
        phone = phone || authUser.phone || '';
        name = name || (authUser.user_metadata as any)?.display_name || '';
      }
      // Guest checkout writes the phone to profiles when auth does not take
      // it, so profiles is the authoritative fallback for every field.
      if (!email || !phone || !name) {
        const { data: profile } = await admin
          .from('profiles')
          .select('email, phone, display_name')
          .eq('id', order.user_id)
          .maybeSingle();
        email = email || profile?.email || '';
        phone = phone || profile?.phone || '';
        name = name || profile?.display_name || '';
      }
    }

    const ticketUrl = ticketPageUrl(SITE_URL, orderToken);

    // ---- Email path -------------------------------------------------------
    if (email) {
      // A recovery link doubles as "set your password" for the account guest
      // checkout created silently. Generating it here (rather than calling
      // resetPasswordForEmail) means we deliver it ourselves through Resend,
      // so it does not depend on Supabase SMTP being configured yet.
      let passwordUrl: string | null = null;
      try {
        const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${SITE_URL.replace(/\/$/, '')}/reset-password` },
        });
        if (linkError) console.warn('[send-ticket-confirmation] recovery link failed', linkError);
        passwordUrl = linkData?.properties?.action_link ?? null;
      } catch (e) {
        // Never let the account-access extra block the ticket itself.
        console.warn('[send-ticket-confirmation] recovery link threw', e);
      }

      const subject = buildSubject(order);
      const html = buildEmailHtml(order, {
        ticketUrl,
        qrUrlFor: (ticketId) => ticketQrUrl(SUPABASE_URL, orderToken, ticketId),
        passwordUrl,
        name,
      });
      const text = buildEmailText(order, { ticketUrl, passwordUrl, name });

      const result = await sendViaResend(email, subject, html, text);
      if (!result.ok) {
        console.error('[send-ticket-confirmation] email send failed', result.error);
        await record({ confirmation_error: result.error });
        return json({ delivered: false, channel: 'email', error: result.error }, 502);
      }

      await record({
        confirmation_sent_at: new Date().toISOString(),
        confirmation_channel: 'email',
        confirmation_error: null,
      });
      return json({ delivered: true, channel: 'email' });
    }

    // ---- SMS path ---------------------------------------------------------
    if (phone) {
      const e164 = toE164(phone);
      if (!e164) {
        const error = `Phone number is not in a sendable format: ${phone}`;
        console.error('[send-ticket-confirmation]', error);
        await record({ confirmation_error: error });
        return json({ delivered: false, channel: 'sms', error }, 400);
      }

      const result = await sendViaTwilio(e164, buildSmsBody(order, ticketUrl));
      if (!result.ok) {
        console.error('[send-ticket-confirmation] sms send failed', result.error);
        await record({ confirmation_error: result.error });
        return json({ delivered: false, channel: 'sms', error: result.error }, 502);
      }

      await record({
        confirmation_sent_at: new Date().toISOString(),
        confirmation_channel: 'sms',
        confirmation_error: null,
      });
      return json({ delivered: true, channel: 'sms' });
    }

    const error = 'Order has no email or phone to deliver to';
    await record({ confirmation_error: error });
    return json({ delivered: false, error }, 400);
  } catch (err) {
    console.error('[send-ticket-confirmation] unexpected error', err);
    await record({ confirmation_error: `Unexpected error: ${String(err).slice(0, 300)}` });
    return json({ error: 'Internal server error' }, 500);
  }
});
