// TEMPORARY, READ-ONLY. Phase 0 of the venue + event date/time restore.
//
// Delete this function once the findings note is signed off:
//   supabase functions delete square-event-probe --project-ref <prod>
// (no new prod secret was created — it reuses the admin-JWT gate)
//
// It exists because the production Square access token lives only as a
// Supabase secret, so the only way to read the live catalog is from inside a
// function that already has it. It is deliberately a NEW function rather than
// a new action on square-catalog-sync: prod runs that one from an uncommitted
// worktree, and redeploying it from main could revert unmerged work.
//
// This function makes NO writes. `assertRead` refuses any call that is not a
// GET, with the single exception of CatalogSearch, which Square models as a
// POST but which reads.
//
// What it settles, in order of how much the answer matters:
//
//   1. Does RetrieveCatalogObject return `item_data.event`?
//      This decides whether Phase 1 can happen at all. Our only safe write is
//      retrieve -> edit one field -> upsert the whole object back, and
//      UpsertCatalogObject REPLACES the stored object with what we send. If
//      the event block is visible to CatalogSearch but not to Retrieve, then
//      what we send back is already missing the venue and the date, and the
//      write DELETES them -- the 2026-08-14 incident, aimed squarely at the
//      field this job exists to restore.
//
//   2. The exact keys inside `item_data.event`, and the exact FORMAT of the
//      values on the items restored by hand. Free text or a real timestamp
//      decides whether the delivered CSV is usable, because it carries no year.
//
//   3. Whether the pinned Square-Version (2024-01-18, in _shared/square.ts)
//      sees the same fields as a current one. A field the pinned version
//      cannot see is a field our deployed code would silently drop.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadSquareConfig,
  squareFetch,
  SQUARE_API_VERSION,
  type SquareConfig,
} from "../_shared/square.ts";

declare const Deno: any;

const CURRENT_VERSION = "2025-07-16";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

/** Hard stop on anything that could mutate the catalog. */
function assertRead(path: string, method: string) {
  const isSearch = path.startsWith("/catalog/search") || path.startsWith("/orders/search");
  if (method !== "GET" && !isSearch) {
    throw new Error(`probe refused a non-read call: ${method} ${path}`);
  }
}

/**
 * Call Square at an explicit API version.
 *
 * `squareFetch` pins Square-Version to SQUARE_API_VERSION, which is exactly the
 * thing question 3 needs to vary, so the pinned calls go through squareFetch
 * (the app's real plumbing, per the brief) and the current-version calls use a
 * direct fetch with the same auth. Both are reads.
 */
async function sq(
  config: SquareConfig,
  path: string,
  { method = "GET", body, version }: { method?: string; body?: unknown; version?: string } = {},
): Promise<any> {
  assertRead(path, method);

  if (!version || version === SQUARE_API_VERSION) {
    const { ok, status, data } = await squareFetch(config, path, { method, body });
    if (!ok) throw new Error(`Square ${status} on ${method} ${path}: ${JSON.stringify(data?.errors ?? data)?.slice(0, 300)}`);
    return data ?? {};
  }

  const res = await fetch(`${config.apiBase}${path}`, {
    method,
    headers: {
      "Square-Version": version,
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Square ${res.status} on ${method} ${path}: ${JSON.stringify(data?.errors ?? data)?.slice(0, 300)}`);
  return data ?? {};
}

async function listAllItems(config: SquareConfig, version: string, catalogVersion?: number) {
  const objects: any[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ types: "ITEM" });
    if (catalogVersion) q.set("catalog_version", String(catalogVersion));
    if (cursor) q.set("cursor", cursor);
    const res = await sq(config, `/catalog/list?${q}`, { version });
    objects.push(...(res.objects ?? []));
    cursor = res.cursor;
  } while (cursor);
  return objects;
}

/** The endpoint Square's forum thread says surfaces the venue. */
async function searchAllItems(config: SquareConfig, version: string) {
  const objects: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await sq(config, "/catalog/search", {
      method: "POST",
      version,
      body: { object_types: ["ITEM"], include_deleted_objects: false, cursor, limit: 1000 },
    });
    objects.push(...(res.objects ?? []));
    cursor = res.cursor;
  } while (cursor);
  return objects;
}

/** Every dotted key path in a value, so nothing is missed by guessing names. */
function keyPaths(value: any, prefix = "", out = new Set<string>()) {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    if (value.length) keyPaths(value[0], `${prefix}[]`, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    keyPaths(v, path, out);
  }
  return out;
}

/** Any leaf whose path or value looks like a venue, an address, or a time. */
function eventish(object: any) {
  const hits: Record<string, unknown> = {};
  const walk = (value: any, path: string) => {
    if (value === null || value === undefined) return;
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    if (
      /event|venue|location_name|address|start|end|date|time/i.test(path) ||
      /508 S Main/i.test(String(value))
    ) {
      hits[path] = value;
    }
  };
  walk(object, "");
  return hits;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Same gate as square-catalog-sync: a signed-in admin. Deliberately not a
  // bespoke shared secret -- this reuses the access control that already
  // governs every other Square action, and needs no new secret in prod.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);
  const { data: userRes } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  const user = userRes?.user;
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  let payload: any = {};
  try { payload = await req.json(); } catch { /* no body */ }

  try {
    const listPinned = await listAllItems(config, SQUARE_API_VERSION);
    const listCurrent = await listAllItems(config, CURRENT_VERSION);
    const searchCurrent = await searchAllItems(config, CURRENT_VERSION);

    const byProductType: Record<string, number> = {};
    for (const o of listCurrent) {
      const t = o.item_data?.product_type ?? "(unset)";
      byProductType[t] = (byProductType[t] ?? 0) + 1;
    }

    const byIdList = new Map(listCurrent.map((o) => [o.id, o]));
    const byIdSearch = new Map(searchCurrent.map((o) => [o.id, o]));
    const byIdPinned = new Map(listPinned.map((o) => [o.id, o]));

    const withEvent = listCurrent.filter((o) => o.item_data?.event);
    const withEventSearch = searchCurrent.filter((o) => o.item_data?.event);
    const withEventPinned = listPinned.filter((o) => o.item_data?.event);

    const eventKeys = new Set<string>();
    for (const o of [...withEvent, ...withEventSearch]) {
      keyPaths(o.item_data.event, "item_data.event", eventKeys);
    }

    // Every surviving event block, not a sample. A Square Library CSV export
    // has no columns for event fields, so the dashboard export CANNOT back this
    // data up -- reading it through the API is the only snapshot that exists.
    // Small enough to return whole (38 at time of writing).
    const allBlocks = [...new Map(
      [...withEvent, ...withEventSearch].map((o) => [o.id, o]),
    ).values()].map((o) => ({
      id: o.id,
      name: o.item_data?.name,
      version: o.version,
      updated_at: o.updated_at,
      event: o.item_data.event,
    }));

    // How is the venue address modelled? If every item points at its own
    // address object, Phase 1 has to create one per item; if they share, we can
    // reuse a single id. Two different ids were seen by hand, so count them.
    const addressIds: Record<string, number> = {};
    for (const b of allBlocks) {
      const a = b.event?.address_id;
      if (a) addressIds[a] = (addressIds[a] ?? 0) + 1;
    }
    const locationNames: Record<string, number> = {};
    for (const b of allBlocks) {
      const n = b.event?.event_location_name ?? "(none)";
      locationNames[n] = (locationNames[n] ?? 0) + 1;
    }
    // Is an address_id a retrievable catalog object, or something else?
    let addressProbe: any = null;
    const someAddress = Object.keys(addressIds)[0];
    if (someAddress) {
      try {
        const a = await sq(config, `/catalog/object/${someAddress}?include_related_objects=false`, { version: CURRENT_VERSION });
        addressProbe = { id: someAddress, type: a.object?.type ?? null, object: a.object ?? null };
      } catch (e: any) {
        addressProbe = { id: someAddress, error: e.message ?? String(e) };
      }
    }

    // Populated blocks — this is the format Phase 1 has to match exactly.
    const samples = [...withEvent, ...withEventSearch].slice(0, 10).map((o) => ({
      id: o.id,
      name: o.item_data?.name,
      product_type: o.item_data?.product_type,
      version: o.version,
      updated_at: o.updated_at,
      event: o.item_data.event,
    }));

    // THE DECIDING TEST.
    const probeIds: string[] = payload.tokens?.length
      ? payload.tokens
      : [...withEvent, ...withEventSearch].slice(0, 5).map((o) => o.id);

    const roundTrip: any[] = [];
    for (const id of probeIds) {
      let rPinned: any = null, rCurrent: any = null, err: string | null = null;
      try {
        rPinned = await sq(config, `/catalog/object/${id}?include_related_objects=false`, { version: SQUARE_API_VERSION });
        rCurrent = await sq(config, `/catalog/object/${id}?include_related_objects=false`, { version: CURRENT_VERSION });
      } catch (e: any) {
        err = e.message ?? String(e);
      }
      roundTrip.push({
        id,
        error: err,
        name: rCurrent?.object?.item_data?.name ?? byIdList.get(id)?.item_data?.name ?? null,
        product_type: rCurrent?.object?.item_data?.product_type ?? null,
        event_in_list_current: !!byIdList.get(id)?.item_data?.event,
        event_in_list_pinned: !!byIdPinned.get(id)?.item_data?.event,
        event_in_search_current: !!byIdSearch.get(id)?.item_data?.event,
        event_in_retrieve_pinned: !!rPinned?.object?.item_data?.event,
        event_in_retrieve_current: !!rCurrent?.object?.item_data?.event,
        event_from_retrieve: rCurrent?.object?.item_data?.event ?? null,
        event_from_search: byIdSearch.get(id)?.item_data?.event ?? null,
        eventish_in_retrieve: eventish(rCurrent?.object ?? {}),
        retrieved_top_level_keys: Object.keys(rCurrent?.object?.item_data ?? {}).sort(),
      });
    }

    // Any item where the field exists upstream but not in retrieve is an item a
    // read-modify-write would silently strip.
    const wouldDrop = roundTrip.filter(
      (r) => (r.event_in_list_current || r.event_in_search_current) && !r.event_in_retrieve_current,
    );

    // Is the missing event data explained by the 2026-08-14 push? That push
    // rebuilt item_data from four columns, which would have cleared the event
    // block along with description and images. If so, the surviving blocks
    // should all predate it and the empty ones should cluster on the day.
    const day = (o: any) => (o.updated_at ?? "").slice(0, 10);
    const eventItems = listCurrent.filter((o) => o.item_data?.product_type === "EVENT");
    const bucket = (objs: any[]) => {
      const h: Record<string, number> = {};
      for (const o of objs) h[day(o) || "(unknown)"] = (h[day(o) || "(unknown)"] ?? 0) + 1;
      return Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 12);
    };
    const eventBlockByProductType: Record<string, { with: number; without: number }> = {};
    for (const o of listCurrent) {
      const t = o.item_data?.product_type ?? "(unset)";
      eventBlockByProductType[t] ??= { with: 0, without: 0 };
      if (o.item_data?.event) eventBlockByProductType[t].with++;
      else eventBlockByProductType[t].without++;
    }
    const wipe = {
      event_type_items: eventItems.length,
      event_type_with_block: eventItems.filter((o) => o.item_data?.event).length,
      event_type_without_block: eventItems.filter((o) => !o.item_data?.event).length,
      updated_at_days_WITH_block: bucket(eventItems.filter((o) => o.item_data?.event)),
      updated_at_days_WITHOUT_block: bucket(eventItems.filter((o) => !o.item_data?.event)),
      by_product_type: eventBlockByProductType,
    };

    // Full object dump for named ids -- used to inspect exactly what a write
    // left behind, field by field.
    let dumps: any = null;
    if (Array.isArray(payload.dump_ids) && payload.dump_ids.length) {
      dumps = [];
      for (const id of payload.dump_ids.slice(0, 40)) {
        try {
          const cv = payload.catalog_version ? `&catalog_version=${payload.catalog_version}` : "";
          const d = await sq(config, `/catalog/object/${id}?include_related_objects=false${cv}`, { version: CURRENT_VERSION });
          dumps.push(d.object ?? null);
        } catch (e: any) {
          dumps.push({ id, error: e.message ?? String(e) });
        }
      }
    }

    // How does the theatre actually record money in Square? Sources, tenders,
    // line-item shapes, taxes, discounts, fulfilment. This is the shape a new
    // integration has to match for accounting to stay consistent.
    if (payload.accounting_audit) {
      const cats = await sq(config, "/catalog/list?types=CATEGORY");
      const catName = new Map((cats.objects ?? []).map((c: any) => [c.id, c.category_data?.name]));

      const tally = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
      const source = new Map<string, number>(), tender = new Map<string, number>();
      const liType = new Map<string, number>(), fulfil = new Map<string, number>();
      const state = new Map<string, number>(), cat = new Map<string, number>();
      let orders = 0, lines = 0, withTax = 0, withDiscount = 0, withServiceCharge = 0;
      let withCatalogId = 0, withNote = 0, withCustomer = 0, returns = 0, tipped = 0;
      let cursor: string | undefined; let pages = 0;
      const maxPages = Number(payload.max_pages ?? 10);
      do {
        const res = await sq(config, "/orders/search", {
          method: "POST",
          body: { location_ids: [config.locationId],
                  query: { sort: { sort_field: "CREATED_AT", sort_order: "DESC" } },
                  limit: 500, cursor },
        });
        for (const o of res.orders ?? []) {
          orders++;
          tally(source, o.source?.name ?? "(none)");
          tally(state, o.state ?? "(none)");
          if (o.discounts?.length) withDiscount++;
          if (o.taxes?.length) withTax++;
          if (o.service_charges?.length) withServiceCharge++;
          if (o.returns?.length) returns++;
          if (o.customer_id) withCustomer++;
          for (const t of o.tenders ?? []) {
            tally(tender, t.type ?? "(none)");
            if ((t.tip_money?.amount ?? 0) > 0) tipped++;
          }
          for (const f of o.fulfillments ?? []) tally(fulfil, f.type ?? "(none)");
          if (!(o.line_items ?? []).length) {
            tally(liType, `NO LINE ITEMS (source=${o.source?.name ?? "none"})`);
          }
          for (const li of o.line_items ?? []) {
            lines++;
            tally(liType, li.item_type ?? "(none)");
            if (li.catalog_object_id) withCatalogId++;
            if (li.note) withNote++;
            const c = li.catalog_object_id ? null : null;
            tally(cat, li.item_type === "CUSTOM_AMOUNT" ? `CUSTOM: ${li.name ?? "?"}` : "(catalog)");
            if (c) void c;
          }
        }
        cursor = res.cursor; pages++;
      } while (cursor && pages < maxPages);

      const top = (m: Map<string, number>, n = 12) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
          .map(([k, v]) => ({ k, v }));
      return json({ ok: true, pages, orders, line_items: lines,
        source: top(source), tender: top(tender), order_state: top(state),
        line_item_type: top(liType), fulfillment: top(fulfil),
        custom_amount_lines: top(cat, 20),
        with_catalog_object_id: withCatalogId, with_note: withNote,
        with_customer_id: withCustomer, orders_with_tax: withTax,
        orders_with_discount: withDiscount, orders_with_service_charge: withServiceCharge,
        orders_with_returns: returns, tenders_with_tip: tipped,
        categories: [...catName.entries()].map(([id, name]) => ({ id, name })) });
    }

    // Order history as an independent source of truth about what variations
    // once existed. The pre-damage snapshot is one witness; the sales record is
    // another, and it covers anything created after the snapshot was taken but
    // before the damage. Anything sold that the catalog can no longer offer is
    // a gap the snapshot did not close.
    if (payload.orders_audit) {
      const seen = new Map<string, any>();   // itemName|variationName -> sample
      let cursor: string | undefined;
      let pages = 0, orders = 0, lines = 0;
      const maxPages = Number(payload.max_pages ?? 20);
      do {
        const res = await sq(config, "/orders/search", {
          method: "POST",
          body: {
            location_ids: [config.locationId],
            query: { sort: { sort_field: "CREATED_AT", sort_order: "DESC" } },
            limit: 500, cursor,
          },
        });
        for (const o of res.orders ?? []) {
          orders++;
          for (const li of o.line_items ?? []) {
            lines++;
            const k = `${li.name ?? ""}|${li.variation_name ?? ""}`;
            if (!seen.has(k)) {
              seen.set(k, {
                item: li.name ?? null,
                variation: li.variation_name ?? null,
                amount: (li.base_price_money ?? {}).amount ?? null,
                catalog_object_id: li.catalog_object_id ?? null,
                first_seen_order: o.created_at,
              });
            }
          }
        }
        cursor = res.cursor;
        pages++;
      } while (cursor && pages < maxPages);

      // What can the catalog offer today?
      const now = await listAllItems(config, CURRENT_VERSION);
      const live = new Set<string>();
      const liveIds = new Set<string>();
      for (const it of now) {
        const nm = it.item_data?.name ?? "";
        for (const v of it.item_data?.variations ?? []) {
          live.add(`${nm}|${v.item_variation_data?.name ?? ""}`);
          liveIds.add(v.id);
        }
      }
      const soldButMissing = [...seen.entries()]
        .filter(([k]) => !live.has(k))
        .map(([, v]) => v);
      // A sale whose variation was literally named "Regular" happened while the
      // catalog was flattened -- that name was the damage, and it is correctly
      // gone now. Those are artefacts of the window, not gaps in the restore.
      const damagedWindow = soldButMissing.filter((v) => v.variation === "Regular");
      // Separator and spacing drift is not a missing variation. A ticket sold as
      // "Adult ~ Thursday, August 27 at 7 PM" and now offered as
      // "Adult - Thursday, August 27 at 7 PM" is the same option renamed.
      const norm = (x: string) =>
        (x ?? "").toLowerCase().replace(/[~\-–—]/g, "-").replace(/\s+/g, " ").trim();
      const liveNorm = new Set([...live].map((k) => {
        const i = k.indexOf("|");
        return `${norm(k.slice(0, i))}|${norm(k.slice(i + 1))}`;
      }));
      const stillMissing = soldButMissing.filter(
        (v) => v.variation !== "Regular" &&
               !liveNorm.has(`${norm(v.item ?? "")}|${norm(v.variation ?? "")}`),
      );
      const renamedOnly = soldButMissing.filter(
        (v) => v.variation !== "Regular" &&
               liveNorm.has(`${norm(v.item ?? "")}|${norm(v.variation ?? "")}`),
      );
      const realGaps = stillMissing;

      return json({
        ok: true, pages, orders, line_items: lines,
        distinct_sold_variations: seen.size,
        sold_but_not_offered_now: soldButMissing.length,
        sold_as_Regular_during_damage: damagedWindow.length,
        renamed_only_not_a_gap: renamedOnly.length,
        real_gaps: realGaps.length,
        by_dangling_id: soldButMissing.filter((v) => v.catalog_object_id && !liveIds.has(v.catalog_object_id)).length,
        examples: realGaps.slice(0, 60),
      });
    }

    // Do past orders still carry the names and prices of variations that have
    // since been deleted? This decides whether restoring variations repairs
    // anything historical, or only re-creates sellable options going forward.
    if (payload.orders_probe) {
      const res = await sq(config, "/orders/search", {
        method: "POST",
        body: {
          location_ids: [config.locationId],
          query: { sort: { sort_field: "CREATED_AT", sort_order: "DESC" } },
          limit: Number(payload.orders_limit ?? 20),
        },
      });
      const orders = res.orders ?? [];
      const lines: any[] = [];
      for (const o of orders) {
        for (const li of o.line_items ?? []) {
          lines.push({
            order_created: o.created_at,
            name: li.name ?? null,
            variation_name: li.variation_name ?? null,
            catalog_object_id: li.catalog_object_id ?? null,
            base_price: li.base_price_money ?? null,
          });
        }
      }
      // Which referenced variation ids no longer resolve in the catalog?
      const refIds = [...new Set(lines.map((l) => l.catalog_object_id).filter(Boolean))];
      const resolved: Record<string, boolean> = {};
      for (const id of refIds.slice(0, 15)) {
        try { await sq(config, `/catalog/object/${id}?include_related_objects=false`); resolved[id] = true; }
        catch { resolved[id] = false; }
      }
      return json({ ok: true, orders: orders.length, line_items: lines.length,
                    sample_lines: lines.slice(0, 12),
                    referenced_ids_checked: Object.keys(resolved).length,
                    referenced_ids_now_missing: Object.values(resolved).filter((v) => !v).length,
                    resolved });
    }

    // Capture the catalog as it stood at a chosen instant, in full, to a file
    // we control.
    //
    // Square retains catalog history and serves it through `catalog_version`,
    // which is how the 2026-08-14 damage turned out to be readable after all --
    // the incident note's "nothing on our side can reconstruct them" was wrong.
    // But Square documents no retention window for that history, so it is not
    // something to depend on. This writes the whole pre-damage catalog to
    // Supabase Storage and returns a short-lived signed URL, so the recovery
    // source becomes a file we own rather than a vendor behaviour that could
    // expire without notice.
    if (payload.snapshot_version) {
      const at = Number(payload.snapshot_version);
      const objects = await listAllItems(config, CURRENT_VERSION, at);
      const body = JSON.stringify({
        captured_at: new Date().toISOString(),
        catalog_version: at,
        square_version: CURRENT_VERSION,
        environment: config.environment,
        item_count: objects.length,
        objects,
      });

      const bucket = "catalog-snapshots";
      try { await admin.storage.createBucket(bucket, { public: false }); } catch { /* exists */ }
      const path = `square-catalog-${at}.json`;
      const up = await admin.storage.from(bucket)
        .upload(path, new Blob([body], { type: "application/json" }), { upsert: true });
      if (up.error) return json({ error: `upload failed: ${up.error.message}` }, 500);
      const signed = await admin.storage.from(bucket).createSignedUrl(path, 3600);
      if (signed.error) return json({ error: `sign failed: ${signed.error.message}` }, 500);

      return json({
        ok: true,
        snapshot: {
          catalog_version: at,
          item_count: objects.length,
          bytes: body.length,
          path: `${bucket}/${path}`,
          signed_url: signed.data.signedUrl,
        },
      });
    }

    // How much of the 2026-08-14 damage is still readable from Square's own
    // catalog history? Walk the catalog as it stood at a chosen instant and
    // compare description/image presence against today.
    let recovery: any = null;
    if (payload.compare_version) {
      const past = await listAllItems(config, CURRENT_VERSION, Number(payload.compare_version));
      const pastById = new Map(past.map((o) => [o.id, o]));
      const text = (o: any) =>
        (o?.item_data?.description || o?.item_data?.description_html || "").length;
      const imgs = (o: any) => (o?.item_data?.image_ids || []).length;
      let lostDesc = 0, lostImg = 0, recoverableDesc = 0, recoverableImg = 0, sameDesc = 0;
      const examples: any[] = [];
      for (const nowObj of listCurrent) {
        const then = pastById.get(nowObj.id);
        if (!then) continue;
        const dNow = text(nowObj), dThen = text(then);
        const iNow = imgs(nowObj), iThen = imgs(then);
        if (dThen > 0 && dNow === 0) { lostDesc++; recoverableDesc++;
          if (examples.length < 8) examples.push({ id: nowObj.id, name: nowObj.item_data?.name, desc_chars_then: dThen, images_then: iThen }); }
        else if (dThen > 0 && dNow > 0) sameDesc++;
        if (iThen > 0 && iNow === 0) { lostImg++; recoverableImg++; }
      }
      recovery = {
        as_of: payload.compare_version,
        items_in_past_walk: past.length,
        items_now: listCurrent.length,
        lost_description_recoverable: recoverableDesc,
        lost_images_recoverable: recoverableImg,
        still_have_description: sameDesc,
        examples,
      };
    }

    // Cross-reference the CSV tokens the caller sends.
    let csv: any = null;
    if (payload.csv_tokens?.length) {
      const tokens: string[] = payload.csv_tokens;
      const present = tokens.filter((t) => byIdList.has(t) || byIdSearch.has(t));
      const get = (t: string) => byIdList.get(t) ?? byIdSearch.get(t);
      csv = {
        csv_rows: tokens.length,
        found_in_catalog: present.length,
        missing_from_catalog: tokens.length - present.length,
        product_type_EVENT: present.filter((t) => get(t)?.item_data?.product_type === "EVENT").length,
        already_has_event_block: present.filter((t) => get(t)?.item_data?.event).length,
        product_type_spread: present.reduce((acc: Record<string, number>, t) => {
          const k = get(t)?.item_data?.product_type ?? "(unset)";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
        // CatalogList and CatalogSearch both omit ARCHIVED items, and these
        // listings are past events that have been archived. Absence from the
        // walk therefore proves nothing. RetrieveCatalogObject fetches by id
        // regardless of archived state, so ask it directly -- this is the only
        // reliable read of whether a CSV token is a real catalog item and what
        // it currently holds.
        retrieved: await (async () => {
          const out: any[] = [];
          for (const t of tokens.slice(0, payload.retrieve_limit ?? 25)) {
            try {
              const r = await sq(config, `/catalog/object/${t}?include_related_objects=false`, { version: CURRENT_VERSION });
              const obj = r.object;

              // Square's Item Library CSV export emits one row per VARIATION,
              // and its "Token" column is the variation id -- not the item id.
              // The event block lives on the parent ITEM, so follow the link.
              let item = obj;
              let via = "direct";
              if (obj?.type === "ITEM_VARIATION") {
                const parentId = obj.item_variation_data?.item_id;
                if (parentId) {
                  const p = await sq(config, `/catalog/object/${parentId}?include_related_objects=false`, { version: CURRENT_VERSION });
                  item = p.object;
                  via = "via_variation";
                }
              }

              const it = item?.item_data ?? {};
              out.push({
                id: t,
                found: !!obj,
                object_type: obj?.type ?? null,
                resolved_via: via,
                item_id: item?.id ?? null,
                name: it.name ?? null,
                product_type: it.product_type ?? null,
                is_archived: it.is_archived ?? null,
                is_deleted: item?.is_deleted ?? null,
                has_event_block: !!it.event,
                event: it.event ?? null,
              });
            } catch (e: any) {
              out.push({ id: t, found: false, error: e.message ?? String(e) });
            }
          }
          return out;
        })(),
        // The rows Phase 1 could never serve: not EVENT items, and product_type
        // cannot be changed after creation.
        not_event_type: present
          .filter((t) => get(t)?.item_data?.product_type !== "EVENT")
          .map((t) => ({ id: t, name: get(t)?.item_data?.name, product_type: get(t)?.item_data?.product_type }))
          .slice(0, 40),
      };
    }

    return json({
      ok: true,
      environment: config.environment,
      pinned_version: SQUARE_API_VERSION,
      current_version: CURRENT_VERSION,
      counts: {
        list_pinned: listPinned.length,
        list_current: listCurrent.length,
        search_current: searchCurrent.length,
        with_event_list_pinned: withEventPinned.length,
        with_event_list_current: withEvent.length,
        with_event_search_current: withEventSearch.length,
      },
      by_product_type: byProductType,
      event_keys: [...eventKeys].sort(),
      samples,
      all_blocks: allBlocks,
      address_ids: addressIds,
      location_names: locationNames,
      address_probe: addressProbe,
      round_trip: roundTrip,
      would_drop_count: wouldDrop.length,
      verdict: wouldDrop.length
        ? "STOP — RetrieveCatalogObject does not return the event block for some items. Read-modify-write would WIPE venue/date."
        : "Round-trip safe on the retrieve axis (still requires a verified single-item write test).",
      wipe,
      recovery,
      dumps,
      csv,
    });
  } catch (e: any) {
    console.error("square-event-probe", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
