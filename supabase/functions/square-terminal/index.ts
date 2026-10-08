import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { corsHeaders } from "../_shared/http.ts";
import { loadSquareConfig, squareFetch, type SquareConfig } from "../_shared/square.ts";
import { buildTicketOrder, loadTicketGroups, orderRequestBody, processingFeeGroup } from "../_shared/square-order.ts";
import { canonicalTier, variationName } from "../_shared/square-catalog.ts";
import { MAX_BUNDLED_DONATION_CENTS } from "../_shared/pricing.ts";
import { actorHeaders, logStaffAction } from "../_shared/audit.ts";
import { requireRole } from "../_shared/callers.ts";
import { checkoutMatchesOrder, logToken } from "./binding.ts";

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

  // Staff, not admin.
  //
  // This gate read `has_role(uid, 'admin')` and answered "Admin access
  // required" — which meant a staff-only account could pick "Card" at the till
  // and be refused by the card reader, on the one screen where the queue is
  // watching. Both actions here are counter work: create_checkout pushes an
  // amount to the terminal, get_checkout asks whether it was paid. Neither
  // configures anything.
  //
  // 'staff' is the right test rather than a wider one: the gate honours the
  // hierarchy, so admin and superadmin still satisfy it (see migration
  // 20260812063211_has_role_hierarchy.sql), and every sibling in the POS —
  // square-cash-sale, square-refund, square-donation, square-labor — already
  // gates exactly here.
  const gateClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = await requireRole(req, gateClient, "staff", {
    headers: corsHeaders,
    forbidden: "Staff access required",
  });
  if (user instanceof Response) return user;

  try {
    const { action, ...params } = await req.json();

    if (action === "create_checkout") {
      return await createCheckout(square.config, params, corsHeaders);
    }

    if (action === "get_checkout") {
      return await getCheckout(square.config, params, corsHeaders);
    }
    const caller = { id: user.id, email: user.email };
    if (action === "list_devices") {
      return await listDevices(square.config, corsHeaders);
    }
    if (action === "start_sale") {
      return await startSale(square.config, params, corsHeaders, caller);
    }
    if (action === "confirm_sale") {
      return await confirmSale(square.config, params, corsHeaders, caller);
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
        device_id: params.device_id || Deno.env.get("SQUARE_TERMINAL_DEVICE_ID") || "SIMULATED_SANDBOX_DEVICE",
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
  const checkoutId = String(params.checkout_id ?? "");
  if (checkoutId.startsWith("SIM_")) {
    // createCheckout only ever mints a SIM_ id in the sandbox. In production a
    // SIM_ id is somebody typing one, and answering COMPLETED to it is a free
    // "card approved" for the film-pass counter (security audit 2026-10-06, L1).
    if (config.environment === "production") {
      return new Response(
        JSON.stringify({ error: "Simulated checkouts do not exist in production" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        simulated: true,
        checkout: {
          id: checkoutId,
          status: "COMPLETED",
        },
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  const { ok, status, data } = await squareFetch(
    config,
    `/terminals/checkouts/${encodeURIComponent(checkoutId)}`,
  );

  if (!ok) {
    throw new Error(`Square API error [${status}]: ${data?.errors?.[0]?.code ?? "unknown"}`);
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

/** The service-role client, naming the verified caller to the audit trigger
 *  (_shared/audit.ts, actorHeaders) so a confirm is not filed under nobody. */
const admin = (actorId: string) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    global: { headers: actorHeaders(actorId) },
  });
type Caller = { id: string; email: string | null };
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
  caller: Caller,
) {
  const db = admin(caller.id);
  const orderToken = String(params.order_token ?? "").trim();
  if (!orderToken) return jsonRes(headers, { error: "order_token is required" }, 400);
  const donationCents = Math.max(0, Math.floor(Number(params.donation_cents ?? 0)) || 0);
  // The same ceiling the POS's donation box enforces (DonationPrompt). The
  // browser cannot exceed it, so anything over it did not come from the till.
  if (donationCents > MAX_BUNDLED_DONATION_CENTS) {
    return jsonRes(headers, { error: `A counter gift is capped at $${MAX_BUNDLED_DONATION_CENTS / 100}. Take a larger gift through Donations.` }, 400);
  }

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
      console.error(`[square-terminal] order build ${built.expectedTotalCents} != charge ${chargeCents} for ${logToken(orderToken)}; no Square Order`);
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
  caller: Caller,
) {
  const db = admin(caller.id);
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
    const r = await squareFetch(config, `/terminals/checkouts/${encodeURIComponent(checkoutId)}`);
    if (!r.ok) return jsonRes(headers, { error: "Could not read the checkout from Square" }, 502);
    // The checkout has to be the one start_sale created for THIS order. Before,
    // any completed checkout id confirmed any order whose total it covered, so
    // one card swipe could confirm a queue of later sales (L1).
    if (!checkoutMatchesOrder(r.data.checkout, orderToken)) {
      console.error(`[square-terminal] checkout ${checkoutId} is not for order ${logToken(orderToken)}`);
      return jsonRes(headers, { error: "That card payment belongs to a different sale. Start this sale again on the reader." }, 409);
    }
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

  // One payment, one order. The database refuses it too (tickets trigger,
  // PT423); asking first turns that into a sentence for the counter rather
  // than "the card was charged but…".
  if (paymentId) {
    const [{ data: otherTickets }, { data: passes }] = await Promise.all([
      db.from("tickets").select("id").eq("square_payment_id", paymentId).neq("order_token", orderToken).limit(1),
      db.from("user_film_passes").select("id").eq("square_payment_id", paymentId).limit(1),
    ]);
    if ((otherTickets ?? []).length > 0 || (passes ?? []).length > 0) {
      console.error(`[square-terminal] payment ${paymentId} already used; order ${logToken(orderToken)} not confirmed`);
      return jsonRes(headers, { error: "That card payment already paid for a different sale. Start this sale again on the reader." }, 409);
    }
  }

  const ids = rows.map((t: any) => t.id);
  const { data: updated, error } = await db
    .from("tickets")
    .update({ status: "confirmed", square_payment_id: paymentId, payment_error: null })
    .in("id", ids)
    .select("id");
  if (error || !updated || updated.length !== ids.length) {
    console.error("[square-terminal] confirm failed after charge", error, { order: logToken(orderToken), checkoutId, paymentId });
    return jsonRes(headers, { error: "The card was charged but the tickets could not be confirmed. Do not charge again — contact support.", payment_id: paymentId }, 500);
  }
  await logStaffAction(caller, "tickets.card_sale_confirmed", "tickets", {
    ticket_ids: ids, payment_id: paymentId, checkout_id: checkoutId, amount_cents: cents, paid_cents: paid,
  });
  return jsonRes(headers, { confirmed: true, ticket_ids: ids, payment_id: paymentId, amount_cents: cents });
}

/**
 * The Square Terminals paired to this location, for the POS's reader picker.
 *
 * The theatre has two — box office and concessions — so a card sale has to say
 * which reader it is for, and a single configured id was never going to be
 * right for both. Read-only: Square's Devices API, filtered to Terminals. The
 * default (`SQUARE_TERMINAL_DEVICE_ID`, if set) is returned so a fresh browser
 * can start with it before anyone has picked.
 */
async function listDevices(config: SquareConfig, headers: Record<string, string>) {
  const r = await squareFetch(config, "/devices?limit=100", { method: "GET" });
  if (!r.ok) return jsonRes(headers, { error: "Could not list the card readers", detail: r.data?.errors }, 502);
  const devices = (r.data?.devices ?? [])
    .filter((d: any) => d.attributes?.type === "TERMINAL")
    .map((d: any) => ({
      id: d.id,
      name: d.attributes?.name ?? d.id,
      status: d.status?.category ?? "UNKNOWN",
      // Square reports a location per component; the first is the pairing.
      location_id: d.components?.find((c: any) => c.type === "APPLICATION")?.application_details?.location_id ?? null,
    }));
  return jsonRes(headers, { devices, default_id: Deno.env.get("SQUARE_TERMINAL_DEVICE_ID") ?? null, environment: config.environment });
}

