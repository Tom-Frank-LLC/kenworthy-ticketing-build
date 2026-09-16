/**
 * Staff notifications — the settings the admin Notifications screen edits.
 *
 * The counterpart to `supabase/functions/_shared/staff_notifications.ts`,
 * which is where the emails are actually sent. The two carry the same registry
 * and the same parsing rules on purpose: the Vite build cannot import a Deno
 * module, and a screen that shows "goes to events@" while the function mails
 * someone else is worse than no screen. When you add a notification type,
 * add it in both files.
 *
 * Storage is one `app_config` row, key `staff_notifications`, shaped
 * `{ [kind]: { enabled: boolean, recipients: string[] } }`. Recipients in that
 * row are the only place a To address can come from — the public forms never
 * supply one — so this file is also where the address list is validated
 * before it is saved.
 */

export const STAFF_NOTIFICATIONS_CONFIG_KEY = 'staff_notifications';

export interface StaffNotificationType {
  kind: string;
  /** What the screen calls it. */
  label: string;
  /** Where it fires, in one sentence. */
  description: string;
  /** Who hears about it when nothing has been configured. */
  defaultRecipients: readonly string[];
}

export const STAFF_NOTIFICATION_TYPES: readonly StaffNotificationType[] = [
  {
    kind: 'rental_request',
    label: 'Rental and marquee requests',
    description:
      'Someone submits the marquee form or the theatre / Backstage rental form. ' +
      'The email carries their contact details, dates and message, replies go to them, ' +
      'and it links to the Rentals queue.',
    defaultRecipients: ['events@kenworthy.org'],
  },
];

export interface StaffNotificationSetting {
  enabled: boolean;
  recipients: string[];
}

export type StaffNotificationSettings = Record<string, StaffNotificationSetting>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/**
 * Read a stored value into one setting per registered kind.
 *
 * Mirrors the function's tolerance exactly: a missing or malformed entry is
 * enabled with the defaults, only a literal `false` turns a kind off, junk
 * recipients are dropped, and an empty list means the defaults. What this
 * returns is what the function will do, which is the point of showing it.
 */
export function parseStaffNotificationSettings(raw: unknown): StaffNotificationSettings {
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: StaffNotificationSettings = {};
  for (const type of STAFF_NOTIFICATION_TYPES) {
    const entry = root[type.kind];
    const defaults = [...type.defaultRecipients];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      out[type.kind] = { enabled: true, recipients: defaults };
      continue;
    }
    const { enabled, recipients } = entry as { enabled?: unknown; recipients?: unknown };
    const valid = Array.isArray(recipients)
      ? dedupe(recipients.filter((r): r is string => typeof r === 'string').map(r => r.trim()).filter(isEmailAddress))
      : [];
    out[type.kind] = { enabled: enabled !== false, recipients: valid.length ? valid : defaults };
  }
  return out;
}

function dedupe(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addresses) {
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Split what an admin typed into a recipient box.
 *
 * Commas, semicolons, whitespace and newlines all separate — people paste
 * from address books, from other emails, and from each other's messages, and
 * the separator is whatever that source used. Anything that is not an address
 * comes back in `invalid` so the screen can name it rather than silently drop
 * it; a dropped address is exactly the "who is this going to?" surprise this
 * screen exists to prevent.
 */
export function parseRecipientList(input: string): { recipients: string[]; invalid: string[] } {
  const tokens = input
    .split(/[\s,;]+/)
    .map(t => t.trim())
    .filter(Boolean);
  const invalid = tokens.filter(t => !isEmailAddress(t));
  const recipients = dedupe(tokens.filter(isEmailAddress));
  return { recipients, invalid };
}

/**
 * Whether a setting may be saved as typed. An enabled notification with no
 * addresses is not "send to nobody" — the function would fall back to the
 * defaults — so the screen refuses it and says so, instead of saving a state
 * that does not mean what it looks like.
 */
export function validateSetting(
  setting: StaffNotificationSetting,
  invalid: string[],
): string | null {
  if (invalid.length) {
    return invalid.length === 1
      ? `"${invalid[0]}" is not an email address.`
      : `These are not email addresses: ${invalid.join(', ')}`;
  }
  if (setting.enabled && setting.recipients.length === 0) {
    return 'Add at least one address, or switch this notification off.';
  }
  return null;
}
