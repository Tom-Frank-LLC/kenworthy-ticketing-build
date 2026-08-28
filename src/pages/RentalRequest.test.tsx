import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import RentalRequest from './RentalRequest';

/**
 * Guards the two things Backstage mode has to get right, neither of which
 * TypeScript can see.
 *
 * The first is scope: the enquiry must reach the queue tagged
 * `backstage_speakeasy`, and there must be no way to send it tagged as anything
 * else. The venue radio is what used to decide that, and it is gone in this
 * mode — so the value now comes from initial state, which is exactly the kind
 * of thing a later refactor drops without any test noticing.
 *
 * The second is that /rental-request is untouched. One component serves both
 * doors, so every conditional here is also a chance to hide a field from the
 * theatre form by accident.
 */

const invokeFunction = vi.fn().mockResolvedValue({ ok: true, id: 'req_1' });

vi.mock('@/lib/functions', () => ({
  invokeFunction: (...args: unknown[]) => invokeFunction(...args),
}));

// The bot check needs a Cloudflare script and a site key, and has neither here.
// Reported as unconfigured, which is the state the form already supports.
vi.mock('@/components/Turnstile', () => ({
  Turnstile: () => null,
  turnstileConfigured: false,
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

function renderForm(mode?: 'backstage') {
  return render(
    // Backstage mode renders a <SEO> tag; the app supplies this provider in
    // App.tsx, and react-helmet-async throws without one.
    <HelmetProvider>
      <MemoryRouter>
        {mode ? <RentalRequest mode={mode} /> : <RentalRequest />}
      </MemoryRouter>
    </HelmetProvider>,
  );
}

/** The three fields the edge function requires before it will insert a row. */
function fillRequired() {
  fireEvent.change(screen.getByLabelText('Event Title *'), { target: { value: 'Birthday' } });
  fireEvent.change(screen.getByLabelText('Primary Contact Name *'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'ada@example.com' } });
}

beforeEach(() => invokeFunction.mockClear());

describe('Backstage mode', () => {
  it('submits venue_area=backstage_speakeasy without ever asking', async () => {
    renderForm('backstage');

    // No radio to get it wrong with.
    expect(screen.queryByRole('radio', { name: 'Main Stage' })).toBeNull();
    expect(screen.getByTestId('locked-venue')).toHaveTextContent('Backstage Speakeasy');

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Send Enquiry' }));

    await waitFor(() => expect(invokeFunction).toHaveBeenCalled());
    const [fn, payload] = invokeFunction.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('rental-request');
    expect(payload.venue_area).toBe('backstage_speakeasy');
  });

  it('answers no projection question it did not ask', async () => {
    renderForm('backstage');
    expect(screen.queryByText('Film / Media')).toBeNull();
    expect(screen.queryByText('Equipment Requests')).toBeNull();

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Send Enquiry' }));

    await waitFor(() => expect(invokeFunction).toHaveBeenCalled());
    const payload = invokeFunction.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('renter_provides_media');
    expect(payload).not.toHaveProperty('kenworthy_provides_media');
    expect(payload).not.toHaveProperty('media_notes');
  });

  it('keeps the fields Backstage does have', () => {
    renderForm('backstage');
    expect(screen.getByText('Concessions')).toBeInTheDocument();
    expect(screen.getByText('Ticketing')).toBeInTheDocument();
    expect(screen.getByLabelText('Time renter will arrive')).toBeInTheDocument();
    expect(screen.getByLabelText('Anticipated number of guests')).toBeInTheDocument();
  });
});

describe('the theatre form is unchanged', () => {
  it('still offers every venue and the full sheet', () => {
    renderForm();
    expect(screen.getByRole('radio', { name: 'Main Stage' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Backstage Speakeasy' })).toBeInTheDocument();
    expect(screen.getByText('Equipment Requests')).toBeInTheDocument();
    expect(screen.getByText('Film / Media')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Request' })).toBeInTheDocument();
  });
});
