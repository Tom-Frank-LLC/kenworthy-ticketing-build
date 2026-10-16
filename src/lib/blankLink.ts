import type { BlankFields } from '@/lib/blankFields';

/**
 * Turning a blank contract into a rental request's contract
 * (link_blank_contract, 20261016215241).
 *
 * A blank holds strings, so an empty field can print as a line to write on. A
 * request's contract holds numbers, and an absent one falls back to the
 * standard rates (DEFAULTS in RentalContract). So a cost left empty on the
 * blank prints the standard rate once linked; the dialog says so.
 */

/** The request columns the link dialog compares, as the request has them. */
export type LinkableRequest = {
  id: string;
  event_title: string;
  applicant_name: string;
  organization_name: string | null;
  email: string;
  phone: string | null;
  event_description: string | null;
  proposed_date: string | null;
  end_date: string | null;
  event_start_time: string | null;
  event_end_time: string | null;
  signed_at: string | null;
  status: string;
  submitted_at: string;
};

/** Details on the request itself: a typed value the staffer prefers replaces it. */
export type IdentityKey = 'applicant_name' | 'organization_name' | 'email' | 'phone' | 'event_description';
/** When: a typed value the staffer prefers sets the contract's Term, and the
 *  request keeps what the renter asked for. */
export type TermKey = 'term_date' | 'term_end_date' | 'term_start' | 'term_end';

export type FieldDiff =
  | { kind: 'identity'; key: IdentityKey; label: string; request: string; blank: string }
  | { kind: 'term'; key: TermKey; label: string; request: string; blank: string };

const IDENTITY: [IdentityKey, keyof BlankFields, string][] = [
  ['applicant_name', 'name', 'Licensee name'],
  ['organization_name', 'organization', 'Organization'],
  ['email', 'email', 'Email'],
  ['phone', 'phone', 'Phone'],
  ['event_description', 'purpose', 'Purpose'],
];

const TERM: [TermKey, keyof LinkableRequest, keyof BlankFields, string][] = [
  ['term_date', 'proposed_date', 'event_date', 'Event date'],
  ['term_end_date', 'end_date', 'end_date', 'End date'],
  ['term_start', 'event_start_time', 'start_time', 'Start time'],
  ['term_end', 'event_end_time', 'end_time', 'End time'],
];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
// Times are stored `HH:mm:ss` on some rows and `HH:mm` on others.
const hm = (v: unknown) => str(v).slice(0, 5);

/**
 * Where what was typed differs from the request. A field left empty on the
 * blank is not a difference: there is nothing typed to prefer.
 */
export function fieldDiffs(f: BlankFields, r: LinkableRequest): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const [key, from, label] of IDENTITY) {
    const blank = str(f[from]);
    const request = str(r[key]);
    const same = key === 'email' ? blank.toLowerCase() === request.toLowerCase() : blank === request;
    if (blank && !same) out.push({ kind: 'identity', key, label, request, blank });
  }
  for (const [key, col, from, label] of TERM) {
    const isTime = key === 'term_start' || key === 'term_end';
    const blank = isTime ? hm(f[from]) : str(f[from]);
    const request = isTime ? hm(r[col]) : str(r[col]).slice(0, 10);
    if (blank && blank !== request) out.push({ kind: 'term', key, label, request, blank });
  }
  return out;
}

function amount(s: string): number | undefined {
  if (s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const NUMBERS = [
  'hourly_rate', 'base_hours', 'additional_hours_rate', 'additional_hours',
  'rehearsal_rate', 'rehearsal_hours', 'staff_rate', 'staff_hours',
  'concessions_fee', 'av_fee', 'nonprofit_discount', 'max_attendees',
] as const;

/**
 * The request's contract_data from the blank: every cost and term typed, and
 * a Term override for each date or time the staffer chose to keep from the
 * blank (`useTerm`). Untyped costs are left out, so they print the standard rate.
 */
export function blankToContractData(f: BlankFields, useTerm: TermKey[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of NUMBERS) {
    const n = amount(f[k]);
    if (n !== undefined) out[k] = n;
  }
  if (str(f.agreement_date)) out.agreement_date = str(f.agreement_date);
  if (f.alcohol_addendum) out.alcohol_addendum = f.alcohol_addendum;
  const days = f.extra_days
    .map(d => ({ label: str(d.label), date: str(d.date), start: str(d.start), end: str(d.end) }))
    .filter(d => d.label || d.date || d.start || d.end);
  if (days.length) out.extra_days = days;
  for (const [key, , from] of TERM) {
    if (useTerm.includes(key)) out[key] = key === 'term_start' || key === 'term_end' ? hm(f[from]) : str(f[from]);
  }
  return out;
}

/** A new request's columns from the blank, with the title and contact the dialog asked for. */
export function newRequestFrom(f: BlankFields, details: {
  event_title: string; applicant_name: string; email: string; organization_name: string; phone: string;
}) {
  return {
    event_title: details.event_title.trim(),
    applicant_name: details.applicant_name.trim(),
    email: details.email.trim(),
    organization_name: details.organization_name.trim(),
    phone: details.phone.trim(),
    proposed_date: str(f.event_date),
    end_date: str(f.end_date),
    event_start_time: hm(f.start_time),
    event_end_time: hm(f.end_time),
    event_description: str(f.purpose),
    wants_beer_wine: f.alcohol_addendum === 'served',
  };
}

const words = (s: string | null | undefined) =>
  new Set((s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));

/**
 * Requests that look like the rental this blank is for, best first, with why.
 * Same email is the strongest sign, then the same day, then shared words in
 * the name, organization or title. Only requests with some reason are listed.
 */
export function rankMatches(f: BlankFields, requests: LinkableRequest[]) {
  const email = str(f.email).toLowerCase();
  const day = str(f.event_date);
  const typed = new Set([...words(f.name), ...words(f.organization), ...words(f.purpose)]);
  return requests
    .map(r => {
      const reasons: string[] = [];
      let score = 0;
      if (email && r.email.trim().toLowerCase() === email) { score += 4; reasons.push('same email'); }
      if (day && (r.proposed_date ?? '').slice(0, 10) === day) { score += 3; reasons.push('same date'); }
      const theirs = new Set([...words(r.applicant_name), ...words(r.organization_name), ...words(r.event_title)]);
      const shared = [...typed].filter(w => theirs.has(w));
      if (shared.length) { score += Math.min(shared.length, 2); reasons.push(`"${shared.slice(0, 2).join('", "')}"`); }
      return { request: r, score, reasons };
    })
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score || b.request.submitted_at.localeCompare(a.request.submitted_at));
}
