import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';

/**
 * The failure this guards against is not "a logged-out visitor got in" — that
 * one is obvious the first time anyone looks. It is the opposite: deciding
 * before `useAuth` has resolved bounces a *signed-in* staff member to /auth on
 * every page refresh, because `user` is null for the moment `getSession()`
 * takes to restore the session from storage. That looks like a flaky login, and
 * it only shows up on reload, which is exactly the path a quick click-through
 * does not take.
 */

let auth = { user: null as unknown, loading: true };
vi.mock('@/lib/auth', () => ({ useAuth: () => auth }));

function AuthPageSpy() {
  const location = useLocation();
  return <div data-testid="auth-page">{location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<AuthPageSpy />} />
        <Route
          path="/dvds"
          element={
            <RequireAuth>
              <div data-testid="protected">catalogue</div>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  it('waits for auth to resolve instead of redirecting a session it has not seen yet', () => {
    auth = { user: null, loading: true };
    renderAt('/dvds');

    expect(screen.queryByTestId('auth-page')).toBeNull();
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('sends a logged-out visitor to /auth carrying where they were going', () => {
    auth = { user: null, loading: false };
    renderAt('/dvds?q=casablanca');

    expect(screen.getByTestId('auth-page').textContent).toBe(
      '?redirect=' + encodeURIComponent('/dvds?q=casablanca'),
    );
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('renders the page once there is a session', () => {
    auth = { user: { id: 'staff-1' }, loading: false };
    renderAt('/dvds');

    expect(screen.getByTestId('protected')).toBeTruthy();
    expect(screen.queryByTestId('auth-page')).toBeNull();
  });
});
