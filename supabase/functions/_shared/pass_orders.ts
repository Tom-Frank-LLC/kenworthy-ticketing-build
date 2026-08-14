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

import { brand, sans } from './brand.ts';
import {
  emailLayout,
  esc,
  eyebrow,
  heading,
  panel,
  paragraph,
  row,
  textFooter,
} from './email-layout.ts';

/**
 * Both pass emails end with this. It is the single most important line in
 * either of them: a patron who thinks the email is the pass turns up at the
 * door with a phone and nothing to scan.
 */
const NOTHING_TO_PRINT =
  'There is nothing to print — no QR code in this email. The pass itself is the physical card.';

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
    ...textFooter(NOTHING_TO_PRINT),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// "It's in the mail" — sent when a staff member confirms the envelope went out
// ---------------------------------------------------------------------------
//
// The order confirmation already promised this would happen ("will be posted
// to …"). This is the second half of that promise, and it is the only message
// that turns an open-ended wait into a countable one. It carries no QR and
// nothing to print, for the same reason the confirmation does not: the pass is
// the physical card, and an email that looks scannable sends someone to the
// door with a phone and no pass.

export interface PassPostedSummary {
  passTypeName: string;
  quantity: number;
  /** Where it was actually sent — the address on the envelope. */
  mailingAddress: MailingAddress | null;
  buyerName: string | null;
  /** Balance one pass carries. Repeated here so the email stands alone. */
  initialBalance: number;
  redemptionPrice: number;
}

export function buildPassPostedSubject(order: PassPostedSummary): string {
  const what = order.quantity === 1 ? 'film pass' : 'film passes';
  return `Your ${what} ${order.quantity === 1 ? 'is' : 'are'} in the mail`;
}

/** The one sentence that matters: it has left the building, and where it went. */
export function postedLine(order: PassPostedSummary): string {
  const subject = order.quantity === 1 ? 'Your pass' : 'Your passes';
  const verb = order.quantity === 1 ? 'is' : 'are';
  const to = order.mailingAddress ? formatAddress(order.mailingAddress) : 'the address you gave us';
  return `${subject} ${verb} on the way to ${to}. Allow a few days for the post, and give us a shout if nothing arrives within a week.`;
}

export function buildPassPostedEmailText(order: PassPostedSummary): string {
  const first = order.buyerName ? order.buyerName.split(/\s+/)[0] : null;
  const admissions = admissionsFor(order.initialBalance, order.redemptionPrice);

  return [
    first ? `Hi ${first},` : 'Hi there,',
    '',
    `Good news — ${order.quantity} × ${order.passTypeName} went in the post today.`,
    '',
    postedLine(order),
    '',
    `Each pass is already activated and carries ${formatMoney(order.initialBalance)}, covering ${formatMoney(
      order.redemptionPrice,
    )} of a standard movie ticket — about ${admissions} films.`,
    'Hand it to our staff at the door and they will scan it. Nothing to set up before it arrives.',
    'Passes cannot be used to book online, and are not valid for special events or premium screenings.',
    '',
    ...textFooter(NOTHING_TO_PRINT),
  ].join('\n');
}

export function buildPassPostedEmailHtml(order: PassPostedSummary): string {
  const first = order.buyerName ? esc(order.buyerName.split(/\s+/)[0]) : null;
  const greeting = first ? `Hi ${first},` : 'Hi there,';
  const admissions = admissionsFor(order.initialBalance, order.redemptionPrice);

  // Same shell as the order confirmation on purpose — a patron sees these two
  // back to back, and emailLayout is what guarantees they match.
  const content = `
          ${row(
            `${paragraph(greeting)}
             <div style="padding-top:8px;">${paragraph('Good news — this went in the post today.')}</div>`,
            '28px 28px 4px',
          )}

          ${row(heading(`${order.quantity} × ${order.passTypeName}`))}

          ${row(
            panel(`
              <div style="font:600 15px/1.5 ${sans};color:${brand.ink};padding-bottom:6px;">
                In the mail
              </div>
              <div style="font:400 14px/1.6 ${sans};color:${brand.body};">
                ${esc(postedLine(order))}
              </div>
            `),
          )}

          ${row(`
            <div style="padding-bottom:8px;">${eyebrow('When it arrives')}</div>
            <div style="font:400 14px/1.7 ${sans};color:${brand.body};">
              It is already activated and carries ${esc(formatMoney(order.initialBalance))}, covering
              ${esc(formatMoney(order.redemptionPrice))} of a standard movie ticket —
              about ${esc(admissions)} films.<br />
              Hand it to our staff at the door and they will scan it. Nothing to set up first.<br />
              Passes cannot be used to book online, and are not valid for special events
              or premium screenings.
            </div>
          `)}

          <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>`;

  return emailLayout({
    title: buildPassPostedSubject(order),
    preheader: `${esc(order.passTypeName)} posted today. Activated and ready to use — no QR code needed.`,
    contentHtml: content,
    footerNote: NOTHING_TO_PRINT,
  });
}

export function buildPassOrderEmailHtml(order: PassOrderSummary): string {
  const first = order.buyerName ? esc(order.buyerName.split(/\s+/)[0]) : null;
  const greeting = first ? `Hi ${first},` : 'Hi there,';
  const admissions = admissionsFor(order.initialBalance, order.redemptionPrice);

  // Same shell as every other transactional email — see email-layout.ts.
  const content = `
          ${row(
            `${paragraph(greeting)}
             <div style="padding-top:8px;">${paragraph('Thank you — your order is in.')}</div>`,
            '28px 28px 4px',
          )}

          ${row(`
            ${heading(`${order.quantity} × ${order.passTypeName}`)}
            <div style="padding-top:8px;">${paragraph(`${esc(formatMoney(order.amountPaid))} paid`)}</div>
          `)}

          ${row(
            panel(`
              <div style="font:600 15px/1.5 ${sans};color:${brand.ink};padding-bottom:6px;">
                ${order.fulfillment === 'pickup' ? 'Collect it at the box office' : 'On its way to you'}
              </div>
              <div style="font:400 14px/1.6 ${sans};color:${brand.body};">
                ${esc(fulfillmentLine(order))}
              </div>
            `),
          )}

          ${row(`
            <div style="padding-bottom:8px;">${eyebrow('How the pass works')}</div>
            <div style="font:400 14px/1.7 ${sans};color:${brand.body};">
              Each pass carries ${esc(formatMoney(order.initialBalance))} and covers
              ${esc(formatMoney(order.redemptionPrice))} of a standard movie ticket —
              about ${esc(admissions)} films.<br />
              Hand it to our staff at the door and they will scan it.<br />
              Passes cannot be used to book online, and are not valid for special events
              or premium screenings.
            </div>
          `)}

          <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>`;

  return emailLayout({
    title: buildPassOrderSubject(order),
    preheader: `${esc(order.passTypeName)} — ${
      order.fulfillment === 'pickup' ? 'ready at the box office' : 'posting to you'
    }. No QR code needed.`,
    contentHtml: content,
    footerNote: `${NOTHING_TO_PRINT} It is activated when it reaches your hands.`,
  });
}
