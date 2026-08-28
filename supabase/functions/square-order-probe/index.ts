// TEMPORARY, SANDBOX-ONLY. Delete once the questions below are answered.
//
// Before any checkout writes an Order, three things have to be known rather than
// assumed, because getting them wrong misprices real tickets:
//
//   1. If a line item carries a catalog_object_id and that catalog item has
//      tax_ids, does Square apply that tax AUTOMATICALLY? If it does and we also
//      send our own tax, every ticket is taxed twice.
//   2. Does base_price_money override the catalog variation's own price?
//   3. How does Square round tax on a line with quantity > 1 — once on the line
//      total, or per unit? _shared/pricing.ts rounds tax PER TICKET ROW to match
//      the enforce_ticket_pricing trigger, and square-refund refunds
//      SUM(total_price). If Square rounds differently, the charge stops equalling
//      what our own rows say and a full refund no longer matches the charge.
//
// Nothing in the docs settles these for our pinned API version, and every wrong
// guess in this project has been a guess that looked reasonable. So: build a
// taxed item in the sandbox, create orders against it, and read the totals back.
//
// Refuses to run against production. Creates only in the sandbox catalog and
// deletes what it makes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { loadSquareConfig, SQUARE_API_VERSION, squareFetch } from "../_shared/square.ts";

declare const Deno: any;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

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

  // Hard gate. This creates catalog objects and orders; it must never touch the
  // live catalog or the real ledger.
  if (config.environment === "production") {
    return json({ error: "Sandbox only. Refusing to run against production." }, 400);
  }

  const stamp = Date.now();
  const created: string[] = [];
  const out: any = { environment: config.environment, api_version: SQUARE_API_VERSION, steps: [] };

  const sq = async (path: string, init: any = {}) => {
    const r = await squareFetch(config, path, init);
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(r.data?.errors ?? r.data).slice(0, 300)}`);
    return r.data;
  };

  try {
    // ---- a 6% tax and a taxed EVENT item with one $8.25 variation -----------
    // $8.25 on purpose: 825 * 0.06 = 49.5, the exact price where "round per
    // ticket" and "round per line" disagree. A whole-dollar price would hide the
    // difference and prove nothing.
    const taxRes = await sq("/catalog/object", {
      method: "POST",
      body: {
        idempotency_key: crypto.randomUUID(),
        object: {
          type: "TAX", id: `#probe-tax-${stamp}`,
          tax_data: {
            name: `ZZ PROBE TAX ${stamp}`, calculation_phase: "TAX_SUBTOTAL_PHASE",
            inclusion_type: "ADDITIVE", percentage: "6.0", applies_to_custom_amounts: true, enabled: true,
          },
        },
      },
    });
    const taxId = taxRes.catalog_object.id;
    created.push(taxId);

    const itemRes = await sq("/catalog/object", {
      method: "POST",
      body: {
        idempotency_key: crypto.randomUUID(),
        object: {
          type: "ITEM", id: `#probe-item-${stamp}`,
          item_data: {
            name: `ZZ PROBE TICKET ${stamp}`, product_type: "EVENT",
            tax_ids: [taxId], is_taxable: true,
            variations: [{
              type: "ITEM_VARIATION", id: `#probe-var-${stamp}`,
              item_variation_data: {
                name: "Adult - Probe", pricing_type: "FIXED_PRICING",
                price_money: { amount: 825, currency: "USD" },
              },
            }],
          },
        },
      },
    });
    const itemId = itemRes.catalog_object.id;
    const variationId = itemRes.catalog_object.item_data.variations[0].id;
    created.push(itemId);
    out.catalog = { itemId, variationId, taxId, catalog_price: 825, is_taxable: true };

    const order = async (label: string, lineItems: any[], taxes?: any[]) => {
      const res = await sq("/orders", {
        method: "POST",
        body: {
          idempotency_key: crypto.randomUUID(),
          order: {
            location_id: config.locationId, reference_id: `probe-${stamp}`,
            source: { name: "Kenworthy Website" },
            line_items: lineItems, ...(taxes ? { taxes } : {}),
          },
        },
      });
      const o = res.order;
      out.steps.push({
        label,
        total: o.total_money?.amount ?? null,
        tax_total: o.total_tax_money?.amount ?? null,
        discount_total: o.total_discount_money?.amount ?? null,
        line_items: (o.line_items ?? []).map((li: any) => ({
          name: li.name, quantity: li.quantity,
          base: li.base_price_money?.amount,
          gross: li.gross_sales_money?.amount,
          tax: li.total_tax_money?.amount,
          applied_taxes: (li.applied_taxes ?? []).length,
        })),
      });
      return o;
    };

    // Q1: catalog line, quantity 1, nothing about tax sent by us.
    await order("qty1 catalog-linked, no tax sent by us",
      [{ uid: "l1", catalog_object_id: variationId, quantity: "1" }]);

    // Q2: does base_price_money override the catalog price? (send 900, not 825)
    await order("qty1 catalog-linked with base_price_money override 900",
      [{ uid: "l1", catalog_object_id: variationId, quantity: "1",
         base_price_money: { amount: 900, currency: "USD" } }]);

    // Q3: quantity 2 — how is tax rounded? 1650 * 0.06 = 99 exactly, whereas
    // per-ticket rounding gives 2 * round(49.5) = 2 * 50 = 100.
    await order("qty2 catalog-linked (rounding test)",
      [{ uid: "l1", catalog_object_id: variationId, quantity: "2" }]);

    // Q4: two separate qty-1 lines for the same variation — does that reproduce
    // our per-ticket rounding exactly?
    await order("two qty1 lines, same variation (per-ticket rounding)",
      [{ uid: "l1", catalog_object_id: variationId, quantity: "1" },
       { uid: "l2", catalog_object_id: variationId, quantity: "1" }]);

    // Q5: ad-hoc line, no catalog link, our own explicit tax — the fallback path
    // and the shape square-invoice already uses.
    await order("ad-hoc line with our own ADDITIVE 6% tax",
      [{ uid: "l1", name: "Adult - Probe (ad hoc)", quantity: "1",
         base_price_money: { amount: 825, currency: "USD" },
         applied_taxes: [{ tax_uid: "our-tax" }] }],
      [{ uid: "our-tax", name: "Sales tax", percentage: "6", scope: "LINE_ITEM", type: "ADDITIVE" }]);

    // Q6: catalog line AND our own tax — the double-tax hazard, measured.
    await order("catalog-linked PLUS our own 6% tax (double-tax check)",
      [{ uid: "l1", catalog_object_id: variationId, quantity: "1",
         applied_taxes: [{ tax_uid: "our-tax" }] }],
      [{ uid: "our-tax", name: "Sales tax", percentage: "6", scope: "LINE_ITEM", type: "ADDITIVE" }]);

    out.ok = true;
  } catch (e: any) {
    out.ok = false;
    out.error = e.message ?? String(e);
  }

  // Orders cannot be deleted, but they are inert without a payment. The catalog
  // objects can and must go.
  for (const id of created.reverse()) {
    try { await squareFetch(config, `/catalog/object/${id}`, { method: "DELETE" }); } catch { /* best effort */ }
  }
  out.cleaned_up = created.length;
  out.note = "Catalog objects deleted. Orders remain but are unpaid and inert.";
  return json(out);
});
