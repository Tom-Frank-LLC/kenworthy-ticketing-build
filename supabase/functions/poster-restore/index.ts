// Give Square catalog items their poster artwork back, sourced by title.
//
// The 2026-08-14 push cleared image_ids on 906 items, orphaning 1,040 images.
// The obvious repair — identify each orphaned image and put it back — turned out
// to be the wrong problem. Square keeps no back-reference from an image to its
// item and the orphans carry no name, so identifying them needs a vision model
// and produces probabilistic answers.
//
// The theatre's own website already holds the answer. kenworthy.org runs Modern
// Events Calendar with a public REST API: 1,518 past events, each carrying its
// poster. That is title -> poster, free and deterministic, and the Square items
// know their titles — so the repair is a string join, not an image problem.
// Measured against the damaged items that could plausibly carry art: 158 of 355
// match a calendar event exactly (100% of NT Live, 93% of MET broadcasts).
//
// TMDB fills the gaps. The WordPress filenames are TMDB poster ids, so that is
// where the theatre's artwork came from originally; querying it by title covers
// repertory titles that predate the calendar.
//
// The orphaned images are deliberately left alone. Attaching a freshly sourced,
// known-correct poster is safer than guessing which orphan belonged where, and
// the orphans can be swept up later as cleanup.
//
// Order of preference, and why: an exact WordPress match is the theatre's own
// editorial choice of artwork for that showing, so it beats anything TMDB
// returns for the same title. TMDB is the fallback, never the default.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json, preflight } from "../_shared/http.ts";
import {
  loadSquareConfig,
  squareErrorMessage,
  squareFetch,
  type SquareConfig,
} from "../_shared/square.ts";

const WP_EVENTS = "https://www.kenworthy.org/wp-json/wp/v2/mec-events";
const TMDB_SEARCH = "https://api.themoviedb.org/3/search/movie";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w780";

/** Categories whose items could plausibly carry poster art. */
const POSTER_CATEGORIES = [
  "6 Film Tickets",
  "6 Rental Tickets",
  "6 Live Event Tickets",
  "6 METLive Tickets",
  "6 NT Live Tickets",
];

/**
 * Comparison form for titles.
 *
 * Strips the broadcast-series prefixes ("MET Live in HD:", "NT Live:") because
 * the calendar and the catalog disagree about whether to include them, and
 * leading articles, which they disagree about just as often.
 */
function titleKey(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&(amp|#0?38);/g, "&")
    .replace(/^(met live in hd|nt live|national theatre live)\s*[:~-]\s*/i, "")
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Decode the HTML entities the WordPress REST API returns in titles. */
function decodeEntities(s: string): string {
  return (s ?? "")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#8211;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

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
    _user_id: user.id, _role: "admin",
  });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* GET-style ping */ }
  const action = payload.action ?? "plan";

  try {
    if (action === "index_wordpress") return json(await indexWordPress(admin));
    if (action === "index_orphans") return json(await indexOrphans(config, admin));
    if (action === "attach_orphans") return json(await attachOrphans(config, admin, payload));
    if (action === "plan") return json(await plan(config, admin, payload));
    if (action === "review") return json(await review(admin, payload));
    if (action === "apply") return json(await apply(config, admin, payload));
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("poster-restore error", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});

// --- INDEX ---------------------------------------------------------------
// Scrape the calendar once. The poster lives in the event's rendered content
// rather than featured_media (MEC does not set a featured image), so it is
// pulled out of the HTML — largest rendition available, since Square will
// downscale but cannot upscale.
async function indexWordPress(admin: any) {
  let page = 1;
  let fetched = 0;
  const rows: any[] = [];

  while (page <= 25) {
    const url = `${WP_EVENTS}?per_page=100&page=${page}&_fields=id,title,content,date`;
    const res = await fetch(url, { headers: { "user-agent": "kenworthy-poster-restore" } });
    if (!res.ok) break; // WordPress answers 400 past the last page
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const e of batch) {
      const title = decodeEntities(e?.title?.rendered ?? "");
      if (!title) continue;
      const html: string = e?.content?.rendered ?? "";
      const urls = [...html.matchAll(
        /https:\/\/www\.kenworthy\.org\/wp-content\/uploads\/[^"'\s)]+?\.(?:jpg|jpeg|png|webp)/gi,
      )].map((m) => m[0]);

      // Prefer the largest rendition; WordPress suffixes them -WxH.
      const best = urls
        .map((u) => {
          const m = u.match(/-(\d+)x(\d+)\.(?:jpg|jpeg|png|webp)$/i);
          return { u, area: m ? Number(m[1]) * Number(m[2]) : Number.MAX_SAFE_INTEGER };
        })
        .sort((a, b) => b.area - a.area)[0]?.u ?? null;

      rows.push({
        event_id: e.id,
        title,
        title_key: titleKey(title),
        poster_url: best,
        event_date: (e?.date ?? "").slice(0, 10) || null,
      });
      fetched++;
    }
    page++;
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("poster_source_wordpress")
      .upsert(rows.slice(i, i + 500), { onConflict: "event_id" });
    if (error) throw new Error(`Index write failed: ${error.message}`);
  }

  return {
    ok: true,
    events_indexed: fetched,
    with_poster: rows.filter((r) => r.poster_url).length,
    distinct_titles: new Set(rows.map((r) => r.title_key)).size,
  };
}

// --- INDEX ORPHANS -------------------------------------------------------
// Record every detached image with the filename Square kept for it.
//
// An earlier pass reported that none of the 1,040 orphans could be matched by
// name, which read as "they have no names". They do — 954 of them — and the
// zero was a matching bug: names like "memoria square.png" survive extension
// stripping but not the trailing " square", so nothing ever compared equal.
// Indexing them here separates collecting the data from matching against it,
// so the matcher can be re-run and tuned without re-listing the catalog.
async function indexOrphans(config: SquareConfig, admin: any) {
  let cursor: string | undefined = undefined;
  const objects: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM,IMAGE" });
    if (cursor) q.set("cursor", cursor);
    const res = await square(config, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) objects.push(o);
    cursor = res.cursor;
  } while (cursor);

  const referenced = new Set<string>();
  for (const o of objects) {
    if (o.type !== "ITEM") continue;
    for (const id of o.item_data?.image_ids ?? []) referenced.add(id);
  }

  const rows = objects
    .filter((o) => o.type === "IMAGE" && !referenced.has(o.id))
    .map((o) => ({
      image_id: o.id,
      image_name: o.image_data?.name ?? null,
      image_url: o.image_data?.url ?? null,
      name_key: filenameKey(o.image_data?.name ?? ""),
      updated_at: o.updated_at ?? null,
    }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("square_orphan_images")
      .upsert(rows.slice(i, i + 500), { onConflict: "image_id" });
    if (error) throw new Error(`Orphan index write failed: ${error.message}`);
  }

  return {
    ok: true,
    orphans_indexed: rows.length,
    with_name: rows.filter((r) => r.image_name).length,
    without_name: rows.filter((r) => !r.image_name).length,
    sample: rows.filter((r) => r.image_name).slice(0, 10)
      .map((r) => ({ name: r.image_name, key: r.name_key })),
  };
}

// --- ATTACH ORPHANS ------------------------------------------------------
// Re-attach an image the catalog already holds. No upload, so no duplicate and
// no new licensing question — this is the theatre's own artwork going back where
// it was. Appends to image_ids read-modify-write, records the prior value first,
// and confirms from the item's own record afterwards.
async function attachOrphans(config: SquareConfig, admin: any, payload: any) {
  const dryRun = payload?.dry_run !== false;
  const limit = Math.min(Number(payload?.limit ?? 40), 100);

  // Items that already carry artwork are excluded, or a paged run re-walks the
  // same head of the list every call: idempotent, but it reports work it did not
  // do and never reaches the tail.
  const { data: done, error: doneErr } = await admin
    .from("poster_restore_plan")
    .select("square_catalog_id")
    .not("attached_at", "is", null);
  if (doneErr) throw new Error(doneErr.message);
  const attachedItems = new Set((done ?? []).map((d: any) => d.square_catalog_id));

  const { data: all, error } = await admin
    .from("square_orphan_images")
    .select("image_id, image_name, matched_item_id, matched_item_name")
    .eq("match_kind", "unique")
    .not("matched_item_id", "is", null);
  if (error) throw new Error(error.message);

  const matches = (all ?? [])
    .filter((m: any) => !attachedItems.has(m.matched_item_id))
    .slice(0, limit);

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      would_attach: (matches ?? []).length,
      sample: (matches ?? []).slice(0, 10)
        .map((m: any) => ({ item: m.matched_item_name, image: m.image_name })),
    };
  }

  let attached = 0;
  const failures: any[] = [];
  for (const m of matches ?? []) {
    try {
      const current = await square(
        config, `/catalog/object/${m.matched_item_id}?include_related_objects=false`,
      );
      const object = current.object;
      if (!object) throw new Error("item no longer in the catalog");
      object.item_data ??= {};
      const before: string[] = object.item_data.image_ids ?? [];

      await admin.from("square_item_images_20260815").upsert({
        square_catalog_id: object.id,
        name: object.item_data?.name ?? null,
        image_ids_before: before,
      }, { onConflict: "square_catalog_id" });

      if (!before.includes(m.image_id)) {
        object.item_data.image_ids = [...before, m.image_id];
        const res = await square(config, "/catalog/object", {
          method: "POST",
          body: { idempotency_key: crypto.randomUUID(), object },
        });
        const after: string[] = res?.catalog_object?.item_data?.image_ids ?? [];
        if (!after.includes(m.image_id)) {
          throw new Error("Square accepted the write but the image is not attached");
        }
        await admin.from("square_item_images_20260815")
          .update({ image_ids_after: after, applied_at: new Date().toISOString() })
          .eq("square_catalog_id", object.id);
      }

      await admin.from("poster_restore_plan")
        .update({
          source: "square_orphan",
          confidence: "exact",
          source_ref: m.image_id,
          source_title: m.image_name,
          attached_image_id: m.image_id,
          attached_at: new Date().toISOString(),
          error: null,
        })
        .eq("square_catalog_id", m.matched_item_id);
      attached++;
    } catch (e: any) {
      failures.push({ item: m.matched_item_name, error: e.message ?? String(e) });
    }
  }

  const counts = new Map<string, number>();
  for (const f of failures) {
    const k = String(f.error).replace(/[A-Z0-9]{20,}/g, "<id>").slice(0, 160);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return {
    ok: true, dry_run: false, attached, attempted: (matches ?? []).length,
    error_summary: [...counts.entries()].map(([error, count]) => ({ error, count })),
    failures: failures.slice(0, 20), failure_count: failures.length,
  };
}

/**
 * Comparison form for an image FILENAME.
 *
 * Filenames carry production noise the catalog title never has: the extension,
 * a rendition suffix ("-scaled", "-200x300"), an aspect note ("square", "vert"),
 * a destination note ("web", "thumbnail", "listing"), a copy counter ("-2"), and
 * the word "poster" itself. Stripping those is what turns "memoria square.png"
 * into something that can equal "MEMORIA".
 */
function filenameKey(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\.(jpe?g|png|gif|webp|heic|tiff?)$/i, "")
    .replace(/[-_]?\d+x\d+/g, " ")
    .replace(/\b(scaled|web|small|med|medium|large|hi ?res|high ?res|low ?res)\b/g, " ")
    .replace(/\b(square|vert|vertical|horiz|horizontal|portrait|landscape)\b/g, " ")
    .replace(/\b(poster|posters|artwork|art|key ?art|thumbnail|thumb|listing|image|flier|flyer|final|copy|edited|rgb|cmyk)\b/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

// --- PLAN ----------------------------------------------------------------
async function plan(config: SquareConfig, admin: any, payload: any) {
  const useTmdb = payload?.use_tmdb !== false;
  const tmdbKey = Deno.env.get("TMDB_API_KEY") ?? "";

  // Live catalog, so an item that already has artwork is skipped rather than
  // given a second poster.
  let cursor: string | undefined = undefined;
  const items: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM" });
    if (cursor) q.set("cursor", cursor);
    const res = await square(config, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) if (o.type === "ITEM") items.push(o);
    cursor = res.cursor;
  } while (cursor);
  const live = new Map(items.map((i) => [i.id, i]));

  const { data: snapshot, error: snapErr } = await admin
    .from("square_catalog_snapshot_20260814")
    .select("square_catalog_id, name, category, likely_overwritten")
    .in("category", POSTER_CATEGORIES)
    .eq("likely_overwritten", true);
  if (snapErr) throw new Error(snapErr.message);

  const { data: wp, error: wpErr } = await admin
    .from("poster_source_wordpress")
    .select("event_id, title, title_key, poster_url")
    .not("poster_url", "is", null);
  if (wpErr) throw new Error(wpErr.message);
  if (!wp || wp.length === 0) {
    throw new Error("The WordPress index is empty — run action \"index_wordpress\" first.");
  }
  const byKey = new Map<string, any[]>();
  for (const w of wp) {
    const list = byKey.get(w.title_key) ?? [];
    list.push(w);
    byKey.set(w.title_key, list);
  }

  const rows: any[] = [];
  let wpHits = 0, tmdbHits = 0, none = 0, alreadyHasArt = 0;

  for (const s of snapshot ?? []) {
    const item = live.get(s.square_catalog_id);
    if (!item) continue;
    if ((item.item_data?.image_ids ?? []).length > 0) { alreadyHasArt++; continue; }

    const key = titleKey(s.name);
    const hits = byKey.get(key) ?? [];
    if (hits.length > 0) {
      // Several showings of one film is normal; they share artwork, so the most
      // recent is as good as any.
      const pick = hits[hits.length - 1];
      rows.push({
        square_catalog_id: s.square_catalog_id,
        item_name: s.name,
        category: s.category,
        title_key: key,
        source: "wordpress",
        source_ref: String(pick.event_id),
        source_title: pick.title,
        poster_url: pick.poster_url,
        confidence: "exact",
      });
      wpHits++;
      continue;
    }

    if (useTmdb && tmdbKey) {
      const q = new URLSearchParams({ api_key: tmdbKey, query: s.name });
      const res = await fetch(`${TMDB_SEARCH}?${q}`);
      const data = res.ok ? await res.json() : null;
      const best = (data?.results ?? []).find((r: any) => r.poster_path);
      if (best) {
        // Only trust TMDB when its own title matches ours — a search always
        // returns something, and "closest result" is how you attach the wrong
        // poster to a film with a common word in its name.
        const agrees = titleKey(best.title ?? "") === key;
        rows.push({
          square_catalog_id: s.square_catalog_id,
          item_name: s.name,
          category: s.category,
          title_key: key,
          source: "tmdb",
          source_ref: String(best.id),
          source_title: best.title ?? null,
          poster_url: `${TMDB_IMAGE}${best.poster_path}`,
          confidence: agrees ? "exact" : "fuzzy",
        });
        tmdbHits++;
        continue;
      }
    }

    rows.push({
      square_catalog_id: s.square_catalog_id,
      item_name: s.name,
      category: s.category,
      title_key: key,
      source: "none",
      confidence: "none",
    });
    none++;
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("poster_restore_plan")
      .upsert(rows.slice(i, i + 500), { onConflict: "square_catalog_id" });
    if (error) throw new Error(`Plan write failed: ${error.message}`);
  }

  return {
    ok: true,
    considered: (snapshot ?? []).length,
    already_has_artwork: alreadyHasArt,
    from_wordpress: wpHits,
    from_tmdb: tmdbHits,
    no_source: none,
    tmdb_configured: Boolean(tmdbKey),
    note: tmdbKey
      ? undefined
      : "TMDB_API_KEY is not set — gaps were left unsourced rather than guessed.",
    sample: rows.filter((r) => r.source !== "none").slice(0, 10)
      .map((r) => ({ item: r.item_name, source: r.source, matched: r.source_title })),
  };
}

// --- REVIEW --------------------------------------------------------------
async function review(admin: any, payload: any) {
  const source = payload?.source ?? null;
  let q = admin.from("poster_restore_plan").select("*").order("item_name");
  if (source) q = q.eq("source", source);
  const { data, error } = await q.range(0, 299);
  if (error) throw new Error(error.message);

  const { data: all } = await admin.from("poster_restore_plan").select("source, confidence, attached_at");
  const tally: Record<string, number> = {};
  for (const r of all ?? []) {
    tally[`${r.source}/${r.confidence}`] = (tally[`${r.source}/${r.confidence}`] ?? 0) + 1;
  }
  return {
    ok: true,
    tally,
    attached: (all ?? []).filter((r: any) => r.attached_at).length,
    rows: data ?? [],
  };
}

// --- APPLY ---------------------------------------------------------------
// Uploads the sourced poster to Square and attaches it to the item in one call
// (CreateCatalogImage takes an object_id), then confirms the item really came
// back carrying the image. A 2xx is not evidence — that lesson cost this
// project four failed repair runs on the category restore.
async function apply(config: SquareConfig, admin: any, payload: any) {
  const dryRun = payload?.dry_run !== false;
  const limit = Math.min(Number(payload?.limit ?? 25), 60);

  let q = admin
    .from("poster_restore_plan")
    .select("*")
    .neq("source", "none")
    .is("attached_at", null);
  // Fuzzy matches are never applied without explicit approval: those are the
  // ones that put the wrong film's poster on a listing.
  if (payload?.include_fuzzy === true) {
    q = q.or("confidence.eq.exact,and(confidence.eq.fuzzy,approved.eq.true)");
  } else {
    q = q.eq("confidence", "exact");
  }
  if (payload?.only_source) q = q.eq("source", payload.only_source);

  const { data: plan, error } = await q.range(0, limit - 1);
  if (error) throw new Error(error.message);

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      would_attach: (plan ?? []).length,
      sample: (plan ?? []).slice(0, 10).map((p: any) => ({
        item: p.item_name, source: p.source, matched: p.source_title,
      })),
    };
  }

  let attached = 0;
  const failures: any[] = [];

  for (const p of plan ?? []) {
    try {
      const img = await fetch(p.poster_url);
      if (!img.ok) throw new Error(`Poster fetch failed: HTTP ${img.status}`);
      const bytes = new Uint8Array(await img.arrayBuffer());
      const mime = img.headers.get("content-type") ?? "image/jpeg";

      // CreateCatalogImage is multipart, not JSON, so it bypasses the shared
      // squareFetch helper.
      const form = new FormData();
      form.append("request", JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        object_id: p.square_catalog_id,   // attaches on create
        image: {
          type: "IMAGE",
          id: "#poster",
          image_data: { caption: p.item_name },
        },
      }));
      form.append("image_file", new Blob([bytes], { type: mime }), "poster.jpg");

      const res = await fetch(`${config.apiBase}/catalog/images`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Square-Version": "2024-01-18",
        },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(`Square ${res.status}: ${squareErrorMessage(data, "image upload failed")}`);
      }
      const imageId = data?.image?.id ?? null;

      // Confirm from the item's own record, not from the upload response.
      const back = await square(
        config, `/catalog/object/${p.square_catalog_id}?include_related_objects=false`,
      );
      const ids: string[] = back?.object?.item_data?.image_ids ?? [];
      if (!imageId || !ids.includes(imageId)) {
        throw new Error("Square accepted the upload but the item is not carrying it");
      }

      await admin.from("poster_restore_plan")
        .update({ attached_image_id: imageId, attached_at: new Date().toISOString(), error: null })
        .eq("square_catalog_id", p.square_catalog_id);
      attached++;
    } catch (e: any) {
      const message = e.message ?? String(e);
      failures.push({ item: p.item_name, error: message });
      await admin.from("poster_restore_plan")
        .update({ error: message })
        .eq("square_catalog_id", p.square_catalog_id);
    }
  }

  const counts = new Map<string, number>();
  for (const f of failures) {
    const k = String(f.error).replace(/[A-Z0-9]{20,}/g, "<id>").slice(0, 160);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return {
    ok: true,
    dry_run: false,
    attached,
    attempted: (plan ?? []).length,
    error_summary: [...counts.entries()].map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count),
    failures: failures.slice(0, 20),
    failure_count: failures.length,
  };
}
