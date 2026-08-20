// The public rental-request form, with a server in front of it.
//
// Until this existed the form wrote straight into `rental_requests` from the
// browser: `supabase.from('rental_requests').insert(payload)`, as `anon`, held
// in check only by an RLS WITH CHECK listing the columns a submitter must not
// forge. That policy is good and stays. What it cannot do is count.
//
// Measured on staging, 2026-08-19: twelve unauthenticated inserts in a row, all
// 201, no throttle, no challenge, nothing to solve. Each row is a person the
// box office believes is waiting, and clearing a flood of them is manual work
// on the one surface where staff cannot safely ignore an entry.
//
// A rate limit alone slows that down. What actually stops a script is having to
// prove it is a browser, and proving anything requires somewhere to check the
// proof — which a direct-to-PostgREST insert does not have. So the write moves
// here, and this function is that somewhere.
//
// Three things follow from the move, and the bot check is only one:
//
//   * The payload is allowlisted rather than filtered. RLS could only forbid
//     named columns; this accepts named ones, so a column added later is not
//     silently submittable from the public form the day it is created.
//   * Free text is bounded. `event_description` had no length limit at all.
//   * There is a single place to add anything else this endpoint ever needs —
//     a notification, a duplicate check, a per-address limit.
//
// Turnstile is Cloudflare's bot check: the page renders a widget that is
// invisible for almost everybody, and hands over a single-use token that this
// function verifies with Cloudflare before writing anything.
//
// ---------------------------------------------------------------------------
// Staged rollout, deliberately
// ---------------------------------------------------------------------------
//
// TURNSTILE_SECRET_KEY is not set yet — the widget has to be created in the
// Cloudflare dashboard first, which is a human step. Until it is set, this
// function does everything else and skips the bot check.
//
// That is a considered choice, not an oversight. The alternative — refuse every
// submission until the key exists — takes the rental form offline the moment
// this deploys, to close a spam hole. Failing open on the *check* while the
// structural fix (no more direct public writes, allowlisted fields, bounded
// text, one chokepoint) lands immediately is the better trade, and setting one
// secret arms the rest.
//
// It is logged loudly on every call so "we'll set that later" cannot become
// "nobody remembered".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET_KEY') || '';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Columns the public form may set, with the cap on each free-text field.
 *
 * An allowlist rather than a denylist. The RLS policy this replaces named the
 * columns a submitter must *not* set (signed_at, admin_notes, the Square
 * invoice fields...), which is correct until somebody adds a column — at which
 * point the new one is public-writable by default and nobody notices.
 *
 * The caps are generous enough that no real applicant meets them; they exist so
 * a single request cannot post a megabyte of text into a table staff read by
 * hand.
 */
const TEXT_FIELDS: Record<string, number> = {
  event_title: 200,
  organization_name: 200,
  applicant_name: 200,
  email: 320,
  phone: 40,
  secondary_contact_name: 200,
  secondary_contact_email: 320,
  secondary_contact_phone: 40,
  marquee_text: 300,
  arrival_time: 40,
  event_start_time: 40,
  event_end_time: 40,
  departure_time: 40,
  venue_area: 60,
  age_range: 60,
  special_needs: 2000,
  accessibility_requirements: 2000,
  media_notes: 2000,
  event_description: 5000,
  activity_order: 5000,
};

const BOOL_FIELDS = [
  'wants_concessions',
  'wants_beer_wine',
  'is_ticketed',
  'is_public',
  'needs_digital_ticketing',
  'renter_provides_media',
  'kenworthy_provides_media',
] as const;

const DATE_FIELDS = ['proposed_date', 'end_date'] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ISO date (YYYY-MM-DD), which is what <input type="date"> submits. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ask Cloudflare whether this token is real, single-use, and ours.
 *
 * Returns true when the check is not configured — see the header comment.
 */
async function passesBotCheck(token: string, ip: string | null): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    console.warn(
      '[rental-request] TURNSTILE_SECRET_KEY is not set — accepting without a bot check. ' +
        'Create the widget in Cloudflare and set the secret to arm this.',
    );
    return true;
  }

  if (!token) return false;

  try {
    const body = new FormData();
    body.append('secret', TURNSTILE_SECRET);
    body.append('response', token);
    // Cloudflare uses this to bind the token to the client that solved it.
    if (ip) body.append('remoteip', ip);

    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    const outcome = await res.json().catch(() => ({}));
    if (!outcome?.success) {
      console.warn('[rental-request] turnstile rejected:', JSON.stringify(outcome?.['error-codes'] ?? []));
      return false;
    }
    return true;
  } catch (err) {
    // A verification that could not be performed is not a verification that
    // passed. Cloudflare being unreachable takes the form down rather than
    // opening it — the opposite of the unconfigured case above, because here
    // somebody *has* decided the check should happen.
    console.error('[rental-request] turnstile verification threw', err);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const ip =
    req.headers.get('cf-connecting-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    null;

  if (!(await passesBotCheck(String(body.turnstile_token ?? ''), ip))) {
    return json(
      { error: "We couldn't verify that you're a person. Please reload the page and try again." },
      403,
    );
  }

  // ---- Build the row from the allowlist, and only the allowlist ------------
  const row: Record<string, unknown> = {};

  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw).trim();
    if (!value) continue;
    if (value.length > max) {
      return json({ error: `That ${field.replace(/_/g, ' ')} is too long.` }, 400);
    }
    row[field] = value;
  }

  for (const field of BOOL_FIELDS) {
    if (typeof body[field] === 'boolean') row[field] = body[field];
  }

  for (const field of DATE_FIELDS) {
    const raw = body[field];
    if (!raw) continue;
    const value = String(raw).trim();
    if (!DATE_RE.test(value)) return json({ error: 'That date is not valid.' }, 400);
    row[field] = value;
  }

  if (body.expected_guests !== undefined && body.expected_guests !== null && body.expected_guests !== '') {
    const n = Number(body.expected_guests);
    if (!Number.isInteger(n) || n < 0 || n > 100000) {
      return json({ error: 'That guest count is not valid.' }, 400);
    }
    row.expected_guests = n;
  }

  // Equipment is a jsonb map of {key: count}. Bounded on both sides: the keys
  // are whatever the form offers, so they are length-capped rather than
  // enumerated here, and the counts must be sane positive integers.
  if (body.equipment && typeof body.equipment === 'object' && !Array.isArray(body.equipment)) {
    const equipment: Record<string, number> = {};
    const entries = Object.entries(body.equipment as Record<string, unknown>);
    if (entries.length > 40) return json({ error: 'Too many equipment lines.' }, 400);
    for (const [key, value] of entries) {
      if (key.length > 60) continue;
      const n = Number(value);
      if (Number.isInteger(n) && n > 0 && n <= 10000) equipment[key] = n;
    }
    row.equipment = equipment;
  }

  // ---- The few things that are required rather than optional --------------
  //
  // These three are NOT NULL on the table. Checked here as well so the caller
  // gets a 400 naming the missing field, rather than the generic 500 a
  // constraint violation would produce — the database refusing the row is the
  // right outcome, but a useless message about it is not.
  if (!row.event_title) return json({ error: 'An event name is required.' }, 400);
  if (!row.applicant_name) return json({ error: 'A contact name is required.' }, 400);
  if (!row.email) return json({ error: 'An email address is required.' }, 400);
  if (!EMAIL_RE.test(String(row.email))) {
    return json({ error: 'That email address is not valid.' }, 400);
  }
  if (row.secondary_contact_email && !EMAIL_RE.test(String(row.secondary_contact_email))) {
    return json({ error: 'That second email address is not valid.' }, 400);
  }

  // The state a new request starts in. Set here rather than defaulted, so this
  // function states it and the reader does not have to go and look.
  row.status = 'pending';
  row.contract_status = 'draft';

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await admin
    .from('rental_requests')
    .insert(row)
    .select('id')
    .single();

  if (error || !data) {
    // Specific in the log, generic on the wire: a column name or a constraint
    // in an error body tells a prober about the schema.
    console.error('[rental-request] insert failed', error);
    return json({ error: 'We could not save that request. Please try again.' }, 500);
  }

  return json({ ok: true, id: data.id });
});
