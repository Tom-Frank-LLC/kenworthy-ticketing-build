// What a URL from outside the code is allowed to become.
//
// Two kinds of outside value reach a URL sink in this app, and each has one
// gate here so the rule is written once:
//
//   safeRedirectPath — a value from the query string (or anywhere a visitor
//                      can type) that is about to go to navigate(). Only a
//                      path on this site gets through.
//   safeHttpUrl      — a URL from the database (rsvp_url, trailer files, press
//                      links) about to become an href or a src. Only http(s)
//                      gets through.
//
// The database refuses most bad values at write time too (CHECK constraints on
// the same columns, 20261006…_url_column_checks.sql). The render-side gate is
// still needed: rows written before the constraint, and a constraint is one
// migration away from being dropped. Neither gate is a substitute for the
// other, and the CSP behind both is a third layer, not the first.

/**
 * A `?redirect=` value, accepted only when it is a path on this site.
 *
 * `//evil.example` and `/\evil.example` look like paths and are not: browsers
 * read both as "another host". react-router 6.30.1 resolves either to a
 * cross-origin URL, `pushState` refuses it, and the router's fallback is
 * `window.location.assign(url)` — so `/auth?redirect=//evil.example` signed a
 * staff member in on the real site and then handed them to the attacker's
 * (audit 2026-10-06, M5; GHSA-9jcx-v3wj-wh4m, GHSA-wrjc-x8rr-h8h6).
 *
 * The rule: starts with one `/` that is not followed by `/` or `\`; no
 * backslash or control character anywhere (browsers delete tabs and newlines
 * before parsing, so `/\t/evil.example` *becomes* `//evil.example`); and it
 * still resolves to this origin after URL parsing. The value returned is the
 * parsed form, re-checked, because parsing collapses `..` — `/..//evil.example`
 * normalises to `//evil.example`.
 *
 * Anything else is replaced by `fallback`, silently: the person signing in
 * still lands somewhere sensible, and a hostile link has no error to read.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback;
  if (!isRootedPath(raw) || /[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;

  const base = 'https://same-origin.invalid';
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return fallback;
  }
  if (parsed.origin !== base) return fallback;

  const path = parsed.pathname + parsed.search + parsed.hash;
  return isRootedPath(path) ? path : fallback;
}

function isRootedPath(s: string): boolean {
  return /^\/(?![/\\])/.test(s);
}

/**
 * Normalise a stored link, or reject it.
 *
 * Two jobs. The first is a courtesy — someone pasting `kenworthy.org/story`
 * without a scheme gets https:// rather than a link that resolves relative to
 * our own domain. The second is not: an `<a href>` accepts `javascript:` and
 * `data:` URLs and will run them (React 18 warns and renders them anyway), so
 * a href that reaches a page has to be proved http(s) first. Admin- and
 * host-entered content is not the same as trusted content — hosts are outside
 * organisers, and any account could be someone else's tomorrow.
 *
 * Returns null when there is nothing safe to link to; callers render without
 * the link rather than with a broken or dangerous one.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}
