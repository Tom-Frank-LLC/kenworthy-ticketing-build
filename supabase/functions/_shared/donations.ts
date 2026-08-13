// Donation receipts and tribute notices.
//
// The bug this fixes: the Donate page told every donor "a receipt is on its
// way to {email}" and nothing in this codebase ever sent one. The receipt it
// meant was Square's own — which Square sends only from a production account,
// and never from the sandbox — so in testing the donor got silence, and in
// production they got a card receipt that says nothing about a 501(c)(3) gift
// and cannot be used as a tax record. Separately, `notify_email` — the person a
// tribute gift is made in honour or memory *for* — was collected on the form,
// validated, stored on the row, and then read by nothing at all.
//
// So there are two messages here, and they are deliberately different:
//
//   receipt  -> the donor. Amount, date, the tax-deductible acknowledgment with
//               the EIN, and the Square receipt link when we have one.
//   tribute  -> the person being notified. Who gave, in whose honour or memory,
//               and the donor's message. Never the amount: the size of someone
//               else's gift is not the recipient's business, and every
//               fundraising CRM omits it for the same reason.
//
// Composition is pure and lives at the top (covered by donations_test.ts);
// sending is at the bottom and mirrors the ticket path in deliver.ts — dispatch
// fire-and-forget, then write every outcome back to the row, because a
// fire-and-forget send that fails silently is exactly how this went unnoticed
// the first time.

import { esc } from './notify.ts';
import { sendTransactionalEmail } from './deliver.ts';
import { syncDonationToLgl } from './lgl.ts';

// Deno globals
declare const Deno: any;

const TICKET_REPLY_TO = Deno.env.get('TICKET_REPLY_TO') || 'events@kenworthy.org';
const VENUE_NAME = 'The Kenworthy Performing Arts Centre';
const BOX_OFFICE_ADDRESS = '508 S Main St, Moscow, ID 83843';

/**
 * The charity's EIN, stated on every receipt.
 *
 * Same number the Donate page prints, and the reason a receipt exists at all: a
 * donor substantiating a deduction needs the organisation's tax ID and a
 * statement about what they got back for the gift.
 */
export const TAX_ID = '82-0519693';

export type DedicationType = 'in_honor' | 'in_memory';

export interface DonationSummary {
  amountCents: number;
  donorName: string | null;
  dedicationType: DedicationType | null;
  dedicateTo: string | null;
  notifyName: string | null;
  message: string | null;
  /** Square's own receipt, when the charge produced one. */
  receiptUrl: string | null;
  /** ISO timestamp of the gift — the date that goes on the receipt. */
  createdAt: string;
  /** True when this gift was added to a ticket purchase rather than given alone. */
  bundled: boolean;
}

export function formatMoney(cents: number): string {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

/** "August 13, 2026" — the gift date, in the theatre's own words. */
export function formatGiftDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}

/**
 * "In honor of Jane Doe" / "In memory of Jane Doe", or null.
 *
 * Null when either half is missing: a dedication type with nobody named is not
 * a dedication, and printing "In memory of" followed by nothing is worse than
 * printing nothing.
 */
export function dedicationPhrase(
  type: DedicationType | null,
  dedicateTo: string | null,
): string | null {
  if (!type || !dedicateTo?.trim()) return null;
  const label = type === 'in_memory' ? 'In memory of' : 'In honor of';
  return `${label} ${dedicateTo.trim()}`;
}

// ---------------------------------------------------------------------------
// Donor receipt
// ---------------------------------------------------------------------------

export function buildReceiptSubject(d: DonationSummary): string {
  return `Your ${formatMoney(d.amountCents)} gift to The Kenworthy`;
}

export function buildReceiptText(d: DonationSummary): string {
  const first = d.donorName ? d.donorName.trim().split(/\s+/)[0] : null;
  const dedication = dedicationPhrase(d.dedicationType, d.dedicateTo);
  const lines: string[] = [];

  lines.push(first ? `Hi ${first},` : 'Hi there,');
  lines.push('');
  lines.push(
    d.bundled
      ? 'Thank you for adding a gift to your ticket order. It goes straight to keeping the marquee lit.'
      : 'Thank you. Your gift goes straight to keeping the marquee lit at 508 South Main.',
  );
  lines.push('');
  lines.push(`Gift: ${formatMoney(d.amountCents)}`);
  lines.push(`Date: ${formatGiftDate(d.createdAt)}`);
  if (dedication) lines.push(dedication);
  lines.push('');
  lines.push(
    `${VENUE_NAME} is a 501(c)(3) non-profit organisation, Tax ID ${TAX_ID}. ` +
      'No goods or services were provided in exchange for this contribution, so it is ' +
      'tax-deductible to the full extent allowed by law. Keep this receipt for your records.',
  );
  if (d.bundled) {
    lines.push('');
    lines.push(
      'Your tickets are confirmed separately and were emailed to you on their own — this ' +
        'message covers only the donation. Sales tax applies to tickets; your gift was not taxed.',
    );
  }
  if (d.receiptUrl) {
    lines.push('');
    lines.push(`Card receipt from Square: ${d.receiptUrl}`);
  }
  lines.push('');
  lines.push(`Questions: ${TICKET_REPLY_TO}`);
  lines.push(VENUE_NAME);
  lines.push(BOX_OFFICE_ADDRESS);
  return lines.join('\n');
}

export function buildReceiptHtml(d: DonationSummary): string {
  const first = d.donorName ? esc(d.donorName.trim().split(/\s+/)[0]) : null;
  const greeting = first ? `Hi ${first},` : 'Hi there,';
  const dedication = dedicationPhrase(d.dedicationType, d.dedicateTo);

  // Same table-and-inline-styles markup as the ticket and film-pass emails.
  // It is the layout mail clients render the same way twice.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(buildReceiptSubject(d))}</title>
</head>
<body style="margin:0;padding:0;background:#f0ece7;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Your receipt for a ${esc(formatMoney(d.amountCents))} tax-deductible gift to The Kenworthy.
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
                ${
                  d.bundled
                    ? 'Thank you for adding a gift to your ticket order — it goes straight to keeping the marquee lit.'
                    : 'Thank you. Your gift goes straight to keeping the marquee lit at 508 South Main.'
                }
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 0;">
              <div style="font:700 30px/1.2 Georgia,'Times New Roman',serif;color:#26211d;">
                ${esc(formatMoney(d.amountCents))}
              </div>
              <div style="font:400 14px/1.6 Helvetica,Arial,sans-serif;color:#8b847d;padding-top:6px;">
                ${esc(formatGiftDate(d.createdAt))}
              </div>${
                dedication
                  ? `
              <div style="font:400 15px/1.6 Georgia,'Times New Roman',serif;color:#55504b;padding-top:10px;font-style:italic;">
                ${esc(dedication)}
              </div>`
                  : ''
              }
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:22px;background:#f6f3ef;border-radius:10px;">
                    <div style="font:600 13px/1.4 Helvetica,Arial,sans-serif;color:#6b6560;letter-spacing:.06em;text-transform:uppercase;padding-bottom:8px;">
                      Your tax receipt
                    </div>
                    <div style="font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#55504b;">
                      ${esc(VENUE_NAME)} is a 501(c)(3) non-profit organisation,
                      Tax ID <strong style="color:#26211d;">${esc(TAX_ID)}</strong>.
                      No goods or services were provided in exchange for this contribution,
                      so it is tax-deductible to the full extent allowed by law.
                      Keep this email for your records.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>${
            d.bundled
              ? `

          <tr>
            <td style="padding:18px 28px 0;">
              <div style="font:400 13px/1.7 Helvetica,Arial,sans-serif;color:#8b847d;">
                Your tickets are confirmed and were sent in their own email — this one covers
                only the donation. Sales tax applies to tickets; your gift was not taxed.
              </div>
            </td>
          </tr>`
              : ''
          }${
            d.receiptUrl
              ? `

          <tr>
            <td align="center" style="padding:22px 28px 0;">
              <a href="${esc(d.receiptUrl)}"
                 style="display:inline-block;padding:11px 20px;border:1px solid #cfc8c1;color:#26211d;font:600 14px/1 Helvetica,Arial,sans-serif;text-decoration:none;border-radius:6px;">
                View your card receipt
              </a>
            </td>
          </tr>`
              : ''
          }

          <tr>
            <td style="padding:22px 28px 28px;">
              <div style="font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#9a938c;border-top:1px solid #e6e2dd;padding-top:16px;">
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

// ---------------------------------------------------------------------------
// Tribute notice — to the person the gift honours or remembers
// ---------------------------------------------------------------------------

export function buildTributeSubject(d: DonationSummary): string {
  return d.dedicationType === 'in_memory'
    ? 'A gift to The Kenworthy in memory of someone you love'
    : 'A gift to The Kenworthy in your honor';
}

/** The donor as the notified person should see them named. */
function donorLabel(d: DonationSummary): string {
  const name = d.donorName?.trim();
  return name || 'Someone';
}

export function buildTributeText(d: DonationSummary): string {
  const first = d.notifyName ? d.notifyName.trim().split(/\s+/)[0] : null;
  const inWhat = d.dedicationType === 'in_memory' ? 'in memory' : 'in honor';
  const who = d.dedicateTo?.trim();
  const lines: string[] = [];

  lines.push(first ? `Hi ${first},` : 'Hi there,');
  lines.push('');
  lines.push(
    `${donorLabel(d)} has made a donation to ${VENUE_NAME} ${inWhat} of ${who || 'someone dear to them'}.`,
  );
  if (d.message) {
    lines.push('');
    lines.push('They wanted you to have this message:');
    lines.push('');
    lines.push(`  ${d.message}`);
  }
  lines.push('');
  lines.push(
    'Gifts like this one keep a 1926 theatre running — the projector, the marquee, and the ' +
      'seats a hundred years of this town has sat in.',
  );
  lines.push('');
  lines.push('With gratitude,');
  lines.push(VENUE_NAME);
  lines.push(BOX_OFFICE_ADDRESS);
  lines.push('');
  lines.push(`Questions: ${TICKET_REPLY_TO}`);
  return lines.join('\n');
}

export function buildTributeHtml(d: DonationSummary): string {
  const first = d.notifyName ? esc(d.notifyName.trim().split(/\s+/)[0]) : null;
  const greeting = first ? `Hi ${first},` : 'Hi there,';
  const inWhat = d.dedicationType === 'in_memory' ? 'in memory' : 'in honor';
  const who = esc(d.dedicateTo?.trim() || 'someone dear to them');

  // No amount anywhere in this message, by design — see the note at the top.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(buildTributeSubject(d))}</title>
</head>
<body style="margin:0;padding:0;background:#f0ece7;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${esc(donorLabel(d))} made a gift to The Kenworthy ${inWhat} of ${who}.
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
            <td style="padding:28px 28px 0;">
              <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#55504b;">${greeting}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 0;">
              <div style="font:400 19px/1.5 Georgia,'Times New Roman',serif;color:#26211d;">
                ${esc(donorLabel(d))} has made a donation to the Kenworthy
                ${inWhat} of ${who}.
              </div>
            </td>
          </tr>${
            d.message
              ? `

          <tr>
            <td style="padding:22px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:22px;background:#f6f3ef;border-radius:10px;">
                    <div style="font:600 13px/1.4 Helvetica,Arial,sans-serif;color:#6b6560;letter-spacing:.06em;text-transform:uppercase;padding-bottom:8px;">
                      Their message
                    </div>
                    <div style="font:400 15px/1.7 Georgia,'Times New Roman',serif;color:#55504b;font-style:italic;">
                      ${esc(d.message)}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
              : ''
          }

          <tr>
            <td style="padding:22px 28px 0;">
              <div style="font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#55504b;">
                Gifts like this one keep a 1926 theatre running — the projector, the marquee,
                and the seats a hundred years of this town has sat in.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 28px;">
              <div style="font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#9a938c;border-top:1px solid #e6e2dd;padding-top:16px;">
                With gratitude,<br />
                ${esc(VENUE_NAME)} · ${esc(BOX_OFFICE_ADDRESS)}<br />
                Questions? Write to
                <a href="mailto:${esc(TICKET_REPLY_TO)}" style="color:#b82a6b;">${esc(TICKET_REPLY_TO)}</a>.
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

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type DonationEmailOutcome = 'sent' | 'skipped' | 'failed';

export interface DonationDeliveryResult {
  receipt: DonationEmailOutcome;
  tribute: DonationEmailOutcome;
  errors: string[];
}

/**
 * Send whichever of the two donation emails this row calls for.
 *
 * `admin` must be a service-role client. Safe to call twice: each message is
 * guarded by its own sent-at column, so a retry or a double dispatch does not
 * thank someone twice. `force` is for an operator re-send.
 */
export async function deliverDonationEmails(
  admin: any,
  donationId: string,
  opts: { force?: boolean } = {},
): Promise<DonationDeliveryResult> {
  const result: DonationDeliveryResult = { receipt: 'skipped', tribute: 'skipped', errors: [] };

  const { data: d, error } = await admin
    .from('donations')
    .select(
      'id, amount_cents, donor_name, donor_email, dedication_type, dedicate_to, notify_name, notify_email, message, status, square_receipt_url, created_at, source, confirmation_sent_at, notify_sent_at',
    )
    .eq('id', donationId)
    .maybeSingle();

  if (error || !d) {
    result.errors.push(error?.message || 'Donation not found');
    return result;
  }
  // Nothing is sent for a gift that did not complete: a declined card must not
  // produce a tax receipt.
  if (d.status !== 'completed') {
    result.errors.push(`Donation status is ${d.status}`);
    return result;
  }

  const summary: DonationSummary = {
    amountCents: Number(d.amount_cents) || 0,
    donorName: d.donor_name ?? null,
    dedicationType: (d.dedication_type as DedicationType | null) ?? null,
    dedicateTo: d.dedicate_to ?? null,
    notifyName: d.notify_name ?? null,
    message: d.message ?? null,
    receiptUrl: d.square_receipt_url ?? null,
    createdAt: d.created_at,
    bundled: d.source === 'ticket_checkout' || d.source === 'staff_pos',
  };

  // ---- Donor receipt ------------------------------------------------------
  if (d.donor_email && (!d.confirmation_sent_at || opts.force)) {
    const sent = await sendTransactionalEmail(
      d.donor_email,
      buildReceiptSubject(summary),
      buildReceiptHtml(summary),
      buildReceiptText(summary),
    );
    if (sent.ok) {
      result.receipt = 'sent';
      await admin
        .from('donations')
        .update({ confirmation_sent_at: new Date().toISOString(), confirmation_error: null })
        .eq('id', d.id);
    } else {
      result.receipt = 'failed';
      result.errors.push(sent.error);
      console.error('[donations] receipt failed', d.id, sent.error);
      await admin
        .from('donations')
        .update({ confirmation_error: sent.error.slice(0, 500) })
        .eq('id', d.id);
    }
  }

  // ---- Tribute notice -----------------------------------------------------
  // Only for a gift that actually names someone: a notify address with no
  // dedication would produce "in honor of nobody".
  const hasTribute =
    !!d.notify_email && !!dedicationPhrase(summary.dedicationType, summary.dedicateTo);

  if (hasTribute && (!d.notify_sent_at || opts.force)) {
    const sent = await sendTransactionalEmail(
      d.notify_email,
      buildTributeSubject(summary),
      buildTributeHtml(summary),
      buildTributeText(summary),
    );
    if (sent.ok) {
      result.tribute = 'sent';
      await admin
        .from('donations')
        .update({ notify_sent_at: new Date().toISOString(), notify_error: null })
        .eq('id', d.id);
    } else {
      result.tribute = 'failed';
      result.errors.push(sent.error);
      console.error('[donations] tribute failed', d.id, sent.error);
      await admin
        .from('donations')
        .update({ notify_error: sent.error.slice(0, 500) })
        .eq('id', d.id);
    }
  }

  return result;
}

/**
 * Everything that has to happen after a gift's money is in: the donor's
 * receipt, the tribute notice, and the gift landing in Little Green Light.
 *
 * Every donation path calls exactly this — the Donate page, a gift bundled with
 * an online ticket order, and one taken at the box office — so a donation is
 * acknowledged and recorded in the CRM the same way regardless of which door it
 * came through.
 *
 * Kept off the request's critical path by waitUntil: a slow Resend or a slow
 * LGL must never delay the thank-you screen, and neither can fail a payment
 * that already went through. Both halves write their own outcome to the
 * donation row, so a failure is visible in the admin instead of lost — which is
 * what went wrong the first time.
 */
export function settleDonation(admin: any, donationId: string): Promise<void> {
  const work = (async () => {
    const [emails, lgl] = await Promise.all([
      deliverDonationEmails(admin, donationId).catch((e): DonationDeliveryResult => ({
        receipt: 'failed',
        tribute: 'failed',
        errors: [String(e)],
      })),
      syncDonationToLgl(admin, donationId).catch((e) => ({
        ok: false as const,
        error: String(e),
        status: 500,
      })),
    ]);
    if (emails.errors.length) console.error('[donations] email issues', donationId, emails.errors);
    if (!lgl.ok) console.error('[donations] lgl sync failed', donationId, lgl.error);
  })();

  // @ts-ignore — EdgeRuntime exists only in the Supabase edge runtime.
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  }
  return work;
}
