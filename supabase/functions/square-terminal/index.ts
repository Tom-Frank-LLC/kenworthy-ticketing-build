import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";
import { loadSquareConfig, squareFetch, type SquareConfig } from "../_shared/square.ts";

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
