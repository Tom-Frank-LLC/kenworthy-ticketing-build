/**
 * The canonical public origin of the ticketing site.
 *
 * Used for SEO / Open Graph tags, JSON-LD, and any absolute link the client
 * builds. Driven by `VITE_SITE_URL`, which `vite.config.ts` bakes in at build
 * time (per `--mode`) exactly like the Supabase URL. That makes the eventual
 * cutover to https://kenworthy.org a one-line change in `.env.production` — not
 * another hunt through the source for a hardcoded domain.
 *
 * The fallback is the production Worker, so a build with no `VITE_SITE_URL`
 * still points somewhere live rather than at the retired Lovable preview.
 *
 * Do NOT hardcode the site domain anywhere else. Import `SITE_URL` from here.
 */
export const SITE_URL: string =
  import.meta.env.VITE_SITE_URL ||
  'https://kenworthy-ticketing-build.mrtomfrank.workers.dev';
