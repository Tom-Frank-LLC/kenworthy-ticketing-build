import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { corsHeaders } from "../_shared/http.ts";
import {
  createPayment,
  isChargeableSource,
  squareFetch,
  loadSquareConfig,
  publishableConfig,
  squareErrorMessage,
} from "../_shared/square.ts";
import { buildTicketOrder, orderRequestBody } from "../_shared/square-order.ts";
import { donorTextError, settleDonation } from "../_shared/donations.ts";
import { LIMITS, RATE_LIMIT_REFUSAL, callerIp, checkRateLimit } from "../_shared/rate_limit.ts";
import { BOT_CHECK_REFUSAL, verifyTurnstile } from "../_shared/turnstile.ts";
import { PAYMENTS_UNAVAILABLE, BOX_OFFICE_PHONE, publicDeclineMessage } from "../_shared/public_errors.ts";
import { actorHeaders } from "../_shared/audit.ts";
import { requireRole, roleGate } from "../_shared/callers.ts";
import { counterPaymentProblem } from "../_shared/counter_payment.ts";
import { type Channel, orderCents, orderProblem, requestProblem } from "./in_person.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (!square.ok) {
      // The detail names environment variables; it is for the log, not the page.
      console.error("[square-donation] get_config:", square.error);
      return json({ error: PAYMENTS_UNAVAILABLE }, 500);
    }
    return json(publishableConfig(square.config));
  }

  // Box office: a donation taken at the counter, alongside (or instead of) a
  // ticket sale. No card is charged here — either the till took cash, or the
  // amount was already included in the combined charge sent to the Square
  // terminal — so this action records the gift and nothing else. It reads the
  // Square payment that carried the gift (in_person.ts), so it takes the
  // config, but it is staff-only and not behind Turnstile.
  if (action === "record_in_person") {
    return await recordInPersonDonation(req, body, square);
  }

  if (action !== "create_payment") {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  if (!square.ok) {
    console.error("[square-donation]", square.error);
    return json({ error: PAYMENTS_UNAVAILABLE }, 500);
  }

  // The public card path. Rate limit first, so a flood costs one indexed upsert
  // rather than a Square round trip each. Fifteen in ten minutes is far above a
  // donor retrying a declined card, and far below anything worth scripting.
  //
  // A speed bump, not the control: it bounds cost and nuisance from one
  // address and does nothing about a distributed attempt. Turnstile, below, is
  // the control.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  {
    const rl = await checkRateLimit(
      admin, req,
      LIMITS.donation.bucket, LIMITS.donation.limit, LIMITS.donation.windowSeconds,
    );
    if (!rl.allowed) return json({ error: RATE_LIMIT_REFUSAL }, 429);
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
  // A card token only — never "CASH" or "EXTERNAL", which Square completes
  // without a card. See isChargeableSource.
  if (!isChargeableSource(sourceId)) return json({ error: "Invalid payment source" }, 400);
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 10_000_000) {
    return json({ error: "Amount must be between $1 and $100,000" }, 400);
  }
  if (!donorName || donorName.length < 2) return json({ error: "Donor name required" }, 400);
  if (!donorEmail || !EMAIL_RE.test(donorEmail)) {
    return json({ error: "Valid donor email required" }, 400);
  }
  if (dedicationType && !["in_honor", "in_memory"].includes(dedicationType)) {
    return json({ error: "Invalid dedication type" }, 400);
  }
  // The tribute notice is sent to this address from the theatre's sender, so
  // it has to be an address — it was stored unchecked before.
  if (notifyEmail && !EMAIL_RE.test(notifyEmail)) {
    return json({ error: "The email to notify is not a valid address" }, 400);
  }
  // Length caps and no links in anything that reaches an email as prose. The
  // reasoning — refuse rather than strip — is in _shared/donations.ts.
  const textError = donorTextError({
    donorName, donorEmail, donorPhone, dedicateTo, notifyName, notifyEmail, message,
  });
  if (textError) return json({ error: textError }, 400);

  // Fails closed — see _shared/turnstile.ts. After the free checks, so a typo
  // the donor can fix does not spend their token; before any row or charge.
  const bot = await verifyTurnstile(body.turnstile_token, callerIp(req), {
    whenUnset: "refuse",
    label: "square-donation",
  });
  if (!bot.ok) return json({ error: BOT_CHECK_REFUSAL }, 403);

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
            // A gift is not collected, so it carries no fulfillment. Same
            // shape square-invoice has always used.
            fulfillment: "NONE",
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
      console.error("Square payment error:", squareErrorMessage(sqResult.data), JSON.stringify(sqResult.data));
      await admin
        .from("donations")
        .update({ status: "failed" })
        .eq("id", pending.id);
      return json({ error: publicDeclineMessage(sqResult.data) }, 400);
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

    // Fire-and-forget purchase history to Mailchimp's store (dormant until
    // mailchimp-bootstrap has run). Never block on success/failure. Not a
    // newsletter signup: that is the donor's checkbox, sent from the browser
    // (Donate.tsx). A call from here used to subscribe every donor regardless,
    // and never arrived for want of an Authorization header; removed 2026-10-07.
    try {
      const [first, ...rest] = donorName.split(/\s+/);
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
    // The exception's own text goes to the log. Not "your card was not
    // charged": this catch also covers the steps after the charge.
    return json({
      error: `Something went wrong while processing your donation. Please check your email for a receipt before trying again, or call the box office on ${BOX_OFFICE_PHONE}.`,
    }, 500);
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
 *
 * Not on a staff member's word. The gift has to name the sale it rode on, and
 * Square has to hold a payment for that sale that covers the gift — see
 * in_person.ts for each rule and why (security audit 2026-10-06, L1).
 */
async function recordInPersonDonation(
  req: Request,
  body: Record<string, unknown>,
  square: ReturnType<typeof loadSquareConfig>,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const reader = createClient(supabaseUrl, serviceKey);

  // The gate is hierarchical: staff covers admin and superadmin.
  const user = await requireRole(req, reader, "staff", {
    headers: corsHeaders,
    unauthorized: "Sign in required",
    forbidden: "Staff only",
  });
  if (user instanceof Response) return user;
  // Past the MFA check already, so this is the plain role test.
  const isAdmin = (await roleGate(reader, user, "admin")) === "ok";

  const shape = requestProblem(body);
  if (shape) return json({ error: shape.error }, shape.status);
  const amountCents = Number(body.amountCents);
  const paymentChannel = String(body.paymentChannel) as Channel;
  const orderToken = String(body.orderToken).trim();

  const donorEmail = (body.donorEmail as string)?.trim() || null;
  if (donorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail)) {
    return json({ error: "That donor email is not a valid address" }, 400);
  }

  const { data: tickets, error: ticketErr } = await reader
    .from("tickets")
    .select("user_id, payment_method, status, square_payment_id, total_price, processing_fee, showing_id")
    .eq("order_token", orderToken);
  if (ticketErr) return json({ error: "Could not read that sale. Try again." }, 503);

  if (!square.ok) {
    console.error("[square-donation] record_in_person:", square.error);
    return json({ error: PAYMENTS_UNAVAILABLE }, 500);
  }
  const verdict = orderProblem({
    channel: paymentChannel,
    tickets: tickets ?? [],
    callerId: user.id,
    callerIsAdmin: isAdmin,
    claimedPaymentId: typeof body.squarePaymentId === "string" ? body.squarePaymentId : null,
    environment: square.config.environment,
  });
  if (!verdict.ok) return json({ error: verdict.refusal.error }, verdict.refusal.status);

  // One gift per sale. A retry (a double-click, a slow response) gets the gift
  // it already filed, not a second receipt and a second LGL record.
  const { data: existing, error: existingErr } = await reader
    .from("donations").select("id, amount_cents").eq("order_token", orderToken).limit(1);
  if (existingErr) return json({ error: "Could not check that sale. Try again." }, 503);
  if ((existing ?? []).length > 0) {
    return json({ success: true, already_recorded: true, donationId: existing![0].id, amountCents: existing![0].amount_cents });
  }

  const live = (tickets ?? []).filter((t: { status: string | null }) => t.status !== "failed");
  if (verdict.paymentId) {
    const paymentId = verdict.paymentId;
    const read = await squareFetch(square.config, `/payments/${encodeURIComponent(paymentId)}`);
    const [{ data: otherTickets }, { data: passes }, { data: passOrders }, { data: otherGifts }] = await Promise.all([
      reader.from("tickets").select("id").eq("square_payment_id", paymentId).neq("order_token", orderToken).limit(1),
      reader.from("user_film_passes").select("id").eq("square_payment_id", paymentId).limit(1),
      reader.from("film_pass_orders").select("id").eq("square_payment_id", paymentId).limit(1),
      reader.from("donations").select("id").eq("square_payment_id", paymentId).limit(1),
    ]);
    const problem = counterPaymentProblem({
      found: read.ok,
      payment: read.data?.payment,
      locationId: square.config.locationId,
      dueCents: orderCents(live) + amountCents,
      alreadyUsed: [otherTickets, passes, passOrders, otherGifts].some((r) => (r ?? []).length > 0),
      purpose: "this sale with its gift",
    });
    if (problem) {
      console.error(`[square-donation] record_in_person refused for order ${orderToken.slice(0, 8)}…: ${problem}`);
      return json({ error: problem }, problem.startsWith("That card payment already") ? 409 : 400);
    }
  }

  // A walk-in who hands over a dollar has no name to give and no receipt to
  // send. The gift is still income, so it is still recorded — labelled for
  // whoever reconciles the day rather than left out of the books.
  const donorName = (body.donorName as string)?.trim() ||
    (donorEmail ? donorEmail.split("@")[0] : "Box office donor");

  // Writes name the staff member to the audit trigger (_shared/audit.ts, M11).
  const admin = createClient(supabaseUrl, serviceKey, { global: { headers: actorHeaders(user.id) } });
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
      // The payment Square holds for it, as verified above — not what the
      // browser sent.
      square_payment_id: verdict.paymentId,
      order_token: orderToken,
      showing_id: live[0]?.showing_id ?? null,
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
