// Drive a real edge-function handler, in-process, with every outbound request
// answered by a stub. Test-only: nothing deployed imports this.
//
// Why a harness rather than more unit tests. The fixes it exists for are about
// ORDER — no account created before a request is validated, no Square or
// database write before the bot check, no bot check on a replay. Order is a
// property of the handler as a whole, so the handler as a whole is what runs:
// `Deno.serve` is intercepted to capture it, and `fetch` is replaced so that
// PostgREST, GoTrue, Cloudflare and anything else answer from a route table and
// every call is recorded. Nothing leaves the process — no email, no SMS, no
// Square — because there is no real fetch to leave through.

// Deno globals
declare const Deno: any;

export const STUB_URL = 'http://stub.supabase.local';
export const ANON = 'anon-key-for-tests';

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

/** A route answers a call, or returns undefined to let the next one try. */
export type Route = (call: Call) => Response | undefined | Promise<Response | undefined>;

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** PostgREST's answer for a table read: an array, or one object if asked for one. */
export function rows(call: Call, data: unknown[]): Response {
  if (call.headers.get('accept')?.includes('vnd.pgrst.object')) {
    if (data.length === 0) {
      return jsonResponse({ code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows', hint: null }, 406);
    }
    return jsonResponse(data[0]);
  }
  return jsonResponse(data);
}

let installed = false;
let routes: Route[] = [];
export const calls: Call[] = [];

function install() {
  if (installed) return;
  installed = true;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    let body: unknown = null;
    const type = req.headers.get('content-type') || '';
    if (type.includes('multipart/form-data')) {
      const form = await req.formData();
      body = Object.fromEntries(form.entries());
    } else {
      const text = await req.text();
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    }
    const call: Call = { method: req.method, url, headers: req.headers, body };
    calls.push(call);
    for (const route of routes) {
      const res = await route(call);
      if (res) return res;
    }
    return jsonResponse({ message: `no stub for ${req.method} ${url.pathname}` }, 404);
  }) as typeof fetch;
}

/** Replace the route table and clear the call log, for one test. */
export function useRoutes(next: Route[]) {
  install();
  routes = next;
  calls.length = 0;
}

/**
 * Import a function's index.ts and return its request handler. Each module is
 * imported once per test process, so call this once per function.
 *
 * `env` is applied first, because the functions read their environment at
 * module load.
 */
export async function loadHandler(
  // A literal `() => import('./index.ts')` from the caller: Deno resolves a
  // literal specifier ahead of time, so the test needs no --allow-read.
  importer: () => Promise<unknown>,
  env: Record<string, string>,
): Promise<(req: Request) => Promise<Response>> {
  install();
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  let captured: ((req: Request) => Promise<Response>) | null = null;
  const realServe = Deno.serve;
  Deno.serve = (handler: any) => {
    captured = typeof handler === 'function' ? handler : handler.handler;
    return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {} };
  };
  try {
    await importer();
  } finally {
    Deno.serve = realServe;
  }
  if (!captured) throw new Error('the module did not call Deno.serve');
  return captured;
}

/** A browser-shaped POST to the handler, as a signed-out visitor. */
export function post(body: unknown, ip = '203.0.113.7'): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify(body),
  });
}

export const BASE_ENV = {
  SUPABASE_URL: STUB_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-for-tests',
  SUPABASE_ANON_KEY: ANON,
  TURNSTILE_SECRET_KEY: 'turnstile-secret-for-tests',
  RESEND_API_KEY: '',
  TWILIO_ACCOUNT_SID: '',
};

/** Route helpers shared by the checkout tests. */
export const is = (call: Call, method: string, path: string) =>
  call.method === method && call.url.pathname === path;

export const siteverify = (success: boolean): Route => (c) =>
  c.url.hostname === 'challenges.cloudflare.com'
    ? jsonResponse(success ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] })
    : undefined;

export const rateLimit = (allowed: boolean): Route => (c) =>
  is(c, 'POST', '/rest/v1/rpc/check_rate_limit')
    ? jsonResponse({ allowed, count: allowed ? 1 : 61, limit: 60, retry_after: 300 })
    : undefined;

/** Index of the first recorded call matching, or -1. */
export function firstIndex(pred: (c: Call) => boolean): number {
  return calls.findIndex(pred);
}

export const createdUser = (c: Call) => is(c, 'POST', '/auth/v1/admin/users');
export const verifiedBot = (c: Call) => c.url.hostname === 'challenges.cloudflare.com';
export const rpc = (name: string) => (c: Call) => is(c, 'POST', `/rest/v1/rpc/${name}`);

/** Swallow the handlers' deliberate log lines so the test output stays readable. */
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { [console.log, console.warn, console.error] = saved; }
}

/** Square credentials for a test that needs `loadSquareConfig` to succeed. */
export const SQUARE_TEST_ENV = {
  SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test',
  SQUARE_ACCESS_TOKEN: 'test-token',
  SQUARE_LOCATION_ID: 'LOC_TEST',
};

/**
 * Run `fn` with these variables set, or unset where the value is null, then put
 * every one back. Tests in one `deno test` run share a process environment.
 */
export async function withEnv<T>(vars: Record<string, string | null>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = Deno.env.get(k);
    if (v === null) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}
