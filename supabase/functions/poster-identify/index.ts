// Identify film posters from images, and (optionally) re-attach them to the
// Square catalog items they belong to.
//
// Why this exists: the 2026-08-14 push cleared `item_data.image_ids` on 906
// catalog items, orphaning 1,040 image objects. The image FILES are intact —
// only the links were lost — but Square stores no back-reference from an image
// to its item, and the orphans carry no usable name or caption, so matching by
// metadata returned 0 of 1,040. The posters do, however, have their titles
// printed on them, and we know the candidate item names. So: read the title off
// the poster, then match against the known list.
//
// It is deliberately a separate function rather than another square-catalog-sync
// action. Identifying a film from its artwork is a general capability — it can
// populate `movies.poster_url`, check that uploaded artwork matches the listing,
// or label an archive — and none of that belongs in a concessions sync.
//
// Shape of the work, and why:
//
//   * Extract, then match. Asking the model "which of these 906 titles is this?"
//     means shipping the candidate list on every request; asking it to READ the
//     title is cheaper, and the match is then an ordinary string problem we can
//     tune, inspect, and re-run without paying for vision again.
//   * Several images per request. One call per image is 1,040 round trips; a
//     handful per call cuts that by the batch factor, and the model handles
//     multiple images in one message natively.
//   * Nothing is written to Square by `plan`. Proposals land in
//     square_poster_matches_20260815 for review, so a bad match is corrected
//     before it reaches a live catalog rather than after.
//   * `apply` is read-modify-write on the ITEM and APPENDS to image_ids — it
//     never replaces them, so an item that already has artwork keeps it. Image
//     objects are never written to at all: re-attachment changes the item's
//     reference, not the file, so existing links to the file elsewhere are
//     unaffected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json, preflight } from "../_shared/http.ts";
import {
  loadSquareConfig,
  squareErrorMessage,
  squareFetch,
  type SquareConfig,
} from "../_shared/square.ts";

/** Images per vision request. Trades round trips against per-call token size. */
const BATCH_IMAGES = 6;

/** Claude call, or throw with the API's own message. */
async function claude(apiKey: string, body: unknown): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Claude ${res.status}: ${data?.error?.message ?? text}`);
  }
  return data;
}

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

/** Every ITEM and IMAGE in the catalog. */
async function listCatalog(config: SquareConfig) {
  let cursor: string | undefined = undefined;
  const objects: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM,IMAGE" });
    if (cursor) q.set("cursor", cursor);
    const res = await square(config, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) objects.push(o);
    cursor = res.cursor;
  } while (cursor);
  return objects;
}

/** Comparison form: case, punctuation, and articles removed. */
function normalise(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Words that carry meaning, for the overlap fallback. */
function tokens(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for"].includes(w));
}

/**
 * Match an extracted title against the candidate item names.
 *
 * Exact-on-normalised first; a token-overlap pass second, which catches the
 * cases where a poster's wording and the catalog entry differ slightly
 * ("MET Live in HD: AIDA" vs "AIDA"). Anything matching more than one candidate
 * is reported as ambiguous rather than guessed at — a poster on the wrong item
 * is worse than one left detached.
 */
function matchTitle(
  title: string,
  candidates: { id: string; name: string }[],
): { kind: "unique" | "ambiguous" | "none"; hits: { id: string; name: string }[] } {
  const key = normalise(title);
  if (key) {
    const exact = candidates.filter((c) => normalise(c.name) === key);
    if (exact.length === 1) return { kind: "unique", hits: exact };
    if (exact.length > 1) return { kind: "ambiguous", hits: exact };
  }

  const want = tokens(title);
  if (want.length === 0) return { kind: "none", hits: [] };
  const scored = candidates
    .map((c) => {
      const have = new Set(tokens(c.name));
      const shared = want.filter((w) => have.has(w)).length;
      return { c, score: shared / want.length };
    })
    .filter((s) => s.score >= 0.8)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: "none", hits: [] };
  const best = scored[0].score;
  const top = scored.filter((s) => s.score === best).map((s) => s.c);
  return { kind: top.length === 1 ? "unique" : "ambiguous", hits: top };
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    posters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Position in the images sent, from 1" },
          title: {
            type: "string",
            description:
              "The film, event, or product title printed on the artwork, transcribed exactly. Empty string if none is legible.",
          },
          year: { type: "integer", description: "Release year if printed, else 0" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          kind: {
            type: "string",
            enum: ["film_poster", "event_poster", "merchandise", "other"],
          },
        },
        required: ["index", "title", "year", "confidence", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["posters"],
  additionalProperties: false,
};

const SYSTEM = `You read titles off artwork — film posters, event posters, and product images.

Transcribe the title exactly as printed, including subtitles and punctuation. Do not
translate it, expand abbreviations, correct spelling, or supply a title from your own
knowledge of the film: transcribe what is on the image. If several lines of text could
be the title, choose the most prominent.

If no title is legible, return an empty string with confidence "low" rather than
guessing. A wrong title is worse than a blank one — it would file a poster against the
wrong catalog entry.

Set confidence "high" only when the title text is clearly legible.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({
      error:
        "ANTHROPIC_API_KEY is not configured. Set it with: " +
        "supabase secrets set ANTHROPIC_API_KEY=... --project-ref <ref>",
    }, 500);
  }
  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

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

  let payload: any = {};
  try { payload = await req.json(); } catch { /* GET-style ping */ }
  const action = payload.action ?? "plan";

  try {
    if (action === "plan") return json(await plan(config, admin, apiKey, payload));
    if (action === "review") return json(await review(admin, payload));
    if (action === "apply") return json(await apply(config, admin, payload));
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("poster-identify error", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});

// --- PLAN ----------------------------------------------------------------
// Reads titles off a batch of orphaned images, matches them to candidate items,
// and records the proposals. Writes nothing to Square.
async function plan(
  config: SquareConfig,
  admin: any,
  apiKey: string,
  payload: any,
) {
  const limit = Math.min(Number(payload?.limit ?? 24), 60);
  const model = String(payload?.model ?? "claude-opus-5");

  const objects = await listCatalog(config);
  const images = objects.filter((o) => o.type === "IMAGE");
  const items = objects.filter((o) => o.type === "ITEM");

  const referenced = new Set<string>();
  for (const it of items) for (const id of it.item_data?.image_ids ?? []) referenced.add(id);

  // Candidates: the items that lost their images. Names come from the live
  // catalog, so a renamed item still matches.
  const candidates = items.map((it) => ({ id: it.id, name: it.item_data?.name ?? "" }));

  // Skip anything already proposed, so repeated runs walk forward.
  const { data: done } = await admin
    .from("square_poster_matches_20260815")
    .select("image_id");
  const seen = new Set((done ?? []).map((r: any) => r.image_id));

  const pending = images
    .filter((im) => !referenced.has(im.id) && !seen.has(im.id))
    .filter((im) => im.image_data?.url)
    .slice(0, limit);

  if (pending.length === 0) {
    return {
      ok: true,
      done: true,
      note: "No orphaned images left to identify.",
      total_orphans: images.filter((im) => !referenced.has(im.id)).length,
      already_proposed: seen.size,
    };
  }

  const rows: any[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let i = 0; i < pending.length; i += BATCH_IMAGES) {
    const batch = pending.slice(i, i + BATCH_IMAGES);
    const content: any[] = [];
    batch.forEach((im, n) => {
      content.push({ type: "text", text: `Image ${n + 1}:` });
      content.push({ type: "image", source: { type: "url", url: im.image_data.url } });
    });
    content.push({
      type: "text",
      text:
        `Read the title off each of the ${batch.length} images above. ` +
        `Return one entry per image, indexed 1 to ${batch.length}.`,
    });

    const res = await claude(apiKey, {
      model,
      max_tokens: 4096,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
      messages: [{ role: "user", content }],
    });

    inputTokens += res?.usage?.input_tokens ?? 0;
    outputTokens += res?.usage?.output_tokens ?? 0;

    // A refusal returns 200 with stop_reason "refusal" and no usable content —
    // check before reading, or this throws on an index that isn't there.
    if (res?.stop_reason === "refusal") {
      throw new Error("Claude declined this batch; skip these images or split the batch.");
    }

    const block = (res?.content ?? []).find((b: any) => b.type === "text");
    let parsed: any = {};
    try { parsed = JSON.parse(block?.text ?? "{}"); } catch { parsed = {}; }

    for (const p of parsed.posters ?? []) {
      const im = batch[(p.index ?? 0) - 1];
      if (!im) continue;
      const title = String(p.title ?? "").trim();
      const m = title ? matchTitle(title, candidates) : { kind: "none" as const, hits: [] };
      rows.push({
        image_id: im.id,
        image_url: im.image_data?.url ?? null,
        extracted_title: title || null,
        extracted_year: Number(p.year) || null,
        model_confidence: p.confidence ?? null,
        matched_item_id: m.kind === "unique" ? m.hits[0].id : null,
        matched_item_name: m.kind === "unique" ? m.hits[0].name : null,
        match_kind: m.kind,
        candidates: m.hits.slice(0, 5),
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from("square_poster_matches_20260815")
      .upsert(rows, { onConflict: "image_id" });
    if (error) throw new Error(`Could not record proposals: ${error.message}`);
  }

  const kinds = { unique: 0, ambiguous: 0, none: 0 } as Record<string, number>;
  for (const r of rows) kinds[r.match_kind] = (kinds[r.match_kind] ?? 0) + 1;

  return {
    ok: true,
    done: false,
    identified: rows.length,
    by_match: kinds,
    remaining: images.filter((im) => !referenced.has(im.id)).length - seen.size - rows.length,
    // Surfaced so the run can be stopped on cost rather than discovered later.
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, model },
    sample: rows.slice(0, 8).map((r) => ({
      title: r.extracted_title,
      matched: r.matched_item_name,
      kind: r.match_kind,
      confidence: r.model_confidence,
    })),
  };
}

// --- REVIEW --------------------------------------------------------------
async function review(admin: any, payload: any) {
  const kind = payload?.match_kind ?? "unique";
  const { data, error } = await admin
    .from("square_poster_matches_20260815")
    .select("*")
    .eq("match_kind", kind)
    .order("extracted_title")
    .range(0, 199);
  if (error) throw new Error(error.message);

  const { data: counts } = await admin
    .from("square_poster_matches_20260815")
    .select("match_kind");
  const tally: Record<string, number> = {};
  for (const r of counts ?? []) tally[r.match_kind] = (tally[r.match_kind] ?? 0) + 1;

  return { ok: true, tally, rows: data ?? [] };
}

// --- APPLY ---------------------------------------------------------------
// Re-attaches approved matches. Read-modify-write, appending to image_ids, with
// the prior value recorded first so a mistake is reversible. The image objects
// are never written to.
async function apply(config: SquareConfig, admin: any, payload: any) {
  const dryRun = payload?.dry_run !== false;
  const limit = Math.min(Number(payload?.limit ?? 40), 100);

  let q = admin
    .from("square_poster_matches_20260815")
    .select("*")
    .eq("match_kind", "unique")
    .not("matched_item_id", "is", null);
  // Default to approved-only; an explicit flag allows a run over unreviewed
  // uniques, which is a choice someone should make deliberately.
  if (payload?.include_unreviewed !== true) q = q.eq("approved", true);
  const { data: matches, error } = await q.range(0, limit - 1);
  if (error) throw new Error(error.message);

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      would_attach: (matches ?? []).length,
      sample: (matches ?? []).slice(0, 10).map((m: any) => ({
        title: m.extracted_title,
        item: m.matched_item_name,
      })),
    };
  }

  let attached = 0;
  const failures: any[] = [];
  for (const m of matches ?? []) {
    try {
      const current = await square(
        config,
        `/catalog/object/${m.matched_item_id}?include_related_objects=false`,
      );
      const object = current.object;
      if (!object) continue;
      object.item_data ??= {};
      const before: string[] = object.item_data.image_ids ?? [];

      // Record the prior value before touching anything.
      await admin.from("square_item_images_20260815").upsert({
        square_catalog_id: object.id,
        name: object.item_data?.name ?? null,
        image_ids_before: before,
      }, { onConflict: "square_catalog_id" });

      if (before.includes(m.image_id)) { attached++; continue; }
      object.item_data.image_ids = [...before, m.image_id];

      const res = await square(config, "/catalog/object", {
        method: "POST",
        body: { idempotency_key: crypto.randomUUID(), object },
      });

      // Same rule the category repair had to learn: a 2xx is not evidence.
      const after: string[] = res?.catalog_object?.item_data?.image_ids ?? [];
      if (!after.includes(m.image_id)) {
        failures.push({
          image_id: m.image_id,
          name: m.matched_item_name,
          error: "Square accepted the write but the image is not attached",
        });
        continue;
      }

      await admin.from("square_item_images_20260815")
        .update({ image_ids_after: after, applied_at: new Date().toISOString() })
        .eq("square_catalog_id", object.id);
      attached++;
    } catch (e: any) {
      failures.push({ image_id: m.image_id, name: m.matched_item_name, error: e.message ?? String(e) });
    }
  }

  return {
    ok: true,
    dry_run: false,
    attached,
    attempted: (matches ?? []).length,
    failures: failures.slice(0, 20),
    failure_count: failures.length,
  };
}
