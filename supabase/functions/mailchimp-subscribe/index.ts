import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createHash } from "node:crypto";
import { z } from "npm:zod@3.23.8";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  merge_fields: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
  interests: z.record(z.boolean()).optional(),
  unsubscribe: z.boolean().optional().default(false),
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
  let { email, first_name, last_name, tags, status, source, merge_fields, interests, unsubscribe } = parsed.data;

  // Authenticate: if a JWT is present it must be valid. Anonymous callers
  // (public newsletter form) are allowed but forced to double opt-in
  // ('pending' status) so nobody can silently subscribe a third-party email —
  // Mailchimp sends a confirmation email the recipient must click.
  const authHeader = req.headers.get("Authorization") || "";
  let isAuthenticated = false;

  // Trusted server-to-server path. Another edge function bearing the service
  // role key has already established the relationship itself — `ticket-checkout`
  // only calls here after a payment cleared and the buyer left the marketing box
  // ticked — so it is allowed to say `status: 'subscribed'` outright. The
  // confirmation-email step exists to stop a stranger subscribing a third party
  // from the public form; a verified purchase is not that, and making a paying
  // customer re-confirm by email is where "subscribed unless you opt out"
  // quietly turns back into opt-in.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) {
    isAuthenticated = true;
  } else if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
      );
      const { data, error } = await userClient.auth.getUser(token);
      if (!error && data?.user) {
        isAuthenticated = true;
        // Only trust the caller's own email when authenticated
        if (data.user.email && data.user.email.toLowerCase() === email.toLowerCase()) {
          isAuthenticated = true;
        }
      }
    } catch (_) { /* treat as anon */ }
  }

  if (!isAuthenticated) {
    // Force double opt-in and constrain tags/source for anonymous submissions
    status = "pending";
    const allowedTags = new Set(["newsletter", "account-signup", "ticket-buyer", "donor", "film-pass", "dvd-renter"]);
    tags = (tags || []).filter((t) => allowedTags.has(t));
    if (tags.length === 0) tags = ["newsletter"];
    // Anonymous callers cannot push merge fields or interests
    merge_fields = undefined;
    interests = undefined;
    // Anonymous callers cannot unsubscribe someone else
    unsubscribe = false;
  }

  const hash = md5Lower(email);
  const base = `https://${server}.api.mailchimp.com/3.0`;
  const auth = "Basic " + btoa(`anystring:${apiKey}`);

  // Unsubscribe path: PATCH member status to 'unsubscribed' and return early.
  if (unsubscribe) {
    const unsubRes = await fetch(`${base}/lists/${audienceId}/members/${hash}`, {
      method: "PATCH",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "unsubscribed" }),
    });
    const j = await unsubRes.json().catch(() => ({}));
    if (!unsubRes.ok && unsubRes.status !== 404) {
      console.error("Mailchimp unsubscribe failed", unsubRes.status, j);
      return new Response(JSON.stringify({ error: "Mailchimp unsubscribe failed", detail: j }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, unsubscribed: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
        ...(merge_fields ?? {}),
      },
      ...(interests ? { interests } : {}),
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