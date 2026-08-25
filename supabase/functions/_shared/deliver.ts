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
// One entry point, sending on every channel the customer gave us:
//   has an email  -> transactional email with an embedded, scannable QR per
//                    ticket, plus (when warranted) a link to set a password
//   has a phone   -> SMS with the essentials and a link to the mobile ticket
//                    page, because an SMS cannot carry a scannable QR
//
// Both, when there are both. Email used to win and stop, with SMS reserved for
// buyers who gave nothing else; the text now goes alongside it, so a customer
// who hands over a number hears immediately that their tickets are out instead
// of finding out whenever they next open their mail. The email is still the
// one that matters at the door — it carries the QR inline and works with no
// signal in the lobby — so the SMS is a notification, not a substitute.
//
// The two are attempted independently and neither suppresses the other. One
// channel getting through is a delivery: `confirmation_sent_at` is stamped so
// a retry cannot send twice, and the channel that failed is recorded in
// `confirmation_error` beside it rather than instead of it.
//
// Callers dispatch this fire-and-forget so delivery can never fail a purchase.
// That makes silent failure the real risk, so every outcome is written back to
// the ticket rows (confirmation_sent_at / confirmation_error).

import { loadOrder, ticketPageUrl, ticketQrUrl } from './tickets.ts';
import { ticketCalendarUrl, googleCalendarUrl } from './calendar.ts';
import { toE164, buildSubject, buildEmailHtml, buildEmailText, buildSmsBody } from './notify.ts';
import { SITE_URL } from './brand.ts';
import { logAudit } from './audit.ts';

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
    const error = `Resend ${res.status}: ${detail.slice(0, 400)}`;
    await logEmailAttempt(to, subject, 'email', error);
    return { ok: false, error };
  }
  await logEmailAttempt(to, subject, 'email', null);
  return { ok: true };
}

/**
 * Record one outbound message in the activity log.
 *
 * This is the choke point every transactional email passes through — ticket
 * confirmations, donation receipts, film-pass deliveries — so one call here
 * covers all of them rather than one per caller.
 *
 * The address is masked, matching what send-auth-email already writes to the
 * console: these go to ticket buyers and donors, and what an admin needs from
 * the log is that a receipt went out at 14:02 and whether it succeeded, not a
 * readable list of every customer's email address.
 *
 * Never awaited for its result and never allowed to throw — delivery is
 * dispatched fire-and-forget precisely so it cannot fail a purchase, and an
 * audit write must not reintroduce that risk.
 */
async function logEmailAttempt(
  to: string,
  subject: string,
  channel: 'email' | 'sms',
  error: string | null,
): Promise<void> {
  const masked = channel === 'email'
    ? to.replace(/(.).*(@.*)/, '$1***$2')
    : to.replace(/.(?=.{4})/g, '*');
  await logAudit({
    action: error ? `${channel}.send_failed` : `${channel}.sent`,
    entityType: 'notification',
    details: { to: masked, subject, channel, ...(error ? { error } : {}) },
  });
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
    const error = `Twilio ${res.status} (${auth.mode}): ${detail.slice(0, 400)}`;
    await logEmailAttempt(to, 'Ticket confirmation', 'sms', error);
    return { ok: false, error };
  }
  await logEmailAttempt(to, 'Ticket confirmation', 'sms', null);
  return { ok: true };
}

export interface DeliverOptions {
  /** Redirect delivery to another recipient. Trusted callers only. */
  email?: string;
  phone?: string;
  name?: string;
  /** True when this checkout is what created the account. */
  accountCreated?: boolean;
  /**
   * Whether the buyer affirmatively agreed to be texted.
   *
   * Explicitly three-valued. `false` means asked and declined, and it blocks
   * the SMS outright — including the number this function would otherwise
   * recover from auth or `profiles`, which is the case that matters: a
   * returning buyer whose number we already hold has not consented merely by
   * having bought before.
   *
   * `undefined` means the caller has nothing to say, and the order's own
   * `sms_consent` is used instead — which is the whole reason that column
   * exists. A resend through `send-ticket-confirmation` carries no consent
   * field, and before the column it fell back to texting whatever number was on
   * file. It now falls back to the buyer's actual answer, and to no if there
   * isn't one.
   *
   * A2P 10DLC treats consent as per-number and affirmative, so the absence of
   * a "no" is not a "yes" — but neither is a number in a database.
   */
  smsConsent?: boolean;
  /** Resend even if a confirmation already went out. */
  force?: boolean;
}

/** Which channels a confirmation actually went out on. */
export type DeliverChannel = 'email' | 'sms' | 'email+sms';

export type DeliverResult =
  /**
   * At least one channel got through. `channel` is what actually sent, not
   * what was attempted, and `partialError` is set when the *other* channel was
   * tried and failed — a text that bounced off a dead number does not undo the
   * emailed ticket, but it should not vanish either.
   */
  | { status: 'delivered'; channel: DeliverChannel; partialError?: string }
  | { status: 'skipped'; reason: 'already_sent'; sentAt: string }
  | { status: 'not_found' }
  /** Nothing reached the customer. `channel` is what was attempted. */
  | { status: 'failed'; channel?: DeliverChannel; error: string; httpStatus: number };

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

  const ticketUrl = ticketPageUrl(SITE_URL, orderToken);
  const calendarUrl = ticketCalendarUrl(SUPABASE_URL, orderToken);
  const googleCalUrl = googleCalendarUrl(order, ticketUrl);

  // ---- Both channels, not the first one that matches ----------------------
  // Email used to win and stop: SMS was only ever the fallback for a buyer who
  // had left the email box blank. It now runs alongside, so anyone who gives
  // us a number is told by text that their tickets are out, and the email is
  // still what carries the scannable QR. The two are attempted independently
  // and neither can suppress the other — the failure that matters here is the
  // one where a working channel goes unused because the other one threw first.

  let emailError: string | null = null;
  if (email) {
    const html = buildEmailHtml(order, {
      ticketUrl,
      qrUrlFor: (ticketId) => ticketQrUrl(SUPABASE_URL, orderToken, ticketId),
      calendarUrl,
      googleCalendarUrl: googleCalUrl,
      name,
    });
    const text = buildEmailText(order, {
      ticketUrl,
      calendarUrl,
      name,
    });

    const result = await sendTransactionalEmail(email, buildSubject(order), html, text);
    if (!result.ok) {
      console.error('[deliver] email send failed', result.error);
      emailError = result.error;
    }
  }

  // ---- SMS ----------------------------------------------------------------
  // Consent first, and before the number is even considered.
  //
  // Resolved from the caller if it said anything, otherwise from what the buyer
  // answered when they placed the order. The caller wins because it is the more
  // specific statement: ticket-checkout is relaying a live answer, and a
  // service-role resend passing `smsConsent` explicitly is an operator
  // asserting one.
  //
  // Anything that is not an affirmative `true` means no SMS. That covers the
  // decline, and it covers the silence — an order placed before this column
  // existed, or through a path that never asks, has no consent on record, and
  // no record is not permission. It is why `send-ticket-confirmation` can no
  // longer text a number it recovered from `profiles` just because a resend
  // carried no consent field of its own.
  //
  // Declining is not a delivery failure and is never recorded as one. Nothing
  // went wrong; the buyer did not ask to be texted.
  const consent = opts.smsConsent ?? order.sms_consent;
  if (consent !== true) phone = '';

  // Unreachable-number errors are 400 (nothing to retry — the number is not
  // dialable) and provider errors 502 (ours or Twilio's, and worth retrying),
  // which is the same split the single-channel version made.
  let smsError: string | null = null;
  let smsStatus = 502;
  if (phone) {
    const e164 = toE164(phone);
    if (!e164) {
      smsError = `Phone number is not in a sendable format: ${phone}`;
      smsStatus = 400;
      console.error('[deliver]', smsError);
    } else {
      const result = await sendViaTwilio(e164, buildSmsBody(order, ticketUrl, calendarUrl));
      if (!result.ok) {
        console.error('[deliver] sms send failed', result.error);
        smsError = result.error;
      }
    }
  }

  // ---- Outcome ------------------------------------------------------------
  if (!email && !phone) {
    const error = 'Order has no email or phone to deliver to';
    await record({ confirmation_error: error });
    return { status: 'failed', error, httpStatus: 400 };
  }

  const emailSent = !!email && !emailError;
  const smsSent = !!phone && !smsError;
  const attempted: DeliverChannel =
    email && phone ? 'email+sms' : email ? 'email' : 'sms';

  if (emailSent || smsSent) {
    const channel: DeliverChannel =
      emailSent && smsSent ? 'email+sms' : emailSent ? 'email' : 'sms';
    // Exactly one of these can be set here, since a delivery means the other
    // channel succeeded or was never asked for.
    const partialError = emailError || smsError;
    if (partialError) {
      console.warn(`[deliver] partial delivery on ${channel}: ${partialError}`);
    }
    // `confirmation_sent_at` is what stops a retry from sending twice, so it is
    // stamped the moment anything reaches the customer. A partial failure rides
    // alongside it in `confirmation_error` rather than in place of it: an order
    // with both columns set is one where the customer was reached and something
    // still needs looking at.
    await record({
      confirmation_sent_at: new Date().toISOString(),
      confirmation_channel: channel,
      confirmation_error: partialError,
    });
    return partialError
      ? { status: 'delivered', channel, partialError }
      : { status: 'delivered', channel };
  }

  // Nothing got through on any channel we had a contact for.
  const error = [emailError, smsError].filter(Boolean).join('; ');
  await record({ confirmation_error: error });
  return {
    status: 'failed',
    channel: attempted,
    error,
    // A dud phone number alone is the customer's typo; anything else means a
    // provider or a credential is involved, and 502 is what a caller retries.
    httpStatus: emailError || smsStatus === 502 ? 502 : 400,
  };
}
