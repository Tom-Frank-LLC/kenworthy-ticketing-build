/**
 * The public reads the Worker makes, over the same anon REST API the browser
 * uses. RLS applies exactly as it does to a patron's tab: an inactive showing
 * is not visible here either, so a crawler cannot be told about a page the
 * app would refuse to show.
 *
 * Each read is cached at the edge for a minute (`caches.default`), keyed on
 * the REST URL. A share preview or a crawler burst on one showing then costs
 * one Supabase round trip rather than one per fetch. Sixty seconds is short
 * enough that an admin's edit reaches the card before anyone notices.
 */

/**
 * `Env` is the global interface `wrangler types` writes to
 * worker-configuration.d.ts from wrangler.jsonc — never hand-written here.
 */

interface ProductionRow {
  title: string;
  description: string | null;
  poster_url: string | null;
}

export interface ShowingRow {
  id: string;
  start_time: string;
  duration_minutes: number | null;
  ticket_price: number | string;
  manually_sold_out: boolean;
  no_ticket_required: boolean;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  movies: (ProductionRow & { duration_minutes: number | null }) | null;
  events: ProductionRow | null;
  live_performances: ProductionRow | null;
  venues: { name: string } | null;
  showing_price_tiers: Array<{ price: number | string; is_active: boolean }> | null;
}

export interface PassRow {
  id: string;
  name: string;
  price: number | string;
  initial_balance: number | string;
  redemption_price: number | string;
  ticket_face_value: number | string | null;
  image_path: string | null;
  fine_print: string | null;
  updated_at: string | null;
}

const SHOWING_SELECT =
  'id,start_time,duration_minutes,ticket_price,manually_sold_out,no_ticket_required,is_active,created_at,updated_at,' +
  'movies(title,description,poster_url,duration_minutes),events(title,description,poster_url),' +
  'live_performances(title,description,poster_url),venues(name),showing_price_tiers(price,is_active)';

const PASS_SELECT = 'id,name,price,initial_balance,redemption_price,ticket_face_value,image_path,fine_print,updated_at';

const CACHE_SECONDS = 60;

async function restGet<T>(env: Env, path: string, ttl = CACHE_SECONDS): Promise<T | null> {
  const url = `${env.SUPABASE_URL}/rest/v1/${path}`;
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return (await hit.json()) as T;

  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    console.log(JSON.stringify({ level: 'warn', msg: 'supabase read failed', path, status: res.status }));
    return null;
  }
  const body = await res.text();
  // The cache's own copy: a fresh Response with an explicit TTL, since
  // PostgREST sends none of its own.
  await cache.put(
    cacheKey,
    new Response(body, {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` },
    }),
  );
  return JSON.parse(body) as T;
}

export async function fetchShowing(env: Env, id: string): Promise<ShowingRow | null> {
  const rows = await restGet<ShowingRow[]>(env, `showings?select=${SHOWING_SELECT}&id=eq.${id}&limit=1`);
  return rows?.[0] ?? null;
}

export async function fetchPass(env: Env, id: string): Promise<PassRow | null> {
  const rows = await restGet<PassRow[]>(env, `film_pass_types?select=${PASS_SELECT}&id=eq.${id}&is_active=eq.true&limit=1`);
  return rows?.[0] ?? null;
}

export interface SitemapRows {
  showings: Array<{ id: string; updated_at: string | null }>;
  passes: Array<{ id: string; updated_at: string | null }>;
}

/**
 * Everything the sitemap lists. Upcoming and recent showings only: a page for
 * a screening months gone is still served, but pointing crawlers at hundreds
 * of them buries the ones that sell tickets. Thirty days back keeps last
 * week's pages fresh in the index while their share links are still being
 * clicked.
 */
export async function fetchSitemapRows(env: Env, now: number = Date.now()): Promise<SitemapRows> {
  const since = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [showings, passes] = await Promise.all([
    restGet<SitemapRows['showings']>(
      env,
      `showings?select=id,updated_at&is_active=eq.true&start_time=gte.${encodeURIComponent(since)}&order=start_time.asc&limit=1000`,
      600,
    ),
    restGet<SitemapRows['passes']>(env, 'film_pass_types?select=id,updated_at&is_active=eq.true&order=name.asc', 600),
  ]);
  return { showings: showings ?? [], passes: passes ?? [] };
}

/** Same render endpoint `src/lib/passImage.ts` uses, at share-card width. */
export function passImageUrl(env: Env, path: string, width = 1200): string {
  return `${env.SUPABASE_URL}/storage/v1/render/image/public/pass-images/${path}?width=${width}&resize=contain&quality=70`;
}
