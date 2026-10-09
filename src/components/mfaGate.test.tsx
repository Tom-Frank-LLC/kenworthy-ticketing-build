import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * The signed-in pages and two-step sign-in (BRIEF-admin-mfa). Everyone who
 * signs in needs it, whatever their role.
 *
 * The server is the lock: once the switch is on, a password-only session gets
 * nothing a signed-out visitor wouldn't. These pin the signage that keeps a
 * person from meeting that refusal as a page of empty tables:
 *   - an account with an authenticator, signed in with the password only, is
 *     asked for the code in place of the page, whatever the switch says;
 *   - an account with no authenticator is sent to set one up once the server
 *     requires it, staff and hosts as much as admins; until then the page
 *     opens as before;
 *   - the pages outside the role gates (/host) get the same treatment.
 */

const factor = {
  id: 'f1',
  factor_type: 'totp',
  status: 'verified',
  friendly_name: 'My phone',
  created_at: '2026-10-08T00:00:00Z',
  updated_at: '2026-10-08T00:00:00Z',
};

const mockAuth = {
  user: { id: 'u1' } as { id: string } | null,
  isAdmin: false,
  isStaff: false,
  isHost: false,
  isSuperadmin: false,
  loading: false,
  mfa: { currentLevel: 'aal1', nextLevel: 'aal1', verifiedFactors: [] as unknown[] },
  mfaRequired: false,
  signOut: vi.fn(),
};

vi.mock('@/lib/auth', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { AdminOnly, StaffOnly } from '@/components/RoleGate';
import { MfaGate } from '@/components/MfaGate';

function Where() {
  const l = useLocation();
  return <p>at {l.pathname + l.search}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminOnly><p>the dashboard</p></AdminOnly>} />
        <Route path="/staff/pos" element={<StaffOnly><p>the till</p></StaffOnly>} />
        <Route path="/host" element={<MfaGate><p>the host dashboard</p></MfaGate>} />
        <Route path="/account/security" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function admin() {
  mockAuth.isAdmin = true;
  mockAuth.isStaff = true;
}
function staff() {
  mockAuth.isAdmin = false;
  mockAuth.isStaff = true;
}

beforeEach(() => {
  mockAuth.mfa = { currentLevel: 'aal1', nextLevel: 'aal1', verifiedFactors: [] };
  mockAuth.mfaRequired = false;
});

describe('an account with an authenticator, signed in with the password only', () => {
  beforeEach(() => {
    mockAuth.mfa = { currentLevel: 'aal1', nextLevel: 'aal2', verifiedFactors: [factor] };
  });

  it('is asked for the code instead of being shown the admin page', () => {
    admin();
    renderAt('/admin');
    expect(screen.queryByText('the dashboard')).toBeNull();
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
  });

  it('is asked even while the switch is off: having a factor means using it', () => {
    admin();
    mockAuth.mfaRequired = false;
    renderAt('/admin');
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
  });

  it('is asked at the till too, staff included', () => {
    staff();
    renderAt('/staff/pos');
    expect(screen.queryByText('the till')).toBeNull();
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
  });
});

describe('a session that has entered the code', () => {
  it('opens the page', () => {
    admin();
    mockAuth.mfa = { currentLevel: 'aal2', nextLevel: 'aal2', verifiedFactors: [factor] };
    mockAuth.mfaRequired = true;
    renderAt('/admin');
    expect(screen.getByText('the dashboard')).toBeTruthy();
  });
});

describe('an admin with no authenticator', () => {
  it('opens the page while the server does not require one yet', () => {
    admin();
    renderAt('/admin');
    expect(screen.getByText('the dashboard')).toBeTruthy();
  });

  it('is sent to set one up once the server requires it, keeping where they were going', () => {
    admin();
    mockAuth.mfaRequired = true;
    renderAt('/admin');
    expect(screen.queryByText('the dashboard')).toBeNull();
    expect(screen.getByText('at /account/security?setup=1&redirect=%2Fadmin')).toBeTruthy();
  });
});

describe('staff with no authenticator', () => {
  it('open the till while the server does not require one yet', () => {
    staff();
    renderAt('/staff/pos');
    expect(screen.getByText('the till')).toBeTruthy();
  });

  it('are sent to set one up once it does: everyone who signs in needs one', () => {
    staff();
    mockAuth.mfaRequired = true;
    renderAt('/staff/pos');
    expect(screen.queryByText('the till')).toBeNull();
    expect(screen.getByText('at /account/security?setup=1&redirect=%2Fstaff%2Fpos')).toBeTruthy();
  });
});

describe('a host, outside the role gates', () => {
  beforeEach(() => {
    mockAuth.isAdmin = false;
    mockAuth.isStaff = false;
    mockAuth.isHost = true;
  });

  it('is asked for the code on /host', () => {
    mockAuth.mfa = { currentLevel: 'aal1', nextLevel: 'aal2', verifiedFactors: [factor] };
    renderAt('/host');
    expect(screen.queryByText('the host dashboard')).toBeNull();
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
  });

  it('is sent to set one up once it is required', () => {
    mockAuth.mfaRequired = true;
    renderAt('/host');
    expect(screen.getByText('at /account/security?setup=1&redirect=%2Fhost')).toBeTruthy();
  });

  it('opens /host after the code', () => {
    mockAuth.mfa = { currentLevel: 'aal2', nextLevel: 'aal2', verifiedFactors: [factor] };
    mockAuth.mfaRequired = true;
    renderAt('/host');
    expect(screen.getByText('the host dashboard')).toBeTruthy();
  });
});
