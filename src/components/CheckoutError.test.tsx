import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckoutError } from './CheckoutError';

/**
 * The point of this banner is that a failed purchase is *seen*. So the tests
 * pin the two things that made the old treatment invisible (BRIEF-checkout-
 * error-visibility):
 *   - it is announced as an alert and carries the message as text, not a
 *     colour-only node a red-deficient viewer can't distinguish;
 *   - it shows nothing when there is no error, so callers can render it
 *     unconditionally with a possibly-null message.
 */
describe('CheckoutError', () => {
  it('renders nothing when there is no message', () => {
    const { container } = render(<CheckoutError message={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty string', () => {
    render(<CheckoutError message="" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces the failure as an alert with the message as text and an icon (not colour alone)', () => {
    render(<CheckoutError message="Your card was not charged — check the number and try again." />);
    const alert = screen.getByRole('alert');
    // The reason is present as readable text, not conveyed by colour.
    expect(alert).toHaveTextContent('Your card was not charged');
    // And an icon accompanies it, so the error identity does not rely on colour
    // (WCAG 1.4.1). lucide renders an <svg>.
    expect(alert.querySelector('svg')).not.toBeNull();
  });
});
