// The admin Overview's numbers, read from Square.
//
// Replaces the Overview's old query against our own `tickets` and
// `concession_sales` tables, which returned ~zero for every card because the
// theatre's money is not in those tables — exactly one order has ever come
// through this build. See _shared/square-analytics.ts for the full reasoning
// and for which Square report each figure corresponds to.
//
// ---------------------------------------------------------------------------
// READ-ONLY. This is a hard guarantee, not an intention.
// ---------------------------------------------------------------------------
//
// On 14 Aug 2026 a Square push built from our own columns deleted every catalog
// field we did not send, wiping descriptions and images across the catalog. The
// damage was invisible in both UIs; timestamps were the only evidence
// (docs/INCIDENT-2026-08-14-square-catalog.md). A reporting endpoint has no
// business writing anything, so `readOnly()` below refuses any call that is not
// a GET or one of Square's two POST-shaped searches, and throws rather than
// falling through. Nothing here should ever need editing to allow a write; if a
// future change wants one, it belongs in a different function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/http.ts";
import { loadSquareConfig, squareFetch, type SquareConfig } from "../_shared/square.ts";
import {
  aggregate,
  type AnalyticsAggregate,
  buildCategoryLookup,
  categoryNames,
  resolveRange,
} from "../_shared/square-analytics.ts";

// Deno globals
declare const Deno: any;

/** Square's only two reads that are not GETs. Everything else must be a GET. */
const POST_SEARCHES = ["/orders/search", "/catalog/search", "/catalog/batch-retrieve"];

function readOnly(path: string, method: string) {
  const allowed = method === "GET" || (method === "POST" && POST_SEARCHES.some((p) => path.startsWith(p)));
  if (!allowed) {
    throw new Error(`square-analytics is read-only; refused ${method} ${path}`);
  }
}

async function sq(config: SquareConfig, path: string, init: { method?: string; body?: unknown } = {}) {
  const method = init.method ?? "GET";
  readOnly(path, method);
  const res = await squareFetch(config, path, { method, body: init.body });
  if (!res.ok) {
    const detail = res.data?.errors?.[0]?.detail ?? res.data?.errors?.[0]?.code ?? `HTTP ${res.status}`;
    throw new Error(`Square ${method} ${path}: ${detail}`);
  }
  return res.data;
}

// Paging caps. A 90-day range is a few thousand orders; the cap exists so a
// pathological range cannot run the function to its wall-clock limit. When it
// bites, `truncated` is set and the UI says so — a silently short total that
// looks authoritative is the failure mode worth avoiding.
const ORDER_PAGE_SIZE = 500;
const MAX_ORDER_PAGES = 40; // 20,000 orders
const MAX_REFUND_PAGES = 20;
const BATCH_RETRIEVE_CHUNK = 900; // Square's limit is 1,000 ids per call.

/**
 * Every COMPLETED order that closed inside the range.
 *
 * Filtering and sorting both use `closed_at`. Square requires the sort field to
 * match the field a `date_time_filter` filters on, and `closed_at` is the right
 * one regardless: it is when the sale completed, which is the instant Square's
 * own reports attribute the money to. `created_at` can be weeks earlier for an
 * invoice raised long before it was paid, which would file the revenue in the
 * wrong month.
 */
async function fetchOrders(config: SquareConfig, range: { start: string; end: string }) {
  const orders: any[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const data = await sq(config, "/orders/search", {
      method: "POST",
      body: {
        location_ids: [config.locationId],
        limit: ORDER_PAGE_SIZE,
        cursor,
        query: {
          filter: {
            // OPEN (674) and DRAFT (221) orders are carts and unsent invoices,
            // not money. CANCELED (75) never completed.
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: { closed_at: { start_at: range.start, end_at: range.end } },
          },
          sort: { sort_field: "CLOSED_AT", sort_order: "DESC" },
        },
      },
    });
    orders.push(...(data.orders ?? []));
    cursor = data.cursor;
    pages++;
  } while (cursor && pages < MAX_ORDER_PAGES);
  return { orders, truncated: Boolean(cursor) };
}

/** Refunds settled in the range. GET /refunds is ListPaymentRefunds. */
async function fetchRefunds(config: SquareConfig, range: { start: string; end: string }) {
  const refunds: any[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      begin_time: range.start,
      end_time: range.end,
      location_id: config.locationId,
      sort_order: "DESC",
    });
    if (cursor) params.set("cursor", cursor);
    const data = await sq(config, `/refunds?${params.toString()}`);
    refunds.push(...(data.refunds ?? []));
    cursor = data.cursor;
    pages++;
  } while (cursor && pages < MAX_REFUND_PAGES);
  return refunds;
}

/**
 * variation id -> reporting category, for exactly the variations sold in range.
 *
 * See buildCategoryLookup for why this addresses the catalog by id instead of
 * listing it: list and search both omit archived items, and historical sales
 * are full of archived screenings.
 */
async function fetchCategoryLookup(config: SquareConfig, orders: any[]) {
  const ids = new Set<string>();
  for (const o of orders) {
    for (const li of o.line_items ?? []) {
      if (li?.catalog_object_id) ids.add(li.catalog_object_id);
    }
  }

  const categoryPage = await sq(config, "/catalog/list?types=CATEGORY");
  const categories = categoryNames(categoryPage.objects ?? []);

  const variations: any[] = [];
  const items: any[] = [];
  const all = [...ids];
  for (let i = 0; i < all.length; i += BATCH_RETRIEVE_CHUNK) {
    const data = await sq(config, "/catalog/batch-retrieve", {
      method: "POST",
      body: { object_ids: all.slice(i, i + BATCH_RETRIEVE_CHUNK), include_related_objects: true },
    });
    variations.push(...(data.objects ?? []));
    items.push(...(data.related_objects ?? []));
  }

  return { lookup: buildCategoryLookup(variations, items, categories), distinctVariations: ids.size };
}

// A short in-isolate cache. Opening the tab, or nudging the range selector back
// and forth, should not re-scan thousands of orders and re-read the catalog
// each time. It is deliberately best-effort: Supabase may serve the next
// request from a cold isolate, in which case this is simply a miss and the data
// is rebuilt. `refresh: true` bypasses it.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: AnalyticsAggregate }>();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Admin-only. verify_jwt accepts the anon key, which is published in every
  // browser bundle and in this public repo, so it is not authentication — the
  // function has to gate itself. This endpoint returns the theatre's whole
  // revenue picture; staff who can scan a ticket should not see it.
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sign in required" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  const range = resolveRange(body?.range, new Date(), { start: body?.start, end: body?.end });
  const cacheKey = `${config.environment}:${config.locationId}:${range.start}:${range.end}`;

  if (!body?.refresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return json({ ...hit.value, cached: true, environment: config.environment });
    }
  }

  try {
    const { orders, truncated } = await fetchOrders(config, range);
    // The catalog lookup depends on which variations the orders reference, so
    // it cannot start until the orders are in; refunds are independent.
    const [{ lookup, distinctVariations }, refunds] = await Promise.all([
      fetchCategoryLookup(config, orders),
      fetchRefunds(config, range),
    ]);

    const result = aggregate({ orders, refunds, lookup, range, truncated });
    const payload = { ...result, meta: { ...result.meta, distinctVariations } };
    cache.set(cacheKey, { at: Date.now(), value: payload });
    return json({ ...payload, cached: false, environment: config.environment });
  } catch (e: any) {
    console.error("square-analytics failed", e?.message ?? e);
    return json({ error: e?.message ?? "Square read failed" }, 502);
  }
});
