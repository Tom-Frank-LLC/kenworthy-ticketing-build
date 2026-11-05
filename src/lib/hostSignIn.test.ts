import { describe, it, expect, vi, beforeEach } from 'vitest';

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { signInWithOtp: (a: unknown) => signInWithOtp(a), verifyOtp: (a: unknown) => verifyOtp(a) } },
}));
vi.mock('@/lib/site', () => ({ appBaseUrl: () => 'https://tickets.example' }));

import { isSignInCode, requestHostSignInLink, verifyHostSignInCode } from './hostSignIn';

beforeEach(() => {
  signInWithOtp.mockReset();
  verifyOtp.mockReset();
});

describe('requestHostSignInLink', () => {
  it('never creates an account, and sends the link back to /host', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await requestHostSignInLink('  Renter@Example.org ');
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'renter@example.org',
      options: { shouldCreateUser: false, emailRedirectTo: 'https://tickets.example/host' },
    });
  });

  // The same answer whoever the address belongs to: that is the whole point.
  it.each([
    ['a host', { error: null }],
    ['an unknown address', { error: { status: 422, name: 'AuthApiError', message: 'Signups not allowed for otp' } }],
    ['a repeat inside the rate limit', { error: { status: 429, name: 'AuthApiError', message: 'For security purposes, you can only request this after 52 seconds.' } }],
  ])('answers ok for %s', async (_who, response) => {
    signInWithOtp.mockResolvedValue(response);
    expect(await requestHostSignInLink('x@example.org')).toBeNull();
  });

  it.each([
    ['the network', { error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } }],
    ['the auth server', { error: { name: 'AuthApiError', message: 'boom', status: 500 } }],
    ['captcha, if it is ever turned on', { error: { name: 'AuthApiError', message: 'captcha protection: request disallowed', status: 400 } }],
  ])('reports a failure of %s, which says nothing about the address', async (_what, response) => {
    signInWithOtp.mockResolvedValue(response);
    expect(await requestHostSignInLink('x@example.org')).toMatch(/couldn't reach/);
  });
});

describe('verifyHostSignInCode', () => {
  it('verifies an email code, spaces removed', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    await verifyHostSignInCode('Renter@Example.org', '123 456');
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'renter@example.org', token: '123456', type: 'email' });
  });

  it('turns a bad code into something a renter can act on', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    await expect(verifyHostSignInCode('x@example.org', '000000')).rejects.toThrow(/request a new one/);
  });
});

describe('isSignInCode', () => {
  it('takes six digits, with or without a space', () => {
    expect(isSignInCode('123456')).toBe(true);
    expect(isSignInCode('123 456')).toBe(true);
    expect(isSignInCode('12345')).toBe(false);
    expect(isSignInCode('abcdef')).toBe(false);
  });
});
