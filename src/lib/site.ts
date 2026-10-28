import { Capacitor } from '@capacitor/core';

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

/**
 * The origin to put in a link that leaves this device: one emailed, copied for
 * a renter, or shown as a QR for another screen to open.
 *
 * On the web that is the page's own origin, so a staging or local tab links to
 * itself. Inside the iOS app the page's origin is `capacitor://localhost`,
 * which no one else can open, so the app links to the public site instead.
 */
export function appBaseUrl(): string {
  return Capacitor.isNativePlatform() ? SITE_URL : window.location.origin;
}
