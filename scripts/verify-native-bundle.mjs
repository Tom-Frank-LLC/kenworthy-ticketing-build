#!/usr/bin/env node
/**
 * Refuses to let a bundle into the iOS app unless it is the one the app should
 * ship: built against production, and with no service worker in it.
 *
 * Runs as `capacitor:copy:before` (package.json), which the Capacitor CLI runs
 * before EVERY `cap copy` and `cap sync`, however they were invoked — so a hand-
 * run `npx cap sync` stops here too. The CLI passes the web dir as
 * CAPACITOR_WEB_DIR, which the hook forwards as the argument.
 *
 * Why each check exists:
 *
 * 1. The backend. A wrong-environment bake is invisible to tsc, vitest and
 *    `vite build`: the bundle is mechanically perfect and points at the wrong
 *    database. (The Centerview app shipped one.) A bundle with NO .env in reach
 *    is worse: every VITE_* inlines empty and the app reaches nothing. So the
 *    assertion is on the inlined URL form, `https://<ref>.supabase.co`, in the
 *    JS assets only — and the set of refs found must be EXACTLY {production}.
 *    Empty fails, extra fails, wrong fails. HTML is not scanned: public/sms.html
 *    hardcodes the production ref as sample text, and would satisfy the check
 *    on its own.
 *
 * 2. The service worker. The app's assets are inside the binary; a worker in
 *    the WebView would cache a shell over them and keep serving it after an app
 *    update. `npm run build:native` builds without one (vite.config.ts). This
 *    catches the website's `dist/` being pointed at by mistake.
 *
 * Override: ALLOW_NONPROD_BUILD=1 lets a staging bundle through, loudly, for the
 * one legitimate case — a simulator or device build to test against staging. It
 * never lets through a bundle with no backend, or one with a service worker.
 *
 * Usage: node scripts/verify-native-bundle.mjs [web-dir]   (default: dist-native)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROD_REF = 'vlmslygnimfbamrtwvyo';
const KNOWN = { vlmslygnimfbamrtwvyo: 'production', rpqzrpboyhshdrfdwayk: 'staging' };

const dir = process.argv[2] || 'dist-native';
const fail = (msg) => {
  console.error(`\n✖ verify-native-bundle: ${msg}\n`);
  process.exit(1);
};

if (!existsSync(join(dir, 'index.html'))) fail(`${dir}/index.html not found. Run \`npm run build:native\` first.`);

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

// 2. No service worker, and nothing that would register one.
for (const sw of ['sw.js', 'registerSW.js']) {
  if (existsSync(join(dir, sw))) fail(`${dir}/${sw} exists. This is a website build; the app must be built with \`npm run build:native\`.`);
}
if (/registerSW|serviceWorker\.register/.test(readFileSync(join(dir, 'index.html'), 'utf8'))) {
  fail(`${dir}/index.html registers a service worker.`);
}

// 1. Exactly the production backend.
const refs = new Set();
const assets = join(dir, 'assets');
if (existsSync(assets)) {
  for (const p of files(assets)) {
    if (!p.endsWith('.js')) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g)) refs.add(m[1]);
  }
}
const named = [...refs].map((r) => `${r} (${KNOWN[r] ?? 'unknown'})`).join(', ');
if (refs.size === 0) fail('no Supabase URL in the bundle — it was built with no env file and can reach no backend.');
if (refs.size === 1 && refs.has(PROD_REF)) {
  console.log(`✔ verify-native-bundle: ${dir} → production (${PROD_REF}), no service worker.`);
  process.exit(0);
}
if (process.env.ALLOW_NONPROD_BUILD === '1') {
  console.warn(`\n⚠ verify-native-bundle: ${dir} points at ${named}. Allowed by ALLOW_NONPROD_BUILD=1 — never upload this build.\n`);
  process.exit(0);
}
fail(`the bundle points at ${named}, not production alone. Build with \`npm run build:native\`.`);
