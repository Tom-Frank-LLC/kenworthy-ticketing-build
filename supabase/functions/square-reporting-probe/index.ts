// TEMPORARY, READ-ONLY. Delete once the questions below are answered.
//
// `square-analytics` pages /v2/orders/search and stops at 40 pages (20,000
// orders). That cap is a deferred failure, not a fix: it is fine for 30 days
// and will silently become "the Overview is short" at some future range.
//
// Square shipped a Reporting API to open beta in April 2026 — a Cube-based
// aggregation endpoint that computes totals server-side, with no pagination at
// all. If it can group by reporting category, it replaces BOTH the paging loop
// AND the catalog batch-retrieve join that exists only to recover categories
// the order line items do not carry.
//
// The docs do not state ItemSales' dimensions. This asks the account:
//
//   1. Is the Reporting API reachable with the token we already hold, or does
//      it need an OAuth scope (REPORTING_READ) we do not have?
//   2. What cubes/views exist, and does one expose a CATEGORY dimension?
//   3. Are gross sales, net sales, quantity and refunds available as measures?
//
// Answering these from the docs would be inference. This measures it. That
// distinction is the whole of fault 3 in
// docs/INCIDENT-2026-08-14-square-catalog.md.
//
// Read-only: GET only, and the Reporting API has no write surface.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/http.ts";
import { loadSquareConfig } from "../_shared/square.ts";

declare const Deno: any;

// The Reporting API is NOT under /v2 — squareFetch's apiBase would produce
// .../v2/reporting/v1/meta and 404. Hence the explicit host here.
const REPORTING_HOST: Record<string, string> = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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

  const host = REPORTING_HOST[config.environment];
  const rfetch = (path: string, init: any = {}) =>
    fetch(`${host}/reporting/v1${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  // ---- load mode: run a real aggregate and compare it to what we shipped ----
  //
  // /reporting/v1/load is ASYNC. While the query is still computing it returns
  // HTTP 200 with a body of {"error":"Continue wait"} rather than results, so a
  // naive caller reads a 200, finds no data, and reports zero. Poll until it
  // resolves.
  let body: any = null;
  try { body = await req.json(); } catch { body = {}; }

  if (body?.load) {
    const query = body.query ?? {
      measures: ["ItemTransactions.sales_gross_amount", "ItemTransactions.items_sold_count"],
      dimensions: ["ItemTransactions.category_name"],
      timeDimensions: [{
        dimension: "ItemTransactions.local_date",
        dateRange: body.dateRange ?? ["2026-07-21", "2026-08-20"],
      }],
      order: { "ItemTransactions.sales_gross_amount": "desc" },
      limit: 100,
    };

    const started = Date.now();
    let attempts = 0;
    while (attempts < 30) {
      attempts++;
      const r = await rfetch("/load", { method: "POST", body: { query } });
      const txt = await r.text();
      let d: any = null;
      try { d = JSON.parse(txt); } catch { /* fall through */ }
      if (!r.ok) return json({ mode: "load", ok: false, status: r.status, body: txt.slice(0, 1200), attempts });
      if (d?.error === "Continue wait") { await new Promise((res) => setTimeout(res, 1000)); continue; }
      return json({
        mode: "load", ok: true, attempts, ms: Date.now() - started,
        environment: config.environment,
        query,
        rowCount: d?.data?.length ?? 0,
        data: d?.data ?? null,
        raw: d?.data ? undefined : String(txt).slice(0, 800),
      });
    }
    return json({ mode: "load", ok: false, reason: "still computing after 30 polls" });
  }

  const res = await fetch(`${REPORTING_HOST[config.environment]}/reporting/v1/meta`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* keep the raw text below */ }

  if (!res.ok || !data) {
    return json({
      reachable: false,
      environment: config.environment,
      status: res.status,
      body: text.slice(0, 1200),
    });
  }

  // Summarise rather than dump: the full schema is large, and the question is
  // narrow — which cube can group revenue by category.
  const cubes = (data.cubes ?? []).map((c: any) => ({
    name: c.name,
    measures: (c.measures ?? []).map((m: any) => m.name ?? m.shortTitle),
    dimensions: (c.dimensions ?? []).map((d: any) => d.name ?? d.shortTitle),
  }));

  const categoryish = cubes.flatMap((c: any) =>
    (c.dimensions ?? [])
      .filter((d: string) => /categ|item|variation|product/i.test(d ?? ""))
      .map((d: string) => `${c.name}.${d}`)
  );

  return json({
    reachable: true,
    environment: config.environment,
    status: res.status,
    cubeCount: cubes.length,
    cubeNames: cubes.map((c: any) => c.name),
    categoryLikeDimensions: categoryish,
    cubes,
  });
});
