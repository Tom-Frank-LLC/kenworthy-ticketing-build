import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

/**
 * The 14 Aug 2026 rule, enforced instead of remembered.
 *
 * A catalog push built from our own columns deleted every field it did not
 * send, wiping descriptions and images across the account. It was invisible in
 * both UIs — timestamps were the only evidence. The standing rule since is that
 * a reporting function makes no catalog write and no non-GET catalog call at
 * all, and the brief for this screen restates it.
 *
 * A comment saying so survives exactly until someone needs one more field and
 * reaches for `POST /catalog/batch-retrieve` because it is convenient. This
 * reads the function's own source and fails the build instead.
 *
 * It self-skips without `--allow-read` so the documented
 * `deno test --allow-env supabase/functions` stays green; run
 * `deno test --allow-env --allow-read supabase/functions` to actually exercise
 * it, which is what CI should do.
 */

const SOURCE_URL = new URL('./index.ts', import.meta.url);
const canRead =
  (await Deno.permissions.query({ name: 'read', path: SOURCE_URL.pathname })).state === 'granted';

const source = canRead ? await Deno.readTextFile(SOURCE_URL) : '';

/** Every `squareFetch(config, <path>, <init?>)` call in the file. */
function squareCalls(text: string): { path: string; method: string }[] {
  const calls: { path: string; method: string }[] = [];
  const re = /squareFetch\(\s*config\s*,\s*([`'"])([^`'"]*)\1/g;
  for (const m of text.matchAll(re)) {
    const path = m[2];
    // Look ahead to the init object, if there is one, for an explicit method.
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 400);
    const method = /method:\s*'([A-Z]+)'/.exec(after);
    // squareFetch defaults to GET when no init is passed.
    const closesImmediately = /^\s*\)/.test(after);
    calls.push({ path, method: closesImmediately ? 'GET' : method?.[1] ?? 'GET' });
  }
  return calls;
}

Deno.test({
  name: 'square-transactions makes no catalog write and no non-GET catalog call',
  ignore: !canRead,
  fn: () => {
    const calls = squareCalls(source);
    assert(calls.length > 0, 'expected to find squareFetch calls to check');

    for (const call of calls) {
      if (call.path.startsWith('/catalog')) {
        assertEquals(
          call.method,
          'GET',
          `catalog call "${call.path}" uses ${call.method}; only GET is permitted here`,
        );
      }
    }
  },
});

Deno.test({
  name: 'square-transactions writes to no Square endpoint at all',
  ignore: !canRead,
  fn: () => {
    // The only non-GET this function is allowed is the documented read
    // `POST /orders/search`. Anything else that mutates — payments, refunds,
    // orders, customers — has no business on a reporting screen.
    const allowedNonGet = new Set(['/orders/search']);
    for (const call of squareCalls(source)) {
      if (call.method === 'GET') continue;
      assert(
        allowedNonGet.has(call.path),
        `non-GET ${call.method} ${call.path} is not an allowed read`,
      );
    }
  },
});

Deno.test({
  name: 'square-transactions is admin-gated and rejects the anon key',
  ignore: !canRead,
  fn: () => {
    // `verify_jwt` accepts the anon key, and this repo is public — so the
    // function must gate itself. Both halves are load-bearing: the anon-key
    // rejection, and the admin role check.
    assert(
      /authHeader\.includes\(ANON_KEY\)/.test(source),
      'the anon key must be rejected explicitly',
    );
    assert(
      /has_role[\s\S]{0,120}_role:\s*'admin'/.test(source),
      "the caller must be checked with has_role(..., 'admin')",
    );
  },
});
