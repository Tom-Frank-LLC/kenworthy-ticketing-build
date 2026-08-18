// Phase 1 of the venue + event date/time restore. Writes item_data.event and
// nothing else.
//
// DRY RUN BY DEFAULT. A caller must pass dry_run:false AND confirm:"WRITE" to
// make Square change, and even then the batch is capped (default 1).
//
// Everything here exists because of docs/INCIDENT-2026-08-14-square-catalog.md:
// UpsertCatalogObject REPLACES the object it is given, so a payload built from
// our own columns is a deletion of every field we did not send. 906 live items
// lost their descriptions, images, categories and extra variations that way.
//
// The three defences, in order:
//
//   1. Read-modify-write. The object we send is the object Square just gave us,
//      with exactly one branch added. Never constructed.
//   2. A diff assertion BEFORE sending. Every key path that differs between the
//      retrieved object and the outgoing one is computed; if any path outside
//      item_data.event has moved, the item is refused rather than sent.
//   3. A read-back AFTER sending. `square-catalog-sync/index.ts:1083` records
//      that at this API version item_data.categories is accepted and silently
//      ignored -- a 2xx proved nothing and a whole repair run changed nothing.
//      item_data.event is undocumented, so it is a prime candidate for the same
//      behaviour. We re-retrieve and confirm Square actually stored it, and
//      that nothing else moved.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadSquareConfig,
  squareFetch,
  SQUARE_API_VERSION,
  type SquareConfig,
} from "../_shared/square.ts";

declare const Deno: any;

/** The venue, as it already exists on the items restored by hand. */
const VENUE_NAME = "Kenworthy Performing Arts Centre";
const VENUE_TZ = "America/Los_Angeles";
const VENUE_TYPES = ["IN_PERSON"];
/** An existing ADDRESS catalog object holding 508 South Main Street. */
const DEFAULT_ADDRESS_ID = "Z7T5WCB5YKEAGJMDSPSYEL3T";

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
      JSON.stringify(data?.errors ?? data)?.slice(0, 400),
    );
  }
  return data ?? {};
}

/**
 * Every dotted path whose leaf value differs between two objects.
 *
 * Arrays are walked element by element rather than compared whole. Treating a
 * variations array as one opaque leaf reports the useless path
 * "item_data.variations" whenever any nested field moves -- including the
 * version bump every successful upsert causes -- which would either cry wolf on
 * every item or, if suppressed wholesale, hide a real change to a price.
 */
function diffPaths(a: any, b: any, prefix = "", out: string[] = []): string[] {
  const isObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${prefix}.length`);
      return out;
    }
    for (let i = 0; i < a.length; i++) diffPaths(a[i], b[i], `${prefix}[${i}]`, out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(prefix || "(root)");
  return out;
}

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

  // rows: [{ token (variation id), start_at, end_at? }]
  const rows: any[] = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return json({ error: "rows required" }, 400);

  const dryRun = payload.dry_run !== false;
  const maxBatch = Number(payload.max_batch ?? 1);
  if (!dryRun && payload.confirm !== "WRITE") {
    return json({ error: 'a real write requires confirm:"WRITE"' }, 400);
  }
  if (rows.length > maxBatch) {
    return json({
      error: `refusing ${rows.length} rows; max_batch is ${maxBatch}. ` +
             "Raise it deliberately, never by accident.",
    }, 400);
  }
  const addressId = payload.address_id ?? DEFAULT_ADDRESS_ID;

  const results: any[] = [];

  for (const row of rows) {
    const token = String(row.token ?? "").trim();
    const rec: any = { token, name: null, item_id: null, action: null };
    try {
      // Callers may address the ITEM directly (restores work from item ids) or
      // by the CSV's token, which is an ITEM_VARIATION id whose parent ITEM is
      // where the event block lives.
      let itemId = String(row.item_id ?? "").trim();
      if (!itemId) {
        const v = await sq(config, `/catalog/object/${token}?include_related_objects=false`);
        itemId = token;
        if (v.object?.type === "ITEM_VARIATION") {
          itemId = v.object.item_variation_data?.item_id;
          if (!itemId) throw new Error("variation has no parent item_id");
        }
      }
      rec.item_id = itemId;

      const before = await sq(config, `/catalog/object/${itemId}?include_related_objects=false`);
      const original = before.object;
      if (!original) throw new Error("item not found");
      rec.name = original.item_data?.name ?? null;
      rec.product_type = original.item_data?.product_type ?? null;
      rec.is_archived = original.item_data?.is_archived ?? null;
      rec.had_event_block = !!original.item_data?.event;

      // product_type is immutable, and only EVENT items can hold event data.
      if (rec.product_type !== "EVENT") {
        rec.action = "skipped";
        rec.reason = `product_type is ${rec.product_type}; only EVENT items can hold a venue or a date, and product_type cannot be changed after creation`;
        results.push(rec);
        continue;
      }

      // Deep copy so the retrieved object stays pristine for the diff.
      const outgoing = JSON.parse(JSON.stringify(original));
      outgoing.item_data ??= {};
      const existing = outgoing.item_data.event ?? {};

      // Two passes run over these items. The venue pass carries no start_at and
      // must not invent one -- 195 of the listings have no known date at all,
      // and 30 more have a date whose year we could not recover. Sending a
      // guessed timestamp to make the shape look complete would be worse than
      // leaving it empty. So a row without start_at sets the location fields
      // only and leaves any existing dates exactly as they are.
      // Restore mode: replace the block with an exact captured one. Needed
      // because the merge below can only add or change fields, never remove
      // them -- and undoing a bad write means putting back a block that had NO
      // end_at where we wrongly added one.
      if (row.event_override) {
        outgoing.item_data.event = row.event_override;
        rec.pass = "restore";
        const changedR = diffPaths(original, outgoing);
        const strayR = changedR.filter((p) => !p.startsWith("item_data.event"));
        rec.changed_paths = changedR;
        rec.event_before = original.item_data?.event ?? null;
        rec.event_after = outgoing.item_data.event;
        if (strayR.length) {
          rec.action = "refused";
          rec.reason = `would also change: ${strayR.join(", ")}`;
          results.push(rec);
          continue;
        }
        if (dryRun) { rec.action = "dry_run"; results.push(rec); continue; }
        await sq(config, "/catalog/object", {
          method: "POST",
          body: { idempotency_key: crypto.randomUUID(), object: outgoing },
        });
        const afterR = await sq(config, `/catalog/object/${itemId}?include_related_objects=false`);
        const storedR = afterR.object?.item_data?.event ?? null;
        const want = row.event_override;
        const okR = !!storedR &&
          storedR.start_at === want.start_at &&
          (storedR.end_at ?? null) === (want.end_at ?? null) &&
          storedR.event_location_name === want.event_location_name;
        rec.action = okR ? "restored" : "accepted_but_not_stored";
        rec.stored_event = storedR;
        rec.collateral_changes = diffPaths(original, afterR.object)
          .filter((p) => !p.startsWith("item_data.event"))
          .filter((p) => { const l = p.split(".").pop(); return l !== "version" && l !== "updated_at"; });
        results.push(rec);
        continue;
      }

      const settingDates = !!row.start_at;
      outgoing.item_data.event = {
        ...existing,                       // keep uid and anything undocumented
        ...(settingDates
          ? { start_at: row.start_at, ...(row.end_at ? { end_at: row.end_at } : {}) }
          : {}),
        event_location_name: VENUE_NAME,
        event_location_time_zone: existing.event_location_time_zone ?? VENUE_TZ,
        event_location_types: existing.event_location_types ?? VENUE_TYPES,
        address_id: existing.address_id ?? addressId,
        all_day_event: existing.all_day_event ?? false,
      };
      rec.pass = settingDates ? "venue+dates" : "venue only";

      // DEFENCE 2 — nothing outside item_data.event may move.
      const changed = diffPaths(original, outgoing);
      const stray = changed.filter((p) => !p.startsWith("item_data.event"));
      rec.changed_paths = changed;
      rec.event_before = original.item_data?.event ?? null;
      rec.event_after = outgoing.item_data.event;
      if (stray.length) {
        rec.action = "refused";
        rec.reason = `would also change: ${stray.join(", ")}`;
        results.push(rec);
        continue;
      }

      if (dryRun) {
        rec.action = "dry_run";
        results.push(rec);
        continue;
      }

      await sq(config, "/catalog/object", {
        method: "POST",
        body: { idempotency_key: crypto.randomUUID(), object: outgoing },
      });

      // DEFENCE 3 — a 2xx is not evidence. Ask Square what it actually holds.
      const after = await sq(config, `/catalog/object/${itemId}?include_related_objects=false`);
      const stored = after.object?.item_data?.event ?? null;
      const storedOk = !!stored &&
        stored.event_location_name === VENUE_NAME &&
        (!row.start_at || stored.start_at === row.start_at) &&
        (!row.end_at || stored.end_at === row.end_at) &&
        // A venue-only write must not have disturbed an existing date.
        (row.start_at || stored.start_at === (existing.start_at ?? undefined));

      // And confirm the write did not disturb anything else, comparing the
      // stored object against what we retrieved before the write.
      //
      // Upserting an item bumps the optimistic-concurrency version and the
      // timestamp on the item AND on each child variation, so those paths move
      // on every successful write and say nothing about damage. Verified on
      // THE GREEN KNIGHT against the 2026-08-17 catalog export: the variation's
      // id, name, and price were identical afterwards and only version and
      // updated_at had changed. Excluded by exact leaf name so that a real
      // change to a price or a name still reports.
      const noisy = (p: string) => {
        const leaf = p.split(".").pop();
        return leaf === "version" || leaf === "updated_at";
      };
      const post = diffPaths(original, after.object)
        .filter((p) => !p.startsWith("item_data.event") && !noisy(p));

      rec.action = storedOk ? "written" : "accepted_but_not_stored";
      rec.stored_event = stored;
      rec.collateral_changes = post;
      if (!storedOk) {
        rec.reason = "Square returned 2xx but the event block it holds does not " +
                     "match what was sent. Treat item_data.event as not writable " +
                     "and stop the run.";
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

  return json({
    ok: true,
    environment: config.environment,
    api_version: SQUARE_API_VERSION,
    dry_run: dryRun,
    tally,
    results,
  });
});
