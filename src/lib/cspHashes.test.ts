import { describe, it, expect } from 'vitest';
// Vite raw imports rather than node:fs, deliberately. This file lives under
// src/, which tsconfig.app.json compiles with types: ["vitest/globals"] and no
// node types — and adding them would let application code import node APIs and
// still typecheck, which is a browser bundle waiting to break at runtime. `?raw`
// and Web Crypto keep this inside the same world the rest of src/ lives in.
import headersRaw from '../../public/_headers?raw';
import indexRaw from '../../index.html?raw';

/**
 * The CSP enforces, and `index.html` carries inline <script> blocks that are
 * allowed by hash. Edit one of those blocks without updating `public/_headers`
 * and the browser stops executing it — in production, silently.
 *
 * The one that matters is the boot watchdog (#149). It is the code that
 * recovers a black empty page when the entry chunk 404s behind a stale service
 * worker, so it only ever runs when the app is already broken. A CSP that
 * blocks it removes the recovery path for the exact failure it exists to catch,
 * and nothing about the site looks wrong until that failure happens.
 *
 * Nobody is going to remember. So this recomputes the hashes the same way the
 * build produces them and asserts `_headers` still lists every one.
 *
 * Reproducing the build here is a plain global replace of `%SITE_URL%` — see
 * `transformIndexHtml` in vite.config.ts. If that ever becomes a real template
 * transform, this test has to follow it, and it will fail loudly rather than
 * quietly stop testing anything.
 */

/** The two origins the token resolves to, from the committed env files. */
const SITE_URLS = [
  'https://kenworthy.org',
  'https://kenworthy-ticketing-staging.mrtomfrank.workers.dev',
];

async function sha256Base64(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function inlineScriptHashes(html: string): Promise<string[]> {
  const out: string[] = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(m[1])) continue; // external, covered by 'self'
    out.push(await sha256Base64(m[2]));
  }
  return out;
}

/**
 * The policy itself, not the prose around it.
 *
 * `_headers` is mostly comments, and those comments discuss the directives by
 * name — so a naive search across the whole file matches the explanation of why
 * there is no 'unsafe-inline' and reads it as an 'unsafe-inline'. The first
 * version of this test did exactly that and failed against a correct policy.
 */
const policyLine =
  headersRaw.split('\n').find((l) => /^\s*Content-Security-Policy:/.test(l)) ?? '';

describe('the CSP still allows every inline script index.html ships', () => {
  it('is enforcing, not report-only — the rest of this file assumes it', () => {
    expect(policyLine).not.toBe('');
    expect(headersRaw).not.toMatch(/^\s*Content-Security-Policy-Report-Only:/m);
  });

  it('lists a hash for every inline script, in both environments', async () => {
    for (const siteUrl of SITE_URLS) {
      // .replace(/…/g) rather than .replaceAll: tsconfig.app.json targets a lib
      // below es2021. Same semantics for a literal token.
      const built = indexRaw.replace(/%SITE_URL%/g, siteUrl);
      const hashes = await inlineScriptHashes(built);

      expect(hashes.length).toBeGreaterThan(0);

      for (const h of hashes) {
        expect(
          policyLine.includes(`'sha256-${h}'`),
          `public/_headers is missing 'sha256-${h}' for an inline <script> in ` +
            `index.html built with SITE_URL=${siteUrl}. Rebuild and recompute — ` +
            `the command is in the CSP comment block in _headers. Leaving it ` +
            `stale means the browser silently refuses to run that script.`,
        ).toBe(true);
      }
    }
  });

  it("script-src does not fall back to 'unsafe-inline'", () => {
    // A hash and 'unsafe-inline' together is worse than either alone: browsers
    // that honour the hash ignore 'unsafe-inline', and browsers that do not get
    // a policy permitting any injected script. Either way it signals the hashes
    // stopped being maintained.
    const scriptSrc = policyLine.match(/script-src([^;]*);/)?.[1] ?? '';
    expect(scriptSrc.length).toBeGreaterThan(0);
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('the boot watchdog is one of the scripts covered', () => {
    // Named explicitly so that deleting the watchdog and leaving a stale hash
    // does not read as "still passing".
    expect(indexRaw).toContain('kw:boot-reload');
  });
});
