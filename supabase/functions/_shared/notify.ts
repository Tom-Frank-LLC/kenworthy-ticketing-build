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
import { brand, serif, sans, mono } from './brand.ts';
import {
  emailLayout,
  esc,
  eyebrow,
  heading,
  outlineButton,
  paragraph,
  primaryButton,
  row,
  textFooter,
  VENUE_NAME,
  VENUE_SHORT,
} from './email-layout.ts';

// The shell, the palette and the venue name all live in email-layout.ts /
// brand.ts now, so a brand change is one edit rather than one per template.
// Re-exported because callers and tests have long imported `esc` from here.
export { esc };

// ---------------------------------------------------------------------------
// Formatting helpers (pure — covered by tickets_test.ts)
// ---------------------------------------------------------------------------

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
  opts: {
    ticketUrl: string;
    qrUrlFor: (ticketId: string) => string;
    /** .ics download (Apple/Outlook/most clients) served by ticket-access. */
    calendarUrl?: string | null;
    /** One-tap Google Calendar template link. */
    googleCalendarUrl?: string | null;
    name?: string | null;
  },
): string {
  const greeting = opts.name ? `Hi ${esc(opts.name.split(/\s+/)[0])},` : 'Hi there,';

  const calendarBlock = opts.calendarUrl
    ? `
      <tr>
        <td align="center" style="padding:22px 28px 0;">
          <div style="padding-bottom:8px;">${eyebrow('Add to your calendar')}</div>
          ${outlineButton(opts.calendarUrl, 'Apple / Outlook (.ics)')}${
            opts.googleCalendarUrl ? outlineButton(opts.googleCalendarUrl, 'Google Calendar') : ''
          }
        </td>
      </tr>`
    : '';

  const ticketBlocks = order.tickets
    .map(
      (t, i) => `
      <tr>
        <td style="padding:20px 0;border-top:1px solid ${brand.rule};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" style="padding-bottom:10px;">
                ${eyebrow(`Ticket ${i + 1} of ${order.tickets.length}`)}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:6px 0;">
                <!-- Literal white, not a brand colour: a scanner needs a true
                     white quiet zone around the code, and tinting it to match
                     the palette is how a QR stops scanning at the door. -->
                <img src="${esc(opts.qrUrlFor(t.id))}"
                     alt="QR code for ticket ${i + 1}"
                     width="200" height="200"
                     style="display:block;width:200px;height:200px;border:8px solid #ffffff;background:#ffffff;border-radius:8px;" />
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:10px;">
                <div style="font:400 15px/1.5 ${sans};color:${brand.ink};">
                  ${esc(describeSeat(t))}
                </div>
                <div style="font:400 13px/1.5 ${sans};color:${brand.soft};padding-top:2px;">
                  ${esc(formatMoney(t.total_price))}
                </div>
                <div style="font:400 11px/1.5 ${mono};color:${brand.faint};padding-top:6px;word-break:break-all;">
                  ${esc(t.qr_code)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`,
    )
    .join('');

  const content = `
          ${row(
            `${paragraph(greeting)}
             <div style="padding-top:8px;">${paragraph(
               order.tickets.length === 1
                 ? 'Here is your ticket. Simply show this QR code when you arrive. We look forward to seeing you.'
                 : 'Here are your tickets. Simply show these QR codes when you arrive. We look forward to seeing you.',
             )}</div>`,
            '28px 28px 4px',
          )}

          ${row(`
            ${heading(order.title)}
            <div style="padding-top:8px;">${paragraph(esc(order.start_time_display))}</div>
            ${paragraph(esc(order.venue || VENUE_NAME))}
          `)}

          ${row(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${ticketBlocks}
              <tr>
                <td style="padding:16px 0;border-top:1px solid ${brand.rule};">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font:600 15px/1.5 ${sans};color:${brand.ink};">Total paid</td>
                      <td align="right" style="font:600 15px/1.5 ${sans};color:${brand.ink};">
                        ${esc(formatMoney(order.total))}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>`,
            '8px 28px 0',
          )}

          <tr>
            <td align="center" style="padding:22px 28px 0;">
              ${primaryButton(opts.ticketUrl, 'View tickets on your phone')}
            </td>
          </tr>

          ${calendarBlock}


          <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>`;

  return emailLayout({
    title: buildSubject(order),
    preheader: `${esc(order.title)} — ${esc(order.start_time_display)}. Your QR code${
      order.tickets.length === 1 ? ' is' : 's are'
    } inside.`,
    contentHtml: content,
  });
}

/** Plain-text alternative. Some clients show only this, so it must stand alone. */
export function buildEmailText(
  order: Order,
  opts: {
    ticketUrl: string;
    calendarUrl?: string | null;
    name?: string | null;
  },
): string {
  const lines: string[] = [];
  lines.push(opts.name ? `Hi ${opts.name.split(/\s+/)[0]},` : 'Hi there,');
  lines.push('');
  lines.push(
    order.tickets.length === 1
      ? 'Here is your ticket. Simply show this QR code when you arrive. We look forward to seeing you.'
      : 'Here are your tickets. Simply show these QR codes when you arrive. We look forward to seeing you.',
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
  if (opts.calendarUrl) {
    lines.push('');
    lines.push('Add it to your calendar:');
    lines.push(opts.calendarUrl);
  }
  lines.push('');
  lines.push(...textFooter());
  return lines.join('\n');
}

/**
 * SMS body. Deliberately compact: carriers split anything over 160 GSM-7
 * characters into multiple billed segments, and a ticket link that arrives in
 * pieces reads as spam. No QR — a texted image cannot be relied on to scan, so
 * the link is the ticket.
 *
 * One link, deliberately. This used to append "Add to calendar: <ics url>",
 * which cost a third segment on every send and duplicated a button the ticket
 * page already carries (PublicTicket.tsx offers both the .ics and Google
 * Calendar). Shortening that URL was measured and does not help — the 36-char
 * order token is the bulk of it, not the path, so a /c/<token> redirect saved
 * 31 characters and stayed at three segments. Dropping the line is what takes
 * a typical send from three segments to two.
 */
export function buildSmsBody(order: Order, ticketUrl: string): string {
  const count = order.tickets.length;
  const seats = order.tickets.some((t) => t.seat)
    ? ` ${order.tickets.map((t) => `${t.seat!.row}${t.seat!.number}`).join(', ')}`
    : '';
  const lines = [
    `${VENUE_SHORT}: ${count} ticket${count === 1 ? '' : 's'} for ${order.title}`,
    `${order.start_time_display}${seats}`,
    `Your ticket${count === 1 ? '' : 's'}: ${ticketUrl}`,
  ];
  return lines.join('\n');
}
