// Staff notifications: which inboxes inside the building hear about what.
//
// The first case is the rental form. Until this existed a marquee or theatre
// request landed in `rental_requests` and in the admin Rentals queue, and that
// was all — nobody was told. The `rental-request` function's own header named
// "a notification" as one of the things its single chokepoint exists to make
// possible; this is that notification.
//
// Two decisions shape the module, and both are about *who* gets mailed:
//
//   1. Recipients come from admin configuration and from nowhere else. The
//      public form is unauthenticated, so any path by which its payload could
//      choose a To address is an open relay with our verified sender on it.
//      The submitter's address is used as Reply-To — the one header a staff
//      member replying needs — and never as To, Cc or Bcc. `notifyStaff` takes
//      no address parameter at all, so a future caller cannot get this wrong
//      by accident.
//
//   2. Settings live in `app_config` under one key, `staff_notifications`,
//      keyed by notification type. app_config is already audited (every write
//      lands in admin_audit_log with the key name) and already has the RLS
//      shape for a per-key admin write, so a new table would be a second
//      mechanism for the same thing. A missing or malformed entry falls back
//      to the type's default recipients, so the notification works before
//      anyone has opened the admin screen and survives a bad edit.
//
// Adding a notification type later is one entry in STAFF_NOTIFICATION_TYPES
// plus one `notifyStaff` call at the hook that knows the event happened. The
// admin screen (src/components/admin/NotificationsTab.tsx) renders from its
// own copy of the registry in src/lib/staffNotifications.ts — the two are
// paired the way flags.ts is paired with src/lib/flags.ts, because the Vite
// build and the Deno functions cannot share a module.

import { sendTransactionalEmail } from './deliver.ts';
import { SITE_URL, brand, sans } from './brand.ts';
import {
  emailLayout,
  esc,
  eyebrow,
  heading,
  panel,
  paragraph,
  primaryButton,
  row,
} from './email-layout.ts';

/** The app_config key the settings live under. */
export const STAFF_NOTIFICATIONS_CONFIG_KEY = 'staff_notifications';

export interface StaffNotificationType {
  /** What the admin screen calls it. */
  label: string;
  /** Where it fires, in one sentence. */
  description: string;
  /** Who hears about it when nothing has been configured. */
  defaultRecipients: readonly string[];
}

/**
 * The registry. One entry per kind of thing staff can be told about.
 *
 * `rental_request` covers both the marquee form and the full theatre /
 * Backstage form, because both post to the same function and land in the same
 * queue; the message body tells them apart, the recipient list does not need
 * to. Candidates noted but not built: a new donation, a comp issued, an
 * undelivered confirmation, a Backstage or contact enquiry.
 */
export const STAFF_NOTIFICATION_TYPES = {
  rental_request: {
    label: 'Rental and marquee requests',
    description: 'Someone submits the marquee form or the theatre / Backstage rental form.',
    defaultRecipients: ['events@kenworthy.org'],
  },
} as const satisfies Record<string, StaffNotificationType>;

export type StaffNotificationKind = keyof typeof STAFF_NOTIFICATION_TYPES;

export interface StaffNotificationSetting {
  enabled: boolean;
  recipients: string[];
}

// Same shape as the form-side check in rental-request: one @, no whitespace,
// a dot in the domain. Enough to keep a stray word or a pasted URL out of a
// To header; Resend does the real validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turn whatever is stored for one kind into something safe to send with.
 *
 * Tolerant on purpose. The value is JSON an admin edited through a form, and
 * the failure mode of a strict parser here is "a typo silently stopped every
 * rental notification". So: a missing entry is enabled with the defaults; an
 * `enabled` that is not literally `false` is on; recipients that are not
 * strings or not addresses are dropped; and an empty list after dropping
 * falls back to the defaults rather than to nobody. Turning a notification
 * off is `enabled: false`, and only that — the one explicit way to say
 * "nobody", so it cannot happen by accident.
 */
export function resolveStaffNotificationSetting(
  config: unknown,
  kind: StaffNotificationKind,
): StaffNotificationSetting {
  const defaults = [...STAFF_NOTIFICATION_TYPES[kind].defaultRecipients];
  const entry =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)[kind]
      : undefined;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { enabled: true, recipients: defaults };
  }
  const { enabled, recipients } = entry as { enabled?: unknown; recipients?: unknown };

  const seen = new Set<string>();
  const valid: string[] = [];
  if (Array.isArray(recipients)) {
    for (const r of recipients) {
      if (typeof r !== 'string') continue;
      const address = r.trim();
      const key = address.toLowerCase();
      if (!EMAIL_RE.test(address) || seen.has(key)) continue;
      seen.add(key);
      valid.push(address);
    }
  }

  return {
    enabled: enabled !== false,
    recipients: valid.length ? valid : defaults,
  };
}

/**
 * Read the setting for one kind from app_config.
 *
 * A failed read resolves to the defaults, not to silence: the database being
 * briefly unreachable for a config lookup is not a reason to drop a request
 * on the floor, and the defaults are the addresses that were hard-coded
 * before any of this was configurable.
 */
export async function readStaffNotificationSetting(
  admin: any,
  kind: StaffNotificationKind,
): Promise<StaffNotificationSetting> {
  try {
    const { data, error } = await admin
      .from('app_config')
      .select('value')
      .eq('key', STAFF_NOTIFICATIONS_CONFIG_KEY)
      .maybeSingle();
    if (error) {
      console.error('[staff-notifications] config read failed, using defaults', error);
      return resolveStaffNotificationSetting(null, kind);
    }
    return resolveStaffNotificationSetting(data?.value ?? null, kind);
  } catch (err) {
    console.error('[staff-notifications] config read threw, using defaults', err);
    return resolveStaffNotificationSetting(null, kind);
  }
}

export interface StaffMessage {
  subject: string;
  html: string;
  text: string;
}

export interface NotifyStaffOptions {
  /**
   * Who a staff reply should go to — the person who submitted the form. This
   * is the only place a submitter's address enters the message, and it is a
   * Reply-To header, not a recipient.
   */
  replyTo?: string | null;
}

export interface NotifyStaffOutcome {
  kind: StaffNotificationKind;
  /** False when the admin has switched this kind off. */
  enabled: boolean;
  /** Addresses that accepted the message. */
  sent: string[];
  /** Addresses that did not, and why. */
  failed: { to: string; error: string }[];
}

/**
 * Send one staff message to everyone configured for `kind`.
 *
 * Best effort by contract. This runs after the thing it reports on has already
 * been saved and acknowledged to the public user, so nothing here may throw
 * back into that path: every failure is logged, recorded in the outcome, and
 * swallowed. One address bouncing does not stop the others — each recipient
 * is its own send, which also gives each its own line in the audit log.
 */
export async function notifyStaff(
  admin: any,
  kind: StaffNotificationKind,
  message: StaffMessage,
  opts: NotifyStaffOptions = {},
): Promise<NotifyStaffOutcome> {
  const outcome: NotifyStaffOutcome = { kind, enabled: true, sent: [], failed: [] };
  try {
    const setting = await readStaffNotificationSetting(admin, kind);
    outcome.enabled = setting.enabled;
    if (!setting.enabled) {
      console.log(`[staff-notifications] ${kind} is switched off; not sending`);
      return outcome;
    }

    const replyTo = opts.replyTo && EMAIL_RE.test(opts.replyTo) ? opts.replyTo : undefined;

    for (const to of setting.recipients) {
      try {
        const result = await sendTransactionalEmail(to, message.subject, message.html, message.text, {
          replyTo,
        });
        if (result.ok) outcome.sent.push(to);
        else outcome.failed.push({ to, error: result.error });
      } catch (err) {
        outcome.failed.push({ to, error: String(err) });
      }
    }

    if (outcome.failed.length) {
      console.error(`[staff-notifications] ${kind}: ${outcome.failed.length} send(s) failed`, outcome.failed);
    }
  } catch (err) {
    console.error(`[staff-notifications] ${kind} threw`, err);
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// rental_request
// ---------------------------------------------------------------------------

/** The columns of a rental_requests row the message reads. All optional but id. */
export interface RentalRequestSummary {
  id: string;
  applicant_name?: string | null;
  email?: string | null;
  phone?: string | null;
  organization_name?: string | null;
  event_title?: string | null;
  venue_area?: string | null;
  marquee_text?: string | null;
  proposed_date?: string | null;
  end_date?: string | null;
  expected_guests?: number | null;
  event_description?: string | null;
}

/**
 * What the form's `venue_area` values mean to a reader. The keys mirror the
 * radio in src/pages/RentalRequest.tsx plus the marquee form's fixed value;
 * anything else falls through to the raw value with its underscores removed,
 * so a new option is legible before anyone updates this list.
 */
const VENUE_AREA_LABELS: Record<string, string> = {
  marquee: 'Marquee',
  main_auditorium_projection: 'Main Auditorium with projection',
  main_auditorium_no_projection: 'Main Auditorium without projection',
  main_stage: 'Main Stage',
  backstage_speakeasy: 'Backstage Speakeasy',
};

export function describeVenueArea(area: string | null | undefined): string {
  if (!area) return 'Not specified';
  return VENUE_AREA_LABELS[area] ?? area.replace(/_/g, ' ');
}

/**
 * A YYYY-MM-DD from `<input type="date">` as a reader would say it. Parsed as
 * UTC midnight and formatted in UTC so the calendar date never shifts by a
 * day — the row stores a date, not an instant.
 */
export function describeDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function describeDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const from = describeDate(start);
  const to = end && end !== start ? describeDate(end) : null;
  if (!from) return 'No date given';
  return to ? `${from} to ${to}` : from;
}

/** Where staff act on a request: the admin Rentals queue. */
export function rentalQueueUrl(siteUrl: string = SITE_URL): string {
  return `${siteUrl.replace(/\/$/, '')}/admin?section=rentals`;
}

/**
 * The message for one new request. Pure, so it can be tested without a
 * server, and so the function that sends it stays about sending.
 *
 * Marquee and theatre requests get different subjects and a different lead
 * detail — the marquee text is the whole request for one, the venue area is
 * the first question for the other — but the same shape, because the same
 * people read both and act on both from the same queue.
 */
export function buildRentalRequestNotification(
  r: RentalRequestSummary,
  opts: { queueUrl?: string } = {},
): StaffMessage & { isMarquee: boolean } {
  const isMarquee = r.venue_area === 'marquee';
  const name = (r.applicant_name || '').trim() || 'Unknown';
  const org = (r.organization_name || '').trim();
  const who = org ? `${name} (${org})` : name;
  const queueUrl = opts.queueUrl ?? rentalQueueUrl();
  const when = describeDateRange(r.proposed_date, r.end_date);

  const subject = isMarquee ? `New marquee request — ${name}` : `New rental request — ${name}`;

  const details: [string, string | null | undefined][] = [
    ['Who', who],
    ['Email', r.email],
    ['Phone', r.phone],
    ['Event', r.event_title],
    isMarquee ? ['Marquee text', r.marquee_text] : ['Venue area', describeVenueArea(r.venue_area)],
    ['Dates', when],
    ['Expected guests', r.expected_guests != null ? String(r.expected_guests) : null],
  ];
  // The theatre form carries a marquee line too, as one field among many.
  if (!isMarquee && r.marquee_text) details.push(['Marquee text', r.marquee_text]);

  const present = details.filter(([, v]) => v != null && String(v).trim() !== '') as [string, string][];

  const label = (s: string) =>
    `<div style="font:600 11px/1.4 ${sans};color:${brand.soft};letter-spacing:.08em;text-transform:uppercase;padding-top:12px;">${esc(s)}</div>`;
  const value = (s: string) =>
    `<div style="font:400 15px/1.5 ${sans};color:${brand.ink};white-space:pre-wrap;">${esc(s)}</div>`;

  const description = (r.event_description || '').trim();

  const content = `
    ${row(
      `${eyebrow(isMarquee ? 'Marquee request' : 'Rental request')}
       <div style="padding-top:8px;">${heading(subject)}</div>
       <div style="padding-top:8px;">${paragraph(
         `Submitted through the public ${isMarquee ? 'marquee' : 'rental'} form and waiting in the Rentals queue.`,
       )}</div>`,
      '28px 28px 4px',
    )}
    ${row(panel(present.map(([k, v]) => `${label(k)}${value(v)}`).join('')))}
    ${
      description
        ? row(`${label('Description')}${value(description)}`, '4px 28px 0')
        : ''
    }
    <tr>
      <td align="center" style="padding:22px 28px 0;">
        ${primaryButton(queueUrl, 'Open the Rentals queue')}
      </td>
    </tr>
    ${row(paragraph(`Replying to this email goes to ${esc(r.email || 'the requester')}.`), '18px 28px 0')}
    <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>`;

  const html = emailLayout({
    title: subject,
    preheader: `${who} — ${when}`,
    contentHtml: content,
  });

  const lines: string[] = [subject, ''];
  for (const [k, v] of present) lines.push(`${k}: ${v}`);
  if (description) lines.push('', 'Description:', description);
  lines.push('', 'Open the Rentals queue:', queueUrl);
  lines.push('', `Replying to this email goes to ${r.email || 'the requester'}.`);

  return { subject, html, text: lines.join('\n'), isMarquee };
}

/**
 * The rental_request hook, in one call: build the message and send it to
 * whoever is configured, with the submitter as Reply-To.
 */
export function notifyStaffOfRentalRequest(
  admin: any,
  request: RentalRequestSummary,
): Promise<NotifyStaffOutcome> {
  const message = buildRentalRequestNotification(request);
  return notifyStaff(admin, 'rental_request', message, { replyTo: request.email });
}
