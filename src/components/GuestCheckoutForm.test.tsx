import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuestCheckoutForm } from './GuestCheckoutForm';
import { COLLECT_PHONE } from '@/lib/flags';

/**
 * Guards the wiring between the checkout button and Square's card form.
 *
 * This exists because of a bug that every other check missed: `<SquareCardForm>`
 * was rendered without `ref={cardRef}`, so `cardRef.current` stayed null and the
 * submit handler hit a bare `return`. Clicking Pay did *nothing* — no request,
 * no error, no spinner. TypeScript could not catch it (`ref` is optional on a
 * forwardRef component) and the edge-function tests could not either, because
 * the browser never got as far as calling one.
 *
 * So the assertion here is deliberately end-of-the-chain: a filled-in form plus
 * a click must produce a token handed to onPurchase. Anything that breaks the
 * ref, the handle, or the tokenize call fails this test.
 */

const tokenizeCard = vi.fn();

vi.mock('@/lib/square', () => ({
  fetchSquareConfig: vi.fn().mockResolvedValue({
    applicationId: 'sandbox-sq0idb-test',
    locationId: 'LOC_TEST',
    environment: 'sandbox' as const,
  }),
  loadSquareSdk: vi.fn().mockResolvedValue(undefined),
  mountSquareCard: vi.fn().mockResolvedValue({
    attach: vi.fn().mockResolvedValue(undefined),
    tokenize: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  }),
  tokenizeCard: (...args: unknown[]) => tokenizeCard(...args),
  SANDBOX_CARD_HINT: 'Test mode — use card 4111 1111 1111 1111.',
}));

// Exact labels, not /Email/i — the marketing opt-in below the contact fields is
// also labelled "Email me about…", and a loose match now finds both. The
// optional " *" is there because COLLECT_PHONE decides whether email is
// required, and the label says so; the anchor still excludes the opt-in.
const emailField = () => screen.getByLabelText(/^Email( \*)?$/);

function fillContactDetails() {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Tom Staging' } });
  fireEvent.change(emailField(), { target: { value: 'tom@example.com' } });
}

const optIn = () => screen.getByRole('checkbox', { name: /Email me about/i });

describe('GuestCheckoutForm', () => {
  beforeEach(() => {
    tokenizeCard.mockReset();
    tokenizeCard.mockResolvedValue('cnon:card-nonce-ok');
  });

  it('tokenises the card and hands the token to the purchase handler', async () => {
    const onPurchase = vi.fn();
    render(
      <GuestCheckoutForm ticketCount={2} total={16.96} purchasing={false} onPurchase={onPurchase} />,
    );

    const payButton = await screen.findByRole('button', { name: /Pay \$16\.96/ });
    // The card form reports ready through onReadyChange; until then, no paying.
    await waitFor(() => expect(payButton).toBeEnabled());

    fillContactDetails();
    fireEvent.click(payButton);

    await waitFor(() =>
      expect(onPurchase).toHaveBeenCalledWith(
        { name: 'Tom Staging', email: 'tom@example.com', phone: '', newsletter: true },
        'cnon:card-nonce-ok',
      ),
    );
  });

  /**
   * The opt-in is the only consent signal there is.
   *
   * With patron accounts off, nobody signs in to buy a ticket, so the old
   * `profiles.marketing_opt_in` check that gated Mailchimp never fires. This
   * checkbox replaced it — which means an unticked box has to actually travel,
   * or buying a ticket silently becomes subscribing to a mailing list.
   */
  it('carries a cleared opt-in through to the purchase handler', async () => {
    const onPurchase = vi.fn();
    render(
      <GuestCheckoutForm ticketCount={1} total={8.48} purchasing={false} onPurchase={onPurchase} />,
    );

    const payButton = await screen.findByRole('button', { name: /Pay \$8\.48/ });
    await waitFor(() => expect(payButton).toBeEnabled());

    fillContactDetails();
    fireEvent.click(optIn());
    fireEvent.click(payButton);

    await waitFor(() =>
      expect(onPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ newsletter: false }),
        'cnon:card-nonce-ok',
      ),
    );
  });

  it('shows the decline reason instead of failing silently', async () => {
    tokenizeCard.mockRejectedValue(new Error('Card expiration date is invalid'));
    const onPurchase = vi.fn();
    render(
      <GuestCheckoutForm ticketCount={1} total={8.48} purchasing={false} onPurchase={onPurchase} />,
    );

    const payButton = await screen.findByRole('button', { name: /Pay \$8\.48/ });
    await waitFor(() => expect(payButton).toBeEnabled());

    fillContactDetails();
    fireEvent.click(payButton);

    expect(await screen.findByText(/Card expiration date is invalid/)).toBeInTheDocument();
    expect(onPurchase).not.toHaveBeenCalled();
  });

  it('will not submit without a name or a way to reach the buyer', async () => {
    const onPurchase = vi.fn();
    render(
      <GuestCheckoutForm ticketCount={1} total={8.48} purchasing={false} onPurchase={onPurchase} />,
    );

    const payButton = await screen.findByRole('button', { name: /Pay/ });
    await waitFor(() => expect(payButton).toBeEnabled());

    fireEvent.click(payButton);

    expect(await screen.findByText(/Name is required/)).toBeInTheDocument();
    expect(tokenizeCard).not.toHaveBeenCalled();
    expect(onPurchase).not.toHaveBeenCalled();
  });

  /**
   * The reason email is mandatory while COLLECT_PHONE is off.
   *
   * Delivery is Resend or Twilio, and Twilio is not wired up. The old rule was
   * "email or phone", so a buyer who typed only a phone number was charged and
   * then sent nothing at all — no email, and an SMS that does not exist. There
   * was no error anywhere to notice. These two tests are what stops the lenient
   * rule from creeping back in before the SMS side is real.
   */
  describe.skipIf(COLLECT_PHONE)('with phone collection off', () => {
    it('does not ask for a phone number it cannot deliver to', async () => {
      render(
        <GuestCheckoutForm ticketCount={1} total={8.48} purchasing={false} onPurchase={vi.fn()} />,
      );

      await screen.findByRole('button', { name: /Pay/ });
      expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
    });

    it('refuses a purchase with no email, rather than taking money and sending nothing', async () => {
      const onPurchase = vi.fn();
      render(
        <GuestCheckoutForm ticketCount={1} total={8.48} purchasing={false} onPurchase={onPurchase} />,
      );

      const payButton = await screen.findByRole('button', { name: /Pay/ });
      await waitFor(() => expect(payButton).toBeEnabled());

      fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Tom Staging' } });
      fireEvent.click(payButton);

      expect(await screen.findByText(/Email is required so we can send your tickets/))
        .toBeInTheDocument();
      expect(tokenizeCard).not.toHaveBeenCalled();
      expect(onPurchase).not.toHaveBeenCalled();
    });
  });
});
