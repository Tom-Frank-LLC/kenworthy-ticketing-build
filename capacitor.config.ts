import type { CapacitorConfig } from '@capacitor/cli';

// The iOS app: the same web build, bundled into the binary. See
// docs/briefs/BRIEF-capacitor-ios-app.md for how it is built and why.
const config: CapacitorConfig = {
  // Registered under the Kenworthy Apple Developer team. An Apple bundle id is
  // globally unique and cannot move between teams, so this must not change.
  appId: 'org.kenworthy.tickets',
  appName: 'Kenworthy',
  // Not dist/: `npm run build:native` builds without the service worker into
  // its own directory, and scripts/verify-native-bundle.mjs (capacitor:copy:before)
  // refuses anything else.
  webDir: 'dist-native',
  // The WebView's own colour before the page paints: the page's #0f0f0f, so the
  // launch image hands over to the app with no white flash in between.
  backgroundColor: '#0f0f0f',
  server: {
    // The page origin is capacitor://localhost. Assets load from the bundle
    // either way; the hostname only names the origin — and it is forced, not
    // chosen. Measured in the iOS 27 simulator (docs/briefs/BRIEF-capacitor-ios-app.md):
    //  - Square's Web Payments SDK refuses to load unless the protocol is https:
    //    or the hostname ends in "localhost" (WebSdkEmbedError). A WKWebView
    //    cannot serve bundled assets over https:, so at capacitor://kenworthy.org
    //    online checkout, film passes and donations have no card form at all.
    //  - Turnstile accepts any hostname on the widget's domain list, and a
    //    "localhost" entry covers this origin. The production widget must list
    //    "localhost" (the staging one already does), or checkout and the rental
    //    form fail with Turnstile error 110200.
    // What it costs: iOS password autofill keys on the host, so the password
    // saved for kenworthy.org is not offered here. And localStorage — with it the
    // Supabase session — is per origin: changing this later signs every app user
    // out once. Leave it.
    // Links that leave the device use appBaseUrl() (src/lib/site.ts), never
    // window.location.origin.
    hostname: 'localhost',
  },
  // server.url is intentionally absent: a release build loads its own bundled
  // assets. Never commit server.url — the app would load whatever that server
  // serves instead of what was reviewed and shipped.
};

export default config;
