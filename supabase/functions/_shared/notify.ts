// Message composition for ticket delivery.
//
// Split out from the send-ticket-confirmation handler so these can be tested
// without booting a server, and so "what an order is" (tickets.ts) stays
// separate from "how we phrase a message about it".

import {
  describeSeat,
  formatMoney,
  type Order,
} from './tickets.ts';

// Deno globals
declare const Deno: any;

const TICKET_REPLY_TO = Deno.env.get('TICKET_REPLY_TO') || 'events@kenworthy.org';
const VENUE_NAME = 'The Kenworthy Performing Arts Centre';

// ---------------------------------------------------------------------------
// Formatting helpers (pure — covered by tickets_test.ts)
// ---------------------------------------------------------------------------

/** Minimal HTML escaping for values interpolated into the email body. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalize a free-text phone number to E.164 for Twilio.
 *
 * Checkout collects phone numbers as typed — "(208) 892-9752", "208.892.9752",
 * "+1 208 892 9752". Twilio rejects anything that is not E.164, and a rejected
 * send is exactly the silent non-delivery this whole change exists to fix, so
 * normalize rather than hope.
 *
 * Returns null when the input cannot be a valid North American number, so the
 * caller can record a real reason instead of firing a doomed request.
 */
export function toE164(raw: string, defaultCountryCode = '1'): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // Already international and explicit about it.
  if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;

  // Bare 10-digit North American number.
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;

  // 11 digits starting with the country code, e.g. 12088929752.
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return `+${digits}`;

  return null;
}

/** Subject line: what it is, and when. */
export function buildSubject(order: Order): string {
  const count = order.tickets.length;
  return `Your ${count} ticket${count === 1 ? '' : 's'} for ${order.title}`;
}

/**
 * Ticket confirmation email.
 *
 * Table-based layout with inline styles — the markup email clients actually
 * render consistently. QR images are absolute URLs served by ticket-access,
 * not data: URIs, because Gmail and Outlook strip data: URIs in <img>. Each QR
 * is captioned with its ticket code so the ticket is still usable at the door
 * if the customer has images turned off.
 */
export function buildEmailHtml(
  order: Order,
  opts: { ticketUrl: string; qrUrlFor: (ticketId: string) => string; passwordUrl?: string | null; name?: string | null },
): string {
  const greeting = opts.name ? `Hi ${esc(opts.name.split(/\s+/)[0])},` : 'Hi there,';

  const ticketBlocks = order.tickets
    .map(
      (t, i) => `
      <tr>
        <td style="padding:20px 0;border-top:1px solid #e6e2dd;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" style="padding-bottom:10px;">
                <div style="font:600 13px/1.4 Helvetica,Arial,sans-serif;color:#6b6560;letter-spacing:.06em;text-transform:uppercase;">
                  Ticket ${i + 1} of ${order.tickets.length}
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:6px 0;">
                <img src="${esc(opts.qrUrlFor(t.id))}"
                     alt="QR code for ticket ${i + 1}"
                     width="200" height="200"
                     style="display:block;width:200px;height:200px;border:8px solid #ffffff;background:#ffffff;border-radius:8px;" />
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:10px;">
                <div style="font:400 15px/1.5 Helvetica,Arial,sans-serif;color:#26211d;">
                  ${esc(describeSeat(t))}
                </div>
                <div style="font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#6b6560;padding-top:2px;">
                  ${esc(formatMoney(t.total_price))}
                </div>
                <div style="font:400 11px/1.5 'SFMono-Regular',Consolas,monospace;color:#9a938c;padding-top:6px;word-break:break-all;">
                  ${esc(t.qr_code)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`,
    )
    .join('');

  const passwordBlock = opts.passwordUrl
    ? `
      <tr>
        <td style="padding:22px 28px;background:#f6f3ef;border-radius:10px;">
          <div style="font:600 15px/1.5 Helvetica,Arial,sans-serif;color:#26211d;padding-bottom:6px;">
            We created an account for you
          </div>
          <div style="font:400 14px/1.6 Helvetica,Arial,sans-serif;color:#55504b;padding-bottom:14px;">
            Your tickets are saved to it. Set a password to sign in any time and
            see every ticket you have with us.
          </div>
          <a href="${esc(opts.passwordUrl)}"
             style="display:inline-block;padding:11px 20px;background:#b82a6b;color:#ffffff;font:600 14px/1 Helvetica,Arial,sans-serif;text-decoration:none;border-radius:6px;">
            Set your password
          </a>
        </td>
      </tr>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(buildSubject(order))}</title>
</head>
<body style="margin:0;padding:0;background:#f0ece7;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${esc(order.title)} — ${esc(order.start_time_display)}. Your QR code${order.tickets.length === 1 ? ' is' : 's are'} inside.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0ece7;">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:26px 28px;background:#26211d;">
              <div style="font:700 19px/1.3 Georgia,'Times New Roman',serif;color:#ffffff;letter-spacing:.01em;">
                The Kenworthy
              </div>
              <div style="font:400 12px/1.5 Helvetica,Arial,sans-serif;color:#b9b1a9;letter-spacing:.08em;text-transform:uppercase;padding-top:3px;">
                Performing Arts Centre · Moscow, Idaho
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 28px 4px;">
              <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#55504b;">${greeting}</div>
              <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#55504b;padding-top:8px;">
                You're all set. Here ${order.tickets.length === 1 ? 'is your ticket' : 'are your tickets'} —
                show the QR code${order.tickets.length === 1 ? '' : 's'} at the door.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 0;">
              <div style="font:700 23px/1.3 Georgia,'Times New Roman',serif;color:#26211d;">
                ${esc(order.title)}
              </div>
              <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#55504b;padding-top:8px;">
                ${esc(order.start_time_display)}
              </div>
              <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#55504b;">
                ${esc(order.venue || VENUE_NAME)}
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${ticketBlocks}
                <tr>
                  <td style="padding:16px 0;border-top:1px solid #e6e2dd;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font:600 15px/1.5 Helvetica,Arial,sans-serif;color:#26211d;">Total paid</td>
                        <td align="right" style="font:600 15px/1.5 Helvetica,Arial,sans-serif;color:#26211d;">
                          ${esc(formatMoney(order.total))}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:6px 28px 24px;">
              <a href="${esc(opts.ticketUrl)}"
                 style="display:inline-block;padding:13px 26px;background:#26211d;color:#ffffff;font:600 15px/1 Helvetica,Arial,sans-serif;text-decoration:none;border-radius:7px;">
                View tickets on your phone
              </a>
              <div style="font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#8b847d;padding-top:10px;">
                Keep this link — it opens your tickets without signing in.
              </div>
            </td>
          </tr>

          ${passwordBlock ? `<tr><td style="padding:0 28px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${passwordBlock}</table></td></tr>` : ''}

          <tr>
            <td style="padding:20px 28px 26px;background:#faf8f6;border-top:1px solid #e6e2dd;">
              <div style="font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#8b847d;">
                Questions? Reply to this email or write to
                <a href="mailto:${esc(TICKET_REPLY_TO)}" style="color:#b82a6b;text-decoration:none;">${esc(TICKET_REPLY_TO)}</a>.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text alternative. Some clients show only this, so it must stand alone. */
export function buildEmailText(
  order: Order,
  opts: { ticketUrl: string; passwordUrl?: string | null; name?: string | null },
): string {
  const lines: string[] = [];
  lines.push(opts.name ? `Hi ${opts.name.split(/\s+/)[0]},` : 'Hi there,');
  lines.push('');
  lines.push(
    `You're all set. Here ${order.tickets.length === 1 ? 'is your ticket' : 'are your tickets'} for:`,
  );
  lines.push('');
  lines.push(order.title);
  lines.push(order.start_time_display);
  lines.push(order.venue || VENUE_NAME);
  lines.push('');
  order.tickets.forEach((t, i) => {
    lines.push(`Ticket ${i + 1} of ${order.tickets.length} — ${describeSeat(t)} — ${formatMoney(t.total_price)}`);
    lines.push(`  Code: ${t.qr_code}`);
  });
  lines.push('');
  lines.push(`Total paid: ${formatMoney(order.total)}`);
  lines.push('');
  lines.push(`Show your QR code at the door. Open your tickets here:`);
  lines.push(opts.ticketUrl);
  if (opts.passwordUrl) {
    lines.push('');
    lines.push('We created an account for you and saved your tickets to it.');
    lines.push('Set a password to sign in any time:');
    lines.push(opts.passwordUrl);
  }
  lines.push('');
  lines.push(`Questions? Write to ${TICKET_REPLY_TO}.`);
  lines.push('The Kenworthy Performing Arts Centre, Moscow, Idaho');
  return lines.join('\n');
}

/**
 * SMS body. Deliberately compact: carriers split anything over 160 GSM-7
 * characters into multiple billed segments, and a ticket link that arrives in
 * pieces reads as spam. No QR — a texted image cannot be relied on to scan, so
 * the link is the ticket.
 */
export function buildSmsBody(order: Order, ticketUrl: string): string {
  const count = order.tickets.length;
  const seats = order.tickets.some((t) => t.seat)
    ? ` ${order.tickets.map((t) => `${t.seat!.row}${t.seat!.number}`).join(', ')}`
    : '';
  return [
    `The Kenworthy: ${count} ticket${count === 1 ? '' : 's'} for ${order.title}`,
    `${order.start_time_display}${seats}`,
    `Show this at the door: ${ticketUrl}`,
  ].join('\n');
}
