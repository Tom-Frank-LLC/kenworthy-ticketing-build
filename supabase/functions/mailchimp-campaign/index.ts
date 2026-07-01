import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Admin-only. Creates a Mailchimp campaign DRAFT (never sent) prefilled
 * with a showing's poster, title, description, showtime, and buy link.
 * Returns Mailchimp's web edit URL so the admin can finish and hit send
 * inside Mailchimp.
 *
 * Body: { showing_id: string }
 */

const SITE_ORIGIN = "https://kenworthy-ticketing.lovable.app";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("MAILCHIMP_API_KEY");
  const server = Deno.env.get("MAILCHIMP_SERVER_PREFIX");
  const audienceId = Deno.env.get("MAILCHIMP_AUDIENCE_ID");
  if (!apiKey || !server || !audienceId) return json({ error: "Mailchimp not configured" }, 500);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: roleRow } = await admin
    .from("user_roles").select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ error: "Admin only" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const showingId = String(body?.showing_id || "");
  if (!showingId) return json({ error: "showing_id required" }, 400);

  const { data: showing, error: sErr } = await admin
    .from("showings")
    .select("id, show_datetime, movie:movies(title, description, poster_url, genre), event:events(title, description, poster_url), performance:live_performances(title, description, poster_url)")
    .eq("id", showingId).maybeSingle();
  if (sErr || !showing) return json({ error: "Showing not found" }, 404);

  const prod: any = showing.movie || showing.event || showing.performance || {};
  const title = prod.title || "This week at the Kenworthy";
  const description = prod.description || "";
  const poster = prod.poster_url || "";
  const when = showing.show_datetime
    ? new Date(showing.show_datetime).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })
    : "";
  const buyUrl = `${SITE_ORIGIN}/showing/${showing.id}`;

  const base = `https://${server}.api.mailchimp.com/3.0`;
  const auth = "Basic " + btoa(`anystring:${apiKey}`);
  const mc = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: auth, "Content-Type": "application/json", ...(init?.headers || {}) },
    });

  const createRes = await mc(`/campaigns`, {
    method: "POST",
    body: JSON.stringify({
      type: "regular",
      recipients: { list_id: audienceId },
      settings: {
        subject_line: `This week at the Kenworthy: ${title}`,
        preview_text: when || "New showing at the Kenworthy",
        title: `${title} — ${when || showing.id.slice(0, 8)}`,
        from_name: "The Kenworthy",
        reply_to: "info@kenworthy.org",
      },
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok) return json({ error: "Campaign create failed", detail: created }, 502);

  const html = `<!doctype html><html><body style="font-family:Georgia,serif;background:#0f0f10;color:#f4efe6;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:32px;">
    ${poster ? `<tr><td><img src="${esc(poster)}" alt="${esc(title)}" style="width:100%;display:block;border-radius:8px;margin-bottom:24px;" /></td></tr>` : ""}
    <tr><td><h1 style="font-family:'Anton',Impact,sans-serif;text-transform:uppercase;letter-spacing:.06em;font-size:36px;color:#f4efe6;margin:0 0 8px;">${esc(title)}</h1></td></tr>
    ${when ? `<tr><td style="font-size:14px;color:#c4a44a;letter-spacing:.15em;text-transform:uppercase;padding-bottom:16px;">${esc(when)}</td></tr>` : ""}
    ${description ? `<tr><td style="font-size:16px;line-height:1.6;color:#d8d3c9;padding-bottom:24px;">${esc(description)}</td></tr>` : ""}
    <tr><td><a href="${esc(buyUrl)}" style="display:inline-block;background:#d93a89;color:#fff;padding:14px 28px;font-family:'Anton',Impact,sans-serif;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;border-radius:4px;">Buy tickets</a></td></tr>
    <tr><td style="padding-top:32px;font-size:12px;color:#8a8578;">The Kenworthy Performing Arts Centre — 508 S Main St, Moscow, ID</td></tr>
  </table></body></html>`;

  const contentRes = await mc(`/campaigns/${created.id}/content`, {
    method: "PUT",
    body: JSON.stringify({ html }),
  });
  if (!contentRes.ok) {
    const detail = await contentRes.json().catch(() => ({}));
    return json({ error: "Content set failed", detail, campaign_id: created.id }, 502);
  }

  return json({
    ok: true,
    campaign_id: created.id,
    edit_url: created.archive_url ? created.archive_url : `https://${server}.admin.mailchimp.com/campaigns/edit?id=${created.web_id ?? ""}`,
    web_id: created.web_id,
  });
});