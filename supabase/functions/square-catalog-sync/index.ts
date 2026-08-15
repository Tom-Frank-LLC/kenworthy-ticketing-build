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
//
// ---------------------------------------------------------------------------
// 2026-08-14 incident — read this before changing pull or push.
//
// Two faults in this file combined to damage the LIVE Square catalog:
//
//   1. `pull` imported every ITEM in the catalog, unscoped, and stamped
//      `is_active: !o.is_deleted`. The Kenworthy's Square catalog is their whole
//      sales history — 998 objects: past films, MET broadcasts, rentals, passes,
//      posters. All of it landed in `concession_items` ACTIVE, so the public home
//      page rendered the entire back catalogue as a concessions menu.
//
//   2. `push_item` rebuilt the Square object from scratch — name plus a single
//      "Regular" variation — and Square's UpsertCatalogObject REPLACES the object
//      it is given. Every field this file did not send was therefore cleared:
//      description, images, category, taxes, and every variation past the first.
//      Deactivating an item in the admin UI called push_item, so clearing the
//      flood by hand overwrote 906 live catalog objects.
//
// The fixes, in order of importance:
//
//   * `push_item` is now read-modify-write. It RETRIEVES the current object and
//     edits only name and the first variation's price. Never reconstruct a
//     catalog object from our columns — we store four fields and Square stores
//     dozens, so anything we build from scratch is a deletion of the rest.
//   * `pull` imports only categories on an allowlist (app_config
//     `square_concession_categories`) and never sets `is_active` on an existing
//     row. New rows arrive inactive and an admin turns them on deliberately.
//   * `preview` dry-runs a pull so the UI can show counts before anything writes.
//   * `repair_categories` re-attaches the category each damaged item used to have,
//     which is the one destroyed field we can still reconstruct — we kept the
//     Square category NAME on every row.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json, preflight } from "../_shared/http.ts";
import { logAudit, withBulkAudit } from "../_shared/audit.ts";
import { concessionSquarePushEnabled } from "../_shared/flags.ts";
import {
  loadSquareConfig,
  squareErrorMessage,
  squareFetch,
  type SquareConfig,
} from "../_shared/square.ts";

/**
 * Square category names whose items are genuine concessions.
 *
 * The Kenworthy's catalog is organised by a numeric prefix: 1-5 and 7 are things
 * sold at the stand, `6 *` is ticketing, `9 *` is passes, and `General` is the
 * junk drawer holding posters and legacy ticket types. Only the stand belongs in
 * `concession_items`. Overridable per-project via app_config so this never needs
 * a deploy to change.
 */
const DEFAULT_CONCESSION_CATEGORIES = [
  "1 Combos",
  "2 Candy",
  "3 Bottles",
  "3 Soda",
  "4 Beer",
  "4 Wine",
  "5 Popcorn",
  "7 Merch",
];

const CATEGORY_CONFIG_KEY = "square_concession_categories";

/** Refuse to write more than this in one pull without an explicit override. */
const PULL_SANITY_LIMIT = 200;

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

/** The configured concessions allowlist, falling back to the default set. */
async function loadCategoryAllowlist(admin: any): Promise<string[]> {
  const { data } = await admin
    .from("app_config")
    .select("value")
    .eq("key", CATEGORY_CONFIG_KEY)
    .maybeSingle();
  const configured = data?.value?.categories;
  if (Array.isArray(configured)) return configured.map((c: unknown) => String(c));
  return DEFAULT_CONCESSION_CATEGORIES;
}

/** Every ITEM and CATEGORY object in the catalog, following the cursor. */
async function listCatalog(config: SquareConfig) {
  let cursor: string | undefined = undefined;
  const objects: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM,CATEGORY" });
    if (cursor) q.set("cursor", cursor);
    const res = await square(config, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) objects.push(o);
    cursor = res.cursor;
  } while (cursor);
  return objects;
}

/** Map category object id -> category name. */
function categoryNames(objects: any[]) {
  const names = new Map<string, string>();
  for (const o of objects) {
    if (o.type === "CATEGORY") names.set(o.id, o.category_data?.name ?? "General");
  }
  return names;
}

/** The category name Square has this item filed under. */
function categoryOf(o: any, names: Map<string, string>) {
  const data = o.item_data ?? {};
  return (
    names.get(data.category_id) ??
    names.get(data.categories?.[0]?.id) ??
    "General"
  );
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
  const action = payload.action ?? "preview";

  try {
    // `preview` is deliberately not logged: it writes nothing, to Square or to
    // us, and an entry per dry run would be noise in front of the real ones.
    if (action === "preview") return json(await previewPull(config, admin));
    // Both write directions are gated together: they are the only actions that
    // can alter the live catalog, and both are phase-2 until the architecture
    // for admin-edits-reach-the-register is settled. Refused server-side rather
    // than only hidden in the UI, so a stale client cannot reach them either.
    // Checked ahead of the audit calls below, so a refusal is never recorded as
    // a write that happened.
    if (
      (action === "push_item" || action === "delete_item") &&
      !concessionSquarePushEnabled()
    ) {
      return json({
        error:
          "Writing to the Square catalog is disabled. Concession items here " +
          "are the website's display menu; Square is the source of truth. " +
          "Set CONCESSION_SQUARE_PUSH=true to re-enable.",
      }, 403);
    }
    if (action === "pull") {
      // Even scoped to the allowlist, the pull upserts one concession_items row
      // per HTTP request. Per-row audit entries would put a sync's worth of
      // near-identical rows in front of a month of real activity, so the
      // trigger is paused for the duration and the run is recorded as two rows:
      // who started it, and what it did.
      return json(await withBulkAudit(
        {
          tables: ["concession_items"],
          action: "concession_items.bulk_sync",
          startDetails: { source: "square", environment: config.environment },
          actorId: user.id,
        },
        () => pullAll(config, admin, payload),
        (result) => ({
          source: "square",
          environment: config.environment,
          pulled: result.pulled,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          allowlist: result.allowlist,
        }),
      ));
    }
    if (action === "push_item") {
      const result = await pushItem(config, admin, payload.itemId);
      // Single item, so no suppression: the concession_items UPDATE this makes
      // is logged by the trigger too, and the pair reads as "an admin pushed
      // this item to Square, and here is the row it changed".
      await logAudit({
        action: "concession_items.square_push",
        entityType: "concession_items",
        entityId: payload.itemId ?? null,
        actorId: user.id,
        actorEmail: user.email ?? null,
        details: { environment: config.environment, square_id: result.square_id ?? null },
      });
      return json(result);
    }
    if (action === "delete_item") {
      const result = await deleteItem(config, payload);
      await logAudit({
        action: "concession_items.square_delete",
        entityType: "concession_items",
        actorId: user.id,
        actorEmail: user.email ?? null,
        details: {
          environment: config.environment,
          square_catalog_id: payload.square_catalog_id ?? null,
        },
      });
      return json(result);
    }
    if (action === "damage_census") {
      return json(await damageCensus(config, admin));
    }
    if (action === "repair_variations") {
      return json(await repairVariations(config, admin, payload));
    }
    if (action === "repair_categories") {
      const result = await repairCategories(config, admin, payload);
      // No suppression: this writes to Square only, never to concession_items.
      // That is exactly why it needs a line of its own — a repair rewrites live
      // catalog objects and leaves no trace in this database at all. Dry runs
      // are skipped for the same reason `preview` is.
      if (!result.dry_run) {
        await logAudit({
          action: "concession_items.square_repair",
          entityType: "concession_items",
          actorId: user.id,
          actorEmail: user.email ?? null,
          details: {
            environment: config.environment,
            repaired: result.repaired,
            attempted: result.attempted,
            remaining: result.remaining,
            failure_count: result.failure_count,
          },
        });
      }
      return json(result);
    }
    if (action === "verify") return json({ ok: true, environment: config.environment });
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("square-catalog-sync error", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});

// --- PREVIEW (dry run) ---------------------------------------------------
// Writes nothing. The admin UI calls this first so a pull can never be a
// surprise: staff see exactly which categories are in scope and how many items
// each would bring in, plus what is being left behind.
async function previewPull(config: SquareConfig, admin: any) {
  const allowed = await loadCategoryAllowlist(admin);
  const allowedSet = new Set(allowed);
  const objects = await listCatalog(config);
  const names = categoryNames(objects);

  const included = new Map<string, number>();
  const excluded = new Map<string, number>();
  for (const o of objects) {
    if (o.type !== "ITEM") continue;
    const cat = categoryOf(o, names);
    const bucket = allowedSet.has(cat) ? included : excluded;
    bucket.set(cat, (bucket.get(cat) ?? 0) + 1);
  }

  const tally = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

  const willImport = [...included.values()].reduce((a, b) => a + b, 0);
  return {
    ok: true,
    environment: config.environment,
    allowlist: allowed,
    // Every category Square knows about, so the UI can offer the full choice.
    all_categories: [...new Set([...included.keys(), ...excluded.keys()])].sort(),
    included: tally(included),
    excluded: tally(excluded),
    will_import: willImport,
    will_skip: [...excluded.values()].reduce((a, b) => a + b, 0),
    over_sanity_limit: willImport > PULL_SANITY_LIMIT,
    sanity_limit: PULL_SANITY_LIMIT,
  };
}

// --- PULL ---------------------------------------------------------------
async function pullAll(config: SquareConfig, admin: any, payload: any) {
  const allowed = await loadCategoryAllowlist(admin);
  const allowedSet = new Set(allowed);
  if (allowedSet.size === 0) {
    throw new Error(
      "No Square categories are allowlisted for concessions — choose them before pulling.",
    );
  }

  const objects = await listCatalog(config);
  const names = categoryNames(objects);
  const inScope = objects.filter(
    (o) => o.type === "ITEM" && allowedSet.has(categoryOf(o, names)),
  );

  // A mis-scoped allowlist must not be able to mass-import in silence. The UI
  // sends confirm_count from what preview showed, so an allowlist edited between
  // preview and pull stops here rather than writing a surprise.
  if (inScope.length > PULL_SANITY_LIMIT && payload?.override_limit !== true) {
    throw new Error(
      `Refusing to import ${inScope.length} items (limit ${PULL_SANITY_LIMIT}). ` +
        `Narrow the category allowlist, or re-run with override_limit.`,
    );
  }

  // Which of these already exist? Existing rows keep their is_active exactly as
  // staff last set it; only genuinely new rows are written, and they arrive
  // inactive. This is what stops any pull — however mis-scoped — from putting
  // anything on the public page by itself.
  const ids = inScope.map((o) => o.id);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("concession_items")
      .select("square_catalog_id")
      .in("square_catalog_id", ids.slice(i, i + 200));
    if (error) throw new Error(`DB read failed: ${error.message}`);
    for (const r of data ?? []) existing.add(r.square_catalog_id);
  }

  let created = 0;
  let updated = 0;
  for (const o of inScope) {
    const data = o.item_data ?? {};
    const variation = (data.variations ?? [])[0];
    const varData = variation?.item_variation_data ?? {};
    const price = Number(varData.price_money?.amount ?? 0) / 100;

    // Note the absence of is_active. Square's is_deleted must never decide what
    // the public site shows; that is an editorial choice staff make here.
    const row: Record<string, unknown> = {
      square_catalog_id: o.id,
      square_variation_id: variation?.id ?? null,
      square_version: o.version ?? null,
      square_synced_at: new Date().toISOString(),
      name: data.name ?? "Untitled",
      price,
      category: categoryOf(o, names),
    };
    if (!existing.has(o.id)) {
      row.is_active = false; // staged; an admin turns it on
      created++;
    } else {
      updated++;
    }

    const { error } = await admin
      .from("concession_items")
      .upsert(row, { onConflict: "square_catalog_id" });
    if (error) throw new Error(`DB upsert failed: ${error.message}`);
  }

  return {
    ok: true,
    environment: config.environment,
    pulled: inScope.length,
    created,
    updated,
    skipped: objects.filter((o) => o.type === "ITEM").length - inScope.length,
    allowlist: allowed,
    note: created > 0
      ? `${created} new item(s) imported INACTIVE — activate them to show on the site.`
      : "No new items; existing items kept their active/inactive state.",
  };
}

// --- PUSH ---------------------------------------------------------------
// Read-modify-write. Square's UpsertCatalogObject replaces the whole object, so
// the only safe edit is to retrieve what is there, change the two fields we own,
// and send it back intact. Reconstructing the object from our four columns is
// what destroyed 906 live catalog entries on 2026-08-14.
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

  const amount = Math.round(Number(item.price) * 100);
  let object: any;

  if (item.square_catalog_id) {
    // Existing Square item: fetch it and edit in place.
    const current = await square(
      config,
      `/catalog/object/${item.square_catalog_id}?include_related_objects=false`,
    );
    object = current.object;
    if (!object) {
      throw new Error(`Square has no object ${item.square_catalog_id}`);
    }
    object.item_data ??= {};
    object.item_data.name = item.name;

    // Only touch the variation we track. Others keep their own names and prices.
    const variations = object.item_data.variations ?? [];
    const target =
      variations.find((v: any) => v.id === item.square_variation_id) ?? variations[0];
    if (target) {
      target.item_variation_data ??= {};
      target.item_variation_data.pricing_type = "FIXED_PRICING";
      target.item_variation_data.price_money = { amount, currency: "USD" };
    } else {
      // No variation at all — add one rather than replacing the item wholesale.
      object.item_data.variations = [
        {
          type: "ITEM_VARIATION",
          id: `#${item.id}-var`,
          item_variation_data: {
            item_id: object.id,
            name: "Regular",
            pricing_type: "FIXED_PRICING",
            price_money: { amount, currency: "USD" },
          },
        },
      ];
    }
  } else {
    // Genuinely new item — nothing upstream to preserve.
    object = {
      type: "ITEM",
      id: `#${item.id}`,
      present_at_all_locations: true,
      item_data: {
        name: item.name,
        variations: [
          {
            type: "ITEM_VARIATION",
            id: `#${item.id}-var`,
            present_at_all_locations: true,
            item_variation_data: {
              name: "Regular",
              pricing_type: "FIXED_PRICING",
              price_money: { amount, currency: "USD" },
            },
          },
        ],
      },
    };
  }

  const res = await square(config, "/catalog/object", {
    method: "POST",
    body: { idempotency_key: crypto.randomUUID(), object },
  });

  const returned = res.catalog_object;
  const returnedVar =
    returned?.item_data?.variations?.find(
      (v: any) => v.id === item.square_variation_id,
    ) ?? returned?.item_data?.variations?.[0];

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

// --- REPAIR --------------------------------------------------------------
// Two jobs against the Square catalog's category field, both driven by
// square_catalog_snapshot_20260814 — the record of every item as it stood before
// the 2026-08-14 damage. It has to be the snapshot rather than concession_items,
// because the out-of-scope rows have since been deleted from the live table.
//
//   restore  — the push wiped the category of items that HAD one. The snapshot
//              still holds the name, so re-file each under the same category.
//   organize — items Square never categorised at all (recorded as "General").
//              Only clearly-patterned names are touched; see desiredCategory.
//
// Neither can bring back descriptions, images, taxes, or variations past the
// first: those were never stored on our side. Only a Square-side backup can.
//
// dry_run: true (the default) reports what it would change and writes nothing.

/**
 * The category an item should sit in, or null to leave it alone.
 *
 * Anchored prefixes and word boundaries only — substring matching is what filed
 * GUILLERMO DEL TORO'S PINOCCHIO as merch (it contains "pin"). "Redeemed" is
 * tested before "pass" so redemption SKUs don't become passes.
 */
function desiredCategory(
  snapshotCategory: string,
  name: string,
  mode: "restore" | "organize" | "both",
): string | null {
  const had = snapshotCategory !== "General";
  if (had) return mode === "organize" ? null : snapshotCategory;
  if (mode === "restore") return null;

  const word = (re: RegExp) => re.test(name);
  if (/redeemed\s*$/i.test(name)) return "6 Redeem";
  if (/^met live in hd:/i.test(name) || /^artist talk with met/i.test(name)) {
    return "6 METLive Tickets";
  }
  if (/^national theatre live:/i.test(name) || /^nt live:/i.test(name)) {
    return "6 NT Live Tickets";
  }
  if (
    word(/\bposters?\b/i) || word(/\bpin\b/i) || word(/\bmagnets?\b/i) ||
    word(/\b(t-?shirts?|hoodie|sticker)\b/i)
  ) {
    return "7 Merch";
  }
  if (word(/\bpass\b/i)) return "9 Film Passes";
  return null;
}

/** Which field Square actually ended up storing the category in, if any. */
function storedCategoryId(itemData: any): string | null {
  return (
    itemData?.category_id ??
    itemData?.categories?.[0]?.id ??
    itemData?.reporting_category?.id ??
    null
  );
}

/**
 * Set an item's category and prove Square kept it.
 *
 * Square's catalog has two category representations and which one is writable
 * depends on the pinned API version. On 2024-01-18 the legacy `category_id` is
 * the one that takes; `categories` is derived, so writing it is accepted and
 * silently discarded. Sending BOTH is rejected outright —
 * "duplicate int value 0 ... for attribute additional_category".
 *
 * So: try one shape at a time, and after each attempt read the category back out
 * of Square's own response. A 2xx only means the request was well-formed; it is
 * not evidence that anything changed. Returns the shape that stuck and the
 * object Square echoed (whose version is current), or null if none did.
 */
async function writeCategoryVerified(
  config: SquareConfig,
  object: any,
  categoryId: string,
): Promise<{ shape: "legacy" | "modern"; object: any } | null> {
  const shapes: Array<{ name: "legacy" | "modern"; apply: (o: any) => void }> = [
    {
      // Legacy first: correct for the pinned API version.
      name: "legacy",
      apply: (o) => {
        delete o.item_data.categories;
        delete o.item_data.reporting_category;
        o.item_data.category_id = categoryId;
      },
    },
    {
      name: "modern",
      apply: (o) => {
        delete o.item_data.category_id;
        o.item_data.categories = [{ id: categoryId, ordinal: 0 }];
        o.item_data.reporting_category = { id: categoryId };
      },
    },
  ];

  let base = object;
  for (const shape of shapes) {
    const candidate = JSON.parse(JSON.stringify(base));
    candidate.item_data ??= {};
    shape.apply(candidate);

    let res: any;
    try {
      res = await square(config, "/catalog/object", {
        method: "POST",
        body: { idempotency_key: crypto.randomUUID(), object: candidate },
      });
    } catch {
      continue; // rejected outright; try the other shape
    }

    const returned = res?.catalog_object;
    if (storedCategoryId(returned?.item_data) === categoryId) {
      return { shape: shape.name, object: returned };
    }
    // Accepted but not stored. The version moved anyway, so the next attempt
    // must build on what Square just returned or it will 409 on a stale version.
    if (returned) base = returned;
  }
  return null;
}

// --- DAMAGE CENSUS -------------------------------------------------------
// "How much was actually lost?" — asked before spending time hunting for a
// pre-incident export. Read-only.
//
// IMAGES can be measured properly. A CatalogImage is its own catalog object;
// the push cleared each item's *reference* to it, not the image itself. So the
// images are still in the catalog, orphaned. Counting images that no item
// points at is a direct measurement of how many pictures were detached.
//
// DESCRIPTIONS cannot. They live inline on the item, so a cleared one leaves no
// trace anywhere. The best available estimate is the 92 items that were never
// pushed: what fraction of *those* carry a description today. State the estimate
// as an estimate — the untouched group is mostly the concession stand, which may
// well be described more (or less) diligently than film tickets, so this is a
// weak extrapolation and is reported with its own base rate so it can be judged.
async function damageCensus(config: SquareConfig, admin: any) {
  // IMAGE is not in the usual list call, so ask for it explicitly.
  let cursor: string | undefined = undefined;
  const objects: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM,IMAGE" });
    if (cursor) q.set("cursor", cursor);
    const res = await square(config, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) objects.push(o);
    cursor = res.cursor;
  } while (cursor);

  const images = objects.filter((o) => o.type === "IMAGE");
  const items = objects.filter((o) => o.type === "ITEM");

  const referenced = new Set<string>();
  for (const it of items) {
    for (const id of it.item_data?.image_ids ?? []) referenced.add(id);
  }
  const orphanImages = images.filter((im) => !referenced.has(im.id));

  // Split the live items by whether we pushed to them.
  const snapshot = new Map<string, any>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("square_catalog_snapshot_20260814")
      .select("square_catalog_id, name, likely_overwritten")
      .range(from, from + 999);
    if (error) throw new Error(`Snapshot read failed: ${error.message}`);
    for (const r of data ?? []) snapshot.set(r.square_catalog_id, r);
    if ((data?.length ?? 0) < 1000) break;
  }

  const bucket = (pushed: boolean) => {
    const set = items.filter((it) => {
      const s = snapshot.get(it.id);
      return s ? Boolean(s.likely_overwritten) === pushed : false;
    });
    const withDescription = set.filter(
      (it) => (it.item_data?.description ?? "").trim().length > 0,
    ).length;
    const withImage = set.filter((it) => (it.item_data?.image_ids ?? []).length > 0).length;
    return { items: set.length, withDescription, withImage };
  };

  const damaged = bucket(true);
  const untouched = bucket(false);

  // Can the orphans be put back? Square stores no back-reference from an image
  // to its item, so the only handle is the image's own name/caption. If those
  // echo the item name the re-attachment is mechanical; if they are generic
  // ("IMG_4821.jpg") it is a manual job and worth knowing before starting.
  const normalise = (s: string) =>
    s.toLowerCase()
      .replace(/\.(jpe?g|png|gif|webp|heic)$/i, "")
      .replace(/[^a-z0-9]+/g, "");

  const byName = new Map<string, string[]>();
  for (const [id, s] of snapshot) {
    const k = normalise(s.name ?? "");
    if (!k) continue;
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(id);
  }

  let unique = 0, ambiguous = 0, unmatched = 0;
  const matchSample: any[] = [];
  const unmatchedSample: any[] = [];
  for (const im of orphanImages) {
    const label = im.image_data?.name ?? im.image_data?.caption ?? "";
    const hits = byName.get(normalise(label)) ?? [];
    if (hits.length === 1) {
      unique++;
      if (matchSample.length < 10) {
        matchSample.push({
          image: label,
          item: snapshot.get(hits[0])?.name ?? null,
        });
      }
    } else if (hits.length > 1) {
      ambiguous++;
    } else {
      unmatched++;
      if (unmatchedSample.length < 10) unmatchedSample.push(label || "(no name)");
    }
  }

  const descriptionRate = untouched.items > 0
    ? untouched.withDescription / untouched.items
    : 0;

  return {
    ok: true,
    environment: config.environment,

    images: {
      total_in_catalog: images.length,
      referenced_by_an_item: referenced.size,
      // The measurement that matters: pictures still in the catalog that nothing
      // points at any more.
      orphaned: orphanImages.length,
      orphan_sample: orphanImages.slice(0, 10).map((im) => ({
        id: im.id,
        name: im.image_data?.name ?? null,
        caption: im.image_data?.caption ?? null,
        url: im.image_data?.url ?? null,
      })),
      // Whether the orphans can be matched back to items by name alone.
      reattachable: {
        unique_match: unique,
        ambiguous_match: ambiguous,
        no_match: unmatched,
        match_sample: matchSample,
        unmatched_sample: unmatchedSample,
      },

      // What metadata the orphans actually carry. Name matching returning zero
      // could mean the names are unhelpful or that there are no names at all —
      // opposite conclusions, and only this distinguishes them. The raw sample
      // exists so any remaining handle (a caption, a url pattern, a timestamp
      // that clusters with item creation) can be seen rather than guessed at.
      metadata: {
        with_name: orphanImages.filter(
          (im) => (im.image_data?.name ?? "").trim().length > 0,
        ).length,
        with_caption: orphanImages.filter(
          (im) => (im.image_data?.caption ?? "").trim().length > 0,
        ).length,
        raw_sample: orphanImages.slice(0, 5).map((im) => ({
          id: im.id,
          updated_at: im.updated_at ?? null,
          image_data_keys: Object.keys(im.image_data ?? {}),
          image_data: im.image_data ?? {},
        })),
      },
    },

    // Both groups as they stand now, so the base rates are visible rather than
    // buried in a single extrapolated number.
    damaged_items: damaged,
    untouched_items: untouched,

    description_estimate: {
      untouched_base_rate: Number((descriptionRate * 100).toFixed(1)),
      estimated_descriptions_lost: Math.round(descriptionRate * damaged.items),
      caveat:
        "Extrapolated from the items we never pushed, which are mostly the " +
        "concession stand. Film and event tickets may carry descriptions at a " +
        "quite different rate, so treat this as an order of magnitude only.",
    },

    verdict:
      orphanImages.length === 0 && descriptionRate === 0
        ? "No evidence of description or image loss — an export hunt is probably not worth it."
        : "There is measurable loss; see the orphaned image count, which is exact.",
  };
}

// --- VARIATION REPAIR ----------------------------------------------------
// The 14 Aug push replaced each item's variations array with a single "Regular"
// entry carrying `version: undefined`. An item with no priced variation cannot
// be rung up, so this outranks the category loss.
//
// The dry run reports what is actually there before anything is written —
// how many items have no variation at all, how many carry one named "Regular",
// and whether the variation id still matches the one recorded pre-incident.
// That distinction decides the repair: an item that kept its original variation
// id only lost its *name*, while an item with none needs one created.
//
// Reusing the original variation id matters beyond tidiness: historical orders
// reference it, so a variation restored under the same id relinks past
// reporting, where a freshly minted one leaves it orphaned. It is attempted
// first and only abandoned if Square refuses.
async function repairVariations(config: SquareConfig, admin: any, payload: any) {
  const dryRun = payload?.dry_run !== false;
  const only: Set<string> | null = Array.isArray(payload?.only_names)
    ? new Set(payload.only_names.map((n: unknown) => String(n)))
    : null;

  const objects = await listCatalog(config);
  const liveItems = new Map<string, any>();
  for (const o of objects) if (o.type === "ITEM") liveItems.set(o.id, o);

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("square_catalog_snapshot_20260814")
      .select("square_catalog_id, square_variation_id, name, price, likely_overwritten")
      .range(from, from + 999);
    if (error) throw new Error(`Snapshot read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }

  const census = {
    no_variation: 0,
    one_named_regular: 0,
    original_id_intact: 0,
    healthy: 0,
    gone_from_square: 0,
  };
  const plan: any[] = [];

  for (const r of rows) {
    if (only && !only.has(r.name)) continue;
    if (!r.likely_overwritten) continue;
    const live = liveItems.get(r.square_catalog_id);
    if (!live) { census.gone_from_square++; continue; }

    const variations = live.item_data?.variations ?? [];
    const first = variations[0];
    const firstName = first?.item_variation_data?.name ?? null;
    const hasPrice = first?.item_variation_data?.price_money?.amount != null;

    if (variations.length === 0) {
      census.no_variation++;
      plan.push({
        id: r.square_catalog_id, name: r.name,
        variation_id: r.square_variation_id, price: Number(r.price ?? 0),
        issue: "no variation",
      });
      continue;
    }
    if (first?.id === r.square_variation_id) census.original_id_intact++;
    if (firstName === "Regular") {
      census.one_named_regular++;
      // Name is unrecoverable, so a "Regular" that is otherwise priced and
      // correctly identified is not worth rewriting — flagged, not planned.
    }
    if (hasPrice) census.healthy++;
  }

  if (dryRun) {
    return {
      ok: true,
      environment: config.environment,
      dry_run: true,
      census,
      needs_repair: plan.length,
      sample: plan.slice(0, 10),
      note:
        "Only items with NO variation are planned. A variation named 'Regular' " +
        "kept its id and price — the original name is not recoverable from our " +
        "side, so rewriting it would change nothing.",
    };
  }

  let repaired = 0;
  const failures: any[] = [];
  for (const p of plan) {
    try {
      const current = await square(
        config,
        `/catalog/object/${p.id}?include_related_objects=false`,
      );
      const object = current.object;
      if (!object) continue;
      object.item_data ??= {};

      const amount = Math.round(p.price * 100);
      const build = (variationId: string) => ({
        type: "ITEM_VARIATION",
        id: variationId,
        item_variation_data: {
          item_id: object.id,
          name: "Regular",
          pricing_type: "FIXED_PRICING",
          price_money: { amount, currency: "USD" },
        },
      });

      // Original id first so historical orders relink; a fresh one only if
      // Square will not take it back.
      let landed: any = null;
      for (const candidateId of [p.variation_id, `#${p.id}-var`].filter(Boolean)) {
        const attempt = JSON.parse(JSON.stringify(object));
        attempt.item_data.variations = [build(candidateId)];
        let res: any;
        try {
          res = await square(config, "/catalog/object", {
            method: "POST",
            body: { idempotency_key: crypto.randomUUID(), object: attempt },
          });
        } catch { continue; }
        // Same rule as the category repair: a 2xx proves nothing. Confirm the
        // variation came back priced before counting it.
        const back = res?.catalog_object?.item_data?.variations?.[0];
        if (back?.item_variation_data?.price_money?.amount === amount) {
          landed = back;
          break;
        }
      }

      if (!landed) {
        failures.push({
          id: p.id, name: p.name,
          error: "Square accepted the write but no priced variation came back",
        });
        continue;
      }
      repaired++;
    } catch (e: any) {
      failures.push({ id: p.id, name: p.name, error: e.message ?? String(e) });
    }
  }

  const counts = new Map<string, number>();
  for (const f of failures) {
    const key = String(f.error).replace(/[A-Z0-9]{20,}/g, "<id>").slice(0, 200);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    ok: true,
    environment: config.environment,
    dry_run: false,
    repaired,
    attempted: plan.length,
    error_summary: [...counts.entries()]
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count),
    failures: failures.slice(0, 20),
    failure_count: failures.length,
  };
}

async function repairCategories(config: SquareConfig, admin: any, payload: any) {
  const dryRun = payload?.dry_run !== false; // default to dry run
  const limit = Number(payload?.limit ?? 0) || null;
  const mode: "restore" | "organize" | "both" = payload?.mode ?? "restore";
  // Names the caller has explicitly vetted. When present, only these are touched
  // — so a reviewed "organize" list can drop entries staff disagreed with.
  const only: Set<string> | null = Array.isArray(payload?.only_names)
    ? new Set(payload.only_names.map((n: unknown) => String(n)))
    : null;

  const objects = await listCatalog(config);
  const nameToCategoryId = new Map<string, string>();
  for (const o of objects) {
    if (o.type === "CATEGORY") {
      nameToCategoryId.set(o.category_data?.name ?? "General", o.id);
    }
  }
  const liveItems = new Map<string, any>();
  for (const o of objects) if (o.type === "ITEM") liveItems.set(o.id, o);

  // The pre-damage record of every item we ever pulled.
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("square_catalog_snapshot_20260814")
      .select("square_catalog_id, category, name")
      .range(from, from + 999);
    if (error) throw new Error(`Snapshot read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }

  const plan: any[] = [];
  const unmatched: any[] = [];
  let gone = 0;
  for (const r of rows) {
    if (only && !only.has(r.name)) continue;
    const live = liveItems.get(r.square_catalog_id);
    if (!live) { gone++; continue; } // no longer in Square
    const want = desiredCategory(r.category, r.name, mode);
    if (!want) continue;
    const wantId = nameToCategoryId.get(want);
    if (!wantId) {
      unmatched.push({ name: r.name, category: want });
      continue;
    }
    // Same reader the write uses to confirm itself, so "needs repair" and
    // "repair stuck" can never disagree about where a category lives.
    if (storedCategoryId(live.item_data) === wantId) continue; // already correct
    plan.push({
      id: r.square_catalog_id,
      name: r.name,
      category: want,
      category_id: wantId,
      was_uncategorized: r.category === "General",
    });
  }

  const target = limit ? plan.slice(0, limit) : plan;
  if (dryRun) {
    const byCategory = new Map<string, number>();
    for (const p of target) {
      byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
    }
    return {
      ok: true,
      environment: config.environment,
      dry_run: true,
      mode,
      needs_repair: plan.length,
      would_repair: target.length,
      restoring: target.filter((p) => !p.was_uncategorized).length,
      organizing: target.filter((p) => p.was_uncategorized).length,
      no_longer_in_square: gone,
      by_category: [...byCategory.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      unmatched_categories: [...new Set(unmatched.map((u) => u.category))],
      // The full list, so staff can review every name before anything writes.
      items: target.map((p) => ({ name: p.name, category: p.category })),
    };
  }

  let repaired = 0;
  const strategy = { modern: 0, legacy: 0 };
  const failures: any[] = [];
  for (const p of target) {
    try {
      const current = await square(
        config,
        `/catalog/object/${p.id}?include_related_objects=false`,
      );
      let object = current.object;
      if (!object) continue;
      object.item_data ??= {};

      // Write, then CONFIRM Square stored it — a 2xx is not evidence of a write.
      //
      // At SQUARE_API_VERSION 2024-01-18 `item_data.categories` is derived, not
      // writable: sending it is accepted and ignored, while clearing
      // `category_id` removes the only field that counts. The whole run then
      // reports success and changes nothing, which is exactly what happened on
      // the first two repair attempts. An error-triggered fallback cannot catch
      // that, because there is no error. Reading the category back out of the
      // response is the only thing that can.
      const wrote = await writeCategoryVerified(config, object, p.category_id);
      if (!wrote) {
        failures.push({
          id: p.id,
          name: p.name,
          error:
            "Square accepted the write but did not store the category " +
            "(no shape took effect)",
        });
        continue;
      }
      object = wrote.object;
      if (wrote.shape === "legacy") strategy.legacy++; else strategy.modern++;
      repaired++;
    } catch (e: any) {
      failures.push({ id: p.id, name: p.name, error: e.message ?? String(e) });
    }
  }

  // Group the messages. 381 individual failures are unreadable one by one, but
  // they usually collapse to one or two distinct causes, and the cause is what
  // decides whether this needs a retry, a throttle, or a different payload.
  const counts = new Map<string, number>();
  for (const f of failures) {
    // Strip the per-object noise so like errors group together.
    const key = String(f.error).replace(/[A-Z0-9]{20,}/g, "<id>").slice(0, 200);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    ok: true,
    environment: config.environment,
    dry_run: false,
    repaired,
    attempted: target.length,
    remaining: plan.length - target.length,
    strategy,
    error_summary: [...counts.entries()]
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count),
    failures: failures.slice(0, 20),
    failure_count: failures.length,
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
