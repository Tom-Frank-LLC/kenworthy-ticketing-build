// Copy and markup for Supabase auth emails, sent by us through Resend.
//
// Supabase's Send Email Hook hands us the token and the action type instead of
// mailing the user itself, so every auth email — password resets, signup
// confirmations, magic links, email changes — goes out over Resend's API. No
// SMTP is configured anywhere, and Supabase's rate-limited built-in mailer is
// never used.

import { brand, serif, sans, mono } from './brand.ts';
import {
  emailLayout,
  esc,
  heading,
  paragraph,
  primaryButton,
  row,
  textFooter,
} from './email-layout.ts';

// The shell, palette and venue name come from email-layout.ts / brand.ts, so
// these emails are visually identical to the ticket, receipt and film-pass
// ones. Re-exported because auth_email_test.ts imports `esc` from here.
export { esc };

/** Shown in both the HTML footer and the plain-text sign-off. */
const NOT_YOU = 'If you did not request this, you can ignore this email — nothing will change.';

/** The action types Supabase's Send Email Hook can deliver. */
export type AuthAction =
  | 'signup'
  | 'recovery'
  | 'magiclink'
  | 'invite'
  | 'email_change'
  | 'email_change_current'
  | 'email_change_new'
  | 'reauthentication';

interface Copy {
  subject: string;
  heading: string;
  body: string;
  cta: string;
}

const COPY: Record<AuthAction, Copy> = {
  recovery: {
    subject: 'Reset your Kenworthy password',
    heading: 'Reset your password',
    body: 'Use the button below to choose a new password. The link is single-use and expires shortly.',
    cta: 'Reset password',
  },
  signup: {
    subject: 'Confirm your email address',
    heading: 'Confirm your email',
    body: 'Confirm this address to finish setting up your Kenworthy account.',
    cta: 'Confirm email',
  },
  magiclink: {
    subject: 'Your Kenworthy sign-in link',
    heading: 'Sign in',
    body: 'Use the button below to sign in. The link is single-use and expires shortly.',
    cta: 'Sign in',
  },
  invite: {
    subject: "You've been invited to the Kenworthy Performing Arts Centre",
    heading: "You've been invited",
    body: 'Accept the invitation to set up your Kenworthy account.',
    cta: 'Accept invitation',
  },
  email_change: {
    subject: 'Confirm your new email address',
    heading: 'Confirm your new email',
    body: 'Confirm this address to finish changing the email on your Kenworthy account.',
    cta: 'Confirm email change',
  },
  email_change_current: {
    subject: 'Confirm the change to your email address',
    heading: 'Confirm your email change',
    body: 'Confirm this change from your current address to finish updating your Kenworthy account.',
    cta: 'Confirm email change',
  },
  email_change_new: {
    subject: 'Confirm your new email address',
    heading: 'Confirm your new email',
    body: 'Confirm this address to finish changing the email on your Kenworthy account.',
    cta: 'Confirm email change',
  },
  reauthentication: {
    subject: 'Your Kenworthy verification code',
    heading: 'Verification code',
    body: 'Enter this code to confirm it is you.',
    cta: '',
  },
};

export function copyFor(action: string): Copy {
  return COPY[action as AuthAction] ?? COPY.magiclink;
}

/**
 * The link the user clicks.
 *
 * Points at the Supabase auth server's verify endpoint — that is what
 * exchanges the token hash for a session and then bounces the browser to
 * redirect_to. Building it ourselves is the part the hook makes us responsible
 * for.
 */
export function buildVerifyUrl(
  supabaseUrl: string,
  tokenHash: string,
  action: string,
  redirectTo: string,
): string {
  const base = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/verify`;
  const params = new URLSearchParams({ token: tokenHash, type: action });
  if (redirectTo) params.set('redirect_to', redirectTo);
  return `${base}?${params.toString()}`;
}

export function buildAuthEmailHtml(opts: {
  action: string;
  verifyUrl: string;
  /** Numeric code, shown as the fallback and as the whole point for reauthentication. */
  token?: string;
}): string {
  const c = copyFor(opts.action);
  const isCodeOnly = opts.action === 'reauthentication';

  const action = isCodeOnly
    ? `
      <div style="font:700 34px/1.2 ${mono};letter-spacing:.18em;color:${brand.ink};padding:8px 0 4px;">
        ${esc(opts.token ?? '')}
      </div>`
    : `
      ${primaryButton(opts.verifyUrl, c.cta)}
      <div style="font:400 12px/1.6 ${sans};color:${brand.faint};padding-top:14px;word-break:break-all;">
        Or paste this into your browser:<br />${esc(opts.verifyUrl)}
      </div>`;

  const content = `
          <tr>
            <td align="center" style="padding:32px 28px 32px;">
              <div style="padding-bottom:10px;">${heading(c.heading)}</div>
              <div style="padding-bottom:22px;">${paragraph(esc(c.body))}</div>
              ${action}
            </td>
          </tr>`;

  return emailLayout({
    title: c.subject,
    preheader: esc(c.body),
    contentHtml: content,
    footerNote: NOT_YOU,
    // Narrower than the ticket email: this is one heading, one sentence and one
    // button, and a 560px card leaves it stranded in white space.
    width: 520,
  });
}

export function buildAuthEmailText(opts: {
  action: string;
  verifyUrl: string;
  token?: string;
}): string {
  const c = copyFor(opts.action);
  const lines = [c.heading, '', c.body, ''];
  if (opts.action === 'reauthentication') lines.push(`Code: ${opts.token ?? ''}`);
  else lines.push(opts.verifyUrl);
  lines.push('', ...textFooter(NOT_YOU));
  return lines.join('\n');
}

export { COPY as AUTH_EMAIL_COPY };
