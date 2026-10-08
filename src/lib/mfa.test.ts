import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { cleanCode, codeFactors, factorTypeLabel, friendlyMfaError, isCompleteCode, needsCode } from '@/lib/mfa';

const f = (factor_type: string, status = 'verified') =>
  ({ id: factor_type + status, factor_type, status, friendly_name: '', created_at: '', updated_at: '' }) as never;

describe('needsCode', () => {
  it('asks only when the session could be raised and has not been', () => {
    expect(needsCode({ currentLevel: 'aal1', nextLevel: 'aal2', verifiedFactors: [] })).toBe(true);
    expect(needsCode({ currentLevel: 'aal2', nextLevel: 'aal2', verifiedFactors: [] })).toBe(false);
    expect(needsCode({ currentLevel: 'aal1', nextLevel: 'aal1', verifiedFactors: [] })).toBe(false);
    expect(needsCode({ currentLevel: null, nextLevel: null, verifiedFactors: [] })).toBe(false);
  });
});

describe('codes', () => {
  it('accepts the "123 456" an app shows, and nothing short of six digits', () => {
    expect(cleanCode(' 123 456 ')).toBe('123456');
    expect(isCompleteCode('123 456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('12345a')).toBe(false);
  });
});

describe('factors, by type (Phase 2 adds passkeys without changing this)', () => {
  it('offers a code only for verified authenticator apps', () => {
    const got = codeFactors([f('totp'), f('totp', 'unverified'), f('webauthn'), f('phone')]);
    expect(got.map(x => (x as { id: string }).id)).toEqual(['totpverified']);
  });

  it('names each type in plain words', () => {
    expect(factorTypeLabel({ factor_type: 'totp' })).toBe('Authenticator app');
    expect(factorTypeLabel({ factor_type: 'webauthn' })).toBe('Passkey');
  });
});

describe('friendlyMfaError', () => {
  it('turns auth\'s developer wording into what to do', () => {
    expect(friendlyMfaError('Invalid TOTP code entered')).toMatch(/didn't match/);
    expect(friendlyMfaError('AAL2 required')).toMatch(/code from your authenticator/);
    expect(friendlyMfaError('Something else')).toBe('Something else');
  });
});
