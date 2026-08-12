// Copy and markup for Supabase auth emails, sent by us through Resend.
//
// Supabase's Send Email Hook hands us the token and the action type instead of
// mailing the user itself, so every auth email — password resets, signup
// confirmations, magic links, email changes — goes out over Resend's API. No
// SMTP is configured anywhere, and Supabase's rate-limited built-in mailer is
// never used.

// Deno globals
declare const Deno: any;

const REPLY_TO = Deno.env.get('TICKET_REPLY_TO') || 'events@kenworthy.org';

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
    subject: "You've been invited to The Kenworthy",
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

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
      <div style="font:700 34px/1.2 'SFMono-Regular',Consolas,monospace;letter-spacing:.18em;color:#26211d;padding:8px 0 4px;">
        ${esc(opts.token ?? '')}
      </div>`
    : `
      <a href="${esc(opts.verifyUrl)}"
         style="display:inline-block;padding:13px 26px;background:#26211d;color:#ffffff;font:600 15px/1 Helvetica,Arial,sans-serif;text-decoration:none;border-radius:7px;">
        ${esc(c.cta)}
      </a>
      <div style="font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#8b847d;padding-top:14px;word-break:break-all;">
        Or paste this into your browser:<br />${esc(opts.verifyUrl)}
      </div>`;

  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f0ece7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0ece7;">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:26px 28px;background:#26211d;">
              <div style="font:700 19px/1.3 Georgia,'Times New Roman',serif;color:#ffffff;">The Kenworthy</div>
              <div style="font:400 12px/1.5 Helvetica,Arial,sans-serif;color:#b9b1a9;letter-spacing:.08em;text-transform:uppercase;padding-top:3px;">
                Performing Arts Centre · Moscow, Idaho
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:32px 28px 28px;">
              <div style="font:700 23px/1.3 Georgia,'Times New Roman',serif;color:#26211d;padding-bottom:10px;">
                ${esc(c.heading)}
              </div>
              <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#55504b;padding-bottom:22px;">
                ${esc(c.body)}
              </div>
              ${action}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 26px;background:#faf8f6;border-top:1px solid #e6e2dd;">
              <div style="font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#8b847d;">
                If you did not request this, you can ignore this email — nothing will change.
                Questions? Write to <a href="mailto:${esc(REPLY_TO)}" style="color:#b82a6b;text-decoration:none;">${esc(REPLY_TO)}</a>.
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

export function buildAuthEmailText(opts: {
  action: string;
  verifyUrl: string;
  token?: string;
}): string {
  const c = copyFor(opts.action);
  const lines = [c.heading, '', c.body, ''];
  if (opts.action === 'reauthentication') lines.push(`Code: ${opts.token ?? ''}`);
  else lines.push(opts.verifyUrl);
  lines.push(
    '',
    'If you did not request this, you can ignore this email — nothing will change.',
    `Questions? Write to ${REPLY_TO}.`,
    'The Kenworthy Performing Arts Centre, Moscow, Idaho',
  );
  return lines.join('\n');
}

export { COPY as AUTH_EMAIL_COPY };
