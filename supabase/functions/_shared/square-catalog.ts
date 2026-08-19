// Naming, classification and diffing for Square catalog work.
//
// Everything here is PURE — no network, no Deno globals — so the conventions in
// docs/SQUARE-TRANSACTION-CONVENTIONS.md can be tested directly. Those
// conventions were measured from 1,584 live variations; this file is the single
// place that encodes them, so a drift in the grammar is one edit, not a grep.

/**
 * The venue's timezone. Must equal tickets.ts's VENUE_TIME_ZONE and
 * square-event-write's VENUE_TZ. Redeclared rather than imported because
 * tickets.ts pulls in PNG/QR dependencies this module has no use for.
 */
export const VENUE_TZ = "America/Los_Angeles";

/**
 * The separator between tier and showtime.
 *
 * Historically "~" (540 variations), more recently "-" (276 vs 264 among dated
 * entries). Decision: WRITE "-", MATCH BOTH. The legacy form stays readable
 * forever, so `parseVariationName` accepts either.
 */
export const SEPARATOR = "-";

/**
 * The numbered category taxonomy. The leading digit orders Square's reports, so
 * these strings are exact — "6 METLive Tickets" has no space in "METLive".
 */
export const CATEGORY = {
  film: "6 Film Tickets",
  metLive: "6 METLive Tickets",
  liveEvent: "6 Live Event Tickets",
  ntLive: "6 NT Live Tickets",
  rental: "6 Rental Tickets",
  filmPass: "9 Film Passes",
  redeem: "6 Redeem",
} as const;

export type CategoryName = typeof CATEGORY[keyof typeof CATEGORY];

/** What kind of production a showing hangs off. */
export type ProductionKind = "movie" | "event" | "live_performance";

/**
 * Which category a production's Square item belongs in.
 *
 * MET and NT Live are not a field in our schema — they are `movies` rows whose
 * TITLE carries the strand prefix, which is also how Square names them. So the
 * classification is by anchored title prefix, deliberately reusing the regexes
 * already proven in square-catalog-sync's `desiredCategory`.
 *
 * Anchored, never substring. Substring matching is what filed
 * GUILLERMO DEL TORO'S PINOCCHIO under merch for containing "pin"
 * (docs/INCIDENT-2026-08-14-square-catalog.md).
 */
export function categoryForProduction(kind: ProductionKind, title: string): CategoryName {
  const t = (title ?? "").trim();
  if (kind === "movie") {
    if (/^met live in hd:/i.test(t) || /^artist talk with met/i.test(t)) return CATEGORY.metLive;
    if (/^national theatre live:/i.test(t) || /^nt live:/i.test(t)) return CATEGORY.ntLive;
    return CATEGORY.film;
  }
  // Events and live performances both sell as live-event admissions. Rentals do
  // not reach here — they bill through square-invoice, not a showing.
  return CATEGORY.liveEvent;
}

/**
 * Collapse the tier vocabulary to the canonical set.
 *
 * The live catalog holds near-duplicates that mean the same thing: `GA` (12) and
 * `General Admission` (25); `Student` (54), `Students` and `Student/Senior`.
 * Generating variations programmatically from free-typed tier names would mint a
 * second variation for every spelling, so names are canonicalised once, here.
 *
 * The canonical forms are the most frequent spelling actually in use, so new
 * variations match the existing ones rather than starting a third dialect.
 * An unrecognised tier is title-cased and passed through — the vocabulary is not
 * a whitelist, and refusing to sell a ticket over a tier spelling would be worse
 * than an extra variation.
 */
export function canonicalTier(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "";

  const key = t.toLowerCase().replace(/[.\s]+$/, "");
  const table: Record<string, string> = {
    "ga": "General Admission",
    "g.a.": "General Admission",
    "general admission": "General Admission",
    "general": "General Admission",
    "adult": "Adult",
    "adults": "Adult",
    "child": "Child",
    "children": "Child",
    "kid": "Child",
    "kids": "Child",
    "student": "Student",
    "students": "Student",
    "student/senior": "Student/Senior",
    "student / senior": "Student/Senior",
    "student/seniors": "Student/Senior",
    "senior": "Senior",
    "seniors": "Senior",
    "student/child": "Student/Child",
    "preferred seating": "Preferred Seating",
    "preferred": "Preferred Seating",
    "vip": "VIP",
    "member": "Member",
    "members": "Member",
  };
  if (table[key]) return table[key];

  // Unknown tier: title-case words, but leave all-caps acronyms (VIP) alone.
  return t
    .split(" ")
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * Format a showtime the way the catalog spells it: "Friday, September 16 at 7 PM".
 *
 * Rules read off the live data:
 *   - weekday, then month name, then day-of-month with no leading zero;
 *   - " at " before the time;
 *   - the minutes are DROPPED on the hour ("7 PM", not "7:00 PM");
 *   - meridiem uppercase with a single leading space.
 *
 * Formatted in the venue's timezone, never the server's — an edge function runs
 * in UTC, where a 7 PM Pacific showing is the NEXT DAY at 02:00 and would be
 * named for the wrong date.
 */
export function formatShowtime(startTime: string | Date, timeZone: string = VENUE_TZ): string {
  const d = startTime instanceof Date ? startTime : new Date(startTime);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid showtime: ${String(startTime)}`);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const minute = get("minute");
  const time = minute === "00" ? get("hour") : `${get("hour")}:${minute}`;

  return `${get("weekday")}, ${get("month")} ${get("day")} at ${time} ${get("dayPeriod").toUpperCase()}`;
}

/**
 * The full variation name.
 *
 * Tiered:   "Adult - Friday, September 16 at 7 PM"
 * Untiered: "Friday, September 16 at 7 PM"
 *
 * An empty tier means the showing has a single price, which the catalog spells
 * as the bare showtime — 712 of the dated variations are that shape.
 */
export function variationName(
  tier: string | null | undefined,
  startTime: string | Date,
  timeZone: string = VENUE_TZ,
): string {
  const showtime = formatShowtime(startTime, timeZone);
  const t = canonicalTier(tier);
  return t ? `${t} ${SEPARATOR} ${showtime}` : showtime;
}

/**
 * Split a variation name back into tier and showtime.
 *
 * Accepts BOTH separators, because the catalog contains both and a "~" entry is
 * the same variation as its "-" twin — treating them as different is how a
 * duplicate gets minted. Returns a null tier for the bare showtime form.
 *
 * Only splits on a separator surrounded by spaces: "Student/Senior" and
 * hyphenated titles must not be torn apart at their own punctuation.
 */
export function parseVariationName(
  name: string,
): { tier: string | null; showtime: string } {
  const m = /^(.*?)\s+[-~]\s+(.*)$/.exec((name ?? "").trim());
  if (!m) return { tier: null, showtime: (name ?? "").trim() };
  return { tier: canonicalTier(m[1]), showtime: m[2].trim() };
}

/**
 * True when two variation names denote the same tier and showtime, ignoring
 * which separator was used and how the tier was spelled.
 */
export function sameVariation(a: string, b: string): boolean {
  const pa = parseVariationName(a);
  const pb = parseVariationName(b);
  return pa.tier === pb.tier && pa.showtime.toLowerCase() === pb.showtime.toLowerCase();
}

/**
 * Every dotted path whose leaf value differs between two objects.
 *
 * Lifted verbatim from square-event-write, which is the proven implementation —
 * it is the pre-send assertion that stops an upsert from carrying a change we
 * did not intend, which is the whole Aug 14 failure mode. Shared so the variation
 * writer and the event writer cannot drift apart on what counts as a change.
 *
 * Arrays are walked element by element rather than compared whole. Treating a
 * variations array as one opaque leaf reports the useless path
 * "item_data.variations" whenever any nested field moves — including the version
 * bump every successful upsert causes — which would either cry wolf on every item
 * or, if suppressed wholesale, hide a real change to a price.
 */
export function diffPaths(a: any, b: any, prefix = "", out: string[] = []): string[] {
  const isObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${prefix}.length`);
      return out;
    }
    for (let i = 0; i < a.length; i++) diffPaths(a[i], b[i], `${prefix}[${i}]`, out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(prefix || "(root)");
  return out;
}

/** Paths that move on every successful upsert and mean nothing. */
export function isNoisyPath(p: string): boolean {
  const leaf = p.split(".").pop();
  return leaf === "version" || leaf === "updated_at";
}

/**
 * Normalise a title for matching a production against a Square item name.
 *
 * Case, punctuation and article noise only. Deliberately conservative: this
 * decides whether we append a variation to an EXISTING live catalog item, so a
 * loose match writes to the wrong film. Anything short of an exact normalised
 * hit is reported for a human instead.
 */
export function normalizeTitle(title: string): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an)\s+/, "");
}

export type Desired = {
  showing_id: string;
  start_time: string;
  production_kind: ProductionKind;
  production_id: string;
  production_title: string;
  category: string;
  tier_name: string;        // '' for a single-price showing
  price_cents: number;
  variation_name: string;
};

/**
 * What each sellable (showing, tier) should be called and cost.
 *
 * Mirrors `_shared/pricing.ts`: a showing's tiers come from
 * showing_price_tiers, and a showing with no active tier sells at
 * showings.ticket_price under the bare showtime grammar.
 *
 * The price here is the TICKET price, pre-tax. Tax lives on the Square item and
 * Square applies it to a line item that references the item.
 */
export function desiredVariations(
  showings: any[],
  tiersByShowing: Map<string, any[]>,
  productions: Map<string, { kind: ProductionKind; id: string; title: string }>,
  timeZone: string = VENUE_TZ,
): { desired: Desired[]; skipped: any[] } {
  const desired: Desired[] = [];
  const skipped: any[] = [];

  for (const s of showings) {
    const prod = productions.get(s.id);
    if (!prod) {
      skipped.push({ showing_id: s.id, reason: "showing has no production row" });
      continue;
    }
    const category = categoryForProduction(prod.kind, prod.title);
    const tiers = (tiersByShowing.get(s.id) ?? []).filter((t) => t.is_active !== false);

    const rows: Array<{ tier: string; price: number }> = tiers.length
      ? tiers.map((t) => ({ tier: canonicalTier(t.tier_name), price: Number(t.price) }))
      : [{ tier: "", price: Number(s.ticket_price) }];

    for (const r of rows) {
      if (!Number.isFinite(r.price) || r.price < 0) {
        skipped.push({ showing_id: s.id, tier: r.tier, reason: "no valid price" });
        continue;
      }
      // Two tiers that canonicalise to the same name are ONE variation. Without
      // this, "Student" and "Students" on the same showing would both try to
      // claim the same (showing_id, tier_name) row and the second would fail the
      // unique constraint mid-run.
      if (desired.some((d) => d.showing_id === s.id && d.tier_name === r.tier)) {
        skipped.push({
          showing_id: s.id,
          tier: r.tier,
          reason: "duplicate tier after canonicalisation",
        });
        continue;
      }
      desired.push({
        showing_id: s.id,
        start_time: s.start_time,
        production_kind: prod.kind,
        production_id: prod.id,
        production_title: prod.title,
        category,
        tier_name: r.tier,
        price_cents: Math.round(r.price * 100),
        variation_name: variationName(r.tier, s.start_time, timeZone),
      });
    }
  }
  return { desired, skipped };
}

// --- catalog integrity ------------------------------------------------------
//
// Square's UpsertCatalogObject replaces the whole object, and a dashboard
// Library CSV has no columns for per-showtime variations or item_data.event. So
// a CSV round-trip strips both, silently, on every item it touches. Nothing in
// this repo does that import; what this code can do is make the loss VISIBLE,
// which is the part that has failed twice — the Aug 14 overwrite was found by
// noticing a timestamp pattern, and the Aug 17 bleed by running a probe on a
// hunch.

/** The shape of one catalog item, reduced to the fields a CSV round-trip eats. */
export interface ItemSummary {
  square_item_id: string;
  name: string | null;
  product_type: string | null;
  category_id: string | null;
  is_archived: boolean;
  has_event_block: boolean;
  event_start_at: string | null;
  variations: Array<{ id: string; name: string | null; price_cents: number | null }>;
  variation_count: number;
  item_version: number | null;
  item_updated_at: string | null;
}

/** Reduce a live Square catalog object to its baseline summary. */
export function summarizeItem(o: any): ItemSummary {
  const d = o?.item_data ?? {};
  const variations = (d.variations ?? []).map((v: any) => ({
    id: v?.id ?? "",
    name: v?.item_variation_data?.name ?? null,
    price_cents: v?.item_variation_data?.price_money?.amount ?? null,
  }));
  return {
    square_item_id: o?.id,
    name: d.name ?? null,
    product_type: d.product_type ?? null,
    // Both shapes, because which one Square populates varies by API version.
    category_id: d.category_id ?? d.categories?.[0]?.id ?? d.reporting_category?.id ?? null,
    is_archived: !!d.is_archived,
    has_event_block: !!d.event,
    event_start_at: d.event?.start_at ?? null,
    variations,
    variation_count: variations.length,
    item_version: o?.version ?? null,
    item_updated_at: o?.updated_at ?? null,
  };
}

export type FindingKind =
  | "lost_event_block"
  | "lost_variations"
  | "lost_category"
  | "flattened_to_regular"
  | "vanished";

export interface Finding {
  square_item_id: string;
  name: string | null;
  kind: FindingKind;
  detail: string;
  /** Baseline capture time — the instant to read back from in version history. */
  known_good_at: string;
  lost_variation_ids?: string[];
}

/**
 * What a catalog item lost since its baseline.
 *
 * Only ever reports LOSS. A catalog legitimately grows — new variations, new
 * items, a renamed film — and reporting growth as damage would bury the signal
 * that matters under normal editing. The Aug 14 and Aug 17 damage were both
 * subtractions.
 *
 * `live` is null when the item is gone from the catalog walk entirely.
 */
export function compareToBaseline(
  baseline: ItemSummary & { captured_at: string },
  live: ItemSummary | null,
): Finding[] {
  const out: Finding[] = [];
  const at = baseline.captured_at;
  const base = { square_item_id: baseline.square_item_id, name: baseline.name, known_good_at: at };

  if (!live) {
    out.push({ ...base, kind: "vanished", detail: "item is absent from the catalog walk" });
    return out;
  }

  if (baseline.has_event_block && !live.has_event_block) {
    out.push({
      ...base,
      kind: "lost_event_block",
      detail: `venue/date block gone${baseline.event_start_at ? ` (was ${baseline.event_start_at})` : ""}`,
    });
  }

  // Variations are matched BY ID. A CSV round-trip that drops rows deletes those
  // objects outright, so a missing id is a real deletion — not a rename, which
  // keeps the id.
  const liveIds = new Set(live.variations.map((v) => v.id));
  const lost = baseline.variations.filter((v) => v.id && !liveIds.has(v.id));
  if (lost.length) {
    out.push({
      ...base,
      kind: "lost_variations",
      detail: `${lost.length} of ${baseline.variation_count} variations deleted: ` +
              lost.map((v) => v.name ?? v.id).slice(0, 6).join(", "),
      lost_variation_ids: lost.map((v) => v.id),
    });
  }

  if (baseline.category_id && !live.category_id) {
    out.push({
      ...base,
      kind: "lost_category",
      detail: `category ${baseline.category_id} cleared`,
    });
  }

  // The Aug 14 signature specifically: many variations collapsed to a single one
  // renamed "Regular". Worth calling out separately from a plain deletion,
  // because it identifies the MECHANISM (an item rebuilt from four columns)
  // rather than just the effect.
  if (
    baseline.variation_count > 1 &&
    live.variation_count === 1 &&
    /^regular$/i.test(live.variations[0]?.name ?? "")
  ) {
    out.push({
      ...base,
      kind: "flattened_to_regular",
      detail: `${baseline.variation_count} variations replaced by a single "Regular" — ` +
              `the signature of an item rebuilt from our own columns`,
    });
  }

  return out;
}


/**
 * Titles that MIGHT be the same film, for a human to confirm.
 *
 * Strictly a suggestion. `normalizeTitle` demands exact equality on purpose —
 * appending a showtime to the wrong film is worse than appending to none — so
 * this never links anything. It exists because the opposite mistake turned out
 * to be just as expensive: a plan run against the real catalog reported ten
 * productions as needing a new Square item, and five of them were already there
 * under a bare title. "Moscow Film Society: Event Horizon" is EVENT HORIZON;
 * "Page to Screen: Divergent" is DIVERGENT. Somebody working that list would
 * have created five duplicates, splitting each film's revenue across two items.
 *
 * Two cheap relationships catch those, and neither is trusted enough to act on:
 *
 *   - our title is "<Series>: <Film>" and the catalog holds <Film>;
 *   - one normalised title contains the other as a whole-word run, which catches
 *     "Charlie Chaplin Shorts" against "CHAPLIN SHORTS".
 *
 * Ranked shortest-first so the tightest match reads first, and capped, because a
 * list of twenty maybes is no more useful than none.
 */
export function suggestTitleMatches(
  title: string,
  candidates: Array<{ id: string; name: string }>,
  limit = 3,
): Array<{ id: string; name: string; why: string }> {
  const ours = normalizeTitle(title);
  if (!ours) return [];

  // "Summer Family Matinee: Peter Rabbit" -> "peter rabbit"
  const afterColon = title.includes(":") ? normalizeTitle(title.slice(title.indexOf(":") + 1)) : "";

  const words = (s: string) => ` ${s} `;
  const out: Array<{ id: string; name: string; why: string; rank: number }> = [];

  for (const c of candidates) {
    const theirs = normalizeTitle(c.name ?? "");
    if (!theirs || theirs === ours) continue;   // exact matches are not suggestions

    if (afterColon && theirs === afterColon) {
      out.push({ id: c.id, name: c.name, why: "same title without the series prefix", rank: 0 });
      continue;
    }
    if (words(ours).includes(words(theirs))) {
      out.push({ id: c.id, name: c.name, why: "catalog title appears inside ours", rank: theirs.length });
      continue;
    }
    if (words(theirs).includes(words(ours))) {
      out.push({ id: c.id, name: c.name, why: "our title appears inside the catalog's", rank: ours.length });
      continue;
    }

    // Every word of one title present in the other, in any order. Catches
    // "Silent Film Festival: Charlie Chaplin Shorts" against
    // "Silent Film Festival: CHAPLIN SHORTS", where the shared run is broken by
    // a word in the middle so neither contains the other.
    //
    // Two words minimum: a single shared word would offer DUNE for every film
    // with "dune" in it, and a suggestion list nobody trusts is one nobody reads.
    const a = new Set(ours.split(" ").filter(Boolean));
    const b = new Set(theirs.split(" ").filter(Boolean));
    const smaller = a.size <= b.size ? a : b;
    const larger = a.size <= b.size ? b : a;
    if (smaller.size >= 2 && [...smaller].every((w) => larger.has(w))) {
      out.push({
        id: c.id,
        name: c.name,
        why: "same words in a different order or spelling",
        rank: 100 + (larger.size - smaller.size),
      });
    }
  }

  return out
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ id, name, why }) => ({ id, name, why }));
}
