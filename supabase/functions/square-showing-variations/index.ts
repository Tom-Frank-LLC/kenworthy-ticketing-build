// Give every sellable showing a Square catalog variation to point at.
//
// This is the PREREQUISITE half of docs/briefs/BRIEF-square-line-items. Checkout
// cannot send a `catalog_object_id` because no showing has ever had one. This
// function works out which variation each (showing, tier) needs, and — only when
// deliberately confirmed — appends it to the film's existing Square EVENT item.
//
// It does NOT touch checkout, and it does not sell anything.
//
// DRY RUN BY DEFAULT. `plan` is read-only and is the default action. `apply`
// additionally requires dry_run:false AND confirm:"WRITE", and is capped.
//
// The three defences are inherited from square-event-write, which is the proven
// implementation (see docs/INCIDENT-2026-08-14-square-catalog.md — 906 live items
// were destroyed by an upsert built from our own columns):
//
//   1. Read-modify-write. The object sent is the object Square just returned,
//      with exactly one variation APPENDED. Never reconstructed.
//   2. A diff assertion BEFORE sending: the only permitted change is the
//      variations array growing by one. Anything else refuses the item.
//   3. A read-back AFTER sending. A 2xx is not evidence — `item_data.categories`
//      is accepted and silently ignored at this API version, and a whole repair
//      run once reported success having changed nothing.
//
// What it will NOT do:
//   - Create a Square ITEM. Connect V2 only permits creating REGULAR and
//     APPOINTMENTS_SERVICE items, and product_type is immutable, so a created
//     item could never become an EVENT and could never hold a venue or date.
//     Productions with no item are reported as a dashboard work list instead.
//   - Touch an item whose product_type is not EVENT.
//   - Edit or remove an existing variation. It only ever appends.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadSquareConfig,
  SQUARE_API_VERSION,
  squareErrorMessage,
  squareFetch,
  type SquareConfig,
} from "../_shared/square.ts";
import {
  CATEGORY,
  diffPaths,
  isNoisyPath,
  normalizeTitle,
  storedCategoryId,
  sameVariation,
  suggestTitleMatches,
  desiredVariations,
  type ProductionKind,
  type Desired,
  parseKindFilter,
} from "../_shared/square-catalog.ts";

declare const Deno: any;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function sq(
  config: SquareConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  const { ok, status, data } = await squareFetch(config, path, init);
  if (!ok) {
    const err: any = new Error(
      `Square ${status}: ${squareErrorMessage(data, `${init.method ?? "GET"} ${path} failed`)}`,
    );
    err.status = status;
    throw err;
  }
  return data ?? {};
}

/** Every ITEM in the catalog, following the cursor. Includes archived items. */
/** Every CATEGORY object, so an item's category id can be given a name. */
async function listCategories(config: SquareConfig) {
  let cursor: string | undefined = undefined;
  const out: any[] = [];
  do {
    const q = new URLSearchParams({ types: "CATEGORY" });
    if (cursor) q.set("cursor", cursor);
    const res: any = await sq(config, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) if (o.type === "CATEGORY") out.push(o);
    cursor = res.cursor;
  } while (cursor);
  return out;
}

async function listItems(config: SquareConfig) {
  let cursor: string | undefined = undefined;
  const items: any[] = [];
  do {
    const q = new URLSearchParams({ types: "ITEM" });
    if (cursor) q.set("cursor", cursor);
    const res: any = await sq(config, `/catalog/list?${q}`);
    for (const o of res.objects ?? []) if (o.type === "ITEM") items.push(o);
    cursor = res.cursor;
  } while (cursor);
  return items;
}

/** Read every row of a table, past PostgREST's silent 1,000-row ceiling. */
async function allRows(query: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);
  const { data: userRes } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  const user = userRes?.user;
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  const loaded = loadSquareConfig();
  if (!loaded.ok) return json({ error: loaded.error }, 500);
  const config = loaded.config;

  let payload: any = {};
  try { payload = await req.json(); } catch { /* none */ }

  const action: string = payload.action ?? "plan";
  if (!["plan", "apply", "ensure_showing", "map_donation", "link_item", "plan_film_passes", "link_pass_type", "create_pass_item"].includes(action)) {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  // One showing, published from the admin form. It is an apply in every respect
  // except that the deliberate-confirmation ritual would be absurd on a form
  // save: the scope is a single showing the user just created, the writes are
  // append-only, and every defence below still applies. The cap is what keeps it
  // bounded — a showing has a handful of tiers, never dozens.
  const scopedShowingId = String(payload.showing_id ?? "").trim();
  const isEnsure = action === "ensure_showing";
  if (isEnsure && !scopedShowingId) {
    return json({ error: "ensure_showing needs a showing_id" }, 400);
  }

  /*
   * Restrict a write to certain production kinds.
   *
   * The Listings tab shows this work as a section of Movies and a section of
   * Live Events, so "Create all 3" under the movie list has to mean three
   * movies. Without this the button wrote the whole plan — every kind — while
   * sitting under a filtered list, which is a control that understates what it
   * writes to Square. That is the shape of the 14 Aug damage and not something
   * to leave to a label.
   *
   * Fails closed. `kinds: ["mvoie"]` is a typo, not a request to write
   * everything, so an unrecognised value is a 400 rather than a silent widening
   * to global scope. Omitting the key entirely still means "no restriction",
   * which is what the unscoped screen and `ensure_showing` rely on.
   */
  const kindFilter = parseKindFilter(payload.kinds);
  if ("error" in kindFilter) return json({ error: kindFilter.error }, 400);
  const kinds = kindFilter.kinds;

  const dryRun = isEnsure ? false : payload.dry_run !== false;
  const maxBatch = isEnsure ? Number(payload.max_batch ?? 8) : Number(payload.max_batch ?? 1);
  if (action === "apply" && !dryRun && payload.confirm !== "WRITE") {
    return json({ error: 'a real write requires confirm:"WRITE"' }, 400);
  }

  // ---- film pass types ------------------------------------------------------
  //
  // Simpler than a showing: a pass is one REGULAR item filed under
  // '9 Film Passes' with no showtime dimension, so the mapping is one-to-one and
  // there is nothing to append. It either exists in the catalog or somebody
  // makes it.
  //
  // Linked by VARIATION id rather than item id, because that is what a checkout
  // line item actually sends. An item with several variations — a 5-admission
  // and a 10-admission pass on one item — would otherwise leave the choice
  // ambiguous at exactly the wrong moment.
  if (action === "plan_film_passes") {
    try {
      const { data: types } = await admin
        .from("film_pass_types")
        .select("id, name, price, is_active, square_item_id, square_variation_id")
        .eq("is_active", true)
        .order("price");

      const items = await listItems(config);

      // Widen the search by changing its axis. Matching on the name alone missed
      // the standard film pass entirely: ours is called "10-film pass" and
      // Square's is not, and no amount of fuzzier string comparison makes that
      // reliable — it either stays too strict to help or gets loose enough to
      // propose the wrong item confidently.
      //
      // A pass's category is the better key. The taxonomy already puts every
      // pass under "9 Film Passes", and that is a handful of items out of ~890,
      // so scoping to it is simultaneously wider than an exact name (it finds a
      // pass whatever it is called) and far narrower than the catalog (nothing
      // else can appear). Clutter comes from searching the whole catalog, not
      // from searching the right corner of it.
      const categories = await listCategories(config);
      const passCategoryId = categories.find((c: any) =>
        normalizeTitle(c.category_data?.name ?? "") === normalizeTitle(CATEGORY.filmPass)
      )?.id ?? null;

      const inPassCategory = passCategoryId
        ? items.filter((i: any) =>
            storedCategoryId(i.item_data) === passCategoryId &&
            i.item_data?.product_type !== "EVENT"
          )
        : [];

      const byVariation = new Map<string, { item: any; variation: any }>();
      for (const i of items) {
        for (const v of i.item_data?.variations ?? []) byVariation.set(v.id, { item: i, variation: v });
      }
      // Passes are REGULAR items; an EVENT item is a screening and never a pass.
      const candidates = items
        .filter((i) => i.item_data?.product_type !== "EVENT")
        .map((i) => ({ id: i.id, name: i.item_data?.name ?? "" }));

      const rows = (types ?? []).map((t: any) => {
        const linked = t.square_variation_id ? byVariation.get(t.square_variation_id) : null;

        // EVERY item with this name, not the first one found. The catalog holds
        // three separate items called SILENT FILM FESTIVAL PASS, and taking the
        // first meant the other two never reached the screen — so the human
        // "choosing" was choosing from a list already narrowed for them, by
        // nothing more principled than catalog order.
        const exactAll = items.filter((i) =>
          normalizeTitle(i.item_data?.name ?? "") === normalizeTitle(t.name) &&
          i.item_data?.product_type !== "EVENT"
        );
        const sources = linked?.item ? [linked.item] : exactAll;

        // Flattened across every matching item, each variation carrying the item
        // it belongs to and whether that item is archived. Two SKUs of the same
        // name at the same price are otherwise indistinguishable on screen, and
        // linking to the archived one loses the sale in Square's reporting.
        const variations = sources.flatMap((item: any) =>
          (item.item_data?.variations ?? []).map((v: any) => ({
            id: v.id,
            name: v.item_variation_data?.name ?? null,
            price_cents: v.item_variation_data?.price_money?.amount ?? null,
            item_id: item.id,
            item_name: item.item_data?.name ?? null,
            archived: !!item.is_deleted || !!v.is_deleted,
          }))
        );

        return {
          pass_type_id: t.id,
          name: t.name,
          price_cents: Math.round(Number(t.price) * 100),
          status: linked ? "linked" : exactAll.length ? "match_found" : "needs_item",
          square_variation_id: t.square_variation_id ?? null,
          square_item_name: sources[0]?.item_data?.name ?? null,
          /** Distinct Square items carrying this name. Above 1 means duplicates. */
          matching_items: sources.length,
          variations,
          possible_matches: linked || exactAll.length ? [] : suggestTitleMatches(t.name, candidates),
          // Everything filed as a pass in Square, minus whatever the name
          // already matched. Offered as real choices rather than a list of
          // names to go and look up, because a name the operator has to
          // reconcile by hand is the manual step this was meant to remove.
          category_options: linked ? [] : inPassCategory
            .filter((i: any) => !sources.some((sx: any) => sx.id === i.id))
            .flatMap((i: any) =>
              (i.item_data?.variations ?? []).map((v: any) => ({
                id: v.id,
                name: v.item_variation_data?.name ?? null,
                price_cents: v.item_variation_data?.price_money?.amount ?? null,
                item_id: i.id,
                item_name: i.item_data?.name ?? null,
                archived: !!i.is_deleted || !!v.is_deleted,
              }))
            ),
        };
      });

      return json({
        ok: true, action, environment: config.environment,
        catalog_items: items.length,
        pass_category: passCategoryId ? CATEGORY.filmPass : null,
        pass_category_items: inPassCategory.length,
        counts: rows.reduce((a: any, r: any) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
        pass_types: rows,
        note: "Read-only. Nothing was written to Square.",
      });
    } catch (e: any) {
      return json({ error: e.message ?? String(e) }, 500);
    }
  }

  // Create the Square item a pass has no match for, then link it.
  //
  // The only path here that ADDS an object to the live catalog, so it carries
  // the same ritual as `apply`: dry run by default, confirm:"WRITE" to mean it,
  // and a read-back afterwards because a 2xx is not evidence.
  //
  // It creates and never updates. The August 14 incident was an upsert built
  // from our own columns landing on an existing object and flattening it;
  // nothing here is given an existing id to land on, so the worst case is a
  // surplus item rather than a destroyed one.
  //
  // It also refuses when the catalog already has that name. A pass with no
  // match is the case this exists for; a pass with three matches needs a human
  // to choose, and quietly adding a fourth is how that mess was made.
  if (action === "create_pass_item") {
    const passTypeId = String(payload.pass_type_id ?? "").trim();
    if (!passTypeId) return json({ error: "pass_type_id is required" }, 400);

    const { data: t } = await admin
      .from("film_pass_types")
      .select("id, name, price, square_variation_id")
      .eq("id", passTypeId)
      .maybeSingle();
    if (!t) return json({ error: "No such pass type" }, 404);
    if (t.square_variation_id) {
      return json({ error: "That pass is already linked. Unlink it first." }, 409);
    }

    try {
      const items = await listItems(config);
      const clashes = items.filter((i: any) =>
        normalizeTitle(i.item_data?.name ?? "") === normalizeTitle(t.name) &&
        i.item_data?.product_type !== "EVENT"
      );
      if (clashes.length && payload.force !== true) {
        return json({
          error: `Square already has ${clashes.length} item(s) named "${t.name}". Link one of those instead, or pass force:true to add another.`,
          existing: clashes.map((i: any) => ({ id: i.id, name: i.item_data?.name })),
        }, 409);
      }

      const priceCents = Math.round(Number(t.price) * 100);
      const object = {
        type: "ITEM",
        id: "#pass",
        item_data: {
          name: t.name,
          // REGULAR, never EVENT: an EVENT item is a screening, and a pass has
          // no showtime dimension.
          product_type: "REGULAR",
          variations: [{
            type: "ITEM_VARIATION",
            id: "#pass-variation",
            item_variation_data: {
              item_id: "#pass",
              name: "Regular",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: priceCents, currency: "USD" },
            },
          }],
        },
      };

      const dry = payload.dry_run !== false;
      if (dry || payload.confirm !== "WRITE") {
        return json({
          ok: true, action, dry_run: true, environment: config.environment,
          would_create: { name: t.name, price_cents: priceCents },
          note: dry
            ? 'Read-only. Pass dry_run:false and confirm:"WRITE" to create it.'
            : 'A real write requires confirm:"WRITE". Nothing was created.',
        });
      }

      const res: any = await sq(config, "/catalog/object", {
        method: "POST",
        body: { idempotency_key: crypto.randomUUID(), object },
      });
      const createdId = res?.catalog_object?.id;
      if (!createdId) return json({ error: "Square returned no object" }, 502);

      // A 2xx is not evidence. Read it back and take the variation id from what
      // Square actually stored, not from what we hoped it stored.
      const after: any = await sq(config, `/catalog/object/${createdId}?include_related_objects=false`);
      const created = after?.object;
      const variation = created?.item_data?.variations?.[0];
      if (!variation?.id) {
        return json({
          error: "Created, but the read-back showed no variation. Check Square before retrying.",
          square_item_id: createdId,
        }, 502);
      }

      const { data: saved, error: saveErr } = await admin
        .from("film_pass_types")
        .update({ square_item_id: createdId, square_variation_id: variation.id })
        .eq("id", passTypeId)
        .select("id");
      if (saveErr || !saved?.length) {
        return json({
          error: `Created in Square but could not save the link: ${saveErr?.message ?? "no row updated"}`,
          square_item_id: createdId,
          square_variation_id: variation.id,
        }, 500);
      }

      return json({
        ok: true, action, dry_run: false, environment: config.environment,
        created: {
          square_item_id: createdId,
          square_variation_id: variation.id,
          name: created?.item_data?.name ?? null,
          price_cents: variation.item_variation_data?.price_money?.amount ?? null,
        },
        note: "Created and linked. Check it appears under 9 Film Passes in Square.",
      });
    } catch (e: any) {
      return json({ error: squareErrorMessage(e, e?.message ?? String(e)) }, 500);
    }
  }


  if (action === "link_pass_type") {
    const passTypeId = String(payload.pass_type_id ?? "").trim();
    const variationId = String(payload.square_variation_id ?? "").trim();
    if (!passTypeId || !variationId) {
      return json({ error: "pass_type_id and square_variation_id are both required" }, 400);
    }
    try {
      // Resolve the variation to its parent item and confirm it is real before
      // pointing sales at it. A wrong id here bills film passes against somebody
      // else's product for as long as nobody notices.
      const res = await sq(config, `/catalog/object/${variationId}?include_related_objects=false`);
      const obj = res.object;
      if (!obj || obj.type !== "ITEM_VARIATION") {
        return json({ error: "That id is not a catalog ITEM_VARIATION." }, 400);
      }
      const itemId = obj.item_variation_data?.item_id;
      if (!itemId) return json({ error: "That variation has no parent item." }, 400);

      const { error } = await admin
        .from("film_pass_types")
        .update({ square_item_id: itemId, square_variation_id: variationId })
        .eq("id", passTypeId);
      if (error) return json({ error: `Could not save the link: ${error.message}` }, 500);

      return json({
        ok: true, action, pass_type_id: passTypeId,
        square_item_id: itemId, square_variation_id: variationId,
        variation_name: obj.item_variation_data?.name ?? null,
      });
    } catch (e: any) {
      return json({ error: e.message ?? String(e) }, 500);
    }
  }

  // ---- link_item ----------------------------------------------------------
  //
  // Record that a production IS a particular Square item. The plan suggests
  // candidates and refuses to act on them; this is where a person says yes.
  // Writes one column on our side and nothing at all to Square.
  if (action === "link_item") {
    const kind = String(payload.kind ?? "");
    const productionId = String(payload.production_id ?? "").trim();
    const itemId = String(payload.square_item_id ?? "").trim();
    const table = { movie: "movies", event: "events", live_performance: "live_performances" }[kind];
    if (!table || !productionId || !itemId) {
      return json({ error: 'kind (movie|event|live_performance), production_id and square_item_id are all required' }, 400);
    }

    try {
      // Confirm the item exists and can actually hold showtimes before pointing
      // a production at it. A typo here would send every future variation for
      // that film onto somebody else's item.
      const res = await sq(config, `/catalog/object/${itemId}?include_related_objects=false`);
      const obj = res.object;
      if (!obj || obj.type !== "ITEM") return json({ error: "That id is not a catalog ITEM." }, 400);
      if (obj.item_data?.product_type !== "EVENT") {
        return json({
          error: `That item is ${obj.item_data?.product_type}, not EVENT, so it cannot hold a venue or dates.`,
        }, 400);
      }

      const { error } = await admin.from(table).update({ square_item_id: itemId }).eq("id", productionId);
      if (error) return json({ error: `Could not save the link: ${error.message}` }, 500);

      return json({
        ok: true, action, kind, production_id: productionId,
        square_item_id: itemId, square_item_name: obj.item_data?.name ?? null,
        note: "Linked. Re-run plan to see its showtimes move out of needs_item.",
      });
    } catch (e: any) {
      return json({ error: e.message ?? String(e) }, 500);
    }
  }

  // ---- map_donation -------------------------------------------------------
  //
  // Find the catalog's DONATION item and record which variation to ring each
  // gift against. Read-only against Square; writes one app_config row, and only
  // when asked.
  //
  // Separate from the showings plan because a donation has no showtime and no
  // tier — it is one item with a handful of preset amounts and a variable-priced
  // "Custom Amount". Without this mapping square-donation bills every gift as an
  // ad-hoc line, which works but never rolls up.
  if (action === "map_donation") {
    try {
      const items = await listItems(config);
      const donationItems = items.filter((i) => i.item_data?.product_type === "DONATION");
      if (donationItems.length !== 1) {
        return json({
          ok: false,
          found: donationItems.length,
          names: donationItems.map((i) => i.item_data?.name),
          error: donationItems.length === 0
            ? "No DONATION product-type item in the catalog."
            : "More than one DONATION item; refusing to guess which one gifts belong to.",
        }, 400);
      }

      const item = donationItems[0];
      const byAmount: Record<string, string> = {};
      let custom: string | null = null;
      for (const v of item.item_data?.variations ?? []) {
        const d = v.item_variation_data ?? {};
        if (d.pricing_type === "VARIABLE_PRICING") { custom = v.id; continue; }
        const amount = d.price_money?.amount;
        if (typeof amount === "number") byAmount[String(amount)] = v.id;
      }

      const value = { item_id: item.id, by_amount_cents: byAmount, custom };
      const dry = payload.dry_run !== false;
      if (!dry) {
        const { error } = await admin
          .from("app_config")
          .upsert({ key: "square_donation_variations", value }, { onConflict: "key" });
        if (error) return json({ error: `Could not save the mapping: ${error.message}` }, 500);
      }

      return json({
        ok: true,
        action,
        dry_run: dry,
        item: { id: item.id, name: item.item_data?.name, is_taxable: item.item_data?.is_taxable },
        presets: Object.keys(byAmount).length,
        value,
        note: dry
          ? "Read-only. Pass dry_run:false to save. Nothing was written to Square either way."
          : "Saved to app_config.square_donation_variations.",
      });
    } catch (e: any) {
      return json({ error: e.message ?? String(e) }, 500);
    }
  }

  try {
    // ---- our side ---------------------------------------------------------
    // Only showings that can still be sold. Backfilling variations for a
    // screening in 2019 would append hundreds of dead rows to live items — the
    // accumulation problem the conventions doc flags as open question 3.
    const horizonDays = Number(payload.horizon_days ?? 120);
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    // A named showing bypasses the horizon: the admin just saved it, and where
    // it falls relative to a rolling window is beside the point.
    const showings = await allRows((f, t) => {
      let q = admin
        .from("showings")
        .select("id, start_time, ticket_price, is_active, movie_id, event_id, live_performance_id");
      q = scopedShowingId
        ? q.eq("id", scopedShowingId)
        : q.eq("is_active", true).gte("start_time", from).lte("start_time", to);
      return q.order("start_time").range(f, t);
    });

    if (!showings.length) {
      return json({
        ok: true, action, dry_run: dryRun, environment: config.environment,
        note: `No active showings between ${from} and ${to}.`,
        counts: {},
      });
    }

    const showingIds = showings.map((s) => s.id);
    const tierRows = await allRows((f, t) =>
      admin
        .from("showing_price_tiers")
        .select("showing_id, tier_name, price, is_active")
        .in("showing_id", showingIds)
        .range(f, t)
    );
    const tiersByShowing = new Map<string, any[]>();
    for (const r of tierRows) {
      const list = tiersByShowing.get(r.showing_id) ?? [];
      list.push(r);
      tiersByShowing.set(r.showing_id, list);
    }

    // Production per showing, with its stored Square item id.
    const idsOf = (k: string) =>
      [...new Set(showings.map((s) => s[k]).filter(Boolean))] as string[];
    const [movies, events, performances] = await Promise.all([
      idsOf("movie_id").length
        ? admin.from("movies").select("id, title, square_item_id").in("id", idsOf("movie_id"))
        : Promise.resolve({ data: [] }),
      idsOf("event_id").length
        ? admin.from("events").select("id, title, square_item_id").in("id", idsOf("event_id"))
        : Promise.resolve({ data: [] }),
      idsOf("live_performance_id").length
        ? admin.from("live_performances").select("id, title, square_item_id")
            .in("id", idsOf("live_performance_id"))
        : Promise.resolve({ data: [] }),
    ]);

    const byId = (rows: any[]) => new Map((rows ?? []).map((r: any) => [r.id, r]));
    const movieById = byId(movies.data as any[]);
    const eventById = byId(events.data as any[]);
    const perfById = byId(performances.data as any[]);

    const productions = new Map<string, { kind: ProductionKind; id: string; title: string }>();
    const storedItemId = new Map<string, string | null>();   // production id -> square item id
    for (const s of showings) {
      let p: any = null;
      let kind: ProductionKind = "movie";
      if (s.event_id) { p = eventById.get(s.event_id); kind = "event"; }
      else if (s.live_performance_id) { p = perfById.get(s.live_performance_id); kind = "live_performance"; }
      else if (s.movie_id) { p = movieById.get(s.movie_id); kind = "movie"; }
      if (!p) continue;
      productions.set(s.id, { kind, id: p.id, title: p.title ?? "" });
      storedItemId.set(p.id, p.square_item_id ?? null);
    }

    // The SAME timezone tickets.ts formats receipts in. If these diverge, the
    // emailed ticket and the Square variation name a different showtime for one
    // screening, and only a human comparing the two would ever notice.
    const venueTz = Deno.env.get("VENUE_TIME_ZONE") || "America/Los_Angeles";
    const { desired, skipped } = desiredVariations(
      showings, tiersByShowing, productions, venueTz,
    );

    // Mappings we already hold.
    const mapped = await allRows((f, t) =>
      admin
        .from("showing_square_variations")
        .select("showing_id, tier_name, square_item_id, square_variation_id, variation_name, price_cents, verified_at")
        .in("showing_id", showingIds)
        .range(f, t)
    );
    const mappedKey = (showingId: string, tier: string) => `${showingId}::${tier}`;
    const mapByKey = new Map(mapped.map((m: any) => [mappedKey(m.showing_id, m.tier_name), m]));

    // ---- Square's side ----------------------------------------------------
    const items = await listItems(config);
    const itemById = new Map<string, any>(items.map((i) => [i.id, i]));

    // Title -> items, for productions with no stored id. Many titles repeat
    // across years, so a title that hits more than one item is AMBIGUOUS and is
    // handed to a human rather than guessed at.
    const itemsByTitle = new Map<string, any[]>();
    for (const i of items) {
      const key = normalizeTitle(i.item_data?.name ?? "");
      if (!key) continue;
      const list = itemsByTitle.get(key) ?? [];
      list.push(i);
      itemsByTitle.set(key, list);
    }

    /** Resolve a production to its Square item, preferring a stored id. */
    function resolveItem(productionId: string, title: string) {
      const stored = storedItemId.get(productionId);
      if (stored) {
        const item = itemById.get(stored);
        if (item) return { item, how: "stored_id" as const };
        return { item: null, how: "stored_id_missing" as const };
      }
      const candidates = (itemsByTitle.get(normalizeTitle(title)) ?? [])
        .filter((i) => i.item_data?.product_type === "EVENT");
      if (candidates.length === 1) return { item: candidates[0], how: "title_match" as const };
      if (candidates.length > 1) return { item: null, how: "ambiguous_title" as const };
      return { item: null, how: "no_item" as const };
    }

    // ---- classify ---------------------------------------------------------
    type Plan = Desired & {
      status: string;
      reason?: string;
      square_item_id?: string | null;
      square_variation_id?: string | null;
      resolved_by?: string;
    };
    const plans: Plan[] = [];

    for (const d of desired) {
      const existing = mapByKey.get(mappedKey(d.showing_id, d.tier_name));
      const { item, how } = resolveItem(d.production_id, d.production_title);

      if (!item) {
        plans.push({
          ...d,
          status: how === "ambiguous_title" ? "ambiguous_item"
            : how === "stored_id_missing" ? "stored_item_gone"
            : "needs_item",
          resolved_by: how,
          reason: how === "ambiguous_title"
            ? "more than one EVENT item shares this title — link it by hand"
            : how === "stored_id_missing"
            ? "the stored square_item_id is not in the catalog"
            : "no EVENT item with this title; Connect V2 cannot create one — make it in the dashboard",
        });
        continue;
      }

      if (item.item_data?.product_type !== "EVENT") {
        plans.push({
          ...d, status: "not_event_item", square_item_id: item.id, resolved_by: how,
          reason: `product_type is ${item.item_data?.product_type}; only EVENT items ` +
                  `can hold a venue or a date, and product_type cannot be changed after creation`,
        });
        continue;
      }

      // Does the variation already exist on the item, under either separator or
      // any spelling of the tier?
      const match = (item.item_data?.variations ?? []).find((v: any) =>
        sameVariation(v.item_variation_data?.name ?? "", d.variation_name)
      );

      if (existing && match && existing.square_variation_id === match.id) {
        const priceNow = match.item_variation_data?.price_money?.amount ?? null;
        plans.push({
          ...d,
          status: priceNow === d.price_cents ? "linked" : "price_drift",
          square_item_id: item.id,
          square_variation_id: match.id,
          resolved_by: how,
          reason: priceNow === d.price_cents ? undefined
            : `Square holds ${priceNow}, we price ${d.price_cents}`,
        });
        continue;
      }

      if (match) {
        plans.push({
          ...d, status: "adopt_existing", square_item_id: item.id,
          square_variation_id: match.id, resolved_by: how,
          reason: "the variation already exists in Square; record the mapping, write nothing",
        });
        continue;
      }

      plans.push({
        ...d, status: "would_append", square_item_id: item.id, resolved_by: how,
      });
    }

    const counts: Record<string, number> = {};
    for (const p of plans) counts[p.status] = (counts[p.status] ?? 0) + 1;

    // The human work list: titles somebody must create as an Event item in the
    // Square dashboard before this can finish. One line per production.
    const needsItem = [...new Map(
      plans.filter((p) => p.status === "needs_item" || p.status === "ambiguous_item")
        .map((p) => [p.production_id, {
          production_id: p.production_id,
          kind: p.production_kind,
          title: p.production_title,
          category: p.category,
          showings: 0,
          status: p.status,
        }])
    ).values()];
    const eventItems = items
      .filter((i) => i.item_data?.product_type === "EVENT")
      .map((i) => ({ id: i.id, name: i.item_data?.name ?? "" }));

    for (const n of needsItem) {
      n.showings = new Set(
        plans.filter((p) => p.production_id === n.production_id).map((p) => p.showing_id)
      ).size;
      // Offer, never assume. Five of the ten titles this reported as needing a
      // new item on its first real run already existed in the catalog under a
      // bare title, and creating them would have split each film's revenue
      // across two Square items. These are for a human to confirm with
      // `link_item`; nothing here links anything.
      (n as any).possible_matches = suggestTitleMatches(n.title, eventItems);
    }

    /*
     * One scope, applied before anything is counted or sliced.
     *
     * The read matters as much as the write here. These lists are capped at 50
     * server-side, so filtering client-side would sample a global 50 and then
     * narrow it — a Movies section could show two rows out of forty because the
     * unscoped fifty happened to be mostly live events. Scoping first means the
     * fifty are fifty of *this* kind.
     *
     * Callers that send no `kinds` — the unscoped screen, SquareLinkPanel,
     * ensure_showing — are unaffected: absent means no restriction.
     */
    const inScope = kinds.length
      ? plans.filter((p) => kinds.includes(p.production_kind))
      : plans;

    const base = {
      ok: true,
      action,
      environment: config.environment,
      api_version: SQUARE_API_VERSION,
      window: { from, to, horizon_days: horizonDays },
      showings: showings.length,
      catalog_items: items.length,
      counts,
      skipped,
      needs_dashboard_item: needsItem,
    };

    if (action === "plan") {
      return json({
        ...base,
        dry_run: true,
        adoptable: inScope.filter((p) => p.status === "adopt_existing").slice(0, 50),
        appendable: inScope.filter((p) => p.status === "would_append").slice(0, 50),
        price_drift: inScope.filter((p) => p.status === "price_drift").slice(0, 50),
        note:
          "Read-only. Nothing was written to Square or to the mapping table. " +
          "`adopt_existing` needs no catalog write at all — the variation is " +
          "already there and only the mapping is missing.",
      });
    }

    // ---- apply ------------------------------------------------------------
    // Adoptions first: they are pure database writes, they cannot damage the
    // catalog, and every one of them removes an item from the append list.
    const adoptions = inScope.filter((p) => p.status === "adopt_existing");
    let adopted = 0;
    if (!dryRun && adoptions.length) {
      for (const a of adoptions) {
        const { error } = await admin.from("showing_square_variations").upsert({
          showing_id: a.showing_id,
          tier_name: a.tier_name,
          square_item_id: a.square_item_id,
          square_variation_id: a.square_variation_id,
          variation_name: a.variation_name,
          price_cents: a.price_cents,
          verified_at: new Date().toISOString(),
        }, { onConflict: "showing_id,tier_name" });
        if (!error) adopted++;
      }
    }

    const appendable = inScope.filter((p) => p.status === "would_append");

    // The cap governs WRITES, not the rehearsal.
    //
    // It used to apply in both modes, which made the dry run useless at its own
    // default: max_batch is 1, a real catalog has hundreds of appendable
    // variations, so `{action:"apply"}` answered 400 and showed nothing. The
    // step that exists to be read before writing could not be read.
    // max_batch LIMITS the run; it does not refuse it.
    //
    // It used to reject the whole batch when there were more appends than the
    // cap, which read as prudent and made the intended workflow impossible: the
    // advice is "write one, read it back in the dashboard, then raise the cap",
    // and with five pending you could never write one. The only way through was
    // to set the cap to the full count, which is precisely the deliberate-choice
    // step the cap exists to force.
    //
    // Now it takes the first max_batch and reports what is left, so a cautious
    // run is one call and a bigger one is the same call with a bigger number.
    const queue = dryRun ? appendable.slice(0, 200) : appendable.slice(0, maxBatch);
    const remaining = dryRun ? 0 : Math.max(0, appendable.length - queue.length);

    const results: any[] = [];
    for (const p of queue) {
      const rec: any = {
        showing_id: p.showing_id, tier_name: p.tier_name,
        variation_name: p.variation_name, item_id: p.square_item_id, action: null,
      };
      try {
        // DEFENCE 1 — read, then modify what Square gave us.
        const before = await sq(
          config, `/catalog/object/${p.square_item_id}?include_related_objects=false`,
        );
        const original = before.object;
        if (!original) throw new Error("item not found");
        if (original.item_data?.product_type !== "EVENT") {
          rec.action = "refused";
          rec.reason = `product_type is ${original.item_data?.product_type}`;
          results.push(rec);
          continue;
        }

        // Re-check on the fresh copy: the listing walk may be minutes stale, and
        // appending a duplicate is exactly the accumulation this must not cause.
        const dupe = (original.item_data?.variations ?? []).find((v: any) =>
          sameVariation(v.item_variation_data?.name ?? "", p.variation_name)
        );
        if (dupe) {
          rec.action = "already_present";
          rec.square_variation_id = dupe.id;
          results.push(rec);
          continue;
        }

        const outgoing = JSON.parse(JSON.stringify(original));
        outgoing.item_data ??= {};
        outgoing.item_data.variations = [...(outgoing.item_data.variations ?? [])];
        const tempId = `#showing-${p.showing_id}-${p.tier_name || "base"}`.slice(0, 40);
        outgoing.item_data.variations.push({
          type: "ITEM_VARIATION",
          id: tempId,
          item_variation_data: {
            item_id: original.id,
            name: p.variation_name,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: p.price_cents, currency: "USD" },
          },
        });

        // DEFENCE 2 — the ONLY permitted change is the array growing by one.
        // Category is deliberately not set here: it lives on the ITEM, and a
        // variation appended to a correctly-filed item inherits it. Writing a
        // category from this path would be a second, riskier change per item.
        const changed = diffPaths(original, outgoing).filter((x) => !isNoisyPath(x));
        const stray = changed.filter((x) => x !== "item_data.variations.length");
        rec.changed_paths = changed;
        if (stray.length) {
          rec.action = "refused";
          rec.reason = `would also change: ${stray.join(", ")}`;
          results.push(rec);
          continue;
        }

        if (dryRun) { rec.action = "dry_run"; results.push(rec); continue; }

        await sq(config, "/catalog/object", {
          method: "POST",
          body: { idempotency_key: crypto.randomUUID(), object: outgoing },
        });

        // DEFENCE 3 — a 2xx is not evidence. Ask Square what it holds.
        const after = await sq(
          config, `/catalog/object/${p.square_item_id}?include_related_objects=false`,
        );
        const stored = (after.object?.item_data?.variations ?? []).find((v: any) =>
          sameVariation(v.item_variation_data?.name ?? "", p.variation_name)
        );
        const storedOk = !!stored &&
          stored.item_variation_data?.price_money?.amount === p.price_cents;

        rec.collateral_changes = diffPaths(original, after.object)
          .filter((x) => !isNoisyPath(x))
          .filter((x) => !x.startsWith("item_data.variations"));

        if (!storedOk) {
          rec.action = "accepted_but_not_stored";
          rec.reason = "Square returned 2xx but the variation it holds does not " +
                       "match what was sent. Stop the run.";
          results.push(rec);
          break;
        }

        // Only now — after Square confirmed it — is the mapping recorded.
        const { error: mapErr } = await admin.from("showing_square_variations").upsert({
          showing_id: p.showing_id,
          tier_name: p.tier_name,
          square_item_id: p.square_item_id,
          square_variation_id: stored.id,
          variation_name: p.variation_name,
          price_cents: p.price_cents,
          verified_at: new Date().toISOString(),
        }, { onConflict: "showing_id,tier_name" });

        rec.action = "written";
        rec.square_variation_id = stored.id;
        if (mapErr) {
          rec.action = "written_unmapped";
          rec.reason = `Square holds the variation but the mapping row failed: ${mapErr.message}`;
        }
        results.push(rec);
      } catch (e: any) {
        rec.action = "error";
        rec.reason = e.message ?? String(e);
        results.push(rec);
        // Square locks the catalog during an upsert and answers 429 while it is
        // held. That is a reason to stop and resume, not to hammer it.
        if (e.status === 429) {
          rec.reason += " — catalog locked; stopping this batch, rerun to continue";
          break;
        }
      }
    }

    const tally: Record<string, number> = {};
    for (const r of results) tally[r.action ?? "?"] = (tally[r.action ?? "?"] ?? 0) + 1;

    return json({
      ...base,
      dry_run: dryRun,
      adopted,
      appendable: appendable.length,
      previewed: dryRun ? queue.length : undefined,
      remaining: dryRun ? undefined : remaining,
      note: remaining
        ? `${remaining} append(s) left. Re-run with a larger max_batch once you have checked these in the dashboard.`
        : undefined,
      tally,
      results,
    });
  } catch (e: any) {
    return json({ error: e.message ?? String(e) }, 500);
  }
});
