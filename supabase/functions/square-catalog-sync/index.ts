// Square Catalog two-way sync — SANDBOX ONLY.
// Hard-coded to sandbox base URL and the sandbox access token env var.
// Do not change either without an explicit go-live decision.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SQUARE_SANDBOX_BASE = "https://connect.squareupsandbox.com/v2";
const SQUARE_VERSION = "2024-10-17";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function squareFetch(
  token: string,
  path: string,
  init: RequestInit = {},
) {
  // Defensive: refuse if the URL is ever anything but sandbox.
  const url = `${SQUARE_SANDBOX_BASE}${path}`;
  if (!url.startsWith("https://connect.squareupsandbox.com/")) {
    throw new Error("Refusing non-sandbox Square URL");
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(
      `Square ${res.status}: ${body?.errors?.[0]?.detail ?? text}`,
    );
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("SQUARE_SANDBOX_ACCESS_TOKEN");
  if (!token) return json({ error: "SQUARE_SANDBOX_ACCESS_TOKEN not configured" }, 500);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // AuthN: require a signed-in admin.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userRes } = await admin.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* GET-style ping */ }
  const action = payload.action ?? "pull";

  try {
    if (action === "pull") return json(await pullAll(token, admin));
    if (action === "push_item") return json(await pushItem(token, admin, payload.itemId));
    if (action === "delete_item") return json(await deleteItem(token, admin, payload));
    if (action === "verify") return json({ ok: true, environment: "sandbox" });
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("square-catalog-sync error", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});

// --- PULL ---------------------------------------------------------------
async function pullAll(token: string, admin: any) {
  let cursor: string | undefined = undefined;
  const items: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM,CATEGORY" });
    if (cursor) q.set("cursor", cursor);
    const res = await squareFetch(token, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) items.push(o);
    cursor = res.cursor;
  } while (cursor);

  const categories = new Map<string, string>();
  for (const o of items) {
    if (o.type === "CATEGORY") categories.set(o.id, o.category_data?.name ?? "General");
  }

  let upserts = 0;
  for (const o of items) {
    if (o.type !== "ITEM") continue;
    const data = o.item_data ?? {};
    const variation = (data.variations ?? [])[0];
    const varData = variation?.item_variation_data ?? {};
    const price = Number(varData.price_money?.amount ?? 0) / 100;
    const category =
      categories.get(data.category_id) ??
      categories.get(data.categories?.[0]?.id) ??
      "General";

    const row = {
      square_catalog_id: o.id,
      square_variation_id: variation?.id ?? null,
      square_version: o.version ?? null,
      square_synced_at: new Date().toISOString(),
      name: data.name ?? "Untitled",
      price,
      category,
      is_active: !o.is_deleted,
    };

    // Upsert on square_catalog_id
    const { error } = await admin
      .from("concession_items")
      .upsert(row, { onConflict: "square_catalog_id" });
    if (error) throw new Error(`DB upsert failed: ${error.message}`);
    upserts++;
  }

  return { ok: true, pulled: upserts, environment: "sandbox" };
}

// --- PUSH ---------------------------------------------------------------
async function pushItem(token: string, admin: any, itemId: string) {
  if (!itemId) throw new Error("itemId required");
  const { data: item, error } = await admin
    .from("concession_items")
    .select("*")
    .eq("id", itemId)
    .single();
  if (error || !item) throw new Error(error?.message ?? "Item not found");
  if (item.is_combo) {
    return { ok: true, skipped: "combo", environment: "sandbox" };
  }

  const catalogId = item.square_catalog_id ?? `#${item.id}`;
  const variationId = item.square_variation_id ?? `#${item.id}-var`;

  const objectPayload = {
    idempotency_key: crypto.randomUUID(),
    object: {
      type: "ITEM",
      id: catalogId,
      version: item.square_version ?? undefined,
      present_at_all_locations: true,
      item_data: {
        name: item.name,
        item_variation_data: undefined,
        variations: [
          {
            type: "ITEM_VARIATION",
            id: variationId,
            version: undefined,
            present_at_all_locations: true,
            item_variation_data: {
              name: "Regular",
              pricing_type: "FIXED_PRICING",
              price_money: {
                amount: Math.round(Number(item.price) * 100),
                currency: "USD",
              },
            },
          },
        ],
      },
    },
  };

  const res = await squareFetch(token, "/catalog/object", {
    method: "POST",
    body: JSON.stringify(objectPayload),
  });

  const returned = res.catalog_object;
  const returnedVar = returned?.item_data?.variations?.[0];

  const { error: upErr } = await admin
    .from("concession_items")
    .update({
      square_catalog_id: returned?.id ?? item.square_catalog_id,
      square_variation_id: returnedVar?.id ?? item.square_variation_id,
      square_version: returned?.version ?? null,
      square_synced_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (upErr) throw new Error(upErr.message);

  return {
    ok: true,
    square_id: returned?.id,
    variation_id: returnedVar?.id,
    environment: "sandbox",
  };
}

async function deleteItem(
  token: string,
  _admin: any,
  payload: { square_catalog_id?: string },
) {
  const id = payload.square_catalog_id;
  if (!id) return { ok: true, skipped: "no square id" };
  await squareFetch(token, `/catalog/object/${id}`, { method: "DELETE" });
  return { ok: true, deleted: id, environment: "sandbox" };
}