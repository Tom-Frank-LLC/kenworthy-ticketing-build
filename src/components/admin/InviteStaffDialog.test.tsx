import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * invite-staff answers a reused account with a `notice`: no invitation email
 * was sent, so the person must use "Forgot password?". The dialog used to drop
 * it, so the admin was never told to pass that on.
 */

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isSuperadmin: false }) }));
const invokeFunction = vi.fn();
vi.mock('@/lib/functions', () => ({ invokeFunction: (...a: unknown[]) => invokeFunction(...a) }));
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

import { InviteStaffDialog } from './InviteStaffDialog';

function submit() {
  render(<InviteStaffDialog open onOpenChange={() => {}} onInvited={() => {}} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pat@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
}

beforeEach(() => {
  invokeFunction.mockReset();
  toastSuccess.mockReset();
});

describe('InviteStaffDialog', () => {
  it('shows the server notice when an existing account was reused', async () => {
    invokeFunction.mockResolvedValue({
      created: false, email: 'pat@example.com', role: 'staff', notice: 'Use Forgot password on /auth.',
    });
    submit();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [title, opts] = toastSuccess.mock.calls[0];
    expect(title).toContain('already had an account');
    expect(opts.description).toBe('Use Forgot password on /auth.');
    expect(opts.duration).toBeGreaterThanOrEqual(10000);
  });

  it('a new account gets the plain invitation message', async () => {
    invokeFunction.mockResolvedValue({ created: true, email: 'pat@example.com', role: 'staff' });
    submit();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toContain("they'll get an email");
    expect(toastSuccess.mock.calls[0][1]).toBeUndefined();
  });
});
