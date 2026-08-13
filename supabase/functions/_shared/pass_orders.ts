// Film-pass orders — the parts worth testing without a server.
//
// Buying a film pass online does not produce a pass. It produces an obligation:
// the theatre has the money and still owes somebody a piece of paper, either
// over the counter or through the post. The confirmation email therefore has
// exactly one job, and it is not "here is your pass" — it is telling the buyer
// where their pass will be and that nothing is scannable yet. Getting that
// wrong sends someone to the door with an email and no pass.
//
// Address handling lives here for the same reason phone normalisation lives in
// notify.ts: a posted pass with an unusable address is a silent failure that
// only surfaces weeks later as "I never got it".

import { esc } from './notify.ts';

// Deno globals
declare const Deno: any;

const TICKET_REPLY_TO = Deno.env.get('TICKET_REPLY_TO') || 'events@kenworthy.org';
const VENUE_NAME = 'The Kenworthy Performing Arts Centre';
const BOX_OFFICE_ADDRESS = '508 S Main St, Moscow, ID 83843';

export type Fulfillment = 'pickup' | 'mail';

export interface MailingAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
}

export interface PassOrderSummary {
  passTypeName: string;
  quantity: number;
  /** What the buyer's card was charged, in dollars. */
  amountPaid: number;
  /** Balance one pass carries once activated. */
  initialBalance: number;
  /** Deducted per in-person admission. */
  redemptionPrice: number;
  fulfillment: Fulfillment;
  mailingAddress: MailingAddress | null;
  buyerName: string | null;
}

/**
 * Read a mailing address from a request body.
 *
 * Returns the address, or a reason it cannot be used. Deliberately strict about
 * the four fields the post office actually needs and deliberately silent about
 * the shape of the rest: this is not address verification, it is the difference
 * between a staff member who can write a label and one who cannot.
 */
export function readMailingAddress(
  raw: unknown,
): { ok: true; address: MailingAddress } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Enter the address to post the pass to' };
  }
  const a = raw as Record<string, unknown>;
  const str = (v: unknown) => String(v ?? '').trim();

  const address: MailingAddress = {
    line1: str(a.line1),
    line2: str(a.line2) || null,
    city: str(a.city),
    state: str(a.state).toUpperCase(),
    postal_code: str(a.postal_code),
  };

  if (!address.line1) return { ok: false, error: 'Enter a street address' };
  if (!address.city) return { ok: false, error: 'Enter a city' };
  if (!address.state) return { ok: false, error: 'Enter a state' };
  if (!address.postal_code) return { ok: false, error: 'Enter a ZIP code' };

  // Long enough to be a real line, short enough that nobody is pasting an essay
  // into a field a staff member has to hand-copy onto an envelope.
  if (address.line1.length > 120 || (address.line2 && address.line2.length > 120)) {
    return { ok: false, error: 'That street address is too long' };
  }
  if (!/^\d{5}(-\d{4})?$/.test(address.postal_code)) {
    return { ok: false, error: 'Enter a 5-digit ZIP code' };
  }

  return { ok: true, address };
}

/** One-line rendering, for a receipt or a staff queue row. */
export function formatAddress(a: MailingAddress): string {
  return [a.line1, a.line2, `${a.city}, ${a.state} ${a.postal_code}`]
    .filter(Boolean)
    .join(', ');
}

export function formatMoney(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`;
}

/**
 * How many admissions a pass is worth.
 *
 * Stated in the confirmation because "a $60 pass" means nothing to a buyer
 * until it is "ten movies". Derived from the configured numbers rather than
 * written as ten, so changing either one changes what the email claims.
 */
export function admissionsFor(initialBalance: number, redemptionPrice: number): number {
  if (!(redemptionPrice > 0)) return 0;
  return Math.floor(initialBalance / redemptionPrice);
}

export function buildPassOrderSubject(order: PassOrderSummary): string {
  const what = order.quantity === 1 ? 'film pass' : `${order.quantity} film passes`;
  return order.fulfillment === 'pickup'
    ? `Your ${what} is ready to collect`
    : `Your ${what} is on its way`;
}

/** The sentence that decides whether the buyer turns up at the door or waits. */
export function fulfillmentLine(order: PassOrderSummary): string {
  const plural = order.quantity === 1 ? 'Your pass' : 'Your passes';
  if (order.fulfillment === 'pickup') {
    return `${plural} will be waiting for you at the box office. Ask for it by name when you next visit — we will activate it and hand it over then.`;
  }
  const to = order.mailingAddress ? formatAddress(order.mailingAddress) : 'the address you gave us';
  return `${plural} will be posted to ${to}. We activate it before it goes in the envelope, so it is ready to use the moment it arrives.`;
}

export function buildPassOrderEmailText(order: PassOrderSummary): string {
  const first = order.buyerName ? order.buyerName.split(/\s+/)[0] : null;
  const admissions = admissionsFor(order.initialBalance, order.redemptionPrice);

  return [
    first ? `Hi ${first},` : 'Hi there,',
    '',
    `Thank you — we have your order for ${order.quantity} × ${order.passTypeName}.`,
    '',
    fulfillmentLine(order),
    '',
    `Each pass carries ${formatMoney(order.initialBalance)} and covers ${formatMoney(
      order.redemptionPrice,
    )} of a standard movie ticket — about ${admissions} films.`,
    'Film passes are redeemed in person: hand the pass to our staff at the door and they will scan it.',
    'They cannot be used to book online, and they are not valid for special events or premium screenings.',
    '',
    `Paid: ${formatMoney(order.amountPaid)}`,
    '',
    'There is nothing to print and no QR code in this email — the pass itself is a physical card.',
    '',
    `Questions: ${TICKET_REPLY_TO}`,
    VENUE_NAME,
    BOX_OFFICE_ADDRESS,
  ].join('\n');
}

export function buildPassOrderEmailHtml(order: PassOrderSummary): string {
  const first = order.buyerName ? esc(order.buyerName.split(/\s+/)[0]) : null;
  const greeting = first ? `Hi ${first},` : 'Hi there,';
  const admissions = admissionsFor(order.initialBalance, order.redemptionPrice);

  // Matches the ticket confirmation's markup deliberately: table layout, inline
  // styles, no external assets. It is the layout mail clients render the same
  // way twice.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(buildPassOrderSubject(order))}</title>
</head>
<body style="margin:0;padding:0;background:#f0ece7;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${esc(order.passTypeName)} — ${
      order.fulfillment === 'pickup' ? 'ready at the box office' : 'posting to you'
    }. No QR code needed.
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
                Thank you — your order is in.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 0;">
              <div style="font:700 23px/1.3 Georgia,'Times New Roman',serif;color:#26211d;">
                ${esc(order.quantity)} × ${esc(order.passTypeName)}
              </div>
              <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#55504b;padding-top:8px;">
                ${esc(formatMoney(order.amountPaid))} paid
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:22px;background:#f6f3ef;border-radius:10px;">
                    <div style="font:600 15px/1.5 Helvetica,Arial,sans-serif;color:#26211d;padding-bottom:6px;">
                      ${order.fulfillment === 'pickup' ? 'Collect it at the box office' : 'On its way to you'}
                    </div>
                    <div style="font:400 14px/1.6 Helvetica,Arial,sans-serif;color:#55504b;">
                      ${esc(fulfillmentLine(order))}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 0;">
              <div style="font:600 13px/1.4 Helvetica,Arial,sans-serif;color:#6b6560;letter-spacing:.06em;text-transform:uppercase;padding-bottom:8px;">
                How the pass works
              </div>
              <div style="font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#55504b;">
                Each pass carries ${esc(formatMoney(order.initialBalance))} and covers
                ${esc(formatMoney(order.redemptionPrice))} of a standard movie ticket —
                about ${esc(admissions)} films.<br />
                Hand it to our staff at the door and they will scan it.<br />
                Passes cannot be used to book online, and are not valid for special events
                or premium screenings.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 28px;">
              <div style="font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#9a938c;border-top:1px solid #e6e2dd;padding-top:16px;">
                There is nothing to print — no QR code in this email. The pass itself is the
                physical card, and it is activated when it reaches your hands.<br /><br />
                Questions? Reply to this email or write to
                <a href="mailto:${esc(TICKET_REPLY_TO)}" style="color:#b82a6b;">${esc(TICKET_REPLY_TO)}</a>.<br />
                ${esc(VENUE_NAME)} · ${esc(BOX_OFFICE_ADDRESS)}
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
