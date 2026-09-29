import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * The "Sandbox mode" warning on the POS card option.
 *
 * It used to render unconditionally, so production showed "payments are
 * simulated, no real charges" on every card sale. It must follow the server's
 * Square environment — and when that cannot be read, say nothing rather than
 * claim sandbox.
 */

const config = vi.hoisted(() => ({
  result: null as null | { environment: 'sandbox' | 'production' } | Error,
  calls: 0,
}));

vi.mock('@/lib/square', () => ({
  fetchSquareConfig: () => {
    config.calls += 1;
    const r = config.result;
    return r instanceof Error
      ? Promise.reject(r)
      : Promise.resolve({ applicationId: 'app', locationId: 'loc', ...r });
  },
}));

const { PaymentMethodSelector } = await import('./PaymentMethodSelector');
const { resetSquareEnvironmentCache } = await import('@/hooks/useSquareEnvironment');

const SANDBOX = /sandbox mode/i;

beforeEach(() => {
  resetSquareEnvironmentCache();
  config.calls = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function renderCard() {
  return render(<PaymentMethodSelector paymentMethod="card" onSelect={() => {}} />);
}

describe('PaymentMethodSelector — sandbox warning', () => {
  it('shows no sandbox warning in production', async () => {
    config.result = { environment: 'production' };
    renderCard();
    await waitFor(() => expect(config.calls).toBe(1));
    // Let the resolved config reach state before asserting its absence.
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByText(SANDBOX)).toBeNull();
  });

  it('shows the warning when the server is on the sandbox', async () => {
    config.result = { environment: 'sandbox' };
    renderCard();
    expect(await screen.findByText(SANDBOX)).toBeInTheDocument();
  });

  it('never claims sandbox when the environment cannot be read', async () => {
    config.result = new Error('Could not load payment configuration');
    renderCard();
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(screen.queryByText(SANDBOX)).toBeNull();
  });

  it('shows nothing for cash, whatever the environment', async () => {
    config.result = { environment: 'sandbox' };
    render(<PaymentMethodSelector paymentMethod="cash" onSelect={() => {}} />);
    await waitFor(() => expect(config.calls).toBe(1));
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByText(SANDBOX)).toBeNull();
  });
});
