import { createClient } from "npm:@supabase/supabase-js@2";
import { callerUser, isServiceRoleCaller } from "../_shared/callers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Records a purchase in the Mailchimp e-commerce store so their built-in
 * "product recommendations" and purchase-based automations can work.
 *
 * Body shape:
 *   {
 *     email: string,           // buyer
 *     first_name?: string,
 *     last_name?: string,
 *     order: {
 *       id: string,            // idempotency key e.g. "ticket:<uuid>"
 *       total: number,         // dollars
 *       lines: [{ id: string, product_id: string, product_title: string,
 *                 quantity: number, price: number, category?: string }]
 *     }
 *   }
 *
 * Products are upserted on demand from the line's product_id/title so the
 * caller doesn't have to pre-register them.
 *
 * ---------------------------------------------------------------------------
 * Who may call this
 * ---------------------------------------------------------------------------
 *
 * Until 2026-08-19 the answer was "anybody". This function checked its
 * Mailchimp configuration and then went straight to work, with no test of the
 * caller at all — and `verify_jwt = true` does not supply one, because the
 * gateway accepts the publishable anon key as a valid bearer. That key ships in
 * the client bundle and is committed to a public repository, so the endpoint
 * was reachable by anyone who read either.
 *
 * What that bought an attacker, once a store exists: arbitrary addresses
 * written into the Kenworthy audience as customers with opt_in_status true,
 * invented orders and revenue in the e-commerce reports the theatre reads, and
 * products carrying attacker-chosen titles that Mailchimp's own automations
 * then put in front of real subscribers. Mailchimp has no sandbox here —
 * staging and production share one API key and one audience — so every one of
 * those writes lands on the live list.
 *
 * It never fired, only because neither project has a bootstrapped store: the
 * `Store not bootstrapped` branch below returned first. That is a latch, not a
 * lock. Running mailchimp-bootstrap once — an ordinary admin action — would
 * have opened it silently.
 *
 * The legitimate callers are ticket-checkout and square-donation, both of which
 * POST here server-side with the service-role key. `recordMailchimpOrder` in
 * src/lib/mailchimp.ts is exported but called from nowhere; a browser is not an
 * expected caller and is no longer an accepted one. Admins are allowed too, so
 * a backfill from the Mailchimp tab does not need the secret key.
 */

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Authorise first, before configuration, before any read. An unauthorised
  // caller must not be able to use the shape of the refusal to learn whether
  // Mailchimp is wired up or whether a store exists.
  if (!isServiceRoleCaller(req)) {
    const caller = await callerUser(createClient, req);
    if (!caller) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Admin access required" }, 403);
  }

  const apiKey = Deno.env.get("MAILCHIMP_API_KEY");
  const server = Deno.env.get("MAILCHIMP_SERVER_PREFIX");
  const audienceId = Deno.env.get("MAILCHIMP_AUDIENCE_ID");
  if (!apiKey || !server || !audienceId) return json({ error: "Mailchimp not configured" }, 500);

  const { data: storeCfg } = await admin
    .from("app_config").select("value").eq("key", "mailchimp_store").maybeSingle();
  const storeId = storeCfg?.value?.id;
  if (!storeId) return json({ error: "Store not bootstrapped" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  const email = String(body?.email || "").toLowerCase().trim();
  const order = body?.order;
  if (!email || !order?.id || !Array.isArray(order?.lines) || order.lines.length === 0) {
    return json({ error: "Missing email/order" }, 400);
  }

  // Each line costs a Mailchimp GET and possibly a POST, sequentially. Without
  // a bound one request turns into arbitrarily many outbound calls against a
  // rate-limited third-party API on a shared key — a lever worth removing even
  // now that the caller has to be trusted to get this far. Four tickets is the
  // online maximum (MAX_TICKETS_PER_SHOWING) and a donation is one line; 50 is
  // far above anything the real callers send.
  if (order.lines.length > 50) {
    return json({ error: "Too many order lines" }, 400);
  }

  const base = `https://${server}.api.mailchimp.com/3.0`;
  const auth = "Basic " + btoa(`anystring:${apiKey}`);
  const mc = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: auth, "Content-Type": "application/json", ...(init?.headers || {}) },
    });

  // Ensure customer exists (upsert)
  const customerId = email; // deterministic
  await mc(`/ecommerce/stores/${storeId}/customers/${encodeURIComponent(customerId)}`, {
    method: "PUT",
    body: JSON.stringify({
      id: customerId,
      email_address: email,
      opt_in_status: true,
      first_name: body.first_name || undefined,
      last_name: body.last_name || undefined,
    }),
  }).catch(() => {});

  // Ensure each product exists
  for (const line of order.lines) {
    const pid = String(line.product_id);
    const pRes = await mc(`/ecommerce/stores/${storeId}/products/${encodeURIComponent(pid)}`);
    if (pRes.status === 404) {
      await mc(`/ecommerce/stores/${storeId}/products`, {
        method: "POST",
        body: JSON.stringify({
          id: pid,
          title: line.product_title || "Kenworthy item",
          type: line.category || "general",
          variants: [{ id: pid, title: line.product_title || pid, price: Number(line.price) || 0 }],
        }),
      }).catch(() => {});
    }
  }

  // Idempotent order create (409 on duplicate id is fine)
  const orderPayload = {
    id: String(order.id),
    customer: { id: customerId, email_address: email, opt_in_status: true },
    currency_code: "USD",
    order_total: Number(order.total) || 0,
    lines: order.lines.map((l: any, i: number) => ({
      id: String(l.id || `${order.id}-${i}`),
      product_id: String(l.product_id),
      product_variant_id: String(l.product_id),
      quantity: Number(l.quantity) || 1,
      price: Number(l.price) || 0,
    })),
    processed_at_foreign: new Date().toISOString(),
  };
  const orderRes = await mc(`/ecommerce/stores/${storeId}/orders`, {
    method: "POST",
    body: JSON.stringify(orderPayload),
  });
  if (!orderRes.ok && orderRes.status !== 409) {
    const detail = await orderRes.json().catch(() => ({}));
    console.error("[mailchimp-ecommerce] order failed", orderRes.status, detail);
    return json({ error: "Order create failed", detail }, 502);
  }

  return json({ ok: true });
});