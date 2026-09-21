// TEMPORARY, SANDBOX-ONLY. Measures how Square rounds discounts and tax.
//
// Uses POST /v2/orders/calculate, which prices an order and persists nothing —
// no order, no catalog object, nothing to clean up. The caller sends the order
// bodies; this only injects the location and summarises what came back, so new
// questions need no redeploy.
//
// Gated on a service-role key rather than an admin session: it is invoked
// from a terminal, and that key is the one credential a terminal session has.
// The bearer is proven by use (an auth-admin call only a service key can make),
// not by comparing strings: the project has both legacy and new-format keys, and
// the one in this function's env is not necessarily the one the CLI hands out.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { loadSquareConfig, SQUARE_API_VERSION, squareFetch } from "../_shared/square.ts";

declare const Deno: any;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const bearer = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!bearer) return json({ error: "Service role only" }, 403);
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, bearer);
  const { error: proofErr } = await asCaller.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (proofErr) return json({ error: "Service role only" }, 403);

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;
  if (config.environment === "production") {
    return json({ error: "Sandbox only. Refusing to run against production." }, 400);
  }

  const body = await req.json().catch(() => ({}));
  // Read-only lookup: did a sandbox payment keep its Order, and what did Square
  // total it at? This is how a staging checkout is verified end to end.
  if (typeof body.lookup_payment === "string") {
    const p = await squareFetch(config, `/payments/${body.lookup_payment}`, { method: "GET" });
    const payment = p.data?.payment;
    const o = payment?.order_id
      ? (await squareFetch(config, `/orders/${payment.order_id}`, { method: "GET" })).data?.order
      : null;
    return json({
      payment: { status: payment?.status, amount: payment?.amount_money?.amount, order_id: payment?.order_id ?? null },
      order: o && {
        state: o.state, reference_id: o.reference_id, source: o.source?.name,
        total: o.total_money?.amount, tax: o.total_tax_money?.amount,
        lines: (o.line_items ?? []).map((li: any) => ({
          name: li.name, qty: li.quantity, catalog_object_id: li.catalog_object_id ?? null,
          base: li.base_price_money?.amount, tax: li.total_tax_money?.amount, total: li.total_money?.amount,
        })),
      },
    });
  }

  const cases: Array<{ label: string; order: Record<string, unknown> }> = body.cases ?? [];
  const results: unknown[] = [];

  for (const c of cases) {
    const r = await squareFetch(config, "/orders/calculate", {
      method: "POST",
      body: { order: { location_id: config.locationId, ...c.order } },
    });
    if (!r.ok) {
      results.push({ label: c.label, error: r.data?.errors ?? r.data });
      continue;
    }
    const o = r.data.order;
    results.push({
      label: c.label,
      total: o.total_money?.amount,
      tax_total: o.total_tax_money?.amount,
      discount_total: o.total_discount_money?.amount,
      lines: (o.line_items ?? []).map((li: any) => ({
        uid: li.uid,
        qty: li.quantity,
        base: li.base_price_money?.amount,
        gross: li.gross_sales_money?.amount,
        discount: li.total_discount_money?.amount,
        tax: li.total_tax_money?.amount,
        total: li.total_money?.amount,
        applied_discounts: (li.applied_discounts ?? []).map((d: any) => d.applied_money?.amount),
      })),
    });
  }

  return json({ environment: config.environment, api_version: SQUARE_API_VERSION, results });
});
