// mailchimp-subscribe, as a handler with its dependencies passed in.
//
// Split from index.ts so the two security rules below can be tested against a
// stubbed Mailchimp. The real audience is shared with production even from
// staging, and has no sandbox, so a test must never reach it.
//
// The two rules (security audit 2026-10-06, M1 and M7):
//
//   1. "Trusted" means staff or the verified service role — not "has a JWT".
//      Checkout mints a session-capable account for every guest buyer, so a
//      valid JWT says nothing about who the caller is. Trusted callers may set
//      merge fields and interests, skip double opt-in, and unsubscribe.
//
//   2. Everyone else is create-only. Mailchimp's member PUT is "add or update",
//      and status_if_new only governs the add, so an anonymous PUT rewrote an
//      existing subscriber's FNAME/LNAME and tags. Anonymous sign-ups now POST,
//      which can only create; "Member Exists" is answered exactly like success,
//      so the form is not a membership oracle either. The one existing member
//      a sign-up does change is a transactional one (a buyer who has not
//      opted in), which goes to pending, as a new sign-up would.

import { createHash } from 'node:crypto';
import { z } from 'npm:zod@3.23.8';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BodySchema = z.object({
  email: z.string().trim().email().max(255),
  first_name: z.string().trim().max(80).optional().default(''),
  last_name: z.string().trim().max(80).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).optional().default([]),
  // 'subscribed' for explicit opt-in, 'pending' for double opt-in flows
  status: z.enum(['subscribed', 'pending']).optional().default('subscribed'),
  source: z.string().trim().max(60).optional(),
  merge_fields: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
  interests: z.record(z.boolean()).optional(),
  unsubscribe: z.boolean().optional().default(false),
});

/** Tags an anonymous caller may attach to a contact it creates. */
export const ANON_TAGS = new Set([
  'newsletter',
  'account-signup',
  'ticket-buyer',
  'donor',
  'film-pass',
  'dvd-renter',
]);

/**
 * The `source:` values that become a tag. Every caller in the repo, as of
 * 2026-10-06. A free-form source was a free-text tag on the shared audience;
 * anything not listed here is dropped, not refused, so an older client keeps
 * working.
 */
export const SOURCES = new Set([
  'footer-form',
  'signup',
  'showing-checkout',
  'profile-settings',
  'donation',
  'dvd-reservation',
  'backfill',
  'admin-self-sync',
  'ticket-checkout',
  'film-pass-checkout',
]);

export type CallerKind = 'trusted' | 'anonymous';

export interface SubscribeDeps {
  fetch: typeof fetch;
  /** Staff (through the role gate) or the verified service role → 'trusted'. */
  classify(req: Request): Promise<CallerKind>;
  /** True when this anonymous request is within the limiter. */
  allow(req: Request): Promise<boolean>;
  config: { apiKey?: string; server?: string; audienceId?: string };
  log?: (...args: unknown[]) => void;
}

function md5Lower(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * A Mailchimp error, reduced to what is safe to log.
 *
 * Mailchimp's `detail` routinely quotes the address ("x@y.com looks fake or
 * invalid") and `errors[]` echoes field values, so neither is logged (L15).
 * Status and title are enough to know what happened.
 */
export function summarise(status: number, body: any): string {
  const title = typeof body?.title === 'string' ? body.title.slice(0, 80) : 'unknown';
  return `${status} ${title}`;
}

export function createHandler(deps: SubscribeDeps) {
  const log = deps.log ?? console.error;

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const { apiKey, server, audienceId } = deps.config;
    if (!apiKey || !server || !audienceId) {
      return json({ error: 'Mailchimp is not configured' }, 500);
    }

    let body: unknown;
    try { body = await req.json(); } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const { email, first_name, last_name, status, source, merge_fields, interests, unsubscribe } =
      parsed.data;

    const kind = await deps.classify(req);
    const sourceTags = source && SOURCES.has(source) ? [`source:${source}`] : [];

    const hash = md5Lower(email);
    const base = `https://${server}.api.mailchimp.com/3.0`;
    const auth = 'Basic ' + btoa(`anystring:${apiKey}`);
    const names = {
      ...(first_name ? { FNAME: first_name } : {}),
      ...(last_name ? { LNAME: last_name } : {}),
    };
    const memberUrl = `${base}/lists/${audienceId}/members/${hash}`;

    // A transactional contact is one Mailchimp holds only because they bought
    // something: mailchimp-ecommerce creates every buyer and donor that way
    // unless they opted in. They are on the list but cannot be sent marketing,
    // and status_if_new / a create-only POST both leave them there, so a
    // sign-up from them would vanish. Asking for email is the step up they
    // have not had yet; this takes it, and touches nothing else.
    async function optInTransactional(to: 'pending' | 'subscribed'): Promise<boolean> {
      const res = await deps.fetch(memberUrl, {
        method: 'PATCH',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) log('[mailchimp-subscribe] transactional opt-in failed:', summarise(res.status, j));
      return res.ok;
    }

    // ---- Anonymous: create-only -------------------------------------------
    if (kind === 'anonymous') {
      // What this bounds is the one thing an anonymous caller can make happen
      // off our infrastructure: Mailchimp sending a confirmation email to an
      // address somebody else typed. Ten in ten minutes is past any honest use
      // of a newsletter box.
      if (!(await deps.allow(req))) {
        return json({ error: 'Too many sign-up attempts. Please try again in a few minutes.' }, 429);
      }

      // Double opt-in, allowlisted tags, names only. No merge fields beyond the
      // name, no interests, no unsubscribe — whatever the body asked for.
      let tags = parsed.data.tags.filter((t) => ANON_TAGS.has(t));
      if (tags.length === 0) tags = ['newsletter'];

      const res = await deps.fetch(`${base}/lists/${audienceId}/members`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_address: email,
          status: 'pending',
          merge_fields: names,
          tags: [...new Set([...tags, ...sourceTags])],
        }),
      });
      const resJson = await res.json().catch(() => ({}));
      if (res.ok) return json({ ok: true, id: hash });

      // An existing member is left exactly as it was, and the caller cannot
      // tell: the same answer as a fresh sign-up. The one exception is a
      // transactional contact, which goes to pending — Mailchimp's
      // confirmation email, the same thing a fresh sign-up gets — with the
      // same allowlisted tags. Names are not touched. This is the ordinary
      // path for a guest who ticks the box at checkout: ticket-checkout's
      // purchase sync has already created them, before the browser gets here.
      if (res.status === 400 && resJson?.title === 'Member Exists') {
        const existing = await deps.fetch(`${memberUrl}?fields=status`, {
          headers: { Authorization: auth },
        });
        const current = await existing.json().catch(() => ({}));
        if (existing.ok && current?.status === 'transactional' && (await optInTransactional('pending'))) {
          const tagRes = await deps.fetch(`${memberUrl}/tags`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tags: [...new Set([...tags, ...sourceTags])].map((name) => ({ name, status: 'active' })),
            }),
          });
          if (!tagRes.ok) {
            log('[mailchimp-subscribe] tagging failed:', summarise(tagRes.status, await tagRes.json().catch(() => ({}))));
          } else {
            await tagRes.text();
          }
        }
        return json({ ok: true, id: hash });
      }
      log('[mailchimp-subscribe] anonymous create failed:', summarise(res.status, resJson));
      return json({ error: 'Could not sign you up right now. Please try again later.' }, 502);
    }

    // ---- Trusted: staff or the service role -------------------------------
    if (unsubscribe) {
      const unsubRes = await deps.fetch(`${base}/lists/${audienceId}/members/${hash}`, {
        method: 'PATCH',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'unsubscribed' }),
      });
      const j = await unsubRes.json().catch(() => ({}));
      if (!unsubRes.ok && unsubRes.status !== 404) {
        const summary = summarise(unsubRes.status, j);
        log('[mailchimp-subscribe] unsubscribe failed:', summary);
        return json({ error: 'Mailchimp unsubscribe failed', detail: summary }, 502);
      }
      return json({ ok: true, unsubscribed: true });
    }

    // PUT upserts the member; tags applied separately so we don't overwrite
    // existing ones. status_if_new means an already-subscribed contact is
    // never downgraded.
    const memberRes = await deps.fetch(`${base}/lists/${audienceId}/members/${hash}`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_address: email,
        status_if_new: status,
        merge_fields: { ...names, ...(merge_fields ?? {}) },
        ...(interests ? { interests } : {}),
      }),
    });
    const memberJson = await memberRes.json().catch(() => ({}));
    if (!memberRes.ok) {
      const summary = summarise(memberRes.status, memberJson);
      log('[mailchimp-subscribe] upsert failed:', summary);
      return json({ error: 'Mailchimp upsert failed', detail: summary }, 502);
    }
    // status_if_new left an existing transactional contact transactional.
    // Stepping up to what was asked for is not a downgrade of anything.
    if (memberJson?.status === 'transactional') await optInTransactional(status);

    const allTags = [...new Set([...parsed.data.tags, ...sourceTags])];
    if (allTags.length) {
      const tagRes = await deps.fetch(`${base}/lists/${audienceId}/members/${hash}/tags`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: allTags.map((name) => ({ name, status: 'active' })) }),
      });
      if (!tagRes.ok) {
        const detail = await tagRes.json().catch(() => ({}));
        log('[mailchimp-subscribe] tagging failed:', summarise(tagRes.status, detail));
      } else {
        await tagRes.text();
      }
    }

    return json({ ok: true, id: memberJson.id ?? hash });
  };
}
