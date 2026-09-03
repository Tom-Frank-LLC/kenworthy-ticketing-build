import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import RentalRequest from './RentalRequest';

/**
 * The submit button has three different waits behind it and they are not the
 * same instruction. Getting this wrong is not cosmetic: on kenworthy.org's
 * first day live, Turnstile put a "verify you are human" checkbox on the page
 * and the button went on saying "Checking your browser…" — telling somebody to
 * wait while the page was waiting on them. It read as a broken form until the
 * checkbox was noticed.
 *
 * The sibling file mocks Turnstile as *unconfigured*, which is the other
 * supported state and cannot exercise any of this. Hence a second file: this
 * one reports it configured and drives the callbacks by hand.
 */

vi.mock('@/lib/functions', () => ({ invokeFunction: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

/** Captured from the mocked widget so a test can play Turnstile. */
let emitToken: ((t: string | null) => void) | undefined;
let emitInteractive: ((v: boolean) => void) | undefined;

vi.mock('@/components/Turnstile', () => ({
  turnstileConfigured: true,
  Turnstile: ({
    onToken,
    onInteractive,
  }: {
    onToken: (t: string | null) => void;
    onInteractive?: (v: boolean) => void;
  }) => {
    emitToken = onToken;
    emitInteractive = onInteractive;
    return null;
  },
}));

function renderForm() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <RentalRequest />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

const button = () =>
  screen.getByRole('button', {
    name: /send request|checking your browser|tick the box above|sending/i,
  });

beforeEach(() => {
  emitToken = undefined;
  emitInteractive = undefined;
});

describe('the submit button says which wait this is', () => {
  it('while the check runs silently, it names the check rather than looking broken', () => {
    renderForm();
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent(/checking your browser/i);
  });

  it('when Turnstile asks for a click, it points at the box instead of saying "wait"', () => {
    renderForm();
    act(() => emitInteractive!(true));

    // The regression this file exists for: "Checking your browser…" here is
    // actively wrong, because the page is waiting on the person.
    expect(button()).not.toHaveTextContent(/checking your browser/i);
    expect(button()).toHaveTextContent(/tick the box above/i);
    expect(button()).toBeDisabled();
  });

  it('once the token arrives it is sendable, whichever path got there', () => {
    renderForm();
    act(() => emitInteractive!(true));
    act(() => {
      emitInteractive!(false);
      emitToken!('a-real-token');
    });

    expect(button()).toBeEnabled();
    expect(button()).toHaveTextContent(/send request/i);
  });

  it('an expiring token puts the button back, and stops claiming a click is needed', () => {
    renderForm();
    act(() => emitToken!('a-real-token'));
    expect(button()).toBeEnabled();

    // Turnstile nulls the token and reports it is no longer interactive.
    act(() => {
      emitInteractive!(false);
      emitToken!(null);
    });

    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent(/checking your browser/i);
  });

  it('the widget is given the interactive callback at all', () => {
    renderForm();
    // Without this wiring the label can never leave "Checking your browser…",
    // which is the exact bug — and it would pass every other test here.
    expect(typeof emitInteractive).toBe('function');
  });
});
