// Ticket delivery — the actual sending, callable in-process.
//
// This lives in _shared rather than inside send-ticket-confirmation because
// guest-checkout calls it directly. It used to POST to the sibling function
// over HTTP with the service-role key as a bearer, and that broke the moment
// Supabase rotated the injected keys to the new `sb_publishable_` /
// `sb_secret_` format: the gateway started rejecting the combination with
// "Conflicting API keys", the request never reached the function, and because
// the dispatch is fire-and-forget the failure was invisible — purchases
// succeeded and nothing was delivered, with not even an error recorded.
//
// Calling it in-process removes that whole class of failure. There is no
// gateway, no credential to forward, and no second cold start on the path that
// matters. send-ticket-confirmation remains as an HTTP endpoint so an operator
// can resend, but it is now a thin wrapper over this.
//
// One entry point, branching on how the customer identified themselves:
//   has an email  -> transactional email with an embedded, scannable QR per
//                    ticket, plus (when warranted) a link to set a password
//   phone only    -> SMS with the essentials and a link to the mobile ticket
//                    page, because an SMS cannot carry a scannable QR
//
// Email wins when a customer supplied both: it carries the QR inline, so it
// works at the door even with no signal in the lobby.
//
// Callers dispatch this fire-and-forget so delivery can never fail a purchase.
// That makes silent failure the real risk, so every outcome is written back to
// the ticket rows (confirmation_sent_at / confirmation_error).

import { loadOrder, ticketPageUrl, ticketQrUrl } from './tickets.ts';
import { ticketCalendarUrl, googleCalendarUrl } from './calendar.ts';
import { toE164, buildSubject, buildEmailHtml, buildEmailText, buildSmsBody } from './notify.ts';
import { memberAccountsEnabled } from './flags.ts';
import { SITE_URL } from './brand.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
// The inbox From line. Note this is only the *default* — if TICKET_FROM_EMAIL
// is set in the deployed environment, that value wins and has to be updated
// there too.
const TICKET_FROM_EMAIL =
  Deno.env.get('TICKET_FROM_EMAIL') || 'Kenworthy <tickets@kenworthy.org>';
const TICKET_REPLY_TO = Deno.env.get('TICKET_REPLY_TO') || 'events@kenworthy.org';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
// Twilio's preferred credential: scoped and revocable, so a leak does not
// expose the master account the way the auth token does.
const TWILIO_API_KEY_SID = Deno.env.get('TWILIO_API_KEY_SID') || '';
const TWILIO_API_KEY_SECRET = Deno.env.get('TWILIO_API_KEY_SECRET') || '';
const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER') || '';
const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') || '';

// SITE_URL is imported from brand.ts — the email logo needs the same origin as
// the patron links, and one default is one thing to go stale instead of two.

type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Send one transactional email through Resend.
 *
 * Exported because film-pass orders need exactly this and nothing else about
 * ticket delivery: the same sender identity, the same reply-to, the same
 * "missing key is a reported error, not a silent no-op". A second copy would be
 * a second place for the from-address to go stale.
 */
export async function sendTransactionalEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<SendResult> {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY is not configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
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

/**
 * Pick the Basic Auth pair for Twilio.
 *
 * An API key is username = key SID (SK…), password = key secret. The account
 * SID stays in the URL path either way — it identifies the account, it is not
 * the credential. Missing that distinction is the usual way an API key setup
 * fails, so account SID is required in both modes.
 *
 * Falls back to the account SID + auth token pair when no API key is set.
 */
export function twilioAuth(env: {
  accountSid: string;
  authToken: string;
  apiKeySid: string;
  apiKeySecret: string;
}): { ok: true; header: string; mode: 'api_key' | 'auth_token' } | { ok: false; error: string } {
  if (!env.accountSid) {
    return { ok: false, error: 'TWILIO_ACCOUNT_SID is not configured' };
  }
  if (env.apiKeySid) {
    if (!env.apiKeySecret) {
      return { ok: false, error: 'TWILIO_API_KEY_SID is set but TWILIO_API_KEY_SECRET is missing' };
    }
    return {
      ok: true,
      mode: 'api_key',
      header: `Basic ${btoa(`${env.apiKeySid}:${env.apiKeySecret}`)}`,
    };
  }
  if (!env.authToken) {
    return {
      ok: false,
      error: 'Configure TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (preferred), or TWILIO_AUTH_TOKEN',
    };
  }
  return {
    ok: true,
    mode: 'auth_token',
    header: `Basic ${btoa(`${env.accountSid}:${env.authToken}`)}`,
  };
}

async function sendViaTwilio(to: string, body: string): Promise<SendResult> {
  const auth = twilioAuth({
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    apiKeySid: TWILIO_API_KEY_SID,
    apiKeySecret: TWILIO_API_KEY_SECRET,
  });
  if (!auth.ok) return { ok: false, error: auth.error };

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
        Authorization: auth.header,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Twilio ${res.status} (${auth.mode}): ${detail.slice(0, 400)}` };
  }
  return { ok: true };
}

export interface DeliverOptions {
  /** Redirect delivery to another recipient. Trusted callers only. */
  email?: string;
  phone?: string;
  name?: string;
  /** True when this checkout is what created the account. */
  accountCreated?: boolean;
  /** Resend even if a confirmation already went out. */
  force?: boolean;
}

export type DeliverResult =
  | { status: 'delivered'; channel: 'email' | 'sms' }
  | { status: 'skipped'; reason: 'already_sent'; sentAt: string }
  | { status: 'not_found' }
  | { status: 'failed'; channel?: 'email' | 'sms'; error: string; httpStatus: number };

/**
 * Deliver an order's tickets and record the outcome on every row in it.
 *
 * `admin` must be a service-role client — this reads and writes tickets
 * regardless of RLS, and reads the auth user to decide on the password link.
 */
export async function deliverConfirmation(
  admin: any,
  orderToken: string,
  opts: DeliverOptions = {},
): Promise<DeliverResult> {
  const record = async (fields: Record<string, unknown>) => {
    const { error } = await admin.from('tickets').update(fields).eq('order_token', orderToken);
    if (error) console.error('[deliver] failed to record outcome', error);
  };

  const order = await loadOrder(admin, orderToken);
  if (!order) return { status: 'not_found' };

  // Guards against a retry or a double-invoke texting someone twice.
  if (order.confirmation_sent_at && !opts.force) {
    return { status: 'skipped', reason: 'already_sent', sentAt: order.confirmation_sent_at };
  }

  let email = (opts.email || '').trim();
  let phone = (opts.phone || '').trim();
  let name = (opts.name || '').trim();

  // Always loaded, because last_sign_in_at decides whether this person needs an
  // account-access link at all.
  const { data: userData } = await admin.auth.admin.getUserById(order.user_id);
  const authUser = userData?.user;
  if (authUser) {
    email = email || authUser.email || '';
    phone = phone || authUser.phone || '';
    name = name || (authUser.user_metadata as any)?.display_name || '';
  }
  // Guest checkout writes the phone to profiles when auth does not take it, so
  // profiles is the authoritative fallback for every field.
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

  const hasSignedIn = !!authUser?.last_sign_in_at;
  const ticketUrl = ticketPageUrl(SITE_URL, orderToken);
  const calendarUrl = ticketCalendarUrl(SUPABASE_URL, orderToken);
  const googleCalUrl = googleCalendarUrl(order, ticketUrl);

  // ---- Email path ---------------------------------------------------------
  if (email) {
    // A recovery link doubles as "set your password" for an account the holder
    // has never signed into. Skipped for anyone who has signed in before —
    // they have a password already, and an unsolicited password link in a
    // receipt reads like phishing. Skipped too when delivery has been
    // redirected elsewhere: minting an account-recovery link for whoever that
    // address belongs to is not a ticket receipt's business.
    //
    // And skipped entirely while member accounts are off. The account behind
    // this ticket still exists — buyers.ts creates one either way — but there
    // is no patron sign-in to send anyone to, so inviting them to set a
    // password would be an invitation to a door that is locked. `buildEmailHtml`
    // and `buildEmailText` render the set-password section only when there is a
    // link, so a null here drops the section and nothing else. The QR ticket
    // email is unaffected.
    const isAccountHolder =
      !!authUser?.email && authUser.email.toLowerCase() === email.toLowerCase();

    let passwordUrl: string | null = null;
    if (memberAccountsEnabled() && !hasSignedIn && isAccountHolder) {
      try {
        const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${SITE_URL.replace(/\/$/, '')}/reset-password` },
        });
        if (linkError) console.warn('[deliver] recovery link failed', linkError);
        passwordUrl = linkData?.properties?.action_link ?? null;
      } catch (e) {
        // Never let the account-access extra block the ticket itself.
        console.warn('[deliver] recovery link threw', e);
      }
    }

    const html = buildEmailHtml(order, {
      ticketUrl,
      qrUrlFor: (ticketId) => ticketQrUrl(SUPABASE_URL, orderToken, ticketId),
      calendarUrl,
      googleCalendarUrl: googleCalUrl,
      passwordUrl,
      accountJustCreated: opts.accountCreated === true,
      name,
    });
    const text = buildEmailText(order, {
      ticketUrl,
      calendarUrl,
      passwordUrl,
      accountJustCreated: opts.accountCreated === true,
      name,
    });

    const result = await sendTransactionalEmail(email, buildSubject(order), html, text);
    if (!result.ok) {
      console.error('[deliver] email send failed', result.error);
      await record({ confirmation_error: result.error });
      return { status: 'failed', channel: 'email', error: result.error, httpStatus: 502 };
    }

    await record({
      confirmation_sent_at: new Date().toISOString(),
      confirmation_channel: 'email',
      confirmation_error: null,
    });
    return { status: 'delivered', channel: 'email' };
  }

  // ---- SMS path -----------------------------------------------------------
  if (phone) {
    const e164 = toE164(phone);
    if (!e164) {
      const error = `Phone number is not in a sendable format: ${phone}`;
      console.error('[deliver]', error);
      await record({ confirmation_error: error });
      return { status: 'failed', channel: 'sms', error, httpStatus: 400 };
    }

    const result = await sendViaTwilio(e164, buildSmsBody(order, ticketUrl, calendarUrl));
    if (!result.ok) {
      console.error('[deliver] sms send failed', result.error);
      await record({ confirmation_error: result.error });
      return { status: 'failed', channel: 'sms', error: result.error, httpStatus: 502 };
    }

    await record({
      confirmation_sent_at: new Date().toISOString(),
      confirmation_channel: 'sms',
      confirmation_error: null,
    });
    return { status: 'delivered', channel: 'sms' };
  }

  const error = 'Order has no email or phone to deliver to';
  await record({ confirmation_error: error });
  return { status: 'failed', error, httpStatus: 400 };
}
