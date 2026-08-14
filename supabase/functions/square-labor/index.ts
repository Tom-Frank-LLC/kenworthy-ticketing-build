// Square Labor — team, timecards, scheduling, labor-vs-sales.
//
// Credentials and API host come from _shared/square.ts like every other Square
// function, so going live is a secrets change (SQUARE_ENV=production) rather
// than a code edit. Before this, the sandbox host and SQUARE_SANDBOX_* names
// were hardcoded here, which meant the whole Labor suite answered 500 on
// production, where only the unprefixed secrets exist.
//
// The other thing this file used to do was swallow Square errors: every failed
// call returned HTTP 200 with `{ simulated: true, note: "…sandbox…" }`. Five
// separate malformed requests hid behind that for months — two of them
// (scheduled-shift create and delete) surfaced in the UI as *success* toasts
// while nothing was written. Every Square call now goes through `square()`,
// which throws, and the handler answers 502 with Square's own message.
//
// Request shapes that Square actually accepts, verified against the sandbox:
//   shift search      filter.start is a TimeRange — { start_at, end_at } —
//                     NOT { start_at: { start_at, end_at } }
//   wages             GET /labor/team-member-wages; there is no search endpoint
//   scheduled shifts  search limit caps at 50 (shifts caps at 200)
//                     details nest under draft_/published_shift_details
//                     job_id is required on create
//                     there is no GET-one and no DELETE; remove = PUT is_deleted
//                     publish = POST /publish or /bulk-publish, not draft:false

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  loadSquareConfig,
  squareErrorMessage,
  squareFetch,
  type SquareConfig,
} from "../_shared/square.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Square search caps. Exceeding either is a 400, not a truncation. */
const SHIFT_PAGE = 200;
const SCHEDULED_PAGE = 50;
/** Backstop so a bad cursor can never loop forever. */
const MAX_RECORDS = 2000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** A Square call that failed. Carries the message worth showing an operator. */
class SquareError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SquareError";
  }
}

/** Call Square, or throw. Never returns a "looks empty" success for a failure. */
async function square(
  config: SquareConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  const { ok, status, data } = await squareFetch(config, path, init);
  if (!ok) {
    throw new SquareError(
      `Square ${status}: ${squareErrorMessage(data, `${init.method ?? "GET"} ${path} failed`)}`,
      status,
    );
  }
  return data ?? {};
}

/** Page a Square *search* endpoint to exhaustion — silent truncation at the
 *  page limit is indistinguishable from "that week was quiet". */
async function searchAll(
  config: SquareConfig,
  path: string,
  query: unknown,
  limit: number,
  key: string,
): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const data = await square(config, path, {
      method: "POST",
      body: { query, limit, ...(cursor ? { cursor } : {}) },
    });
    out.push(...(data[key] || []));
    cursor = data.cursor;
  } while (cursor && out.length < MAX_RECORDS);
  return out;
}

interface Wage {
  hourly_rate_cents?: number;
  title?: string;
  job_id?: string;
}

/** Wages keyed by team member. Also the only source of a member's job_id,
 *  which Square requires when scheduling them. */
async function listWages(config: SquareConfig): Promise<Map<string, Wage>> {
  const byMember = new Map<string, Wage>();
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const data = await square(config, `/labor/team-member-wages?${qs}`);
    for (const w of data.team_member_wages || []) {
      // Keep the first wage seen per member; Square lists one row per job.
      if (!byMember.has(w.team_member_id)) {
        byMember.set(w.team_member_id, {
          hourly_rate_cents: w.hourly_rate?.amount,
          title: w.title,
          job_id: w.job_id,
        });
      }
    }
    cursor = data.cursor;
  } while (cursor && byMember.size < MAX_RECORDS);
  return byMember;
}

/** Square nests a scheduled shift's real fields one level down, in whichever
 *  of draft/published details applies. Flatten it so callers see one shape. */
function normalizeScheduledShift(s: any) {
  const details = s.published_shift_details || s.draft_shift_details || {};
  return {
    id: s.id,
    version: s.version,
    team_member_id: details.team_member_id,
    location_id: details.location_id,
    job_id: details.job_id ?? null,
    start_at: details.start_at,
    end_at: details.end_at,
    notes: details.notes ?? null,
    timezone: details.timezone ?? null,
    draft: !s.published_shift_details,
  };
}

const isLiveShift = (s: any) =>
  !(s.published_shift_details || s.draft_shift_details || {}).is_deleted;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const squareConfig = loadSquareConfig();
  if (!squareConfig.ok) return json({ error: squareConfig.error }, 500);
  const config = squareConfig.config;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: hasAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
  const { data: hasStaff } = await supabase.rpc("has_role", { _user_id: user.id, _role: "staff" });
  if (!hasAdmin && !hasStaff) return json({ error: "Staff access required" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const { action, ...params } = body as { action: string; [k: string]: unknown };

    switch (action) {
      case "list_team":
        return await listTeam(config);
      case "list_shifts":
        return await listShifts(config, params as { begin?: string; end?: string });
      case "current_shift":
        return await currentShift(config, supabase, user.id);
      case "clock_in":
        return await clockIn(config, supabase, user.id);
      case "clock_out":
        return await clockOut(config, params as { shift_id: string });
      case "start_break":
        return await startBreak(config, params as { shift_id: string });
      case "end_break":
        return await endBreak(config, params as { shift_id: string });
      case "force_close_shift":
        if (!hasAdmin) return json({ error: "Admin required" }, 403);
        return await clockOut(config, params as { shift_id: string });
      case "list_scheduled_shifts":
        return await listScheduledShifts(config, params as { begin?: string; end?: string });
      case "upsert_scheduled_shift":
        if (!hasAdmin) return json({ error: "Admin required" }, 403);
        return await upsertScheduledShift(config, params as Record<string, unknown>);
      case "delete_scheduled_shift":
        if (!hasAdmin) return json({ error: "Admin required" }, 403);
        return await deleteScheduledShift(config, params as Record<string, unknown>);
      case "publish_week":
        if (!hasAdmin) return json({ error: "Admin required" }, 403);
        return await publishWeek(config, params as { begin: string; end: string });
      case "labor_summary":
        return await laborSummary(config, supabase, params as { begin?: string; end?: string });
      case "my_upcoming_shifts":
        return await myUpcomingShifts(config, supabase, user.id);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("square-labor error:", err);
    if (err instanceof SquareError) {
      // 502: we reached Square and Square refused. Distinguishable from our own
      // 4xx/5xx, and the message is Square's own so the fix is actionable.
      return json({ error: err.message, square_status: err.status }, 502);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

async function listTeam(config: SquareConfig) {
  const data = await square(config, "/team-members/search", {
    method: "POST",
    body: {
      query: { filter: { location_ids: [config.locationId] } },
      limit: 100,
    },
  });
  const members = data.team_members || [];

  // A wage lookup failure must not blank the roster, but it must not be
  // invisible either — that is how "wage: null" read as "not set in sandbox"
  // while the endpoint being called did not exist.
  let wages = new Map<string, Wage>();
  let wagesError: string | null = null;
  try {
    wages = await listWages(config);
  } catch (err) {
    wagesError = err instanceof Error ? err.message : "Wage lookup failed";
    console.error("square-labor wage lookup failed:", err);
  }

  return json({
    environment: config.environment,
    wages_error: wagesError,
    team_members: members.map((m: Record<string, unknown>) => {
      const wage = wages.get(m.id as string);
      return {
        id: m.id,
        given_name: m.given_name,
        family_name: m.family_name,
        email: m.email_address,
        status: m.status,
        wage: wage ? { hourly_rate_cents: wage.hourly_rate_cents, title: wage.title } : null,
      };
    }),
  });
}

async function currentShift(config: SquareConfig, supabase: any, userId: string) {
  const teamMemberId = await linkedTeamMemberId(supabase, userId);
  if (!teamMemberId) return json({ shift: null, linked: false });

  const shifts = await searchAll(
    config,
    "/labor/shifts/search",
    {
      filter: {
        location_ids: [config.locationId],
        team_member_ids: [teamMemberId],
        status: "OPEN",
      },
    },
    1,
    "shifts",
  );
  return json({ shift: shifts[0] || null, linked: true });
}

async function linkedTeamMemberId(supabase: any, userId: string): Promise<string | null> {
  const { data: link } = await supabase
    .from("staff_square_links")
    .select("square_team_member_id")
    .eq("user_id", userId)
    .maybeSingle();
  return link?.square_team_member_id || null;
}

async function clockIn(config: SquareConfig, supabase: any, userId: string) {
  const teamMemberId = await linkedTeamMemberId(supabase, userId);
  if (!teamMemberId) {
    return json({
      error: "No Square team member linked to your account. Ask an admin to link you in the Staff tab.",
    }, 400);
  }
  const data = await square(config, "/labor/shifts", {
    method: "POST",
    body: {
      idempotency_key: crypto.randomUUID(),
      shift: {
        location_id: config.locationId,
        team_member_id: teamMemberId,
        start_at: new Date().toISOString(),
      },
    },
  });
  return json({ shift: data.shift });
}

/** Square's UpdateShift replaces the whole shift, so every mutation below
 *  reads the current one first and puts it back changed. */
async function mutateShift(
  config: SquareConfig,
  shiftId: string,
  change: (shift: any) => any,
) {
  const current = await square(config, `/labor/shifts/${shiftId}`);
  const updated = change({ ...current.shift });
  delete updated.created_at;
  delete updated.updated_at;
  const data = await square(config, `/labor/shifts/${shiftId}`, {
    method: "PUT",
    body: { shift: updated },
  });
  return json({ shift: data.shift });
}

async function clockOut(config: SquareConfig, params: { shift_id: string }) {
  if (!params.shift_id) return json({ error: "shift_id required" }, 400);
  return await mutateShift(config, params.shift_id, (shift) => ({
    ...shift,
    end_at: new Date().toISOString(),
  }));
}

async function startBreak(config: SquareConfig, params: { shift_id: string }) {
  if (!params.shift_id) return json({ error: "shift_id required" }, 400);

  // A break must reference a BreakType the merchant has configured; inventing
  // a name/duration is a 400 ("Field must not be blank" — break_type_id).
  const data = await square(config, "/labor/break-types?limit=50");
  const breakTypes = (data.break_types || []).filter(
    (b: any) => !b.location_id || b.location_id === config.locationId,
  );
  if (breakTypes.length === 0) {
    return json({
      error: "No break types are configured in Square for this location. Add one in the Square dashboard (Team → Settings → Breaks) before staff can take breaks.",
    }, 400);
  }
  const breakType = breakTypes[0];

  return await mutateShift(config, params.shift_id, (shift) => ({
    ...shift,
    breaks: [
      ...(shift.breaks || []),
      {
        start_at: new Date().toISOString(),
        break_type_id: breakType.id,
        name: breakType.break_name,
        expected_duration: breakType.expected_duration,
        is_paid: breakType.is_paid ?? false,
      },
    ],
  }));
}

async function endBreak(config: SquareConfig, params: { shift_id: string }) {
  if (!params.shift_id) return json({ error: "shift_id required" }, 400);
  return await mutateShift(config, params.shift_id, (shift) => ({
    ...shift,
    breaks: (shift.breaks || []).map((b: Record<string, unknown>) =>
      b.end_at ? b : { ...b, end_at: new Date().toISOString() }
    ),
  }));
}

async function listShifts(config: SquareConfig, params: { begin?: string; end?: string }) {
  const begin = params.begin || new Date(Date.now() - 14 * 86400_000).toISOString();
  const end = params.end || new Date().toISOString();
  const shifts = await searchAll(
    config,
    "/labor/shifts/search",
    {
      filter: {
        location_ids: [config.locationId],
        // TimeRange. Nesting another { start_at, end_at } inside start_at is a
        // 400 EXPECTED_STRING, which used to be reported as "no shift data".
        start: { start_at: begin, end_at: end },
      },
    },
    SHIFT_PAGE,
    "shifts",
  );
  return json({ shifts });
}

async function listScheduledShifts(
  config: SquareConfig,
  params: { begin?: string; end?: string },
) {
  const begin = params.begin || new Date().toISOString();
  const end = params.end || new Date(Date.now() + 14 * 86400_000).toISOString();
  const raw = await searchAll(
    config,
    "/labor/scheduled-shifts/search",
    {
      filter: {
        location_ids: [config.locationId],
        start_at: { start_at: begin, end_at: end },
      },
    },
    SCHEDULED_PAGE,
    "scheduled_shifts",
  );
  return json({ scheduled_shifts: raw.filter(isLiveShift).map(normalizeScheduledShift) });
}

async function upsertScheduledShift(config: SquareConfig, params: Record<string, unknown>) {
  const teamMemberId = params.team_member_id as string | undefined;
  const startAt = params.start_at as string | undefined;
  const endAt = params.end_at as string | undefined;
  if (!teamMemberId || !startAt || !endAt) {
    return json({ error: "team_member_id, start_at and end_at are required" }, 400);
  }

  // Square rejects a scheduled shift with no job. The member's wage record is
  // where their job lives, so fall back to that rather than asking the UI.
  let jobId = (params.job_id as string | undefined) || undefined;
  if (!jobId) {
    const wages = await listWages(config);
    jobId = wages.get(teamMemberId)?.job_id;
  }
  if (!jobId) {
    return json({
      error: "This team member has no job assigned in Square. Assign them one in the Square dashboard, then try again.",
    }, 400);
  }

  const details = {
    location_id: config.locationId,
    team_member_id: teamMemberId,
    job_id: jobId,
    start_at: startAt,
    end_at: endAt,
    ...(params.notes ? { notes: params.notes } : {}),
  };

  const id = params.id as string | undefined;
  const data = id
    ? await square(config, `/labor/scheduled-shifts/${id}`, {
      method: "PUT",
      body: { scheduled_shift: { draft_shift_details: details } },
    })
    : await square(config, "/labor/scheduled-shifts", {
      method: "POST",
      body: {
        idempotency_key: crypto.randomUUID(),
        scheduled_shift: { draft_shift_details: details },
      },
    });

  return json({ scheduled_shift: normalizeScheduledShift(data.scheduled_shift) });
}

/** Square has no DELETE and no GET-one for scheduled shifts. Removal is an
 *  update that sets is_deleted, which means the caller has to hand back the
 *  shift's own fields — the UI always has them, it is deleting a row it drew. */
async function deleteScheduledShift(config: SquareConfig, params: Record<string, unknown>) {
  const id = params.id as string | undefined;
  const teamMemberId = params.team_member_id as string | undefined;
  const startAt = params.start_at as string | undefined;
  const endAt = params.end_at as string | undefined;
  if (!id) return json({ error: "id required" }, 400);
  if (!teamMemberId || !startAt || !endAt) {
    return json({
      error: "team_member_id, start_at and end_at are required to remove a scheduled shift",
    }, 400);
  }

  await square(config, `/labor/scheduled-shifts/${id}`, {
    method: "PUT",
    body: {
      scheduled_shift: {
        draft_shift_details: {
          location_id: config.locationId,
          team_member_id: teamMemberId,
          ...(params.job_id ? { job_id: params.job_id } : {}),
          start_at: startAt,
          end_at: endAt,
          is_deleted: true,
        },
      },
    },
  });
  return json({ ok: true });
}

async function publishWeek(config: SquareConfig, params: { begin: string; end: string }) {
  const begin = params.begin || new Date().toISOString();
  const end = params.end || new Date(Date.now() + 7 * 86400_000).toISOString();
  const raw = await searchAll(
    config,
    "/labor/scheduled-shifts/search",
    {
      filter: {
        location_ids: [config.locationId],
        start_at: { start_at: begin, end_at: end },
      },
    },
    SCHEDULED_PAGE,
    "scheduled_shifts",
  );
  // Draft = has no published details yet. `draft: false` is not a Square field;
  // writing it was the old code's way of "publishing", and it did nothing.
  const drafts = raw.filter((s) => isLiveShift(s) && !s.published_shift_details);
  if (drafts.length === 0) return json({ published: 0, total: 0 });

  const data = await square(config, "/labor/scheduled-shifts/bulk-publish", {
    method: "POST",
    body: {
      scheduled_shifts: Object.fromEntries(
        drafts.map((s) => [s.id, { idempotency_key: crypto.randomUUID(), version: s.version }]),
      ),
    },
  });

  const responses = data.responses || {};
  const published = Object.values(responses).filter((r: any) => r?.scheduled_shift).length;
  const failures = Object.entries(responses)
    .filter(([, r]: [string, any]) => r?.errors?.length)
    .map(([id, r]: [string, any]) => `${id}: ${squareErrorMessage(r, "failed")}`);

  return json({ published, total: drafts.length, failures });
}

async function laborSummary(
  config: SquareConfig,
  supabase: any,
  params: { begin?: string; end?: string },
) {
  const begin = params.begin || new Date(Date.now() - 30 * 86400_000).toISOString();
  const end = params.end || new Date().toISOString();

  const [shifts, wages] = await Promise.all([
    searchAll(
      config,
      "/labor/shifts/search",
      {
        filter: {
          location_ids: [config.locationId],
          start: { start_at: begin, end_at: end },
        },
      },
      SHIFT_PAGE,
      "shifts",
    ),
    listWages(config),
  ]);

  // Aggregate labor cost per day (YYYY-MM-DD)
  const dayLabor = new Map<string, { hours: number; cost: number }>();
  for (const s of shifts) {
    if (!s.end_at) continue;
    const startMs = new Date(s.start_at).getTime();
    const endMs = new Date(s.end_at).getTime();
    const unpaidBreakMs = (s.breaks || []).reduce((sum: number, b: any) => {
      if (!b.end_at || b.is_paid) return sum;
      return sum + (new Date(b.end_at).getTime() - new Date(b.start_at).getTime());
    }, 0);
    const ms = Math.max(0, endMs - startMs - unpaidBreakMs);
    const hours = ms / 3_600_000;
    // Square stamps the wage in effect onto the shift itself; prefer it so a
    // later raise cannot rewrite what last month's labor cost was.
    const rateCents = s.wage?.hourly_rate?.amount ??
      wages.get(s.team_member_id)?.hourly_rate_cents ?? 0;
    const cost = hours * (rateCents / 100);
    const day = s.start_at.slice(0, 10);
    const cur = dayLabor.get(day) || { hours: 0, cost: 0 };
    cur.hours += hours;
    cur.cost += cost;
    dayLabor.set(day, cur);
  }

  // Pull sales per day: tickets + concession_sales
  const dayBegin = begin.slice(0, 10);
  const dayEnd = end.slice(0, 10);
  const [{ data: tickets }, { data: cSales }] = await Promise.all([
    supabase.from("tickets")
      .select("total_price, processing_fee, created_at, payment_method")
      .gte("created_at", dayBegin)
      .lte("created_at", dayEnd + "T23:59:59")
      .neq("payment_method", "comp"),
    supabase.from("concession_sales")
      .select("total, created_at")
      .gte("created_at", dayBegin)
      .lte("created_at", dayEnd + "T23:59:59"),
  ]);

  const daySales = new Map<string, { tickets: number; concessions: number }>();
  for (const t of (tickets || [])) {
    const d = (t.created_at as string).slice(0, 10);
    const cur = daySales.get(d) || { tickets: 0, concessions: 0 };
    cur.tickets += Number(t.total_price || 0);
    daySales.set(d, cur);
  }
  for (const s of (cSales || [])) {
    const d = (s.created_at as string).slice(0, 10);
    const cur = daySales.get(d) || { tickets: 0, concessions: 0 };
    cur.concessions += Number(s.total || 0);
    daySales.set(d, cur);
  }

  // Merge keys
  const days = Array.from(new Set([...dayLabor.keys(), ...daySales.keys()])).sort();
  const series = days.map((d) => {
    const l = dayLabor.get(d) || { hours: 0, cost: 0 };
    const s = daySales.get(d) || { tickets: 0, concessions: 0 };
    const revenue = s.tickets + s.concessions;
    return {
      day: d,
      hours: Number(l.hours.toFixed(2)),
      labor_cost: Number(l.cost.toFixed(2)),
      ticket_revenue: Number(s.tickets.toFixed(2)),
      concession_revenue: Number(s.concessions.toFixed(2)),
      revenue: Number(revenue.toFixed(2)),
      labor_pct: revenue > 0 ? Number(((l.cost / revenue) * 100).toFixed(1)) : null,
    };
  });

  const totalLabor = series.reduce((a, r) => a + r.labor_cost, 0);
  const totalRevenue = series.reduce((a, r) => a + r.revenue, 0);
  return json({
    series,
    totals: {
      labor_cost: Number(totalLabor.toFixed(2)),
      revenue: Number(totalRevenue.toFixed(2)),
      labor_pct: totalRevenue > 0 ? Number(((totalLabor / totalRevenue) * 100).toFixed(1)) : null,
      hours: Number(series.reduce((a, r) => a + r.hours, 0).toFixed(2)),
    },
  });
}

async function myUpcomingShifts(config: SquareConfig, supabase: any, userId: string) {
  const teamMemberId = await linkedTeamMemberId(supabase, userId);
  if (!teamMemberId) return json({ linked: false, shifts: [] });

  const begin = new Date().toISOString();
  const end = new Date(Date.now() + 14 * 86400_000).toISOString();
  const raw = await searchAll(
    config,
    "/labor/scheduled-shifts/search",
    {
      filter: {
        location_ids: [config.locationId],
        team_member_ids: [teamMemberId],
        start_at: { start_at: begin, end_at: end },
      },
    },
    SCHEDULED_PAGE,
    "scheduled_shifts",
  );
  return json({
    linked: true,
    shifts: raw.filter(isLiveShift).map(normalizeScheduledShift),
  });
}
