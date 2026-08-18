// Restore descriptions and images destroyed by the 2026-08-14 overwrite.
//
// See docs/square-catalog-history-recovery.md. Square keeps historical catalog
// versions and serves them from the ordinary read endpoints, so the "lost" data
// is readable at catalog_version=<epoch ms>. This copies it back.
//
// DRY RUN BY DEFAULT. A real write needs dry_run:false AND confirm:"RESTORE".
//
// Two rules this function exists to obey, both from the incident it repairs:
//
//   1. Never send the historical object back wholesale. It is a snapshot from
//      before every legitimate change since -- including the venue and event
//      dates written on 18 August. Doing that would "restore" the catalog by
//      destroying four days of work. Instead: take the CURRENT object, copy the
//      three lost fields onto it, and send that.
//   2. A 2xx is not evidence. Read back and compare.
//
// Scope is deliberately description + description_html + image_ids. Extra
// variations were also lost on 14 August, but variations carry prices and SKUs
// and are referenced by orders, so resurrecting them is a separate decision
// with a different risk profile. This does not touch them.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadSquareConfig,
  squareFetch,
  SQUARE_API_VERSION,
  type SquareConfig,
} from "../_shared/square.ts";

declare const Deno: any;

/** 2026-08-14 21:00 UTC — after the over-pull, before the 22:27 overwrite. */
const DEFAULT_VERSION = 1786741200000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function sq(
  config: SquareConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  const { ok, status, data } = await squareFetch(config, path, init);
  if (!ok) {
    throw new Error(
      `Square ${status} on ${init.method ?? "GET"} ${path}: ` +
      JSON.stringify(data?.errors ?? data)?.slice(0, 300),
    );
  }
  return data ?? {};
}

/** Dotted paths whose leaf differs. Arrays walked element-wise so that a
 *  variation's version bump does not masquerade as a change to the array. */
function diffPaths(a: any, b: any, prefix = "", out: string[] = []): string[] {
  const isObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
    }
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

const RESTORED_FIELDS = ["description", "description_html", "image_ids"];

/**
 * Fields Square changes by itself as a consequence of a legitimate write, and
 * which therefore say nothing about damage.
 *
 * `description_plaintext` is documented read-only — Square derives it from the
 * description. Verified on EMILY THE CRIMINAL: restoring the description
 * repopulated it to a matching 350 characters without us sending it.
 *
 * Square also normalises whitespace in `description`: a historical value with
 * three consecutive newlines came back with two, and every other character was
 * identical. That is cosmetic, not content loss, so a length that comes back a
 * few characters short of the historical one is expected and not a failure.
 */
const DERIVED_FIELDS = ["item_data.description_plaintext"];

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

const textLen = (o: any) =>
  ((o?.item_data?.description ?? "") || (o?.item_data?.description_html ?? "")).length;
const imgCount = (o: any) => (o?.item_data?.image_ids ?? []).length;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);
  const { data: userRes } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  const user = userRes?.user;
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  let payload: any = {};
  try { payload = await req.json(); } catch { /* none */ }
  const at = Number(payload.catalog_version ?? DEFAULT_VERSION);

  try {
    // --- PLAN ------------------------------------------------------------
    // Which items lost something that the historical catalog still holds?
    if (payload.plan) {
      const [now, past] = [await listAll(config), await listAll(config, at)];
      const pastById = new Map(past.map((o) => [o.id, o]));
      const plan: any[] = [];
      for (const cur of now) {
        const then = pastById.get(cur.id);
        if (!then) continue;
        const needDesc = textLen(then) > 0 && textLen(cur) === 0;
        const needImgs = imgCount(then) > 0 && imgCount(cur) === 0;
        if (needDesc || needImgs) {
          plan.push({
            id: cur.id,
            name: cur.item_data?.name,
            desc_chars: textLen(then),
            images: imgCount(then),
            needDesc, needImgs,
          });
        }
      }
      return json({
        ok: true, catalog_version: at,
        items_now: now.length, items_then: past.length,
        plan_count: plan.length,
        need_description: plan.filter((p) => p.needDesc).length,
        need_images: plan.filter((p) => p.needImgs).length,
        plan,
      });
    }

    // --- APPLY -----------------------------------------------------------
    const ids: string[] = Array.isArray(payload.ids) ? payload.ids : [];
    if (!ids.length) return json({ error: "ids required (or plan:true)" }, 400);
    const dryRun = payload.dry_run !== false;
    if (!dryRun && payload.confirm !== "RESTORE") {
      return json({ error: 'a real write requires confirm:"RESTORE"' }, 400);
    }
    const maxBatch = Number(payload.max_batch ?? 25);
    if (ids.length > maxBatch) {
      return json({ error: `refusing ${ids.length} ids; max_batch is ${maxBatch}` }, 400);
    }

    const results: any[] = [];
    for (const id of ids) {
      const rec: any = { id, name: null, action: null };
      try {
        const [curRes, oldRes] = [
          await sq(config, `/catalog/object/${id}?include_related_objects=false`),
          await sq(config, `/catalog/object/${id}?include_related_objects=false&catalog_version=${at}`),
        ];
        const current = curRes.object;
        const historical = oldRes.object;
        if (!current) throw new Error("item not found now");
        if (!historical) throw new Error("item not found at that catalog version");
        rec.name = current.item_data?.name ?? null;

        // Start from the CURRENT object. Never the historical one.
        const outgoing = JSON.parse(JSON.stringify(current));
        outgoing.item_data ??= {};
        const applied: string[] = [];

        for (const f of RESTORED_FIELDS) {
          const had = historical.item_data?.[f];
          const has = outgoing.item_data?.[f];
          const emptyNow = f === "image_ids" ? !(has?.length) : !has;
          if (had && (f === "image_ids" ? had.length : true) && emptyNow) {
            outgoing.item_data[f] = had;
            applied.push(f);
          }
        }

        if (!applied.length) {
          rec.action = "nothing_to_restore";
          results.push(rec);
          continue;
        }
        rec.restoring = applied;
        rec.desc_chars = textLen(historical);
        rec.images = imgCount(historical);

        // Nothing outside the three fields may move.
        const changed = diffPaths(current, outgoing);
        const allowed = new Set(RESTORED_FIELDS.map((f) => `item_data.${f}`));
        const stray = changed.filter(
          (p) => ![...allowed].some((a) => p === a || p.startsWith(`${a}[`) || p.startsWith(`${a}.`)),
        );
        rec.changed_paths = changed;
        if (stray.length) {
          rec.action = "refused";
          rec.reason = `would also change: ${stray.join(", ")}`;
          results.push(rec);
          continue;
        }

        if (dryRun) { rec.action = "dry_run"; results.push(rec); continue; }

        await sq(config, "/catalog/object", {
          method: "POST",
          body: { idempotency_key: crypto.randomUUID(), object: outgoing },
        });

        // Read back — a 2xx proves nothing.
        const after = await sq(config, `/catalog/object/${id}?include_related_objects=false`);
        const got = after.object;
        const descOk = !applied.includes("description") || textLen(got) > 0;
        const imgOk = !applied.includes("image_ids") || imgCount(got) === imgCount(historical);
        rec.action = descOk && imgOk ? "restored" : "accepted_but_not_stored";
        rec.now_desc_chars = textLen(got);
        rec.now_images = imgCount(got);
        rec.collateral_changes = diffPaths(current, got)
          .filter((p) => ![...allowed].some((a) => p === a || p.startsWith(`${a}[`) || p.startsWith(`${a}.`)))
          .filter((p) => !DERIVED_FIELDS.includes(p))
          .filter((p) => { const l = p.split(".").pop(); return l !== "version" && l !== "updated_at"; });
        if (rec.action !== "restored") {
          rec.reason = "Square returned 2xx but did not store the fields";
        }
        results.push(rec);
      } catch (e: any) {
        rec.action = "error";
        rec.reason = e.message ?? String(e);
        results.push(rec);
      }
    }

    const tally: Record<string, number> = {};
    for (const r of results) tally[r.action ?? "?"] = (tally[r.action ?? "?"] ?? 0) + 1;
    return json({ ok: true, environment: config.environment, api_version: SQUARE_API_VERSION,
                  dry_run: dryRun, catalog_version: at, tally, results });
  } catch (e: any) {
    console.error("square-catalog-restore", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
