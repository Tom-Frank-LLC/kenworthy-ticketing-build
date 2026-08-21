// The admin Overview's numbers, from Square's Reporting API.
//
// Read-only and admin-gated. The reasoning, the measured schema, and the three
// traps in the Reporting API all live in _shared/square-reporting.ts.
//
// This replaced an implementation that paged /v2/orders/search and did the
// arithmetic here. It under-reported gross revenue by ~35%: Square counted
// 2,894 orders in the window where it counted 2,377. The fix was not to debug
// the sum but to stop doing the sum — Square's reporting engine is the same one
// behind the Dashboard, so the figures now agree with Square by construction
// rather than by reconciliation.
//
// READ-ONLY is structural, not merely intended: the Reporting API has no write
// surface at all, and this function makes no other Square call. After the
// 14 Aug catalog damage (docs/INCIDENT-2026-08-14-square-catalog.md) a
// reporting endpoint has no business holding a write path.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/http.ts";
import { loadSquareConfig } from "../_shared/square.ts";
import {
  type AnalyticsPayload,
  categoryByDayQuery,
  granularityFor,
  pollLoad,
  refundsQuery,
  resolveRange,
  shape,
  topPerformersQuery,
  uncategorizedQuery,
  totalsQuery,
} from "../_shared/square-reporting.ts";

declare const Deno: any;

const CATEGORY_ROW_LIMIT = 10000;

// A short in-isolate cache. Cubes refresh on a ~15 minute interval upstream, so
// serving a 10-minute-old aggregate costs no freshness that Square itself
// offers. Best-effort: a cold isolate is simply a miss. `refresh: true` skips it.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: AnalyticsPayload }>();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Admin-only. verify_jwt accepts the anon key, which ships in every browser
  // bundle and in this public repo, so it is not authentication — the function
  // gates itself. This returns the theatre's whole revenue picture.
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sign in required" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  // The Reporting API is production-only: connect.squareupsandbox.com has no
  // /reporting/v1 at all (404, measured 2026-08-20), so on staging every query
  // would fail and the tab would show a raw upstream error. Say what is
  // actually true instead. Staging's sandbox has no sales history to report on
  // either, so nothing is lost by this.
  if (config.environment !== "production") {
    return json({
      error: "Square's Reporting API is production-only — the sandbox host does not serve it. " +
        "The Overview has no figures to show on staging.",
      environment: config.environment,
    }, 501);
  }

  const range = resolveRange(body?.range, new Date(), { start: body?.start, end: body?.end });
  const granularity = granularityFor(range);
  const cacheKey = `${config.environment}:${range.start}:${range.end}`;

  if (!body?.refresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return json({ ...hit.value, cached: true, environment: config.environment });
    }
  }

  const run = (label: string, query: any) =>
    pollLoad({ environment: config.environment, accessToken: config.accessToken, query, label });

  try {
    // Five independent aggregates; Square computes each one server-side, so
    // there is no paging and nothing to stitch together here.
    const [totalsRows, categoryRows, topRows, uncategorizedRows, refundRows] = await Promise.all([
      run("totals", totalsQuery(range)),
      run("categories", categoryByDayQuery(range, granularity, CATEGORY_ROW_LIMIT)),
      run("topPerformers", topPerformersQuery(range)),
      run("uncategorized", uncategorizedQuery(range)),
      run("refunds", refundsQuery(range)),
    ]);

    const payload = shape({
      range, granularity,
      totalsRows, categoryRows, topRows, uncategorizedRows, refundRows,
      categoryRowLimit: CATEGORY_ROW_LIMIT,
    });

    cache.set(cacheKey, { at: Date.now(), value: payload });
    return json({ ...payload, cached: false, environment: config.environment });
  } catch (e: any) {
    console.error("square-analytics failed", e?.message ?? e);
    return json({ error: e?.message ?? "Square reporting read failed" }, 502);
  }
});
