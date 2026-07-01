import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SQUARE_SANDBOX_BASE = "https://connect.squareupsandbox.com/v2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const APPLICATION_ID = Deno.env.get("SQUARE_SANDBOX_APPLICATION_ID");
  const ACCESS_TOKEN = Deno.env.get("SQUARE_SANDBOX_ACCESS_TOKEN");
  const LOCATION_ID = Deno.env.get("SQUARE_SANDBOX_LOCATION_ID");

  if (!APPLICATION_ID || !ACCESS_TOKEN || !LOCATION_ID) {
    return json({ error: "Square sandbox credentials not configured" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action as string;

  // Public: return the publishable IDs the browser SDK needs
  if (action === "get_config") {
    return json({
      applicationId: APPLICATION_ID,
      locationId: LOCATION_ID,
      environment: "sandbox",
    });
  }

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

    const sqResponse = await fetch(`${SQUARE_SANDBOX_BASE}/payments`, {
      method: "POST",
      headers: {
        "Square-Version": "2024-01-18",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        source_id: sourceId,
        amount_money: { amount: amountCents, currency: "USD" },
        location_id: LOCATION_ID,
        autocomplete: true,
        reference_id: pending.id.slice(0, 40),
        note,
        buyer_email_address: donorEmail,
        statement_description_identifier: "KENWORTHY",
      }),
    });

    const sqData = await sqResponse.json();

    if (!sqResponse.ok || !sqData.payment) {
      console.error("Square payment error:", JSON.stringify(sqData));
      await admin
        .from("donations")
        .update({ status: "failed" })
        .eq("id", pending.id);
      const msg =
        sqData?.errors?.[0]?.detail ||
        sqData?.errors?.[0]?.code ||
        "Card was declined";
      return json({ error: msg }, 400);
    }

    const payment = sqData.payment;
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