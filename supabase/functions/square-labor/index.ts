import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SQUARE_BASE = "https://connect.squareupsandbox.com/v2";
const SQUARE_VERSION = "2024-01-18";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function squareFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    ...init,
    headers: {
      "Square-Version": SQUARE_VERSION,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = Deno.env.get("SQUARE_SANDBOX_ACCESS_TOKEN");
  const locationId = Deno.env.get("SQUARE_SANDBOX_LOCATION_ID");
  if (!token || !locationId) {
    return json({ error: "Square sandbox credentials not configured" }, 500);
  }

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
        return await listTeam(token, locationId);
      case "list_shifts":
        return await listShifts(token, locationId, params as { begin?: string; end?: string });
      case "current_shift":
        return await currentShift(token, locationId, supabase, user.id);
      case "clock_in":
        return await clockIn(token, locationId, supabase, user.id);
      case "clock_out":
        return await clockOut(token, params as { shift_id: string });
      case "start_break":
        return await startBreak(token, params as { shift_id: string });
      case "end_break":
        return await endBreak(token, params as { shift_id: string });
      case "force_close_shift":
        if (!hasAdmin) return json({ error: "Admin required" }, 403);
        return await clockOut(token, params as { shift_id: string });
      case "list_scheduled_shifts":
        return await listScheduledShifts(token, locationId, params as { begin?: string; end?: string });
      case "upsert_scheduled_shift":
        if (!hasAdmin) return json({ error: "Admin required" }, 403);
        return await upsertScheduledShift(token, locationId, params as Record<string, unknown>);
      case "delete_scheduled_shift":
        if (!hasAdmin) return json({ error: "Admin required" }, 403);
        return await deleteScheduledShift(token, params as { id: string });
      case "publish_week":
        if (!hasAdmin) return json({ error: "Admin required" }, 403);
        return await publishWeek(token, locationId, params as { begin: string; end: string });
      case "labor_summary":
        return await laborSummary(token, locationId, supabase, params as { begin?: string; end?: string });
      case "my_upcoming_shifts":
        return await myUpcomingShifts(token, locationId, supabase, user.id);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("square-labor error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

async function listTeam(token: string, locationId: string) {
  const { ok, data } = await squareFetch(token, "/team-members/search", {
    method: "POST",
    body: JSON.stringify({
      query: { filter: { location_ids: [locationId] } },
      limit: 100,
    }),
  });
  if (!ok) {
    return json({ simulated: true, team_members: [], note: "Sandbox returned no team data" });
  }
  const members = data.team_members || [];

  // Try to fetch wages — sandbox may return empty
  const wagesByMember = new Map<string, { hourly_rate_cents?: number; title?: string }>();
  try {
    const { ok: wOk, data: wData } = await squareFetch(token, "/labor/team-member-wages/search", {
      method: "POST",
      body: JSON.stringify({ query: { limit: 100 } }),
    });
    if (wOk && wData.team_member_wages) {
      for (const w of wData.team_member_wages) {
        wagesByMember.set(w.team_member_id, {
          hourly_rate_cents: w.hourly_rate?.amount,
          title: w.title,
        });
      }
    }
  } catch (_) { /* ignore */ }

  return json({
    simulated: false,
    team_members: members.map((m: Record<string, unknown>) => ({
      id: m.id,
      given_name: m.given_name,
      family_name: m.family_name,
      email: m.email_address,
      status: m.status,
      wage: wagesByMember.get(m.id as string) || null,
    })),
  });
}

async function currentShift(token: string, locationId: string, supabase: any, userId: string) {
  const { data: link } = await supabase
    .from("staff_square_links")
    .select("square_team_member_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!link?.square_team_member_id) {
    return json({ shift: null, linked: false });
  }
  const { ok, data } = await squareFetch(token, "/labor/shifts/search", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: {
          location_ids: [locationId],
          team_member_ids: [link.square_team_member_id],
          status: "OPEN",
        },
      },
      limit: 1,
    }),
  });
  if (!ok) return json({ shift: null, linked: true, note: "Sandbox shift query failed" });
  const shift = (data.shifts || [])[0] || null;
  return json({ shift, linked: true });
}

async function clockIn(token: string, locationId: string, supabase: any, userId: string) {
  const { data: link } = await supabase
    .from("staff_square_links")
    .select("square_team_member_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!link?.square_team_member_id) {
    return json({ error: "No Square team member linked to your account. Ask an admin to link you in the Staff tab." }, 400);
  }
  const { ok, status, data } = await squareFetch(token, "/labor/shifts", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      shift: {
        location_id: locationId,
        team_member_id: link.square_team_member_id,
        start_at: new Date().toISOString(),
      },
    }),
  });
  if (!ok) return json({ error: `Square error [${status}]: ${JSON.stringify(data)}` }, 500);
  return json({ shift: data.shift });
}

async function clockOut(token: string, params: { shift_id: string }) {
  if (!params.shift_id) return json({ error: "shift_id required" }, 400);
  // Get current shift
  const { ok: getOk, data: getData } = await squareFetch(token, `/labor/shifts/${params.shift_id}`, {});
  if (!getOk) return json({ error: `Could not load shift: ${JSON.stringify(getData)}` }, 500);
  const shift = getData.shift;
  const updated = { ...shift, end_at: new Date().toISOString() };
  delete updated.created_at;
  delete updated.updated_at;
  const { ok, status, data } = await squareFetch(token, `/labor/shifts/${params.shift_id}`, {
    method: "PUT",
    body: JSON.stringify({ shift: updated }),
  });
  if (!ok) return json({ error: `Square error [${status}]: ${JSON.stringify(data)}` }, 500);
  return json({ shift: data.shift });
}

async function startBreak(token: string, params: { shift_id: string }) {
  const { ok, data: getData } = await squareFetch(token, `/labor/shifts/${params.shift_id}`, {});
  if (!ok) return json({ error: "Could not load shift" }, 500);
  const shift = getData.shift;
  const breaks = shift.breaks || [];
  breaks.push({
    start_at: new Date().toISOString(),
    name: "Break",
    expected_duration: "PT15M",
    is_paid: false,
  });
  const updated = { ...shift, breaks };
  delete updated.created_at;
  delete updated.updated_at;
  const { ok: uOk, data } = await squareFetch(token, `/labor/shifts/${params.shift_id}`, {
    method: "PUT",
    body: JSON.stringify({ shift: updated }),
  });
  if (!uOk) return json({ error: `Square error: ${JSON.stringify(data)}` }, 500);
  return json({ shift: data.shift });
}

async function endBreak(token: string, params: { shift_id: string }) {
  const { ok, data: getData } = await squareFetch(token, `/labor/shifts/${params.shift_id}`, {});
  if (!ok) return json({ error: "Could not load shift" }, 500);
  const shift = getData.shift;
  const breaks = (shift.breaks || []).map((b: Record<string, unknown>) =>
    b.end_at ? b : { ...b, end_at: new Date().toISOString() }
  );
  const updated = { ...shift, breaks };
  delete updated.created_at;
  delete updated.updated_at;
  const { ok: uOk, data } = await squareFetch(token, `/labor/shifts/${params.shift_id}`, {
    method: "PUT",
    body: JSON.stringify({ shift: updated }),
  });
  if (!uOk) return json({ error: `Square error: ${JSON.stringify(data)}` }, 500);
  return json({ shift: data.shift });
}

async function listShifts(
  token: string,
  locationId: string,
  params: { begin?: string; end?: string },
) {
  const begin = params.begin || new Date(Date.now() - 14 * 86400_000).toISOString();
  const end = params.end || new Date().toISOString();
  const { ok, data } = await squareFetch(token, "/labor/shifts/search", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: {
          location_ids: [locationId],
          start: { start_at: { start_at: begin, end_at: end } },
        },
      },
      limit: 200,
    }),
  });
  if (!ok) return json({ simulated: true, shifts: [], note: "Sandbox returned no shift data" });
  return json({ simulated: false, shifts: data.shifts || [] });
}

async function listScheduledShifts(
  token: string,
  locationId: string,
  params: { begin?: string; end?: string },
) {
  const begin = params.begin || new Date().toISOString();
  const end = params.end || new Date(Date.now() + 14 * 86400_000).toISOString();
  const { ok, data } = await squareFetch(token, "/labor/scheduled-shifts/search", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: {
          location_ids: [locationId],
          start_at: { start_at: begin, end_at: end },
        },
      },
      limit: 200,
    }),
  });
  if (!ok) {
    return json({
      simulated: true,
      scheduled_shifts: [],
      note: "Scheduled shifts not available in sandbox. Will activate in production.",
    });
  }
  return json({ simulated: false, scheduled_shifts: data.scheduled_shifts || [] });
}

async function upsertScheduledShift(
  token: string,
  locationId: string,
  params: Record<string, unknown>,
) {
  const id = params.id as string | undefined;
  const payload = {
    scheduled_shift: {
      location_id: locationId,
      team_member_id: params.team_member_id,
      job_id: params.job_id ?? null,
      start_at: params.start_at,
      end_at: params.end_at,
      notes: params.notes ?? null,
      draft: params.draft ?? true,
    },
    idempotency_key: crypto.randomUUID(),
  };
  const path = id ? `/labor/scheduled-shifts/${id}` : `/labor/scheduled-shifts`;
  const method = id ? "PUT" : "POST";
  const { ok, status, data } = await squareFetch(token, path, {
    method,
    body: JSON.stringify(payload),
  });
  if (!ok) {
    return json({
      simulated: true,
      note: "Scheduled-shift writes are not supported in this sandbox; persisted locally.",
      echo: payload.scheduled_shift,
      square_status: status,
    });
  }
  return json({ simulated: false, scheduled_shift: data.scheduled_shift });
}

async function deleteScheduledShift(token: string, params: { id: string }) {
  if (!params.id) return json({ error: "id required" }, 400);
  const { ok, status, data } = await squareFetch(token, `/labor/scheduled-shifts/${params.id}`, {
    method: "DELETE",
  });
  if (!ok) return json({ simulated: true, note: "Sandbox delete failed; treat as removed.", square_status: status, data });
  return json({ simulated: false, ok: true });
}

async function publishWeek(
  token: string,
  locationId: string,
  params: { begin: string; end: string },
) {
  // Square has /labor/scheduled-shifts/publish; sandbox often 404s. Iterate & flip draft=false.
  const { ok, data } = await squareFetch(token, "/labor/scheduled-shifts/search", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: {
          location_ids: [locationId],
          start_at: { start_at: params.begin, end_at: params.end },
          draft: true,
        },
      },
      limit: 200,
    }),
  });
  if (!ok) {
    return json({ simulated: true, published: 0, note: "Sandbox could not enumerate draft shifts." });
  }
  const drafts = data.scheduled_shifts || [];
  let published = 0;
  for (const s of drafts) {
    const upd = { ...s, draft: false };
    delete upd.created_at;
    delete upd.updated_at;
    const res = await squareFetch(token, `/labor/scheduled-shifts/${s.id}`, {
      method: "PUT",
      body: JSON.stringify({ scheduled_shift: upd }),
    });
    if (res.ok) published += 1;
  }
  return json({ simulated: false, published, total: drafts.length });
}

async function laborSummary(
  token: string,
  locationId: string,
  supabase: any,
  params: { begin?: string; end?: string },
) {
  const begin = params.begin || new Date(Date.now() - 30 * 86400_000).toISOString();
  const end = params.end || new Date().toISOString();

  // Pull shifts + wages from Square
  const [shiftsRes, teamRes] = await Promise.all([
    squareFetch(token, "/labor/shifts/search", {
      method: "POST",
      body: JSON.stringify({
        query: { filter: { location_ids: [locationId], start: { start_at: { start_at: begin, end_at: end } } } },
        limit: 200,
      }),
    }),
    squareFetch(token, "/labor/team-member-wages/search", {
      method: "POST",
      body: JSON.stringify({ query: { limit: 100 } }),
    }),
  ]);
  const shifts = shiftsRes.ok ? (shiftsRes.data.shifts || []) : [];
  const wages = new Map<string, number>();
  if (teamRes.ok) {
    for (const w of (teamRes.data.team_member_wages || [])) {
      wages.set(w.team_member_id, w.hourly_rate?.amount || 0);
    }
  }

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
    const rateCents = wages.get(s.team_member_id) || 0;
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
    simulated: !shiftsRes.ok,
  });
}

async function myUpcomingShifts(
  token: string,
  locationId: string,
  supabase: any,
  userId: string,
) {
  const { data: link } = await supabase
    .from("staff_square_links")
    .select("square_team_member_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!link?.square_team_member_id) return json({ linked: false, shifts: [] });

  const begin = new Date().toISOString();
  const end = new Date(Date.now() + 14 * 86400_000).toISOString();
  const { ok, data } = await squareFetch(token, "/labor/scheduled-shifts/search", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: {
          location_ids: [locationId],
          team_member_ids: [link.square_team_member_id],
          start_at: { start_at: begin, end_at: end },
        },
      },
      limit: 50,
    }),
  });
  if (!ok) return json({ linked: true, shifts: [], simulated: true });
  return json({ linked: true, shifts: data.scheduled_shifts || [], simulated: false });
}