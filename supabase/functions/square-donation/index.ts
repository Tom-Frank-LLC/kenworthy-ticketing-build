import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";
import {
  createPayment,
  squareFetch,
  loadSquareConfig,
  publishableConfig,
  squareErrorMessage,
} from "../_shared/square.ts";
import { buildTicketOrder, orderRequestBody } from "../_shared/square-order.ts";
import { settleDonation } from "../_shared/donations.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Sandbox vs production is a secrets decision now, not a code one — the same
  // resolution every other Square call in this project uses.
  const square = loadSquareConfig();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action as string;

  // Public: return the publishable IDs the browser SDK needs
  if (action === "get_config") {
    if (!square.ok) return json({ error: square.error }, 500);
    return json(publishableConfig(square.config));
  }

  // Box office: a donation taken at the counter, alongside (or instead of) a
  // ticket sale. No card is charged here — either the till took cash, or the
  // amount was already included in the combined charge sent to the Square
  // terminal — so this action records the gift and nothing else. Square config
  // is irrelevant to it, which is why it sits above the square.ok guard.
  if (action === "record_in_person") {
    return await recordInPersonDonation(req, body);
  }

  if (!square.ok) return json({ error: square.error }, 500);

  if (action !== "create_payment") {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  // Validate donation payload
  const sourceId = body.sourceId as string;
  const amountCents = Number(body.amountCents);
  const donorName = (body.donorName as string)?.trim();
  const donorEmail = (body.donorEmail as string)?.trim();
  const donorPhone = (body.donorPhone as string)?.trim() || null;
  const dedicationType = (body.dedicationType as string) || null;
  const dedicateTo = (body.dedicateTo as string)?.trim() || null;
  const notifyName = (body.notifyName as string)?.trim() || null;
  const notifyEmail = (body.notifyEmail as string)?.trim() || null;
  const message = (body.message as string)?.trim() || null;

  if (!sourceId) return json({ error: "Missing payment source" }, 400);
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 10_000_000) {
    return json({ error: "Amount must be between $1 and $100,000" }, 400);
  }
  if (!donorName || donorName.length < 2) return json({ error: "Donor name required" }, 400);
  if (!donorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail)) {
    return json({ error: "Valid donor email required" }, 400);
  }
  if (dedicationType && !["in_honor", "in_memory"].includes(dedicationType)) {
    return json({ error: "Invalid dedication type" }, 400);
  }

  // Optional auth — if a JWT is present, link the donation to that user
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  if (authHeader && !authHeader.includes(anonKey)) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      // ignore — donations are allowed for guests
    }
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Insert a pending row so we always have a record, even if Square errors
  const idempotencyKey = crypto.randomUUID();
  const { data: pending, error: insertErr } = await admin
    .from("donations")
    .insert({
      amount_cents: amountCents,
      donor_name: donorName,
      donor_email: donorEmail,
      donor_phone: donorPhone,
      dedication_type: dedicationType,
      dedicate_to: dedicateTo,
      notify_name: notifyName,
      notify_email: notifyEmail,
      message,
      status: "pending",
      user_id: userId,
      source: "donate_page",
      payment_channel: "online",
    })
    .select("id")
    .single();

  if (insertErr || !pending) {
    console.error("Failed to insert pending donation:", insertErr);
    return json({ error: "Could not record donation" }, 500);
  }

  // Charge the card via Square Payments API
  try {
    const noteParts = [`Donation #${pending.id.slice(0, 8)}`];
    if (dedicationType && dedicateTo) {
      noteParts.push(`${dedicationType === "in_honor" ? "In honor of" : "In memory of"} ${dedicateTo}`);
    }
    const note = noteParts.join(" — ").slice(0, 500);

    // A donation is NOT a ticket line. The catalog has one DONATION product-type
    // item with $10 / $20 / $50 / $100 and a variable-priced "Custom Amount"
    // variation, all is_taxable false. Ringing a gift against a ticket item
    // would inflate admissions revenue and put a donation into the tax base.
    //
    // The mapping lives in app_config['square_donation_variations'] and is unset
    // until somebody populates it from the live catalog, so this degrades to a
    // named ad-hoc "Donation" line rather than failing.
    let squareOrderId: string | undefined;
    try {
      const { data: cfg } = await admin
        .from("app_config")
        .select("value")
        .eq("key", "square_donation_variations")
        .maybeSingle();
      const map = (cfg?.value ?? {}) as any;
      // An exact preset ($10/$20/$50/$100) if one matches, otherwise the
      // variable-priced Custom Amount variation, which still needs an explicit
      // price sent with it.
      const variationId: string | null =
        map?.by_amount_cents?.[String(amountCents)] ?? map?.custom ?? null;

      const built = buildTicketOrder([{
        tierKey: "__donation",
        displayName: "Donation",
        variationId,
        unitPriceCents: amountCents,
        unitTaxCents: 0,
        count: 1,
        taxable: false, // the DONATION item is is_taxable false, and a gift is not a sale
      }]);

      if (!variationId) {
        console.warn("[square-donation] no DONATION variation mapped; billed as an ad-hoc line");
      }

      if (built.expectedTotalCents !== amountCents) {
        console.error(`[square-donation] order total ${built.expectedTotalCents} != charge ${amountCents}; bare payment`);
      } else {
        const createdOrder = await squareFetch(square.config, "/orders", {
          method: "POST",
          body: orderRequestBody({
            locationId: square.config.locationId,
            referenceId: pending.id,
            built,
            idempotencyKey: `order-${idempotencyKey}`,
            fulfillment: "DIGITAL",
            buyerEmail: donorEmail,
            buyerName: donorName,
          }),
        });
        const squareTotal = createdOrder.data?.order?.total_money?.amount;
        if (!createdOrder.ok || !createdOrder.data?.order?.id) {
          console.error("[square-donation] order create failed", createdOrder.status, JSON.stringify(createdOrder.data));
        } else if (squareTotal !== amountCents) {
          console.error(`[square-donation] Square totalled ${squareTotal} vs charge ${amountCents}; abandoning order`);
        } else {
          squareOrderId = createdOrder.data.order.id;
        }
      }
    } catch (err) {
      console.error("[square-donation] order build threw, falling back to bare payment", err);
    }

    const sqResult = await createPayment(square.config, {
      sourceId,
      amountCents,
      idempotencyKey,
      orderId: squareOrderId,
      referenceId: pending.id,
      note,
      buyerEmail: donorEmail,
    });

    if (!sqResult.ok || !sqResult.data?.payment) {
      console.error("Square payment error:", JSON.stringify(sqResult.data));
      await admin
        .from("donations")
        .update({ status: "failed" })
        .eq("id", pending.id);
      return json({ error: squareErrorMessage(sqResult.data) }, 400);
    }

    const payment = sqResult.data.payment;
    await admin
      .from("donations")
      .update({
        status: payment.status === "COMPLETED" ? "completed" : payment.status?.toLowerCase() ?? "completed",
        square_payment_id: payment.id,
        square_receipt_url: payment.receipt_url ?? null,
      })
      .eq("id", pending.id);

    // Fire-and-forget Mailchimp sync — donor tag + e-commerce order.
    // Never block on success/failure.
    try {
      const [first, ...rest] = donorName.split(/\s+/);
      void fetch(`${supabaseUrl}/functions/v1/mailchimp-subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": anonKey },
        body: JSON.stringify({
          email: donorEmail,
          first_name: first ?? "",
          last_name: rest.join(" "),
          tags: ["donor"],
          source: "donation",
        }),
      }).catch(() => {});
      void fetch(`${supabaseUrl}/functions/v1/mailchimp-ecommerce`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": anonKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          email: donorEmail,
          first_name: first ?? "",
          last_name: rest.join(" "),
          order: {
            id: `donation:${pending.id}`,
            total: amountCents / 100,
            lines: [{
              id: pending.id,
              product_id: "donation",
              product_title: "Donation to the Kenworthy",
              quantity: 1,
              price: amountCents / 100,
              category: "donation",
            }],
          },
        }),
      }).catch(() => {});
    } catch (e) {
      console.warn("[square-donation] mailchimp sync threw", e);
    }

    // Receipt, tribute notice, and the Little Green Light gift. In-process:
    // this used to POST to lgl-sync-donation with the anon key in `apikey` and
    // the service-role key as a bearer — a function that was never deployed,
    // called with the credential pair the gateway refuses. Nothing about that
    // failure was visible, because nothing awaited it.
    settleDonation(admin, pending.id);

    return json({
      success: true,
      donationId: pending.id,
      receiptUrl: payment.receipt_url ?? null,
      amountCents,
    });
  } catch (err) {
    console.error("Donation processing error:", err);
    await admin.from("donations").update({ status: "failed" }).eq("id", pending.id);
    return json({ error: err instanceof Error ? err.message : "Payment failed" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Record a donation taken at the box office.
 *
 * The money has already moved by the time this is called — cash into the till,
 * or a card charge on the Square terminal that included the gift in its total.
 * So this writes the contribution to the books, and then does exactly what the
 * online path does with it: receipt if we have an address, and a gift posted to
 * Little Green Light.
 *
 * Staff-only, checked server-side. The donations table grants INSERT to nobody
 * but service_role, which is the reason this action exists at all: the POS
 * cannot write the row itself.
 */
async function recordInPersonDonation(req: Request, body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const admin = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sign in required" }, 401);
  const { data: isStaff } = await admin.rpc("has_role", { _user_id: user.id, _role: "staff" });
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isStaff && !isAdmin) return json({ error: "Staff only" }, 403);

  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 10_000_000) {
    return json({ error: "Donation must be between $1 and $100,000" }, 400);
  }

  const paymentChannel = String(body.paymentChannel || "");
  if (!["cash", "terminal"].includes(paymentChannel)) {
    return json({ error: "paymentChannel must be cash or terminal" }, 400);
  }

  const donorEmail = (body.donorEmail as string)?.trim() || null;
  if (donorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail)) {
    return json({ error: "That donor email is not a valid address" }, 400);
  }
  // A walk-in who hands over a dollar has no name to give and no receipt to
  // send. The gift is still income, so it is still recorded — labelled for
  // whoever reconciles the day rather than left out of the books.
  const donorName = (body.donorName as string)?.trim() ||
    (donorEmail ? donorEmail.split("@")[0] : "Box office donor");

  const { data: row, error } = await admin
    .from("donations")
    .insert({
      amount_cents: amountCents,
      donor_name: donorName,
      donor_email: donorEmail,
      donor_phone: (body.donorPhone as string)?.trim() || null,
      status: "completed",
      source: "staff_pos",
      payment_channel: paymentChannel,
      square_payment_id: (body.squarePaymentId as string) || null,
      order_token: (body.orderToken as string) || null,
      showing_id: (body.showingId as string) || null,
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error("[square-donation] in-person insert failed", error);
    return json({ error: "Could not record the donation" }, 500);
  }

  settleDonation(admin, row.id);

  return json({ success: true, donationId: row.id, amountCents });
}