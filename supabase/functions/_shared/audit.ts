// Activity-log writes from edge functions.
//
// The admin_audit_log table is filled mostly by the log_audit_event() trigger,
// which sees every write to an audited table. What it cannot see is anything
// that is not a row change: a Square catalog pull, an LGL donation sync, a
// Mailchimp campaign send, an email leaving the building, a staff sign-in.
// Those are the events that explain WHY a hundred rows changed at 3pm, and
// they only exist here.
//
// Deliberately built on plain fetch rather than supabase-js. This module is
// imported by _shared/deliver.ts, which is bundled into most of the ticketing
// functions; adding a remote dependency to that path is how a function starts
// answering BOOT_ERROR. fetch against PostgREST has no import to go wrong.
//
// Every function here swallows its own errors. An audit write must never be
// the reason a ticket fails to send or a sync reports failure — a missing log
// line is a smaller problem than a broken checkout, and the alternative is
// wrapping every call site in its own try/catch.

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/**
 * Field names whose values must never be written to the log.
 *
 * Kept in step with audit_is_secret_key() in the database. The trigger redacts
 * row diffs; this redacts the hand-built `details` an edge function passes in,
 * which the trigger never sees. Two copies of one rule is a real cost, but the
 * alternative is a code path that can put a live credential in front of every
 * admin, and there is no shared execution context between plpgsql and Deno.
 */
const SECRET_KEY_PATTERN =
  /(secret|token|password|passwd|credential|signature|_key$|api_?key|access_key|private_key)/i;

/**
 * Field names that end in "key" but name a thing rather than authorise access.
 *
 * `_key$` is in the pattern above because it is what catches api_key,
 * signing_key and secret_key, and erring towards redaction is right for a
 * credential filter. It also sweeps up identifiers, and redacting those costs
 * real information: `entity_key` is how an app_config entry says WHICH setting
 * changed, so redacting it turns every settings entry into "something changed".
 */
const KEY_SUFFIXED_IDENTIFIERS = new Set([
  'key',                 // app_config's setting name
  'entity_key',          // this log's own pointer at a non-uuid primary key
  'source_key',          // QBO external reference
  'account_source_key',
]);

export function isSecretKey(key: string): boolean {
  if (KEY_SUFFIXED_IDENTIFIERS.has(key.toLowerCase())) return false;
  return SECRET_KEY_PATTERN.test(key);
}

/** Replace credential-shaped fields with "[redacted]", at any depth. */
export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // null survives so "was unset, now set" stays readable; it leaks nothing.
    out[k] = isSecretKey(k) ? (v === null ? null : '[redacted]') : redact(v);
  }
  return out;
}

export interface AuditEntry {
  /** Dotted, table-first where there is a table: 'concession_items.bulk_sync'. */
  action: string;
  /** The audited table, or a pseudo-type like 'auth' / 'email' / 'integration'. */
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  /** The admin who triggered this. Omit for webhook and cron runs — those are
   *  genuinely nobody, and claiming otherwise would be worse than "system". */
  actorId?: string | null;
  actorEmail?: string | null;
}

async function post(path: string, body: unknown): Promise<Response | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[audit] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing; entry dropped');
    return null;
  }
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
}

/** Write one activity-log row. Never throws. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const res = await post('admin_audit_log', {
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      details: redact(entry.details ?? {}),
    });
    if (res && !res.ok) {
      console.error(`[audit] ${entry.action} rejected: ${res.status} ${await res.text().catch(() => '')}`);
    }
  } catch (e) {
    console.error(`[audit] ${entry.action} failed`, e);
  }
}

// ---------------------------------------------------------------------------
// Staff actions taken through the service role
// ---------------------------------------------------------------------------
//
// A staff-gated function verifies its caller and then writes with the service
// role, because RLS would refuse the write from the caller's own session. The
// log_audit_event trigger records those row changes with actor = auth.uid(),
// which for the service role is NULL — so a refund, a Square catalog write or a
// signed contract read "by nobody" (security audit 2026-10-06, M11).
//
// Two halves, both needed:
//
//   actorHeaders  rides on every PostgREST request a function makes as the
//                 service role. The BEFORE INSERT guard on admin_audit_log
//                 (migration 20261006225810_audit_log_integrity) fills a NULL actor
//                 from it, so every trigger-written row is attributed without
//                 each call site remembering. The header is honoured only when
//                 the request's JWT role is service_role: a browser that sends
//                 it is ignored, because only a key holder can make that claim.
//   logStaffAction  for what is not a row change at all: a Square refund's
//                 amount and payment, a catalog write, an invoice sent. These
//                 never touch an audited table, so the header has nothing to
//                 attribute.

/** The request header carrying the verified caller's id. Lower-case, because
 *  PostgREST lower-cases header names in `request.headers`. */
export const ACTOR_HEADER = 'x-kw-actor-id';

/** Headers for a service-role client acting for a verified caller. Pass as
 *  `createClient(url, serviceKey, { global: { headers: actorHeaders(user.id) } })`. */
export function actorHeaders(actorId: string | null | undefined): Record<string, string> {
  return actorId ? { [ACTOR_HEADER]: actorId } : {};
}

/** Log something a verified staff caller did that is not a row change.
 *  Never throws, like logAudit. */
export async function logStaffAction(
  actor: { id: string; email?: string | null },
  action: string,
  entityType: string,
  details: Record<string, unknown> = {},
  entityId: string | null = null,
): Promise<void> {
  await logAudit({
    action,
    entityType,
    entityId,
    details,
    actorId: actor.id,
    actorEmail: actor.email ?? null,
  });
}

/** Set by a handler once it knows who is asking and that the request writes. */
export interface StaffAuditContext {
  actor?: { id: string; email?: string | null };
  /** e.g. 'square_catalog.event_write'. Unset means nothing worth logging
   *  (a dry run, a read, a refusal before the caller was known). */
  action?: string;
  entityType?: string;
  entityId?: string | null;
}

const SUMMARY_LIST_MAX = 25;

/**
 * The part of a JSON response worth keeping in the log.
 *
 * Top-level scalars and small objects (ok, error, dry_run, tally) as they are;
 * lists cut to their length plus the scalar fields of the first 25 entries, so
 * a catalog run records which items it touched and how each ended without
 * copying whole Square objects into a table every admin reads.
 */
export function summariseResponse(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      out[`${k}_count`] = v.length;
      out[k] = v.slice(0, SUMMARY_LIST_MAX).map((e) =>
        e && typeof e === 'object'
          ? Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([, x]) => x === null || typeof x !== 'object'))
          : e
      );
    } else if (v === null || typeof v !== 'object') {
      out[k] = v;
    } else if (JSON.stringify(v).length <= 500) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Wrap a staff-gated handler so that a write it marks in `ctx` is logged with
 * the verified actor and the outcome, whichever of its return paths it took.
 * The log write never changes the response.
 */
export function auditedHandler(
  handler: (req: Request, ctx: StaffAuditContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const ctx: StaffAuditContext = {};
    const res = await handler(req, ctx);
    if (ctx.actor && ctx.action) {
      let body: unknown = null;
      try { body = await res.clone().json(); } catch { /* not JSON */ }
      await logStaffAction(ctx.actor, ctx.action, ctx.entityType ?? 'integration', {
        status: res.status,
        ...summariseResponse(body),
      }, ctx.entityId ?? null);
    }
    return res;
  };
}

/**
 * Pause per-row logging on `tables` and record that the pause started.
 *
 * For importers that write a row at a time. square-catalog-sync upserts one
 * concession_items row per HTTP request, so the whole Square catalog — ~998
 * objects in the August over-pull — would otherwise land in the log as ~998
 * near-identical entries and push a month of real activity off the 500-row
 * page an admin actually reads.
 *
 * Returns a run id for auditBulkEnd, or null if suppression could not be taken
 * out — in which case the caller should carry on and simply log per row, which
 * is noisy but never wrong.
 */
export async function auditBulkBegin(
  tables: string[],
  action: string,
  details: Record<string, unknown> = {},
  minutes = 10,
  actorId: string | null = null,
): Promise<string | null> {
  try {
    const res = await post('rpc/audit_bulk_begin', {
      p_tables: tables,
      p_action: action,
      p_details: redact(details),
      p_minutes: minutes,
      p_actor_id: actorId,
    });
    if (!res || !res.ok) {
      console.error(`[audit] bulk begin failed: ${res?.status} ${await res?.text().catch(() => '')}`);
      return null;
    }
    const runId = await res.json();
    return typeof runId === 'string' ? runId : null;
  } catch (e) {
    console.error('[audit] bulk begin failed', e);
    return null;
  }
}

/**
 * Lift suppression and write the one summary row the whole exercise is for.
 *
 * Safe to call with a null runId (begin failed, nothing was suppressed): the
 * summary row is still worth having, and the RPC no-ops on the delete.
 */
export async function auditBulkEnd(
  runId: string | null,
  action: string,
  details: Record<string, unknown> = {},
  actorId: string | null = null,
): Promise<void> {
  try {
    if (!runId) {
      await logAudit({ action, entityType: 'integration', details, actorId });
      return;
    }
    const res = await post('rpc/audit_bulk_end', {
      p_run_id: runId,
      p_action: action,
      p_details: redact(details),
      p_actor_id: actorId,
    });
    if (res && !res.ok) {
      console.error(`[audit] bulk end failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
  } catch (e) {
    console.error('[audit] bulk end failed', e);
  }
}

/**
 * Run `work` with per-row logging paused, and record one summary row either
 * way. Suppression is lifted even when the work throws — otherwise a sync that
 * dies half way leaves the log switched off until expires_at, and the failure
 * itself goes unrecorded.
 */
export async function withBulkAudit<T>(
  opts: {
    tables: string[];
    action: string;
    startDetails?: Record<string, unknown>;
    minutes?: number;
    actorId?: string | null;
  },
  work: () => Promise<T>,
  summarise: (result: T) => Record<string, unknown>,
): Promise<T> {
  const actorId = opts.actorId ?? null;
  const runId = await auditBulkBegin(
    opts.tables, opts.action, opts.startDetails ?? {}, opts.minutes ?? 10, actorId,
  );
  try {
    const result = await work();
    await auditBulkEnd(runId, opts.action, summarise(result), actorId);
    return result;
  } catch (e) {
    await auditBulkEnd(runId, `${opts.action}.failed`, {
      error: e instanceof Error ? e.message : String(e),
    }, actorId);
    throw e;
  }
}
