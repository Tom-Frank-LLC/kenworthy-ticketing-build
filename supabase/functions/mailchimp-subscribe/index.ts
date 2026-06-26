import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createHash } from "node:crypto";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  email: z.string().trim().email().max(255),
  first_name: z.string().trim().max(80).optional().default(""),
  last_name: z.string().trim().max(80).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).optional().default([]),
  // 'subscribed' for explicit opt-in, 'pending' for double opt-in flows
  status: z.enum(["subscribed", "pending"]).optional().default("subscribed"),
  source: z.string().trim().max(60).optional(),
});

function md5Lower(email: string): string {
  return createHash("md5").update(email.trim().toLowerCase()).digest("hex");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("MAILCHIMP_API_KEY");
  const server = Deno.env.get("MAILCHIMP_SERVER_PREFIX");
  const audienceId = Deno.env.get("MAILCHIMP_AUDIENCE_ID");
  if (!apiKey || !server || !audienceId) {
    return new Response(JSON.stringify({ error: "Mailchimp is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { email, first_name, last_name, tags, status, source } = parsed.data;

  const hash = md5Lower(email);
  const base = `https://${server}.api.mailchimp.com/3.0`;
  const auth = "Basic " + btoa(`anystring:${apiKey}`);

  // PUT upserts the member; tags applied separately so we don't overwrite existing ones.
  const memberRes = await fetch(`${base}/lists/${audienceId}/members/${hash}`, {
    method: "PUT",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      email_address: email,
      status_if_new: status,
      // Don't downgrade an already-subscribed contact
      merge_fields: {
        ...(first_name ? { FNAME: first_name } : {}),
        ...(last_name ? { LNAME: last_name } : {}),
      },
    }),
  });
  const memberJson = await memberRes.json().catch(() => ({}));
  if (!memberRes.ok) {
    console.error("Mailchimp upsert failed", memberRes.status, memberJson);
    return new Response(JSON.stringify({ error: "Mailchimp upsert failed", detail: memberJson }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const allTags = [...new Set([...tags, ...(source ? [`source:${source}`] : [])])];
  if (allTags.length) {
    const tagRes = await fetch(`${base}/lists/${audienceId}/members/${hash}/tags`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ tags: allTags.map((name) => ({ name, status: "active" })) }),
    });
    if (!tagRes.ok) {
      const detail = await tagRes.json().catch(() => ({}));
      console.error("Mailchimp tagging failed", tagRes.status, detail);
    } else {
      await tagRes.text();
    }
  }

  return new Response(JSON.stringify({ ok: true, id: memberJson.id ?? hash }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});