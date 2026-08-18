// Notice when the Square catalog loses things, and put them back.
//
// Why this exists: Square's UpsertCatalogObject REPLACES the object it is given,
// and a dashboard Library CSV has no columns for per-showtime variations or the
// undocumented item_data.event block. So an export/edit/import round-trip strips
// both from every item it touches. On 2026-08-17, 770 of 838 EVENT items lost
// their event block that way; on 2026-08-14, 906 items were flattened by a
// different route with the same root cause.
//
// Nothing in this repo performs a CSV import — it is a human dashboard workflow,
// so it CANNOT be prevented here. What failed both times, and what this fixes,
// is that the damage was INVISIBLE: the Aug 14 overwrite was found only by
// noticing a timestamp pattern days later, and the Aug 17 bleed only because
// somebody ran a probe on a hunch. Neither was caught by a system.
//
//   snapshot  record what the catalog looks like now          (no Square writes)
//   check     walk it again and report what was LOST          (no Square writes)
//   repair    put back the lost blocks and variations, from
//             Square's own version history                    (gated, capped)
//
// `check` is the default action and is safe to run on a schedule.
//
// Repair reads the authentic prior object out of Square via
// `catalog_version=<epoch ms>` (docs/square-catalog-history-recovery.md) rather
// than rebuilding anything from our columns. Rebuilding from our columns is what
// destroyed 906 items; the baseline table records shape so we know WHAT went
// missing, never so we can reconstruct it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadSquareConfig,
  SQUARE_API_VERSION,
  squareErrorMessage,
  squareFetch,
  type SquareConfig,
} from "../_shared/square.ts";
import {
  compareToBaseline,
  diffPaths,
  isNoisyPath,
  summarizeItem,
  type Finding,
  type ItemSummary,
} from "../_shared/square-catalog.ts";

declare const Deno: any;

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
    const err: any = new Error(
      `Square ${status}: ${squareErrorMessage(data, `${init.method ?? "GET"} ${path} failed`)}`,
    );
    err.status = status;
    throw err;
  }
  return data ?? {};
}

/** Every ITEM in the catalog, following the cursor. Archived items included. */
async function listItems(config: SquareConfig, catalogVersion?: number) {
  let cursor: string | undefined = undefined;
  const items: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM" });
    if (catalogVersion) q.set("catalog_version", String(catalogVersion));
    if (cursor) q.set("cursor", cursor);
    const res: any = await sq(config, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) if (o.type === "ITEM") items.push(o);
    cursor = res.cursor;
  } while (cursor);
  return items;
}

async function allRows(query: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: any = {};
  try { payload = await req.json(); } catch { /* none */ }

  const action: string = payload.action ?? "check";
  if (!["snapshot", "check", "repair", "install_schedule", "ping"].includes(action)) {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  // Two kinds of caller.
  //
  //   a human admin  — any action, including repair;
  //   the scheduler  — presents the service role key, and may ONLY read.
  //
  // The scheduled job exists to notice damage, never to act on it unattended.
  // `repair` writes to the live catalog and every incident in this project's
  // history came from an unattended-looking write, so a machine caller is
  // refused it outright rather than merely discouraged.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);
  const bearer = authHeader.replace("Bearer ", "").trim();

  const isMachine = bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (isMachine) {
    if (action === "repair") {
      return json({
        error: "The scheduler may not repair. Run repair as an admin, having " +
               "read what the check found.",
      }, 403);
    }
  } else {
    const { data: userRes } = await admin.auth.getUser(bearer);
    const user = userRes?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Admin only" }, 403);
  }

  // The cheapest authenticated round trip there is. Exists so install_schedule
  // can prove a credential works AS A BEARER before storing it, rather than
  // storing it and finding out at 11:17 tomorrow. Touches nothing.
  if (action === "ping") {
    return json({ ok: true, caller: isMachine ? "machine" : "admin" });
  }

  // Turn the nightly schedule on without anybody handling a credential.
  //
  // The schedule needs the service role key stored in Vault so pg_net can
  // present it. Asking a person to paste it into the SQL editor went wrong twice
  // — the placeholder text was submitted verbatim both times — and it was a poor
  // design regardless: hand-transcribing a credential into a query.
  //
  // This function already holds the key and already talks to Postgres as
  // service_role, so it can hand the key over itself. Admin-gated, and refused
  // to machine callers so the scheduler cannot reconfigure its own schedule.
  if (action === "install_schedule") {
    if (isMachine) {
      return json({ error: "Only an admin can install the schedule." }, 403);
    }
    // Built from SUPABASE_URL, not from req.url.
    //
    // Deriving it from the incoming request looked more elegant and was wrong:
    // inside an edge function req.url's pathname is just "/square-catalog-guard"
    // with no "/functions/v1" prefix, so the self-probe hit
    // https://<ref>.supabase.co/square-catalog-guard and got a 404
    // "requested path is invalid". SUPABASE_URL is injected by the platform and
    // is the project's real base.
    //
    // Worth noting the probe caught this: without it the bad URL would have gone
    // into Vault and pg_net would have 404'd nightly into a table nobody reads.
    const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    if (!base) {
      return json({ error: "SUPABASE_URL is not set in this function's environment." }, 500);
    }
    const functionUrl = `${base}/functions/v1/square-catalog-guard`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!serviceKey) {
      return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set in this function's environment." }, 500);
    }

    // PROVE THE CREDENTIAL FIRST.
    //
    // Storing a key and trusting it is how this went wrong repeatedly: the value
    // was accepted, everything reported success, and the only evidence of
    // failure was a nightly 401 in net._http_response that nobody reads.
    //
    // The bearer has to clear two gates the function cannot inspect from here —
    // the platform's JWT gateway, and then this function's own machine check.
    // The only honest test is a real HTTP round trip against our own URL, which
    // is exactly what pg_net will do every morning. Anything less is a guess
    // about key formats, and the last such guess was wrong.
    let probe: { status: number; body: string };
    try {
      const r = await fetch(functionUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping" }),
      });
      probe = { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e: any) {
      return json({ error: `Could not reach ${functionUrl} to verify the key: ${e.message}` }, 502);
    }

    let probeOk = false;
    try { probeOk = probe.status === 200 && JSON.parse(probe.body)?.caller === "machine"; } catch { /* not json */ }

    if (!probeOk) {
      return json({
        error: "The service role key in this function's environment does not work " +
               "as a bearer against this function, so the schedule would 401 every " +
               "night. Nothing was stored.",
        probe,
        key_shape: `${serviceKey.length} chars, starts "${serviceKey.slice(0, 3)}"`,
        hint: probe.status === 401
          ? "The platform gateway rejected it before the function ran."
          : "It reached the function but was not recognised as the machine caller.",
      }, 502);
    }

    const { data, error } = await admin.rpc("configure_square_catalog_guard", {
      p_url: functionUrl,
      p_service_key: serviceKey,
    });
    if (error) {
      return json({ error: `Could not configure the schedule: ${error.message}` }, 500);
    }
    return json({
      ok: true,
      action,
      configured_url: functionUrl,
      result: data,
      verified: probe,
      note: "Schedule configured, and the key was proven to work as a bearer " +
            "before being stored. Nothing was pasted and no key left the platform. " +
            "Prove it end to end: run { action: 'check' } from the scheduler by " +
            "calling select public.run_square_catalog_guard_check(); and confirm a " +
            "new row appears in square_catalog_guard_runs.",
    });
  }

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  try {
    // ---- snapshot ---------------------------------------------------------
    if (action === "snapshot") {
      const items = await listItems(config);
      const rows = items.map((o) => {
        const s = summarizeItem(o);
        return { ...s, captured_at: new Date().toISOString(), last_ok_at: null };
      });

      // Upsert in pages — a single 1,000-item body is a timeout risk and a
      // partial failure is easier to reason about in chunks.
      let written = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await admin
          .from("square_catalog_baseline")
          .upsert(chunk, { onConflict: "square_item_id" });
        if (error) throw new Error(`baseline upsert failed: ${error.message}`);
        written += chunk.length;
      }

      const eventItems = rows.filter((r) => r.product_type === "EVENT").length;
      return json({
        ok: true, action, environment: config.environment,
        api_version: SQUARE_API_VERSION,
        items_seen: items.length, items_written: written,
        event_items: eventItems,
        with_event_block: rows.filter((r) => r.has_event_block).length,
        total_variations: rows.reduce((n, r) => n + r.variation_count, 0),
        note: "Baseline captured. Nothing was written to Square.",
      });
    }

    // ---- check / repair both need the comparison --------------------------
    const baseline = await allRows((f, t) =>
      admin.from("square_catalog_baseline").select("*").range(f, t)
    );
    if (!baseline.length) {
      return json({
        error: "No baseline to compare against. Run { action: 'snapshot' } first.",
      }, 400);
    }

    const items = await listItems(config);
    const liveById = new Map<string, ItemSummary>(
      items.map((o) => [o.id, summarizeItem(o)]),
    );

    const findings: Finding[] = [];
    for (const b of baseline) {
      const live = liveById.get(b.square_item_id) ?? null;
      findings.push(...compareToBaseline(b as any, live));
    }

    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;

    // Items that still match get their last_ok_at moved forward, so "when was
    // this last known good" is answerable without keeping every run's detail.
    const damaged = new Set(findings.map((f) => f.square_item_id));
    const okIds = baseline
      .map((b) => b.square_item_id)
      .filter((id) => !damaged.has(id) && liveById.has(id));

    if (action === "check") {
      const nowIso = new Date().toISOString();
      for (let i = 0; i < okIds.length; i += 500) {
        await admin
          .from("square_catalog_baseline")
          .update({ last_ok_at: nowIso })
          .in("square_item_id", okIds.slice(i, i + 500));
      }

      await admin.from("square_catalog_guard_runs").insert({
        items_seen: items.length,
        items_baselined: baseline.length,
        lost_event_block: counts.lost_event_block ?? 0,
        lost_variations: counts.lost_variations ?? 0,
        lost_category: counts.lost_category ?? 0,
        vanished: counts.vanished ?? 0,
        findings: findings.slice(0, 500),
        note: findings.length
          ? "Losses detected — see findings."
          : "Catalog matches baseline.",
      });

      return json({
        ok: true, action, environment: config.environment,
        api_version: SQUARE_API_VERSION,
        items_seen: items.length, items_baselined: baseline.length,
        healthy: okIds.length,
        counts,
        findings: findings.slice(0, 200),
        truncated: findings.length > 200 ? findings.length - 200 : 0,
        note: findings.length
          ? "Read-only. Nothing was written to Square. Repair with " +
            '{ action:"repair", dry_run:false, confirm:"REPAIR" }.'
          : "Read-only. Catalog matches baseline.",
      });
    }

    // ---- repair -----------------------------------------------------------
    const dryRun = payload.dry_run !== false;
    const maxBatch = Number(payload.max_batch ?? 5);
    if (!dryRun && payload.confirm !== "REPAIR") {
      return json({ error: 'a real write requires confirm:"REPAIR"' }, 400);
    }

    // Only losses that version history can actually put back.
    const repairable = findings.filter(
      (f) => f.kind === "lost_event_block" || f.kind === "lost_variations",
    );
    const only: Set<string> | null = Array.isArray(payload.only_ids)
      ? new Set(payload.only_ids.map(String))
      : null;
    const queue = (only ? repairable.filter((f) => only.has(f.square_item_id)) : repairable)
      .slice(0, dryRun ? 200 : maxBatch + 1);

    if (!dryRun && queue.length > maxBatch) {
      return json({
        ok: false, action, counts,
        error: `refusing ${repairable.length} repairs; max_batch is ${maxBatch}. ` +
               "Raise it deliberately, never by accident.",
      }, 400);
    }

    const results: any[] = [];
    for (const f of queue) {
      const rec: any = {
        id: f.square_item_id, name: f.name, kind: f.kind, action: null,
      };
      try {
        const at = new Date(f.known_good_at).getTime();
        const [curRes, oldRes] = [
          await sq(config, `/catalog/object/${f.square_item_id}?include_related_objects=false`),
          await sq(
            config,
            `/catalog/object/${f.square_item_id}?include_related_objects=false&catalog_version=${at}`,
          ),
        ];
        const current = curRes.object;
        const historical = oldRes.object;
        if (!current) throw new Error("item not found now");
        if (!historical) throw new Error(`item not found at catalog_version=${at}`);

        // Start from the CURRENT object, never the historical one. The
        // historical copy is a source of the missing FIELD, not of the object.
        const outgoing = JSON.parse(JSON.stringify(current));
        outgoing.item_data ??= {};
        const allowed: string[] = [];

        if (f.kind === "lost_event_block") {
          const block = historical.item_data?.event;
          if (!block) throw new Error("no event block at that catalog version either");
          if (outgoing.item_data.event) {
            rec.action = "nothing_to_restore";
            results.push(rec);
            continue;
          }
          outgoing.item_data.event = block;
          allowed.push("item_data.event");
          rec.restoring = { start_at: block.start_at ?? null, venue: block.event_location_name ?? null };
        } else {
          // Missing variations, taken back verbatim from the historical object.
          const liveIds = new Set(
            (outgoing.item_data.variations ?? []).map((v: any) => v.id),
          );
          const missing = (historical.item_data?.variations ?? [])
            .filter((v: any) => (f.lost_variation_ids ?? []).includes(v.id))
            .filter((v: any) => !liveIds.has(v.id));
          if (!missing.length) {
            rec.action = "nothing_to_restore";
            results.push(rec);
            continue;
          }
          outgoing.item_data.variations = [
            ...(outgoing.item_data.variations ?? []),
            // Square assigns ids on create and will not take a deleted id back,
            // so these return as NEW objects. Sales history is unaffected —
            // Square order lines carry name, variation_name and price on the
            // order itself, not by reference.
            ...missing.map((v: any) => ({
              ...v,
              id: `#restore-${v.id}`.slice(0, 40),
              item_variation_data: { ...v.item_variation_data, item_id: current.id },
            })),
          ];
          allowed.push("item_data.variations");
          rec.restoring = missing.map((v: any) => v.item_variation_data?.name ?? v.id);
        }

        // Nothing outside the field being restored may move.
        const changed = diffPaths(current, outgoing).filter((p) => !isNoisyPath(p));
        const stray = changed.filter(
          (p) => !allowed.some((a) => p === a || p.startsWith(`${a}[`) || p.startsWith(`${a}.`)),
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

        // A 2xx proves nothing. Ask Square what it now holds.
        const after = await sq(
          config, `/catalog/object/${f.square_item_id}?include_related_objects=false`,
        );
        const got = after.object;
        const ok = f.kind === "lost_event_block"
          ? !!got?.item_data?.event
          : (got?.item_data?.variations ?? []).length >
            (current.item_data?.variations ?? []).length;

        rec.action = ok ? "repaired" : "accepted_but_not_stored";
        if (!ok) {
          rec.reason = "Square returned 2xx but does not hold the restored field. " +
                       "Stop the run.";
        }
        rec.collateral_changes = diffPaths(current, got)
          .filter((p) => !isNoisyPath(p))
          .filter((p) => !allowed.some((a) => p === a || p.startsWith(`${a}[`) || p.startsWith(`${a}.`)));

        // Re-baseline the item we just fixed, so the next check sees it healthy
        // rather than reporting the same loss forever.
        if (ok) {
          const s = summarizeItem(got);
          await admin.from("square_catalog_baseline").upsert({
            ...s, captured_at: new Date().toISOString(), last_ok_at: new Date().toISOString(),
          }, { onConflict: "square_item_id" });
        }
        results.push(rec);
        if (!ok) break;
      } catch (e: any) {
        rec.action = "error";
        rec.reason = e.message ?? String(e);
        results.push(rec);
        // Square locks the catalog during an upsert and answers 429 while it is
        // held. Stop and resume rather than hammering it.
        if (e.status === 429) {
          rec.reason += " — catalog locked; stopping this batch, rerun to continue";
          break;
        }
      }
    }

    const tally: Record<string, number> = {};
    for (const r of results) tally[r.action ?? "?"] = (tally[r.action ?? "?"] ?? 0) + 1;

    return json({
      ok: true, action, environment: config.environment,
      dry_run: dryRun, counts, repairable: repairable.length,
      tally, results,
    });
  } catch (e: any) {
    return json({ error: e.message ?? String(e) }, 500);
  }
});
