import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The header only shows "signed out" once this device has really let go of
 * the session (audit 2026-10-06, L12).
 *
 * It used to log a failed sign-out and send the browser to /auth regardless,
 * which looked signed out while the token stayed in localStorage. signOut now
 * clears the device even offline and rejects only when it could not — so a
 * rejection means "still signed in here", and the menu has to stay put and say
 * so. lib/signOutDevice.test.ts covers the clearing; this covers the screen.
 */

const signOut = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    isAdmin: false,
    isStaff: true,
    isHost: false,
    isSuperadmin: false,
    loading: false,
    signOut,
  }),
}));
vi.mock('@/hooks/useHiringEnabled', () => ({ useHiringEnabled: () => ({ enabled: false }) }));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { MobileNav } from '@/components/MobileNav';
import { SIGN_OUT_FAILED } from '@/lib/signOutDevice';

let hrefSet: string[];
const realLocation = window.location;

beforeEach(() => {
  signOut.mockReset();
  toastError.mockReset();
  hrefSet = [];
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: unknown }).location = {
    ...realLocation,
    pathname: '/staff',
    search: '',
    set href(v: string) {
      hrefSet.push(v);
    },
    get href() {
      return realLocation.href;
    },
  };
});

afterEach(() => {
  (window as unknown as { location: unknown }).location = realLocation;
});

async function clickSignOut() {
  render(
    <MemoryRouter initialEntries={['/staff']}>
      <MobileNav />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  fireEvent.click(await screen.findByRole('button', { name: /sign out/i }));
}

describe('MobileNav sign-out', () => {
  it('goes to /auth once sign-out resolves', async () => {
    signOut.mockResolvedValue(undefined);
    await clickSignOut();
    await waitFor(() => expect(hrefSet).toEqual(['/auth']));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('stays signed in, visibly, when the session could not be cleared', async () => {
    signOut.mockRejectedValue(new Error('still stored'));
    await clickSignOut();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(SIGN_OUT_FAILED));
    expect(hrefSet).toEqual([]);
  });
});
