import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * The Notifications screen writes the one row that decides who staff emails
 * go to, so the two things worth pinning are what it writes and when it
 * refuses to. The read is stubbed with whatever `stored` holds; the upsert
 * records its payload and answers with `upsertRows`, which lets the RLS
 * "204 with no rows" case be exercised without a database.
 */
let stored: unknown = null;
let upsertRows: unknown[] = [{ key: 'staff_notifications' }];
const upserts: any[] = [];
const toasts: { kind: string; msg: string }[] = [];

vi.mock('sonner', () => ({
  toast: {
    success: (msg: string) => toasts.push({ kind: 'success', msg }),
    error: (msg: string) => toasts.push({ kind: 'error', msg }),
  },
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: stored == null ? null : { value: stored }, error: null }),
      }),
    }),
    upsert: (payload: any) => {
      upserts.push(payload);
      return { select: () => Promise.resolve({ data: upsertRows, error: null }) };
    },
  });
  return { supabase: { from } };
});

const { default: NotificationsTab } = await import('./NotificationsTab');

const recipientsBox = () => screen.getByLabelText('Send to') as HTMLTextAreaElement;
const saveButton = () => screen.getByRole('button', { name: /save/i });

describe('NotificationsTab', () => {
  beforeEach(() => {
    stored = null;
    upsertRows = [{ key: 'staff_notifications' }];
    upserts.length = 0;
    toasts.length = 0;
    try { localStorage.clear(); } catch { /* jsdom without storage */ }
  });

  it('shows the default recipient when nothing is stored, and says where emails go', async () => {
    render(<NotificationsTab />);
    await waitFor(() => expect(recipientsBox().value).toBe('events@kenworthy.org'));
    expect(screen.getByText(/currently going to/i).textContent).toContain('events@kenworthy.org');
    // Nothing to save until something changes.
    expect(saveButton()).toBeDisabled();
  });

  it('writes the whole row with the parsed list, and reports the new recipients', async () => {
    stored = { rental_request: { enabled: true, recipients: ['events@kenworthy.org'] } };
    render(<NotificationsTab />);
    await waitFor(() => expect(recipientsBox().value).toBe('events@kenworthy.org'));

    fireEvent.change(recipientsBox(), { target: { value: 'events@kenworthy.org, gm@kenworthy.org\nGM@kenworthy.org' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].key).toBe('staff_notifications');
    expect(upserts[0].value).toEqual({
      rental_request: { enabled: true, recipients: ['events@kenworthy.org', 'gm@kenworthy.org'] },
    });
    await waitFor(() => expect(toasts.at(-1)?.kind).toBe('success'));
    expect(toasts.at(-1)?.msg).toContain('gm@kenworthy.org');
  });

  it('refuses an address it cannot read, by name, and writes nothing', async () => {
    render(<NotificationsTab />);
    await waitFor(() => expect(recipientsBox().value).toBe('events@kenworthy.org'));

    fireEvent.change(recipientsBox(), { target: { value: 'events@kenworthy.org, front desk' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts.at(-1)?.kind).toBe('error'));
    expect(toasts.at(-1)?.msg).toContain('front');
    expect(upserts).toHaveLength(0);
  });

  it('refuses "on, but nobody", which is not what it would mean', async () => {
    render(<NotificationsTab />);
    await waitFor(() => expect(recipientsBox().value).toBe('events@kenworthy.org'));

    fireEvent.change(recipientsBox(), { target: { value: '   ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts.at(-1)?.kind).toBe('error'));
    expect(toasts.at(-1)?.msg).toMatch(/at least one address/i);
    expect(upserts).toHaveLength(0);
  });

  it('switching off writes enabled:false and says nobody will be emailed', async () => {
    render(<NotificationsTab />);
    await waitFor(() => expect(recipientsBox().value).toBe('events@kenworthy.org'));

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(saveButton());

    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].value.rental_request.enabled).toBe(false);
    await waitFor(() => expect(toasts.at(-1)?.msg).toMatch(/nobody will be emailed/i));
  });

  it('treats an RLS-blocked upsert (no rows back) as a failure, not a save', async () => {
    upsertRows = [];
    render(<NotificationsTab />);
    await waitFor(() => expect(recipientsBox().value).toBe('events@kenworthy.org'));

    fireEvent.change(recipientsBox(), { target: { value: 'gm@kenworthy.org' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts.at(-1)?.kind).toBe('error'));
    expect(toasts.at(-1)?.msg).toMatch(/permission/i);
    // The screen still shows the old list as the saved one.
    expect(screen.getByText(/currently going to/i).textContent).toContain('events@kenworthy.org');
  });
});
