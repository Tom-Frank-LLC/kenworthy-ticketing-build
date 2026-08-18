// Restore the item variations flattened by the 2026-08-14 overwrite.
//
// DRY RUN BY DEFAULT. A real write needs dry_run:false AND confirm:"RESTORE".
//
// What the damage looks like, measured across all 270 affected items rather
// than assumed:
//
//   * `pushItem` rebuilt each item with ONE variation. In all 270 cases that
//     survivor kept the id of the FIRST historical variation and was RENAMED --
//     usually to "Regular". So the survivor is not a spare row to leave alone:
//     its name is part of the damage.
//   * Because the first variation survived, items with tiers kept the FIRST
//     price. Adult $20 / Student $15 became one "Regular" at $20 -- the cheaper
//     tier is missing, not mispriced.
//   * The other variations were hard-deleted. Retrieving one returns 404, and
//     Square assigns ids on create, so they come back as NEW objects. Sales
//     history is unaffected either way: Square order lines carry name,
//     variation_name and base_price_money on the order itself.
//
// So a restore is: rename the survivor back, and append the missing siblings.
//
// Two things it refuses to do:
//
//   1. Rename a survivor that is NOT currently called "Regular". Four items
//      have been edited since the damage and their current names are somebody's
//      deliberate work, not wreckage.
//   2. Touch anything outside item_data.variations. Asserted before the write
//      and re-checked after it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { loadSquareConfig, squareFetch, type SquareConfig } from "../_shared/square.ts";

declare const Deno: any;

// 2026-08-14 22:20 UTC. The over-pull at 19:41 only wrote to our database, so
// Square was untouched until the first destructive push at 22:27 -- this is the
// latest point that is still pre-damage, and so the most complete one.
const PRE_DAMAGE = 1786746000000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function sq(config: SquareConfig, path: string, init: { method?: string; body?: unknown } = {}) {
  const { ok, status, data } = await squareFetch(config, path, init);
  if (!ok) throw new Error(`Square ${status} on ${init.method ?? "GET"} ${path}: ${JSON.stringify(data?.errors ?? data)?.slice(0, 300)}`);
  return data ?? {};
}

function diffPaths(a: any, b: any, prefix = "", out: string[] = []): string[] {
  const isObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${prefix}.length`); return out; }
    for (let i = 0; i < a.length; i++) diffPaths(a[i], b[i], `${prefix}[${i}]`, out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(prefix || "(root)");
  return out;
}

const vdata = (v: any) => (v?.item_variation_data ?? {}) as any;
const key = (v: any) => `${vdata(v).name ?? ""}|${(vdata(v).price_money ?? {}).amount ?? "var"}`;

async function listAll(config: SquareConfig, catalogVersion?: number) {
  const objects: any[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ types: "ITEM" });
    if (catalogVersion) q.set("catalog_version", String(catalogVersion));
    if (cursor) q.set("cursor", cursor);
    const res = await sq(config, `/catalog/list?${q}`);
    objects.push(...(res.objects ?? []));
    cursor = res.cursor;
  } while (cursor);
  return objects;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);
  const { data: userRes } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!userRes?.user) return json({ error: "Unauthorized" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userRes.user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  let payload: any = {};
  try { payload = await req.json(); } catch { /* none */ }
  const at = Number(payload.catalog_version ?? PRE_DAMAGE);

  try {
    if (payload.plan) {
      const [now, past] = [await listAll(config), await listAll(config, at)];
      const pastById = new Map(past.map((o) => [o.id, o]));
      const plan: any[] = [];
      for (const c of now) {
        const p = pastById.get(c.id);
        if (!p) continue;
        const cv = c.item_data?.variations ?? [], pv = p.item_data?.variations ?? [];
        // Two distinct kinds of damage, and only the first changes the count.
        //
        //   fewer variations  -- siblings were deleted
        //   same count, but the survivor is called "Regular" -- an item that
        //     only ever had one variation still lost its NAME, and a
        //     count-based plan cannot see that at all. 417 items are in this
        //     state, found via the order history: tickets sold as
        //     "Wednesday, October 5 at 7 PM" that the catalog now calls
        //     "Regular".
        //
        // An empty historical name is left alone -- restoring "" is not a fix.
        const renameOnly = pv.length === cv.length && cv.length > 0 &&
          vdata(cv[0]).name === "Regular" &&
          !!vdata(pv[0]).name && vdata(pv[0]).name !== "Regular";
        if (pv.length <= cv.length && !renameOnly) continue;
        const have = new Set(cv.map((v: any) => v.id));
        const survivor = cv[0];
        plan.push({
          id: c.id, name: c.item_data?.name,
          archived: !!c.item_data?.is_archived,
          from: cv.length, to: pv.length,
          kind: pv.length > cv.length ? "missing variations" : "name only",
          missing: pv.filter((v: any) => !have.has(v.id)).length,
          survivor_name: vdata(survivor).name,
          survivor_should_be: vdata(pv[0]).name,
          survivor_renameable: vdata(survivor).name === "Regular",
        });
      }
      return json({ ok: true, catalog_version: at, plan_count: plan.length,
                    total_missing: plan.reduce((a, p) => a + p.missing, 0),
                    needs_review: plan.filter((p) => !p.survivor_renameable),
                    plan });
    }

    const ids: string[] = Array.isArray(payload.ids) ? payload.ids : [];
    if (!ids.length) return json({ error: "ids required (or plan:true)" }, 400);
    const dryRun = payload.dry_run !== false;
    if (!dryRun && payload.confirm !== "RESTORE") return json({ error: 'a real write requires confirm:"RESTORE"' }, 400);
    const maxBatch = Number(payload.max_batch ?? 10);
    if (ids.length > maxBatch) return json({ error: `refusing ${ids.length} ids; max_batch is ${maxBatch}` }, 400);

    const results: any[] = [];
    for (const id of ids) {
      const rec: any = { id, name: null, action: null };
      try {
        const cur = (await sq(config, `/catalog/object/${id}?include_related_objects=false`)).object;
        const old = (await sq(config, `/catalog/object/${id}?include_related_objects=false&catalog_version=${at}`)).object;
        if (!cur) throw new Error("item not found now");
        if (!old) throw new Error("item not found at that catalog version");
        rec.name = cur.item_data?.name ?? null;

        const outgoing = JSON.parse(JSON.stringify(cur));
        outgoing.item_data ??= {};
        const cv: any[] = outgoing.item_data.variations ?? [];
        const pv: any[] = old.item_data?.variations ?? [];
        const have = new Set(cv.map((v) => v.id));
        const haveKeys = new Set(cv.map(key));

        // 1. The survivor's name is part of the damage -- but only if it still
        //    reads "Regular". Anything else is somebody's later work.
        const survivor = cv[0];
        const histFirst = pv.find((v) => v.id === survivor?.id) ?? pv[0];
        rec.survivor_name_before = vdata(survivor).name;
        if (survivor && histFirst && vdata(survivor).name === "Regular" && vdata(histFirst).name) {
          survivor.item_variation_data.name = vdata(histFirst).name;
          rec.survivor_renamed_to = vdata(histFirst).name;
        } else if (survivor && vdata(survivor).name !== vdata(histFirst ?? {}).name) {
          rec.survivor_left_alone = vdata(survivor).name;
        }

        // 2. Append the siblings that were deleted. Matched by id AND by
        //    name+price, so a re-run cannot create duplicates.
        let n = 0;
        const added: any[] = [];
        for (const hv of pv) {
          if (have.has(hv.id) || haveKeys.has(key(hv))) continue;
          const d = { ...vdata(hv), item_id: id };
          if (d.pricing_type === "VARIABLE_PRICING") delete d.price_money;
          cv.push({
            type: "ITEM_VARIATION",
            id: `#restore-${n++}`,
            present_at_all_locations: hv.present_at_all_locations ?? true,
            item_variation_data: d,
          });
          added.push({ name: d.name, amount: (d.price_money ?? {}).amount ?? null, pricing: d.pricing_type });
        }
        outgoing.item_data.variations = cv;
        rec.added = added;

        if (!added.length && !rec.survivor_renamed_to) {
          rec.action = "nothing_to_restore";
          results.push(rec);
          continue;
        }

        const changed = diffPaths(cur, outgoing);
        const stray = changed.filter((p) => !p.startsWith("item_data.variations"));
        rec.changed_paths_outside_variations = stray;
        if (stray.length) { rec.action = "refused"; rec.reason = `would also change: ${stray.join(", ")}`; results.push(rec); continue; }
        if (dryRun) { rec.action = "dry_run"; results.push(rec); continue; }

        await sq(config, "/catalog/object", { method: "POST", body: { idempotency_key: crypto.randomUUID(), object: outgoing } });

        const after = (await sq(config, `/catalog/object/${id}?include_related_objects=false`)).object;
        const av: any[] = after?.item_data?.variations ?? [];
        const wantKeys = new Set(pv.map(key));
        const gotKeys = new Set(av.map(key));
        const missingAfter = [...wantKeys].filter((k) => !gotKeys.has(k));
        rec.variations_after = av.length;
        rec.still_missing = missingAfter;
        rec.action = missingAfter.length ? "accepted_but_not_stored" : "restored";
        rec.collateral_changes = diffPaths(cur, after)
          .filter((p) => !p.startsWith("item_data.variations"))
          .filter((p) => { const l = p.split(".").pop(); return l !== "version" && l !== "updated_at"; });
        results.push(rec);
      } catch (e: any) {
        rec.action = "error"; rec.reason = e.message ?? String(e); results.push(rec);
      }
    }
    const tally: Record<string, number> = {};
    for (const r of results) tally[r.action ?? "?"] = (tally[r.action ?? "?"] ?? 0) + 1;
    return json({ ok: true, dry_run: dryRun, catalog_version: at, tally, results });
  } catch (e: any) {
    console.error("square-variation-restore", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
