import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";
import { loadSquareConfig, squareFetch, type SquareConfig } from "../_shared/square.ts";
import { buildTicketOrder, loadTicketGroups, orderRequestBody, processingFeeGroup } from "../_shared/square-order.ts";
import { canonicalTier, variationName } from "../_shared/square-catalog.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Same environment resolution as every other Square call: SQUARE_ENV picks
  // the credential set and the API host, so the terminal follows the site from
  // sandbox to live without a code change.
  const square = loadSquareConfig();
  if (!square.ok) {
    return new Response(
      JSON.stringify({ error: square.error }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Staff, not admin.
  //
  // This gate read `has_role(uid, 'admin')` and answered "Admin access
  // required" — which meant a staff-only account could pick "Card" at the till
  // and be refused by the card reader, on the one screen where the queue is
  // watching. Both actions here are counter work: create_checkout pushes an
  // amount to the terminal, get_checkout asks whether it was paid. Neither
  // configures anything.
  //
  // 'staff' is the right test rather than a wider one: has_role honours the
  // hierarchy, so admin and superadmin still satisfy it (see migration
  // 20260812063211_has_role_hierarchy.sql), and every sibling in the POS —
  // square-cash-sale, square-refund, square-donation, square-labor — already
  // gates exactly here.
  const { data: hasStaff } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "staff",
  });
  if (!hasStaff) {
    return new Response(JSON.stringify({ error: "Staff access required" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { action, ...params } = await req.json();

    if (action === "create_checkout") {
      return await createCheckout(square.config, params, corsHeaders);
    }

    if (action === "get_checkout") {
      return await getCheckout(square.config, params, corsHeaders);
    }
    if (action === "start_sale") {
      return await startSale(square.config, params, corsHeaders);
    }
    if (action === "confirm_sale") {
      return await confirmSale(square.config, params, corsHeaders);
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Square Terminal error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function createCheckout(
  config: SquareConfig,
  params: { amount_cents: number; note: string; idempotency_key: string; device_id?: string },
  headers: Record<string, string>
) {
  // In sandbox, we can't use real devices. The Terminal API sandbox simulates device behavior.
  // We create a Terminal Checkout that would normally be sent to a Square Terminal device.
  const body: Record<string, unknown> = {
    idempotency_key: params.idempotency_key,
    checkout: {
      amount_money: {
        amount: params.amount_cents,
        currency: "USD",
      },
      device_options: {
        device_id: params.device_id || "SIMULATED_SANDBOX_DEVICE",
        skip_receipt_screen: true,
        collect_signature: false,
        tip_settings: { allow_tipping: false },
      },
      reference_id: params.idempotency_key,
      note: params.note,
      payment_type: "CARD_PRESENT",
    },
  };

  const { ok, data } = await squareFetch(config, "/terminals/checkouts", {
    method: "POST",
    body,
  });

  if (!ok) {
    // In sandbox without a real device, Terminal API may return errors.
    // Fall back to a simulated/mock checkout for development.
    //
    // Production must never take this branch: a simulated checkout reports
    // COMPLETED without any money moving, which is exactly the failure mode
    // this whole change exists to remove. So it is refused outright when the
    // live credentials are in use — a card reader that cannot be reached is a
    // failed sale, not an approved one.
    console.warn("Square Terminal API returned error:", JSON.stringify(data));

    if (config.environment === "production") {
      return new Response(
        JSON.stringify({
          error:
            data?.errors?.[0]?.detail ||
            "The Square Terminal could not be reached. Check the reader and try again.",
        }),
        { status: 502, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        simulated: true,
        checkout: {
          id: `SIM_${params.idempotency_key}`,
          status: "COMPLETED",
          payment_type: "CARD_PRESENT",
          amount_money: { amount: params.amount_cents, currency: "USD" },
          note: params.note,
          created_at: new Date().toISOString(),
        },
        message: "Sandbox simulation — no real Square Terminal device connected. Payment auto-approved for testing.",
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ simulated: false, checkout: data.checkout }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
}

async function getCheckout(
  config: SquareConfig,
  params: { checkout_id: string },
  headers: Record<string, string>
) {
  if (params.checkout_id.startsWith("SIM_")) {
    return new Response(
      JSON.stringify({
        simulated: true,
        checkout: {
          id: params.checkout_id,
          status: "COMPLETED",
        },
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  const { ok, status, data } = await squareFetch(
    config,
    `/terminals/checkouts/${params.checkout_id}`,
  );

  if (!ok) {
    throw new Error(`Square API error [${status}]: ${JSON.stringify(data)}`);
  }

  // payment_ids is what makes a box-office card sale refundable: the POS stores
  // it on the ticket rows, and square-refund credits that payment.
  return new Response(
    JSON.stringify({
      simulated: false,
      checkout: data.checkout,
      payment_id: data.checkout?.payment_ids?.[0] ?? null,
    }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
}

// ---------------------------------------------------------------------------
// A card sale at the counter, the way an online sale works
// ---------------------------------------------------------------------------
//
// Rows first, pending. Then the reader. Then confirm. The browser sends an
// order_token and never an amount: what the terminal is asked for is read from
// the rows create_ticket_order wrote, and the rows are confirmed only after
// Square says the checkout completed for exactly that amount.
//
// This replaces charge-then-insert, where a refused row came after the money
// had moved, and a bare-amount checkout with no Square Order — so a counter
// card sale had no line items, no category, and no discount in Square's
// reporting. Now it registers an Order first, like ticket-checkout does, and
// the Terminal checkout carries its id. Sandbox measurement (22 Sep 2026):
// a checkout with order_id is accepted and returns it; whether the completed
// payment is applied to the order could not be observed in the sandbox (its
// test devices never complete on their own), so the confirm step trusts the
// checkout's own status and amount and treats the order as attribution.

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const jsonRes = (headers: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

/** The pending card rows of one order, and what they add up to. */
async function pendingRows(db: any, orderToken: string) {
  const { data, error } = await db
    .from("tickets")
    .select("id, showing_id, tier_id, price, list_price, discount_amount, discount_label, tax_amount, total_price, processing_fee, payment_method, status, square_payment_id")
    .eq("order_token", orderToken);
  if (error) throw new Error(`could not read the order: ${error.message}`);
  const rows = (data ?? []).filter((t: any) => t.payment_method === "card");
  const cents = rows.reduce((s: number, t: any) => s + Math.round(Number(t.total_price) * 100) + Math.round(Number(t.processing_fee ?? 0) * 100), 0);
  return { rows, cents };
}

async function startSale(
  config: SquareConfig,
  params: { order_token: string; donation_cents?: number; idempotency_key: string; device_id?: string },
  headers: Record<string, string>,
) {
  const db = admin();
  const orderToken = String(params.order_token ?? "").trim();
  if (!orderToken) return jsonRes(headers, { error: "order_token is required" }, 400);
  const donationCents = Math.max(0, Math.floor(Number(params.donation_cents ?? 0)) || 0);

  const { rows, cents } = await pendingRows(db, orderToken);
  if (rows.length === 0) return jsonRes(headers, { error: "No card sale is waiting under that order" }, 404);
  if (rows.some((t: any) => t.status !== "pending")) return jsonRes(headers, { error: "That order is not awaiting a card" }, 409);
  const chargeCents = cents + donationCents;
  if (chargeCents <= 0) return jsonRes(headers, { error: "Nothing to charge" }, 400);

  // The Square Order, best-effort: attribution is worth a lot, but not the sale.
  let squareOrderId: string | undefined;
  try {
    const { data: showing } = await db.from("showings").select("id, start_time").eq("id", rows[0].showing_id).maybeSingle();
    const groups = await loadTicketGroups(db, rows[0].showing_id,
      { tickets: rows, showing: { start_time: showing?.start_time ?? "" }, productionTitle: "" },
      { canonicalTier, variationName, timeZone: Deno.env.get("VENUE_TIME_ZONE") || undefined });
    const feeCents = rows.reduce((s: number, t: any) => s + Math.round(Number(t.processing_fee ?? 0) * 100), 0);
    if (feeCents > 0) groups.push(processingFeeGroup(feeCents));
    if (donationCents > 0) groups.push({ tierKey: "__donation", displayName: "Donation", variationId: null, unitPriceCents: donationCents, count: 1, taxable: false });
    const built = buildTicketOrder(groups);
    if (built.expectedTotalCents !== chargeCents) {
      console.error(`[square-terminal] order build ${built.expectedTotalCents} != charge ${chargeCents} for ${orderToken}; no Square Order`);
    } else {
      const created = await squareFetch(config, "/orders", {
        method: "POST",
        body: orderRequestBody({ locationId: config.locationId, referenceId: orderToken, built, idempotencyKey: `order-${params.idempotency_key}`, fulfillment: "NONE" }),
      });
      const total = created.data?.order?.total_money?.amount;
      if (created.ok && created.data?.order?.id && total === chargeCents) squareOrderId = created.data.order.id;
      else console.error("[square-terminal] Square order not usable", created.status, total, JSON.stringify(created.data?.errors ?? ""));
    }
  } catch (err) {
    console.error("[square-terminal] order build threw; checkout goes without one", err);
  }

  // The reader. A real one comes from SQUARE_TERMINAL_DEVICE_ID; the sandbox
  // name is only ever meaningful in the sandbox.
  const deviceId = params.device_id || Deno.env.get("SQUARE_TERMINAL_DEVICE_ID") || "SIMULATED_SANDBOX_DEVICE";
  const { ok, data } = await squareFetch(config, "/terminals/checkouts", {
    method: "POST",
    body: {
      idempotency_key: params.idempotency_key,
      checkout: {
        amount_money: { amount: chargeCents, currency: "USD" },
        ...(squareOrderId ? { order_id: squareOrderId } : {}),
        device_options: { device_id: deviceId, skip_receipt_screen: true, collect_signature: false, tip_settings: { allow_tipping: false } },
        reference_id: orderToken.slice(0, 40),
        note: `${rows.length} ticket(s)` + (donationCents > 0 ? ` + $${(donationCents / 100).toFixed(2)} donation` : ""),
        payment_type: "CARD_PRESENT",
      },
    },
  });

  if (!ok) {
    console.warn("[square-terminal] checkout refused:", JSON.stringify(data));
    if (config.environment === "production") {
      return jsonRes(headers, { error: data?.errors?.[0]?.detail || "The Square Terminal could not be reached. Check the reader and try again." }, 502);
    }
    // Sandbox with no reachable device: the same simulation the old path had,
    // so the flow can be walked on staging. Never in production.
    return jsonRes(headers, { simulated: true, checkout: { id: `SIM_${params.idempotency_key}`, status: "COMPLETED", amount_money: { amount: chargeCents, currency: "USD" } }, amount_cents: chargeCents, square_order_id: squareOrderId ?? null });
  }
  return jsonRes(headers, { simulated: false, checkout: data.checkout, amount_cents: chargeCents, square_order_id: squareOrderId ?? null });
}

async function confirmSale(
  config: SquareConfig,
  params: { order_token: string; checkout_id: string },
  headers: Record<string, string>,
) {
  const db = admin();
  const orderToken = String(params.order_token ?? "").trim();
  const checkoutId = String(params.checkout_id ?? "").trim();
  if (!orderToken || !checkoutId) return jsonRes(headers, { error: "order_token and checkout_id are required" }, 400);

  const { rows, cents } = await pendingRows(db, orderToken);
  if (rows.length === 0) return jsonRes(headers, { error: "No card sale under that order" }, 404);
  if (rows.every((t: any) => t.status === "confirmed")) {
    return jsonRes(headers, { already_confirmed: true, ticket_ids: rows.map((t: any) => t.id), payment_id: rows[0].square_payment_id ?? null });
  }

  let status: string; let paymentId: string | null = null; let paid: number | null = null;
  if (checkoutId.startsWith("SIM_")) {
    if (config.environment === "production") return jsonRes(headers, { error: "Simulated checkouts do not exist in production" }, 400);
    status = "COMPLETED"; paid = cents;
  } else {
    const r = await squareFetch(config, `/terminals/checkouts/${checkoutId}`);
    if (!r.ok) return jsonRes(headers, { error: "Could not read the checkout from Square" }, 502);
    status = r.data.checkout?.status;
    paymentId = r.data.checkout?.payment_ids?.[0] ?? null;
    paid = r.data.checkout?.amount_money?.amount ?? null;
  }

  if (status !== "COMPLETED") return jsonRes(headers, { status, confirmed: false });
  // The amount Square took must be the rows plus whatever gift rode along —
  // never less than the rows. More is a gift; less is a mis-sale.
  if (paid === null || paid < cents) {
    return jsonRes(headers, { error: `The reader took ${paid} but the order is ${cents}; not confirming. Contact support.`, status }, 409);
  }

  const ids = rows.map((t: any) => t.id);
  const { data: updated, error } = await db
    .from("tickets")
    .update({ status: "confirmed", square_payment_id: paymentId, payment_error: null })
    .in("id", ids)
    .select("id");
  if (error || !updated || updated.length !== ids.length) {
    console.error("[square-terminal] confirm failed after charge", error, { orderToken, checkoutId, paymentId });
    return jsonRes(headers, { error: "The card was charged but the tickets could not be confirmed. Do not charge again — contact support.", payment_id: paymentId }, 500);
  }
  return jsonRes(headers, { confirmed: true, ticket_ids: ids, payment_id: paymentId, amount_cents: cents });
}

