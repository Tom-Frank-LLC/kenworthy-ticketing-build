import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The Color Lab's two doors, and specifically the one that is easy to get wrong.
 *
 * The footer's "Staff login" link is hidden from anyone who already has a
 * session — that is `BRIEF-disable-member-login`'s doing, and it is correct.
 * But that link is also the *only* route to the Lab for a logged-out viewer
 * (they reach it by clicking the logo on the sign-in card), so without a second
 * door a signed-in staff member — the people the tool is actually for — would
 * have no way in at all. The footer therefore swaps one link for the other.
 *
 * This is tested here rather than in a browser because the interesting half of
 * it needs a signed-in session, and the two branches are mutually exclusive:
 * you cannot see both in one page load no matter how you click.
 */

const mockAuth = {
  user: null as { id: string } | null,
  isAdmin: false,
  isStaff: false,
  isHost: false,
  isSuperadmin: false,
  signOut: vi.fn(),
};

vi.mock('@/lib/auth', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/useHiringEnabled', () => ({ useHiringEnabled: () => false }));

// The provider now reads the published site theme, which pulls in the real
// Supabase client — and that throws "supabaseUrl is required" without a built
// env. Stubbing the client rather than the siteTheme module keeps the
// precedence logic under test instead of mocking it away.
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
import { ColorLabProvider } from './ColorLabProvider';

function renderLayout() {
  return render(
    <MemoryRouter>
      <ColorLabProvider>
        <Layout>
          <div />
        </Layout>
      </ColorLabProvider>
    </MemoryRouter>,
  );
}

describe('the footer entry point', () => {
  beforeEach(() => {
    mockAuth.user = null;
    window.sessionStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('offers a logged-out viewer the staff login, and no Color Lab link', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: 'Staff login' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Color Lab' })).toBeNull();
  });

  it('offers a signed-in staffer the Color Lab instead — they never see the login link', () => {
    mockAuth.user = { id: 'staff-1' };
    renderLayout();
    // The whole reason the second door exists: this link is gone for them.
    expect(screen.queryByRole('link', { name: 'Staff login' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Color Lab' })).toBeTruthy();
  });

  it('opens the panel directly, with no trip through /auth', () => {
    mockAuth.user = { id: 'staff-1' };
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Color Lab' }));
    // The panel is lazily loaded, so what is provable synchronously is that the
    // session recorded the Lab as open — which is what survives navigation.
    expect(window.sessionStorage.getItem('kenworthy.colorlab')).toContain('"on":true');
  });

  it('drops the footer link once the Lab is open, so it cannot be opened twice', () => {
    mockAuth.user = { id: 'staff-1' };
    const { rerender } = renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Color Lab' }));
    rerender(
      <MemoryRouter>
        <ColorLabProvider>
          <Layout>
            <div />
          </Layout>
        </ColorLabProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Color Lab' })).toBeNull();
  });
});

describe('the green CTA', () => {
  beforeEach(() => {
    mockAuth.user = null;
    window.sessionStorage.clear();
  });

  it('is on the header Tickets button and nowhere else in the chrome', () => {
    renderLayout();
    const tickets = screen.getByRole('link', { name: 'Tickets' });
    expect(tickets.className).toContain('bg-success');

    // Donate sits beside it and must stay purple — the whole point of making
    // Tickets green is that the two read as different kinds of action.
    const donate = screen.getByRole('link', { name: /Donate/ });
    expect(donate.className).not.toContain('bg-success');

    const filmPass = screen.getByRole('link', { name: 'Film Pass' });
    expect(filmPass.className).not.toContain('bg-success');
  });
});
