// The default mail template — the shell every transactional email shares.
//
// Before this existed, the ticket confirmation, the auth emails, the donation
// receipt, the tribute notice and the two film-pass emails each carried their
// own copy of the same header, footer, table scaffold and hardcoded hex. Six
// copies meant a brand change was six edits, and in practice they had already
// drifted apart. Now each template supplies only its body rows and this decides
// what a Kenworthy email looks like.
//
// The constraints this markup is written against, all of them email-client
// reality rather than preference:
//
//   * Tables and inline styles. No stylesheet, no CSS custom properties, no
//     flexbox — Outlook renders through Word's engine and Gmail strips <style>
//     in several contexts.
//   * Every image is an absolute URL. Gmail and Outlook drop `data:` URIs, and
//     Gmail will not render SVG at all, so the logo is a hosted PNG.
//   * `bgcolor` attributes alongside the inline `background` styles. Outlook
//     honours the attribute when it ignores the style, which is what keeps the
//     dark header from rendering as a white band.
//   * Every HTML email ships a plain-text alternative. Those live with each
//     template, since they are copy rather than layout.

import {
  brand,
  emailLockup,
  serif,
  sans,
  SITE_URL,
  VENUE_NAME,
  BOX_OFFICE_ADDRESS,
} from './brand.ts';

// Deno globals
declare const Deno: any;

export const TICKET_REPLY_TO = Deno.env.get('TICKET_REPLY_TO') || 'events@kenworthy.org';

// The name lives in brand.ts (it is used by the .ics feed too, not just email).
// Re-exported so a template needs one import for everything it renders.
export { VENUE_NAME, VENUE_SHORT, BOX_OFFICE_ADDRESS } from './brand.ts';

/** Minimal HTML escaping for values interpolated into an email body. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Pieces a template builds its body from
// ---------------------------------------------------------------------------

/** The small uppercase label above a block. */
export function eyebrow(text: string): string {
  return `<div style="font:600 12px/1.5 ${sans};color:${brand.soft};letter-spacing:.06em;text-transform:uppercase;">${esc(text)}</div>`;
}

/** A section heading, in the serif that stands in for the site's display face. */
export function heading(text: string): string {
  return `<div style="font:700 23px/1.3 ${serif};color:${brand.ink};">${esc(text)}</div>`;
}

/** A paragraph of running copy. Pass `html` already-escaped content. */
export function paragraph(html: string): string {
  return `<div style="font:400 15px/1.6 ${sans};color:${brand.body};">${html}</div>`;
}

/** The inset callout box — used for tax receipts, fulfilment notes, messages. */
export function panel(innerHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td bgcolor="${brand.panel}" style="padding:22px;background:${brand.panel};border-radius:10px;">
        ${innerHtml}
      </td>
    </tr>
  </table>`;
}

/** The one strong call to action in a message. Amethyst, per `--primary`. */
export function primaryButton(href: string, label: string): string {
  return `<a href="${esc(href)}"
     style="display:inline-block;padding:13px 26px;background:${brand.primary};color:${brand.onPrimary};font:600 15px/1 ${sans};text-decoration:none;border-radius:7px;">
    ${esc(label)}
  </a>`;
}

/** A quieter action — calendar links, "view your card receipt". */
export function outlineButton(href: string, label: string): string {
  return `<a href="${esc(href)}"
     style="display:inline-block;padding:11px 20px;margin:0 4px;border:1px solid ${brand.outline};color:${brand.ink};font:600 13px/1 ${sans};text-decoration:none;border-radius:6px;">
    ${esc(label)}
  </a>`;
}

/** Wrap body content in a padded row of the shell's table. */
export function row(innerHtml: string, padding = '22px 28px 0'): string {
  return `<tr><td style="padding:${padding};">${innerHtml}</td></tr>`;
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

export interface EmailLayoutOptions {
  /** Document title, and what a client shows as the message name. */
  title: string;
  /** Hidden preview text — what shows next to the subject in the inbox list. */
  preheader?: string;
  /** The body: a sequence of `<tr>` rows, usually built with `row()`. */
  contentHtml: string;
  /** An extra line in the footer above the standard sign-off, if the message needs one. */
  footerNote?: string;
  /** Override the site origin used for the logo URL. Defaults to `SITE_URL`. */
  siteUrl?: string;
  /** Card width in pixels. 560 suits most; auth emails use 520. */
  width?: number;
}

/**
 * Wrap a message body in the Kenworthy shell.
 *
 * The header is the site's own black with the cream wordmark on it. The body is
 * the site's `--paper` surface — see the note in brand.ts for why a receipt is
 * paper rather than black.
 *
 * The logo's `alt` text carries the venue name and is styled inline, so a client
 * with images off renders the name in roughly the right place at roughly the
 * right size rather than showing a broken-image box. That is the images-off
 * fallback; the tagline below it is real text and always shows.
 */
export function emailLayout(opts: EmailLayoutOptions): string {
  const width = opts.width ?? 560;
  // Resolved per email, so the centenary lockup retires on schedule without a
  // redeploy. See emailLockup() in brand.ts.
  const logo = emailLockup(opts.siteUrl ?? SITE_URL);

  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${brand.paper};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${brand.paper}" style="background:${brand.paper};">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:${width}px;background:${brand.surface};border-radius:14px;overflow:hidden;">
          <tr>
            <td bgcolor="${brand.bg}" style="padding:24px 28px;background:${brand.bg};">
              <img src="${esc(logo.url)}"
                   alt="${esc(VENUE_NAME)}"
                   width="${logo.width}" height="${logo.height}"
                   style="display:block;width:${logo.width}px;height:auto;border:0;outline:none;text-decoration:none;color:${brand.cream};font:700 19px/1.3 ${serif};" />
              <div style="font:400 12px/1.5 ${sans};color:${brand.mutedText};letter-spacing:.08em;text-transform:uppercase;padding-top:8px;">
                Moscow, Idaho · Since 1926
              </div>
            </td>
          </tr>

          ${opts.contentHtml}

          <tr>
            <td bgcolor="${brand.footerBand}" style="padding:20px 28px 26px;background:${brand.footerBand};border-top:1px solid ${brand.rule};">
              <div style="font:400 13px/1.6 ${sans};color:${brand.faint};">
                ${opts.footerNote ? `${opts.footerNote}<br /><br />` : ''}Questions? Reply to this email or write to
                <a href="mailto:${esc(TICKET_REPLY_TO)}" style="color:${brand.primary};text-decoration:none;">${esc(TICKET_REPLY_TO)}</a>.<br />
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

/**
 * The sign-off every plain-text alternative ends with, so the text and HTML
 * versions agree about who sent the message.
 */
export function textFooter(note?: string): string[] {
  const lines: string[] = [];
  if (note) lines.push(note, '');
  lines.push(`Questions: ${TICKET_REPLY_TO}`, VENUE_NAME, BOX_OFFICE_ADDRESS);
  return lines;
}
