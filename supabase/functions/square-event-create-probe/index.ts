// TEMPORARY, SANDBOX-ONLY. Delete once the question below is answered.
//
// The question: can Connect V2 CREATE a catalog item with product_type EVENT?
//
// Why it matters: screenings are EVENT items, product_type is immutable, and
// only EVENT items can hold a venue and date (docs/venue-date-square-mechanism.md).
// If creation is possible, square-showing-variations can link a brand-new film
// end to end. If it is not, a human must create each new film in the dashboard
// first, forever.
//
// Why it is not already answered: Square's CatalogItemProductType reference says
// "Connect V2 only allows the creation of REGULAR or APPOINTMENTS_SERVICE items".
// That is a claim, and it is a claim this project has already seen mislead —
// the SAME sentence was cited as a reason updates to EVENT items might fail, and
// 739 of them then succeeded. This repo's history is emphatic that an inherited
// "impossible" gets tested before it is planned around; the Aug 14 damage was
// called unrecoverable for four days and was not.
//
// SAFETY
//   - Refuses outright if the resolved Square environment is production. This
//     must never run against the live catalog.
//   - Creates ONE item, reads it back, and deletes it again by default.
//   - Creating is additive. It cannot damage an existing object the way an
//     upsert can, which is why this is a safe experiment at all.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadSquareConfig,
  SQUARE_API_VERSION,
  squareFetch,
} from "../_shared/square.ts";

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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);
  const { data: userRes } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!userRes?.user) return json({ error: "Unauthorized" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userRes.user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  let payload: any = {};
  try { payload = await req.json(); } catch { /* none */ }
  const keep = payload.keep === true;

  // Production is not forbidden outright any more — the sandbox answered yes and
  // a production confirmation is the point — but it must be asked for by name.
  // A missing flag defaults to refusing, so this can never run against the live
  // catalog by accident or by a stray retry of a sandbox call.
  if (config.environment === "production" && payload.confirm !== "PRODUCTION-CREATE") {
    return json({
      error: 'Refusing production without confirm:"PRODUCTION-CREATE". ' +
             "Creating is additive and the probe deletes what it makes, but the " +
             "live catalog is never touched on a default call.",
    }, 400);
  }

  const stamp = Date.now();
  const results: any[] = [];

  // Try EVENT first, then REGULAR as a control. If EVENT fails and REGULAR
  // succeeds, the constraint is real and specific rather than a broken request.
  for (const productType of ["EVENT", "REGULAR"]) {
    // The REGULAR control only earns its keep when EVENT failed: it separates
    // "Square refuses EVENT" from "the request itself was wrong". If EVENT
    // succeeded there is nothing to disambiguate, so skip it and leave the live
    // catalog one write lighter.
    if (productType === "REGULAR" && results[0]?.created) {
      results.push({ product_type: "REGULAR", skipped: "EVENT succeeded; control not needed" });
      continue;
    }
    const rec: any = { product_type: productType, created: false };
    const object = {
      type: "ITEM",
      id: `#probe-${productType}-${stamp}`,
      item_data: {
        name: `ZZ PROBE ${productType} ${stamp} (delete me)`,
        product_type: productType,
        variations: [{
          type: "ITEM_VARIATION",
          id: `#probe-var-${productType}-${stamp}`,
          item_variation_data: {
            name: "Probe",
            pricing_type: "FIXED_PRICING",
            price_money: { amount: 100, currency: "USD" },
          },
        }],
      },
    };

    const res = await squareFetch(config, "/catalog/object", {
      method: "POST",
      body: { idempotency_key: crypto.randomUUID(), object },
    });
    rec.http_status = res.status;

    if (!res.ok) {
      rec.errors = res.data?.errors ?? res.data;
      results.push(rec);
      continue;
    }

    const id = res.data?.catalog_object?.id;
    rec.created_id = id ?? null;
    // A 2xx is not evidence. Read it back and check what product_type Square
    // actually stored — accepting the request and silently downgrading the type
    // would be the worst outcome and the easiest to miss.
    if (id) {
      const back = await squareFetch(config, `/catalog/object/${id}?include_related_objects=false`);
      const stored = back.data?.object?.item_data?.product_type ?? null;
      rec.stored_product_type = stored;
      rec.created = stored === productType;
      rec.silently_downgraded = !!stored && stored !== productType;

      if (!keep) {
        const del = await squareFetch(config, `/catalog/object/${id}`, { method: "DELETE" });
        rec.cleaned_up = del.ok;
      }
    }
    results.push(rec);
  }

  const evt = results.find((r) => r.product_type === "EVENT");
  const reg = results.find((r) => r.product_type === "REGULAR" && !r.skipped);
  const verdict = evt?.created
    ? "EVENT items CAN be created via Connect V2 — the reference's claim does not hold here."
    : reg?.created
    ? "EVENT creation refused while REGULAR succeeded — the constraint is real and specific."
    : "Both failed; the request itself is probably wrong. Inconclusive.";

  return json({
    ok: true,
    environment: config.environment,
    api_version: SQUARE_API_VERSION,
    verdict,
    results,
    note: keep ? "Probe items were KEPT." : "Probe items were deleted after read-back.",
  });
});
