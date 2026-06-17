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