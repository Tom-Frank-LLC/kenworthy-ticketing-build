// Square Catalog two-way sync for concession items.
//
// Credentials and API host come from _shared/square.ts like every other Square
// function, so going live is a secrets change (SQUARE_ENV=production) rather
// than a code edit. This file used to hardcode the sandbox host, guard against
// any non-sandbox URL, and read SQUARE_SANDBOX_ACCESS_TOKEN by name — which is
// why "Pull from Square" answered 500 on production, where that secret does not
// exist. The reported environment now comes from the resolved config instead of
// the string "sandbox", so the UI can never claim sandbox while charging live.
//
// CORS also matters here: supabase-js sends x-supabase-client-* headers, and the
// hand-rolled header list this file carried omitted them, so the preflight could
// fail before the function ever ran. It uses the shared list now.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json, preflight } from "../_shared/http.ts";
import {
  loadSquareConfig,
  squareErrorMessage,
  squareFetch,
  type SquareConfig,
} from "../_shared/square.ts";

/** Call Square, or throw with Square's own message — never a silent empty result. */
async function square(
  config: SquareConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  const { ok, status, data } = await squareFetch(config, path, init);
  if (!ok) {
    throw new Error(
      `Square ${status}: ${squareErrorMessage(data, `${init.method ?? "GET"} ${path} failed`)}`,
    );
  }
  return data ?? {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

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
    if (action === "pull") return json(await pullAll(config, admin));
    if (action === "push_item") return json(await pushItem(config, admin, payload.itemId));
    if (action === "delete_item") return json(await deleteItem(config, payload));
    if (action === "verify") return json({ ok: true, environment: config.environment });
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("square-catalog-sync error", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});

// --- PULL ---------------------------------------------------------------
async function pullAll(config: SquareConfig, admin: any) {
  let cursor: string | undefined = undefined;
  const items: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM,CATEGORY" });
    if (cursor) q.set("cursor", cursor);
    const res = await square(config, `/catalog/list?${q}`);
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

  return { ok: true, pulled: upserts, environment: config.environment };
}

// --- PUSH ---------------------------------------------------------------
async function pushItem(config: SquareConfig, admin: any, itemId: string) {
  if (!itemId) throw new Error("itemId required");
  const { data: item, error } = await admin
    .from("concession_items")
    .select("*")
    .eq("id", itemId)
    .single();
  if (error || !item) throw new Error(error?.message ?? "Item not found");
  if (item.is_combo) {
    return { ok: true, skipped: "combo", environment: config.environment };
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

  const res = await square(config, "/catalog/object", {
    method: "POST",
    body: objectPayload,
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
    environment: config.environment,
  };
}

async function deleteItem(
  config: SquareConfig,
  payload: { square_catalog_id?: string },
) {
  const id = payload.square_catalog_id;
  if (!id) return { ok: true, skipped: "no square id" };
  await square(config, `/catalog/object/${id}`, { method: "DELETE" });
  return { ok: true, deleted: id, environment: config.environment };
}
