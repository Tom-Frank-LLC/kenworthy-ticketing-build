import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Configured, so the gate has something to wait for. The widget itself is not
// rendered here; this is the state a checkout's submit button reads.
vi.mock('@/components/Turnstile', () => ({ turnstileConfigured: true }));

import { useTurnstileGate } from './useTurnstileGate';

/**
 * The single-use rule, from the browser's side. The server spends a token on
 * the first attempt whatever the outcome, so after a declined card the page
 * must not be left holding the spent one with the Pay button enabled.
 */
describe('useTurnstileGate', () => {
  it('waits for a token, then lets the submit through', () => {
    const { result } = renderHook(() => useTurnstileGate());
    expect(result.current.waiting).toBe(true);
    expect(result.current.waitLabel).toBe('Checking your browser…');

    act(() => result.current.onToken('tok-1'));
    expect(result.current.waiting).toBe(false);
    expect(result.current.waitLabel).toBeNull();
    expect(result.current.token).toBe('tok-1');
  });

  it('says "tick the box" while the widget is showing a checkbox', () => {
    const { result } = renderHook(() => useTurnstileGate());
    act(() => result.current.onInteractive(true));
    expect(result.current.waitLabel).toBe('Tick the box above to continue');
  });

  it('refresh drops the spent token and remounts the widget for a new one', () => {
    const { result } = renderHook(() => useTurnstileGate());
    act(() => result.current.onToken('tok-1'));
    const before = result.current.widgetKey;

    act(() => result.current.refresh());
    expect(result.current.token).toBeNull();
    expect(result.current.waiting).toBe(true);
    expect(result.current.widgetKey).not.toBe(before);
  });
});
