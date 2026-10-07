import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { forwardRef, useEffect, useImperativeHandle, type ReactElement } from 'react';
import Donate from './Donate';

/**
 * The newsletter signup for a gift goes from the browser, and only when the
 * donor leaves the box ticked. square-donation does not subscribe anyone (it
 * used to subscribe every donor, and the call never arrived), so this is the
 * one place the rule lives and the one place it is pinned.
 */

const invokeFunction = vi.fn();
vi.mock('@/lib/functions', () => ({
  invokeFunction: (...args: unknown[]) => invokeFunction(...args),
}));

const subscribeToMailchimp = vi.fn();
vi.mock('@/lib/mailchimp', () => ({
  subscribeToMailchimp: (...args: unknown[]) => subscribeToMailchimp(...args),
}));

vi.mock('@/components/SquareCardForm', () => ({
  SquareCardForm: forwardRef<unknown, { onReadyChange?: (r: boolean) => void }>(
    function FakeCard({ onReadyChange }, ref) {
      useImperativeHandle(ref, () => ({ tokenize: async () => 'cnon:test', ready: true }));
      useEffect(() => { onReadyChange?.(true); }, []);
      return null;
    },
  ),
}));

const render = (ui: ReactElement) =>
  rtlRender(<HelmetProvider><MemoryRouter>{ui}</MemoryRouter></HelmetProvider>);

function fillDonor() {
  fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Ada Lovelace King' } });
  fireEvent.change(screen.getByLabelText('Email (for receipt)'), { target: { value: 'ada@example.com' } });
}

async function donate() {
  const button = screen.getByRole('button', { name: /^Donate/ });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(invokeFunction).toHaveBeenCalled());
}

describe('Donate newsletter', () => {
  beforeEach(() => {
    invokeFunction.mockReset();
    invokeFunction.mockResolvedValue({ success: true, receiptUrl: null });
    subscribeToMailchimp.mockReset();
  });

  it('asks, ticked by default, and subscribes the donor after the gift goes through', async () => {
    render(<Donate />);
    expect(screen.getByRole('checkbox', { name: /Email me about upcoming films/ })).toBeChecked();

    fillDonor();
    await donate();

    await waitFor(() => expect(subscribeToMailchimp).toHaveBeenCalledTimes(1));
    expect(subscribeToMailchimp.mock.calls[0][0]).toMatchObject({
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace King',
      tags: ['donor'],
      source: 'donation',
    });
  });

  it('does not subscribe a donor who unticks the box', async () => {
    render(<Donate />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Email me about upcoming films/ }));

    fillDonor();
    await donate();

    await new Promise((r) => setTimeout(r, 50));
    expect(subscribeToMailchimp).not.toHaveBeenCalled();
  });

  it('does not subscribe anyone when the gift fails', async () => {
    invokeFunction.mockResolvedValue({ success: false });
    render(<Donate />);

    fillDonor();
    await donate();

    await new Promise((r) => setTimeout(r, 50));
    expect(subscribeToMailchimp).not.toHaveBeenCalled();
  });
});
