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

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty',
];

/** "ten", not "10" — the count reads as prose in the sentence that uses it. */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * Money without dead cents: "$6", not "$6.00", but "$59.50" when there are
 * cents to state. formatMoney() still pads, and is right for a total on its own
 * line; this is for money sitting inside a sentence.
 */
export function formatMoneyCompact(n: number): string {
  const v = Number(n || 0);
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

export function buildPassOrderSubject(order: PassOrderSummary): string {
  // The verb has to agree with the count. It used to be hardcoded singular, so
  // a two-pass order subject read "Your 2 film passes is ready to collect".
  const one = order.quantity === 1;
  const what = one ? 'film pass' : `${order.quantity} film passes`;
  return order.fulfillment === 'pickup'
    ? `Your ${what} ${one ? 'is' : 'are'} ready to collect`
    : `Your ${what} ${one ? 'is on its way' : 'are on their way'}`;
}

/**
 * The sentence that decides whether the buyer turns up at the door or waits.
 *
 * Every pronoun in here agrees with the count. The previous version pluralised
 * only its opening — "Your passes will be waiting … ask for it … activate it
 * and hand it over" — which is the shape a sentence takes when the first clause
 * is fixed and the rest is not.
 */
export function fulfillmentLine(order: PassOrderSummary): string {
  const one = order.quantity === 1;
  const subject = one ? 'Your pass is' : 'Your passes are';
  if (order.fulfillment === 'pickup') {
    return `${subject} waiting for you at the box office, under your name.`;
  }
  const to = order.mailingAddress ? formatAddress(order.mailingAddress) : 'the address you gave us';
  return one
    ? `Your pass will be mailed to you at ${to}.`
    : `Your passes will be mailed to you at ${to}.`;
}

/** What the pass is worth and where it does not work. */
export function redemptionLine(order: PassOrderSummary): string {
  const one = order.quantity === 1;
  const films = numberWord(admissionsFor(order.initialBalance, order.redemptionPrice));
  const each = formatMoneyCompact(order.redemptionPrice);
  const subject = one ? 'Your pass is' : 'Each pass is';
  const pronoun = one
    ? 'It cannot be used online and is not eligible'
    : 'They cannot be used online and are not eligible';
  return `${subject} redeemable in person for ${films} ${each} film tickets. ${pronoun} for special events nor premium screenings.`;
}

export function buildPassOrderEmailText(order: PassOrderSummary): string {
  const first = order.buyerName ? order.buyerName.split(/\s+/)[0] : null;

  return [
    first ? `Hi ${first},` : 'Hi there,',
    '',
    `We have received your order for ${order.quantity} \u00d7 ${order.passTypeName}. ${fulfillmentLine(order)}`,
    '',
    redemptionLine(order),
    '',
    `Paid: ${formatMoneyCompact(order.amountPaid)}`,
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

  // Mirrors buildPassOrderEmailText sentence for sentence. The two are separate
  // functions and drift silently, so they are kept in the same shape: greeting,
  // what was ordered and where it goes, what it is worth, what was paid.
  const content = `
          ${row(
            `${paragraph(greeting)}
             <div style="padding-top:8px;">${paragraph(
               `We have received your order for ${esc(order.quantity)} &times; ${esc(
                 order.passTypeName,
               )}. ${esc(fulfillmentLine(order))}`,
             )}</div>
             <div style="padding-top:8px;">${paragraph(esc(redemptionLine(order)))}</div>`,
            '28px 28px 4px',
          )}

          ${row(
            `<div style="font:600 15px/1.5 ${sans};color:${brand.ink};">Paid: ${esc(
              formatMoneyCompact(order.amountPaid),
            )}</div>`,
          )}

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
