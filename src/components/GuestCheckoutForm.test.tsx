import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuestCheckoutForm } from './GuestCheckoutForm';
import { COLLECT_PHONE, SMS_DELIVERY_LIVE } from '@/lib/flags';

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
   * Two flags, deliberately, and these blocks are keyed on them separately.
   *
   * COLLECT_PHONE decides whether the field is on the form. SMS_DELIVERY_LIVE
   * decides whether a phone number alone is a contact we can reach — and those
   * are true at different times. The field and its disclosure are live now so
   * an A2P 10DLC reviewer can see the opt-in; the texts are not, because the
   * campaign is unregistered and carriers reject every send. Conflating the two
   * is what charged phone-only buyers and sent them nothing in August.
   */
  describe.skipIf(COLLECT_PHONE)('with the phone field hidden', () => {
    it('does not ask for a phone number it is not collecting', async () => {
      render(
        <GuestCheckoutForm ticketCount={1} total={8.48} purchasing={false} onPurchase={vi.fn()} />,
      );

      await screen.findByRole('button', { name: /Pay/ });
      expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
    });
  });

  describe.skipIf(!COLLECT_PHONE)('with the phone field shown', () => {
    it('asks for a phone number and discloses what texting it means', async () => {
      render(
        <GuestCheckoutForm ticketCount={1} total={8.48} purchasing={false} onPurchase={vi.fn()} />,
      );

      await screen.findByRole('button', { name: /Pay/ });
      expect(screen.getByLabelText(/^Phone$/)).toBeInTheDocument();
      // Rates and STOP are the two disclosures the campaign is reviewed on, and
      // they are in the copy whichever side of SMS_DELIVERY_LIVE we are on.
      expect(screen.getByText(/Message and data rates may apply/)).toBeInTheDocument();
      expect(screen.getByText(/Reply STOP to opt out/)).toBeInTheDocument();
    });
  });

  /**
   * The rule that stops a buyer paying for tickets that cannot reach them.
   *
   * The old "email or phone" was honest only while SMS worked. With delivery
   * off, a buyer who typed only a number was charged and sent nothing at all —
   * no email, and a text the carrier refused — with no error anywhere to
   * notice. This is what keeps the lenient rule from creeping back before the
   * SMS side is real, and it holds whether or not the field is on screen.
   */
  describe.skipIf(SMS_DELIVERY_LIVE)('while SMS cannot deliver', () => {
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

  /**
   * The other side of the same rule, so flipping SMS_DELIVERY_LIVE is covered
   * before it happens rather than discovered afterwards. The number reaches the
   * purchase handler exactly as typed: `toE164` on the server is what
   * normalises it, and trimming or reformatting it here would be doing that job
   * twice, differently.
   */
  describe.skipIf(!SMS_DELIVERY_LIVE)('once SMS can deliver', () => {
    it('takes a phone-only purchase and passes the number through as typed', async () => {
      const onPurchase = vi.fn();
      render(
        <GuestCheckoutForm ticketCount={1} total={8.48} purchasing={false} onPurchase={onPurchase} />,
      );

      const payButton = await screen.findByRole('button', { name: /Pay/ });
      await waitFor(() => expect(payButton).toBeEnabled());

      fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Tom Staging' } });
      fireEvent.change(screen.getByLabelText(/^Phone$/), { target: { value: '(208) 892-9752' } });
      fireEvent.click(payButton);

      await waitFor(() =>
        expect(onPurchase).toHaveBeenCalledWith(
          { name: 'Tom Staging', email: '', phone: '(208) 892-9752', newsletter: true },
          'cnon:card-nonce-ok',
        ),
      );
    });
  });
});
