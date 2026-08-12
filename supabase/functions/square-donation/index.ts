import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";
import {
  createPayment,
  loadSquareConfig,
  publishableConfig,
  squareErrorMessage,
} from "../_shared/square.ts";

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

    const sqResult = await createPayment(square.config, {
      sourceId,
      amountCents,
      idempotencyKey,
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

    // Fire-and-forget Little Green Light sync (constituent + gift).
    try {
      void fetch(`${supabaseUrl}/functions/v1/lgl-sync-donation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": anonKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ donationId: pending.id }),
      }).catch(() => {});
    } catch (e) {
      console.warn("[square-donation] lgl sync threw", e);
    }

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