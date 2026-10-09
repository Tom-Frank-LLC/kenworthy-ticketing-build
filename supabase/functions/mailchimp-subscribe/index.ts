import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { LIMITS, checkRateLimit } from "../_shared/rate_limit.ts";
import { roleGate, verifiedCaller, verifyServiceRoleCaller } from "../_shared/callers.ts";
import { type CallerKind, createHandler } from "./handler.ts";

// The rules live in handler.ts so they can be tested without reaching the
// shared production audience. This file only wires in the real dependencies.

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Trusted = the verified service role, or a signed-in user holding staff
 * (which admin and superadmin satisfy). A valid JWT alone is not enough: every
 * guest buyer has an account (security audit M1). A host, a buyer's session, a
 * bad token or a failed role lookup all fall to the anonymous path, which is
 * the safe one. So does an admin who has not entered their authenticator code:
 * this branches rather than refuses, and anonymous is still a working sign-up.
 */
async function classify(req: Request): Promise<CallerKind> {
  if (await verifyServiceRoleCaller(req)) return "trusted";
  const user = await verifiedCaller(req);
  if (!user) return "anonymous";
  return (await roleGate(admin(), user, "staff")) === "ok" ? "trusted" : "anonymous";
}

async function allow(req: Request): Promise<boolean> {
  const rl = await checkRateLimit(
    admin(), req,
    LIMITS.mailchimpSubscribe.bucket,
    LIMITS.mailchimpSubscribe.limit,
    LIMITS.mailchimpSubscribe.windowSeconds,
  );
  return rl.allowed;
}

Deno.serve(createHandler({
  fetch,
  classify,
  allow,
  config: {
    apiKey: Deno.env.get("MAILCHIMP_API_KEY"),
    server: Deno.env.get("MAILCHIMP_SERVER_PREFIX"),
    audienceId: Deno.env.get("MAILCHIMP_AUDIENCE_ID"),
  },
}));
