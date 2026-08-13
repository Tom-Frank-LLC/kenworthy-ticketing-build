import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import fs from "fs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  // Canonical public origin for SEO/OG tags, JSON-LD, and absolute links. Set
  // per-env in .env.staging/.env.production; falls back to the prod Worker so a
  // build is never left pointing at the retired Lovable preview domain. Flip to
  // https://kenworthy.org at domain cutover — no code change, just the env var.
  const siteUrl = (env.VITE_SITE_URL || process.env.VITE_SITE_URL || 'https://kenworthy-ticketing-build.mrtomfrank.workers.dev').replace(/\/+$/, '');

  return {
    define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
    'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl),
    },
    server: {
      host: "::",
      port: 8080,
      hmr: { overlay: false },
    },
    plugins: [
      react(),
      // Resolve the %SITE_URL% token to the origin above so the static shell
      // crawlers read (index.html OG/JSON-LD, robots.txt, sitemap.xml) is
      // correct per-env. App code reads the same value via
      // import.meta.env.VITE_SITE_URL (src/lib/site.ts). One source of truth;
      // the domain cutover is a single env change.
      {
        name: 'site-url',
        transformIndexHtml(html: string) {
          return html.replaceAll('%SITE_URL%', siteUrl);
        },
        closeBundle() {
          // public/ files are copied verbatim, so token-replace them on disk
          // after the build writes them out.
          for (const file of ['robots.txt', 'sitemap.xml']) {
            const p = path.resolve(__dirname, 'dist', file);
            try {
              const txt = fs.readFileSync(p, 'utf8');
              if (txt.includes('%SITE_URL%')) {
                fs.writeFileSync(p, txt.replaceAll('%SITE_URL%', siteUrl));
              }
            } catch { /* file not present in this build — ignore */ }
          }
        },
      },
      VitePWA({
        // The manifest and icons are hand-maintained in public/ so they stay
        // readable and reusable by the eventual Capacitor wrapper.
        manifest: false,
        injectRegister: 'auto',
        registerType: 'autoUpdate',
        workbox: {
          // Precache only the shell. Deliberately NOT the JS bundles: those
          // are content-hashed and immutable, and bulk-downloading the admin
          // tree over cellular is exactly what the code splitting above
          // exists to prevent. They are runtime-cached on first use instead.
          globPatterns: ['**/*.{css,html,svg,woff,woff2}'],
          // The backstage lockup is a 276KB SVG. Keep it out of the
          // install-time download — it still gets runtime-cached on first
          // view. (Excluding it via `maximumFileSizeToCacheInBytes` instead
          // makes vite-plugin-pwa fail the build outright.)
          globIgnores: ['**/backstage-logo-*.svg'],
          // MUST stay explicitly `undefined`, not merely omitted: vite-plugin-pwa
          // defaults it to 'index.html' (Object.assign over its defaultWorkbox,
          // so an explicit undefined is what clears it). navigateFallback
          // registers workbox's own NavigationRoute *before* every
          // runtimeCaching route, and the workbox router is first-match-wins —
          // so it shadows the NetworkFirst shell rule below and keeps serving
          // the precached, cache-first shell. Verified by reading the emitted
          // dist/sw.js, not assumed. SPA navigation is handled entirely by the
          // 'kenworthy-shell' rule instead.
          navigateFallback: undefined,
          // The other half of the same problem, and the non-obvious half.
          // precacheAndRoute() registers its route BEFORE any runtimeCaching
          // route, and workbox's PrecacheRoute defaults to `directoryIndex:
          // 'index.html'` — so a navigation to `/` resolves to the *precached*
          // index.html and is served cache-first, shadowing the shell rule
          // below exactly the way navigateFallback did. Removing
          // navigateFallback alone is NOT enough; verified by observing
          // `performance.getEntriesByType('navigation')[0].deliveryType ===
          // 'cache-storage'` on a controlled load. null disables the lookup
          // (workbox only defaults it when undefined), so `/` falls through to
          // the network-first rule.
          //
          // `cleanURLs` is deliberately left at its default (true) and is not
          // exposed by generateSW: it maps `/colorlab` → the precached
          // colorlab.html, which is correct — that page is a real, separately
          // revisioned document, not the SPA shell.
          directoryIndex: null,
          navigationPreload: true,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // THE APP SHELL. Must be network-first: each build content-hashes
              // the JS/CSS, so a cache-first shell hands the browser a document
              // referencing asset filenames that no longer exist on the server.
              // The Worker's `not_found_handling: single-page-application` then
              // answers those dead requests with index.html (200, text/html)
              // where a script was expected — which is the blank page after
              // every deploy. Going to the network for the document means the
              // asset hashes it names are always ones that exist.
              //
              // Excludes /api/ (edge routes) and the standalone static pages in
              // public/, which are their own documents and must not be answered
              // with the SPA shell.
              urlPattern: ({ request, url, sameOrigin }) =>
                sameOrigin &&
                request.mode === 'navigate' &&
                !url.pathname.startsWith('/api/') &&
                !/^\/colorlab(\.html)?$/.test(url.pathname),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'kenworthy-shell',
                // Slow network → fall back to the cached shell rather than
                // hanging. Offline is instant (fetch rejects immediately).
                networkTimeoutSeconds: 3,
                cacheableResponse: { statuses: [200] },
                plugins: [
                  {
                    // Every SPA route is the same document, so store exactly one
                    // shell under one key. Without this, an offline navigation
                    // to a route the user had never visited online would miss
                    // the cache and fail — `navigateFallback` used to cover that
                    // case. Deliberately no ExpirationPlugin: a single entry
                    // can't grow, and a maxAge would expire the offline
                    // fallback out from under a user who is still offline.
                    cacheKeyWillBeUsed: async () => '/index.html',
                  },
                ],
              },
            },
            {
              // Hashed build assets — the filename changes whenever the
              // content does, so cache-first is always safe here.
              urlPattern: ({ url, request, sameOrigin }) =>
                sameOrigin &&
                url.pathname.startsWith('/assets/') &&
                (request.destination === 'script' || request.destination === 'style'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'kenworthy-assets',
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: ({ request }) => request.destination === 'image',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'kenworthy-images',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 14 },
              },
            },
          ],
        },
        devOptions: {
          // Keep the SW out of `vite dev` — a stale shell during HMR is a
          // debugging trap with no upside.
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    build: {
      // NOTE: deliberately no `manualChunks`. Rolldown already keeps recharts,
      // xlsx, jspdf/html2pdf and html5-qrcode in chunks reachable only from
      // the lazy admin routes. Forcing them into named vendor chunks made
      // things *worse*: a manual chunk becomes a shared chunk, which Vite
      // then emits as a <link modulepreload> on index.html — so the home page
      // eagerly downloaded recharts and jsPDF (~1.8MB) that it never uses.
      // Verify with: grep -o 'assets/[^"]*' dist/index.html
      chunkSizeWarningLimit: 800,
    },
  };
});
