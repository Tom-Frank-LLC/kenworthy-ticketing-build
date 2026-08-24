import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Who is offered the Staff section, and who is let into it.
 *
 * Both halves are here because they are easy to get half-right: hiding a link
 * is not a guard, and guarding a route while forgetting the link leaves the
 * people it is for with no way to find it. The states are also mutually
 * exclusive — no single page load shows a patron's header and a staffer's — so
 * this is the only place all of them can be seen at once.
 *
 * The Donate button belongs to the same change: the header runs out of room at
 * `lg` exactly where Staff and Admin need to sit, so the ask aimed at patrons
 * is shown to patrons only.
 */

const mockAuth = {
  user: null as { id: string } | null,
  isAdmin: false,
  isStaff: false,
  isHost: false,
  isSuperadmin: false,
  loading: false,
  signOut: vi.fn(),
};

vi.mock('@/lib/auth', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/useHiringEnabled', () => ({ useHiringEnabled: () => false }));

// Layout pulls in the ColorLab provider, which reads the published site theme
// through the real Supabase client — "supabaseUrl is required" without a built
// env. Same stub as colorlab/entryPoints.test.tsx.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  },
}));

vi.mock('@/components/NewsletterSignup', () => ({ NewsletterSignup: () => null }));
vi.mock('@/components/MobileNav', () => ({ MobileNav: () => null }));

import { Layout } from '@/components/Layout';
import { ColorLabProvider } from '@/components/colorlab/ColorLabProvider';
import { StaffOnly } from '@/components/StaffOnly';

function signedOut() {
  mockAuth.user = null;
  mockAuth.isAdmin = false;
  mockAuth.isStaff = false;
  mockAuth.isHost = false;
  mockAuth.isSuperadmin = false;
  mockAuth.loading = false;
}

/** `isStaff` is the union of the three roles — see checkRoles in lib/auth.tsx. */
function signedInAs(roles: { staff?: boolean; admin?: boolean; host?: boolean }) {
  mockAuth.user = { id: 'u1' };
  mockAuth.isAdmin = !!roles.admin;
  mockAuth.isStaff = !!roles.staff || !!roles.admin;
  mockAuth.isHost = !!roles.host;
  mockAuth.isSuperadmin = false;
  mockAuth.loading = false;
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <ColorLabProvider>
        <Layout><div /></Layout>
      </ColorLabProvider>
    </MemoryRouter>,
  );
}

const header = () => document.querySelector('header')!;
const headerLink = (name: string) =>
  [...header().querySelectorAll('a')].find(a => a.textContent?.trim() === name) ?? null;

describe('the header', () => {
  beforeEach(() => {
    signedOut();
    window.sessionStorage.clear();
  });

  it('offers a patron Donate, and neither staff section', () => {
    renderHeader();
    expect(headerLink('Donate')).toBeTruthy();
    expect(headerLink('Staff')).toBeNull();
    expect(headerLink('Admin')).toBeNull();
  });

  it('offers a staff-only account Staff, but not Admin — and drops Donate', () => {
    signedInAs({ staff: true });
    renderHeader();
    expect(headerLink('Staff')?.getAttribute('href')).toBe('/staff');
    expect(headerLink('Admin')).toBeNull();
    expect(headerLink('Donate')).toBeNull();
  });

  it('offers an admin both — they run the counter too', () => {
    signedInAs({ admin: true });
    renderHeader();
    expect(headerLink('Staff')?.getAttribute('href')).toBe('/staff');
    expect(headerLink('Admin')?.getAttribute('href')).toBe('/admin');
    expect(headerLink('Donate')).toBeNull();
  });
});

describe('the /staff guard', () => {
  function renderGuarded(allowHost = false) {
    return render(
      <MemoryRouter initialEntries={['/staff/pos']}>
        <Routes>
          <Route
            path="/staff/pos"
            element={<StaffOnly allowHost={allowHost}><p>the till</p></StaffOnly>}
          />
          <Route path="/" element={<p>the front page</p>} />
          <Route path="/auth" element={<p>the sign-in card</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(signedOut);

  it('lets staff through', () => {
    signedInAs({ staff: true });
    renderGuarded();
    expect(screen.getByText('the till')).toBeTruthy();
  });

  it('sends a signed-out visitor to sign in, not to the till', () => {
    renderGuarded();
    expect(screen.queryByText('the till')).toBeNull();
    expect(screen.getByText('the sign-in card')).toBeTruthy();
  });

  it('sends a signed-in account with no role home', () => {
    mockAuth.user = { id: 'u2' };
    renderGuarded();
    expect(screen.queryByText('the till')).toBeNull();
    expect(screen.getByText('the front page')).toBeTruthy();
  });

  it('keeps a host out of the till, and lets them into the door scanner', () => {
    signedInAs({ host: true });
    renderGuarded(false);
    expect(screen.queryByText('the till')).toBeNull();

    signedInAs({ host: true });
    renderGuarded(true);
    expect(screen.getByText('the till')).toBeTruthy();
  });

  it('waits for the role lookup rather than bouncing on a hard refresh', () => {
    mockAuth.user = { id: 'u1' };
    mockAuth.loading = true;
    renderGuarded();
    expect(screen.queryByText('the till')).toBeNull();
    expect(screen.queryByText('the front page')).toBeNull();
    expect(screen.getByText('Loading...')).toBeTruthy();
  });
});
