import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import authPkg from '@supabase/auth-js/package.json';
import { signOutDevice } from './signOutDevice';

/**
 * Sign-out on a flaky connection (audit 2026-10-06, L12), run against the real
 * auth client with only `fetch` replaced. The property: once signOutDevice
 * resolves, the session is gone from this device's storage, whatever the
 * network did — and when it cannot guarantee that, it throws.
 */

const URL_ = 'https://abcdefghijklmnop.supabase.co';
const KEY = 'sb-abcdefghijklmnop-auth-token';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function seededSession() {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    access_token: 'header.payload.sig',
    refresh_token: 'refresh-1',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: '00000000-0000-0000-0000-000000000001', email: 'staff@example.org', aud: 'authenticated' },
  });
}

function client(fetchImpl: typeof fetch) {
  const storage = memoryStorage();
  storage.setItem(KEY, seededSession());
  const supabase = createClient(URL_, 'anon-key', {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
  return { supabase, storage };
}

const offline = () => vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const serverError = () =>
  vi.fn(async () => new Response('{"message":"upstream"}', { status: 503, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const ok = () => vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('signOutDevice', () => {
  // The two controls pin why this file exists, on the auth-js version the
  // audit traced. A later version that clears storage on its own would turn
  // them red under a plain runIf; pinning to the version keeps an upgrade from
  // failing here, and the cases below hold on any version.
  it.runIf(authPkg.version === '2.96.0')(
    'control: auth-js 2.96.0 keeps the session stored when /logout fails — with scope local too',
    async () => {
      for (const scope of ['global', 'local'] as const) {
        const { supabase, storage } = client(offline());
        const { error } = await supabase.auth.signOut({ scope });
        expect(error, scope).not.toBeNull();
        expect(storage.map.has(KEY), scope).toBe(true);
      }
    },
  );

  it('the server confirms: revoked, and nothing left on the device', async () => {
    const fetchImpl = ok();
    const { supabase, storage } = client(fetchImpl);
    await expect(signOutDevice(supabase.auth)).resolves.toEqual({ revoked: true });
    expect(storage.map.has(KEY)).toBe(false);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/auth/v1/logout');
  });

  it.each([
    ['offline', offline],
    ['a 5xx from /logout', serverError],
  ])('%s: the device is cleared anyway, and the app is told the user signed out', async (_label, make) => {
    const fetchImpl = make();
    const { supabase, storage } = client(fetchImpl);
    const events: string[] = [];
    supabase.auth.onAuthStateChange(event => events.push(event));

    await expect(signOutDevice(supabase.auth)).resolves.toEqual({ revoked: false });

    expect([...storage.map.keys()].filter(k => k.startsWith('sb-'))).toEqual([]);
    expect(events).toContain('SIGNED_OUT');
    // One attempt at the server; the local fallback makes no request of its own.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
  });

  it('throws — so the UI stays signed in — when it cannot clear the device', async () => {
    const { supabase, storage } = client(offline());
    // Storage that refuses to forget: the one case where "signed out" would be a lie.
    storage.removeItem = () => undefined;
    await expect(signOutDevice(supabase.auth)).rejects.toBeTruthy();
    expect(storage.map.has(KEY)).toBe(true);
  });
});
