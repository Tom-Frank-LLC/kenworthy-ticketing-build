import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { forwardRef, useEffect, useImperativeHandle, type ReactElement } from 'react';
import { FilmPassPurchase } from './FilmPassPurchase';
import type { PassType } from '@/lib/filmPass';

/**
 * A pickup-only pass must never leave the browser as a mail order.
 *
 * The server refuses one anyway (readFulfillment in _shared/pass_orders.ts), but
 * a refusal after the buyer has typed an address and a card is a poor way to
 * learn the pass can't be posted. So the option is not offered at all, and what
 * the page sends is asserted here, at the end of the chain.
 */

const invokeFunction = vi.fn();
vi.mock('@/lib/functions', () => ({
  invokeFunction: (...args: unknown[]) => invokeFunction(...args),
}));

// Square's iframe cannot load under jsdom. A stand-in that is ready at once and
// hands back a fixed token is all the purchase flow needs.
vi.mock('@/components/SquareCardForm', () => ({
  SquareCardForm: forwardRef<unknown, { onReadyChange?: (r: boolean) => void }>(
    function FakeCard({ onReadyChange }, ref) {
      useImperativeHandle(ref, () => ({ tokenize: async () => 'cnon:test', ready: true }));
      useEffect(() => { onReadyChange?.(true); }, []);
      return null;
    },
  ),
}));

const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const PASS: PassType = {
  id: 'pt-1',
  name: 'French Film Festival Pass',
  price: 40,
  initial_balance: 40,
  redemption_price: 8,
  ticket_face_value: null,
  expiration_days: null,
  image_path: null,
  fine_print: null,
  festival_slug: null,
  pickup_only: false,
};

function fillContactDetails() {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Tom Staging' } });
  fireEvent.change(screen.getByLabelText(/^Email( \*)?$/), { target: { value: 'tom@example.com' } });
}

async function pay() {
  const button = screen.getByRole('button', { name: /^Pay/ });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(invokeFunction).toHaveBeenCalledTimes(1));
  return invokeFunction.mock.calls[0][1] as Record<string, unknown>;
}

describe('FilmPassPurchase fulfillment', () => {
  beforeEach(() => {
    invokeFunction.mockReset();
    invokeFunction.mockResolvedValue({ success: true });
  });

  it('offers both choices on a shippable pass, and ships when asked', async () => {
    render(<FilmPassPurchase pass={PASS} onPlaced={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /Collect at the box office/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Ship it to me/ }));

    fillContactDetails();
    fireEvent.change(screen.getByLabelText(/^Street address/), { target: { value: '508 S Main St' } });
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: 'Moscow' } });
    fireEvent.change(screen.getByLabelText(/^ZIP/), { target: { value: '83843' } });

    const body = await pay();
    expect(body.fulfillment).toBe('mail');
    expect(body.mailing_address).toMatchObject({ line1: '508 S Main St', postal_code: '83843' });
  });

  it('offers no shipping on a pickup-only pass and sends a pickup order', async () => {
    render(<FilmPassPurchase pass={{ ...PASS, pickup_only: true }} onPlaced={vi.fn()} />);

    expect(screen.queryByText(/Ship it to me/)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Street address/)).not.toBeInTheDocument();
    expect(screen.getByText(/Pickup only — collect at the box office/)).toBeInTheDocument();

    fillContactDetails();
    const body = await pay();
    expect(body.fulfillment).toBe('pickup');
    expect(body.mailing_address).toBeUndefined();
  });
});
