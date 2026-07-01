// Little Green Light donation sync.
//
// Given a donation id, finds (or creates) the constituent in LGL by email
// and posts the gift. Idempotent per-donation via donations.lgl_gift_id.
//
// Called fire-and-forget from square-donation after a successful payment,
// and also invokable directly from the admin dashboard to backfill.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LGL_BASE = "https://api.littlegreenlight.com/api/v1";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("LGL_API_KEY");
  if (!apiKey) return json({ error: "LGL not configured" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const donationId: string | undefined = body?.donationId;
  const force: boolean = !!body?.force;
  if (!donationId) return json({ error: "donationId required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: d, error: dErr } = await admin
    .from("donations")
    .select("id, amount_cents, donor_name, donor_email, donor_phone, dedication_type, dedicate_to, message, status, lgl_gift_id, lgl_constituent_id, created_at")
    .eq("id", donationId)
    .maybeSingle();
  if (dErr || !d) return json({ error: "Donation not found" }, 404);
  if (d.status !== "completed") return json({ error: `Donation status is ${d.status}, skipping` }, 400);
  if (d.lgl_gift_id && !force) return json({ ok: true, skipped: "already synced", giftId: d.lgl_gift_id });

  // Dev-stage kill switch. When app_config.lgl_sync_paused = true, no
  // donations sync to the live LGL account. Manual "force" calls from the
  // admin dashboard still respect the pause so a superadmin can't accidentally
  // push demo data live. Delete this block once we're off the sandbox period.
  const { data: pauseRow } = await admin
    .from("app_config").select("value").eq("key", "lgl_sync_paused").maybeSingle();
  const paused = (pauseRow?.value as any)?.paused === true;
  if (paused) {
    await admin.from("donations")
      .update({ lgl_sync_error: "Skipped: LGL sync is paused (superadmin toggle)." })
      .eq("id", d.id);
    return json({ ok: true, skipped: "lgl_sync_paused" });
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function markError(msg: string) {
    await admin.from("donations")
      .update({ lgl_sync_error: msg.slice(0, 500) })
      .eq("id", d.id);
  }

  try {
    // 1. Resolve constituent — reuse cached id, else search by email, else create.
    let constituentId: string | null = d.lgl_constituent_id ?? null;

    if (!constituentId) {
      const q = encodeURIComponent(`email_address=${d.donor_email}`);
      const sRes = await fetch(`${LGL_BASE}/constituents/search?q=${q}&limit=1`, { headers });
      if (sRes.ok) {
        const sJson = await sRes.json();
        const first = sJson?.items?.[0];
        if (first?.id) constituentId = String(first.id);
      } else if (sRes.status !== 404) {
        const txt = await sRes.text();
        console.warn("[lgl] search failed", sRes.status, txt);
      }
    }

    if (!constituentId) {
      const parts = (d.donor_name || "").trim().split(/\s+/);
      const first_name = parts[0] || "";
      const last_name = parts.slice(1).join(" ") || "(unknown)";
      const payload: any = {
        first_name,
        last_name,
        email_addresses: [{
          address: d.donor_email,
          email_address_type_id: 1, // Home — LGL default
          is_preferred: true,
        }],
      };
      if (d.donor_phone) {
        payload.phone_numbers = [{
          number: d.donor_phone,
          phone_number_type_id: 1,
          is_preferred: true,
        }];
      }
      const cRes = await fetch(`${LGL_BASE}/constituents`, {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      if (!cRes.ok) {
        const detail = await cRes.text();
        await markError(`constituent create ${cRes.status}: ${detail}`);
        return json({ error: "constituent_create_failed", status: cRes.status, detail }, 502);
      }
      const cJson = await cRes.json();
      constituentId = String(cJson.id);
    }

    // 2. Post the gift.
    const noteParts: string[] = [`Kenworthy online donation (Square). Donation id: ${d.id}.`];
    if (d.dedication_type && d.dedicate_to) {
      const label = d.dedication_type === "in_memory" ? "In memory of" : "In honor of";
      noteParts.push(`${label} ${d.dedicate_to}.`);
    }
    if (d.message) noteParts.push(`Message: ${d.message}`);

    const giftPayload: any = {
      received_amount: (d.amount_cents / 100).toFixed(2),
      received_date: (d.created_at as string).slice(0, 10),
      external_id: `kenworthy-donation-${d.id}`,
      note: noteParts.join(" "),
      // Category/payment type IDs vary per LGL account; leave unset so LGL uses defaults.
    };
    const gRes = await fetch(
      `${LGL_BASE}/constituents/${constituentId}/gifts`,
      { method: "POST", headers, body: JSON.stringify(giftPayload) },
    );
    if (!gRes.ok) {
      const detail = await gRes.text();
      await markError(`gift create ${gRes.status}: ${detail}`);
      await admin.from("donations")
        .update({ lgl_constituent_id: constituentId })
        .eq("id", d.id);
      return json({ error: "gift_create_failed", status: gRes.status, detail }, 502);
    }
    const gJson = await gRes.json();

    await admin.from("donations").update({
      lgl_constituent_id: constituentId,
      lgl_gift_id: String(gJson.id),
      lgl_synced_at: new Date().toISOString(),
      lgl_sync_error: null,
    }).eq("id", d.id);

    return json({ ok: true, constituentId, giftId: String(gJson.id) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markError(msg);
    return json({ error: msg }, 500);
  }
});