import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The marquee form's bot check, from the visitor's side (#278, #361).
 *
 * - "Checking your browser…" only while the widget solves silently; when it
 *   puts a checkbox on screen, the button says to tick it.
 * - A failed send spent its single-use token, so the widget is remounted for a
 *   new one and the button waits again. It used to keep the spent token and
 *   resend it, which the server refuses as a duplicate.
 */

// The widget, reduced to its callbacks and a mount counter.
let latest: { onToken: (t: string) => void; onInteractive?: (b: boolean) => void } | null = null;
let mounts = 0;
vi.mock('@/components/Turnstile', async () => {
  const { useEffect } = await import('react');
  return {
    turnstileConfigured: true,
    Turnstile: (props: { onToken: (t: string) => void; onInteractive?: (b: boolean) => void }) => {
      latest = props;
      useEffect(() => { mounts += 1; }, []);
      return null;
    },
  };
});
const invokeFunction = vi.fn();
vi.mock('@/lib/functions', () => ({ invokeFunction: (...a: unknown[]) => invokeFunction(...a) }));

import { MarqueeBookingForm } from './MarqueeBookingForm';

function openForm() {
  render(
    <MemoryRouter>
      <MarqueeBookingForm trigger={<button type="button">Book the marquee</button>} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Book the marquee' }));
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Pat' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pat@example.com' } });
  fireEvent.change(screen.getByLabelText('What should the marquee say?'), { target: { value: 'HAPPY 90TH' } });
  fireEvent.change(screen.getByLabelText('Day to display it'), { target: { value: '2099-01-01' } });
}

beforeEach(() => {
  latest = null;
  mounts = 0;
  invokeFunction.mockReset();
});

describe('MarqueeBookingForm bot check', () => {
  it('says "Checking your browser…" only while the check solves silently', () => {
    openForm();
    expect(screen.getByRole('button', { name: 'Checking your browser…' })).toBeDisabled();
    act(() => latest!.onInteractive!(true));
    expect(screen.getByRole('button', { name: 'Tick the box above to continue' })).toBeDisabled();
    act(() => latest!.onToken('tok-1'));
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
  });

  it('gets a fresh token after a failed send, keeping what was typed', async () => {
    invokeFunction.mockRejectedValueOnce(new Error('Bot check failed'));
    openForm();
    act(() => latest!.onToken('tok-1'));
    const mountsBefore = mounts;
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bot check failed'));
    expect(invokeFunction.mock.calls[0][1]).toMatchObject({ turnstile_token: 'tok-1' });
    expect(mounts).toBe(mountsBefore + 1);
    expect(screen.getByRole('button', { name: 'Checking your browser…' })).toBeDisabled();
    expect(screen.getByLabelText('Your name')).toHaveValue('Pat');

    act(() => latest!.onToken('tok-2'));
    invokeFunction.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(invokeFunction).toHaveBeenCalledTimes(2));
    expect(invokeFunction.mock.calls[1][1]).toMatchObject({ turnstile_token: 'tok-2' });
  });
});
