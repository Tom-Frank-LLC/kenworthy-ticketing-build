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
  const isSearch = path.startsWith("/catalog/search");
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
