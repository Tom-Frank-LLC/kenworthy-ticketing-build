import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * One-time (idempotent) admin bootstrap:
 *  1. Creates the "Programming" interest category + groups on the audience.
 *  2. Creates a Mailchimp e-commerce store named "kenworthy-web".
 *  3. Generates a webhook shared secret and stores it in app_config.
 *  4. Persists interest-group IDs in app_config so downstream syncs don't
 *     have to hit Mailchimp's schema endpoint every time.
 *
 * Returns the webhook URL to paste into Mailchimp's audience settings.
 */

const GROUP_NAMES = ["Films", "Live Performances", "Special Events", "Backstage"];
const STORE_ID = "kenworthy-web";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("MAILCHIMP_API_KEY");
  const server = Deno.env.get("MAILCHIMP_SERVER_PREFIX");
  const audienceId = Deno.env.get("MAILCHIMP_AUDIENCE_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!apiKey || !server || !audienceId) return json({ error: "Mailchimp not configured" }, 500);

  // Admin gate
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

  const base = `https://${server}.api.mailchimp.com/3.0`;
  const auth = "Basic " + btoa(`anystring:${apiKey}`);
  const mcFetch = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: auth, "Content-Type": "application/json", ...(init?.headers || {}) },
    });

  // --- 1. Interest category "Programming" ---
  let categoryId: string | null = null;
  const catsRes = await mcFetch(`/lists/${audienceId}/interest-categories?count=50`);
  const catsJson = await catsRes.json();
  const existingCat = catsJson?.categories?.find((c: any) => c.title === "Programming");
  if (existingCat) categoryId = existingCat.id;
  else {
    const createCat = await mcFetch(`/lists/${audienceId}/interest-categories`, {
      method: "POST",
      body: JSON.stringify({ title: "Programming", type: "checkboxes" }),
    });
    const cj = await createCat.json();
    if (!createCat.ok) return json({ error: "Category create failed", detail: cj }, 502);
    categoryId = cj.id;
  }

  const groupIds: Record<string, string> = {};
  const groupsRes = await mcFetch(`/lists/${audienceId}/interest-categories/${categoryId}/interests?count=50`);
  const groupsJson = await groupsRes.json();
  for (const name of GROUP_NAMES) {
    const existing = groupsJson?.interests?.find((g: any) => g.name === name);
    if (existing) { groupIds[name] = existing.id; continue; }
    const createG = await mcFetch(`/lists/${audienceId}/interest-categories/${categoryId}/interests`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    const gj = await createG.json();
    if (!createG.ok) return json({ error: `Group ${name} failed`, detail: gj }, 502);
    groupIds[name] = gj.id;
  }

  // --- 2. E-commerce store ---
  const storeCheck = await mcFetch(`/ecommerce/stores/${STORE_ID}`);
  if (storeCheck.status === 404) {
    const mkStore = await mcFetch(`/ecommerce/stores`, {
      method: "POST",
      body: JSON.stringify({
        id: STORE_ID,
        list_id: audienceId,
        name: "Kenworthy",
        currency_code: "USD",
        domain: "kenworthy-ticketing.lovable.app",
        email_address: "info@kenworthy.org",
      }),
    });
    const sj = await mkStore.json();
    if (!mkStore.ok) return json({ error: "Store create failed", detail: sj }, 502);
  }

  // --- 3. Webhook secret ---
  const { data: existingCfg } = await admin
    .from("app_config").select("value").eq("key", "mailchimp_webhook").maybeSingle();
  let webhookSecret: string = existingCfg?.value?.secret;
  if (!webhookSecret) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    webhookSecret = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const webhookUrl = `${supabaseUrl}/functions/v1/mailchimp-webhook?s=${webhookSecret}`;

  // --- 4. Persist config ---
  await admin.from("app_config").upsert({
    key: "mailchimp_interests",
    value: { category_id: categoryId, group_ids: groupIds },
    updated_at: new Date().toISOString(),
  });
  await admin.from("app_config").upsert({
    key: "mailchimp_webhook",
    value: { secret: webhookSecret },
    updated_at: new Date().toISOString(),
  });
  await admin.from("app_config").upsert({
    key: "mailchimp_store",
    value: { id: STORE_ID },
    updated_at: new Date().toISOString(),
  });

  return json({ ok: true, category_id: categoryId, group_ids: groupIds, webhook_url: webhookUrl, store_id: STORE_ID });
});