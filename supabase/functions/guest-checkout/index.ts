import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { guest_name, guest_email, guest_phone, showing_id, tickets } = body;

    // Validate required fields
    if (!guest_name || typeof guest_name !== "string" || guest_name.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!guest_email && !guest_phone) {
      return new Response(JSON.stringify({ error: "Email or phone is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (guest_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!showing_id || !tickets || !Array.isArray(tickets) || tickets.length === 0) {
      return new Response(JSON.stringify({ error: "Showing ID and tickets are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tickets.length > 4) {
      return new Response(JSON.stringify({ error: "Maximum 4 tickets per purchase" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Try to find existing user by email or phone
    let userId: string | null = null;

    if (guest_email) {
      // Look up by email in auth.users
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = usersData?.users?.find(
        (u) => u.email?.toLowerCase() === guest_email.toLowerCase()
      );
      if (existingUser) {
        userId = existingUser.id;
      }
    }

    if (!userId && guest_phone) {
      // Look up by phone in profiles
      const { data: profileData } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("phone", guest_phone.trim())
        .limit(1)
        .maybeSingle();
      if (profileData) {
        userId = profileData.id;
      }
    }

    // 2. If no existing user found, create one
    if (!userId) {
      const randomPassword = crypto.randomUUID() + "Aa1!";
      const createPayload: any = {
        password: randomPassword,
        email_confirm: true,
        user_metadata: { display_name: guest_name.trim() },
      };

      if (guest_email) {
        createPayload.email = guest_email.toLowerCase().trim();
      }
      if (guest_phone) {
        createPayload.phone = guest_phone.trim();
      }

      const { data: newUser, error: createError } =
        await supabaseAdmin.auth.admin.createUser(createPayload);

      if (createError) {
        console.error("Error creating user:", createError);
        return new Response(
          JSON.stringify({ error: "Failed to create account: " + createError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      userId = newUser.user.id;

      // Update profile with phone if provided (trigger may not set it)
      if (guest_phone) {
        await supabaseAdmin
          .from("profiles")
          .update({ phone: guest_phone.trim() })
          .eq("id", userId);
      }
    }

    // 3. Check ticket limit for this showing
    const { count: existingCount } = await supabaseAdmin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("showing_id", showing_id)
      .eq("user_id", userId)
      .eq("status", "confirmed");

    if ((existingCount || 0) + tickets.length > 4) {
      return new Response(
        JSON.stringify({
          error: `Ticket limit reached. You already have ${existingCount || 0} ticket(s) for this showing.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 4. Build ticket rows — pricing is enforced by DB trigger
    const ticketRows = tickets.map((t: any) => ({
      user_id: userId,
      showing_id,
      seat_id: t.seat_id || null,
      tier_id: t.tier_id || null,
      price: 0, // Will be overridden by enforce_ticket_pricing trigger
      tax_amount: 0,
      total_price: 0,
      qr_code: crypto.randomUUID(),
      status: "confirmed",
      payment_method: "online",
    }));

    const { data: createdTickets, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .insert(ticketRows)
      .select("id, qr_code, price, total_price, seat_id, tier_id");

    if (ticketError) {
      console.error("Error creating tickets:", ticketError);
      return new Response(
        JSON.stringify({ error: "Failed to create tickets: " + ticketError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fire-and-forget Mailchimp sync — guest gets tagged as ticket-buyer and
    // added to the Films/Events/Performances interest group. Never blocks
    // ticket creation.
    if (guest_email) {
      try {
        const displayName = String(guest_name || "").trim();
        const [first, ...rest] = displayName.split(/\s+/);
        const anonUrl = `${SUPABASE_URL}/functions/v1/mailchimp-subscribe`;
        // Fetch showing/production type + title for the e-commerce line
        const { data: showRow } = await supabaseAdmin
          .from("showings")
          .select("id, movie:movies(title), event:events(title), performance:live_performances(title), movie_id, event_id, live_performance_id")
          .eq("id", showing_id).maybeSingle();
        const category = showRow?.movie_id ? "Films"
          : showRow?.event_id ? "Special Events"
          : showRow?.live_performance_id ? "Live Performances" : "Films";
        const title = (showRow?.movie as any)?.title || (showRow?.event as any)?.title || (showRow?.performance as any)?.title || "Kenworthy showing";

        // 1) subscribe/tag (anonymous — server forces double opt-in)
        void fetch(anonUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": Deno.env.get("SUPABASE_ANON_KEY")! },
          body: JSON.stringify({
            email: guest_email,
            first_name: first ?? "",
            last_name: rest.join(" "),
            tags: ["ticket-buyer"],
            source: "guest-checkout",
          }),
        }).catch(() => {});

        // 2) e-commerce order
        const total = createdTickets.reduce((s: number, t: any) => s + Number(t.total_price || 0), 0);
        void fetch(`${SUPABASE_URL}/functions/v1/mailchimp-ecommerce`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
            "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            email: guest_email,
            first_name: first ?? "",
            last_name: rest.join(" "),
            order: {
              id: `tickets:${createdTickets[0].id}`,
              total,
              lines: createdTickets.map((t: any) => ({
                id: t.id,
                product_id: showing_id,
                product_title: title,
                quantity: 1,
                price: Number(t.total_price || 0),
                category,
              })),
            },
          }),
        }).catch(() => {});
      } catch (e) {
        console.warn("[guest-checkout] mailchimp sync threw", e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        tickets: createdTickets,
        message: `${createdTickets.length} ticket(s) purchased successfully`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Guest checkout error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
