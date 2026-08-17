import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

/**
 * Regression: picking a swatch must repaint the page *now*, not on the next pick.
 *
 * The Lab shipped running exactly one selection behind. `applyEffectiveTheme`
 * fetched the session override out of `sessionStorage` itself, and the provider
 * wrote storage *after* painting — so every click applied the previous click's
 * colour, forever.
 *
 * Nothing caught it. The resolver's own tests wrote to storage and then called
 * the resolver, which is the correct order, so they quietly satisfied the hidden
 * requirement instead of testing it. The bug lived in the *sequencing* inside
 * the provider, and no test rendered the provider at all.
 *
 * So this test drives the provider the way a click does — call setPurple, then
 * look at what is actually on <html> — with no storage priming anywhere. It
 * fails against the old code and passes against the new.
 */

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  },
}));

import { ColorLabProvider, useColorLab } from './ColorLabProvider';
import { hexToHslCss } from '@/lib/colorLab';

function Harness() {
  const { setPurple, setGreen, reset } = useColorLab();
  return (
    <>
      <button onClick={() => setPurple('#B262DA')}>purple-1</button>
      <button onClick={() => setPurple('#8443B1')}>purple-2</button>
      <button onClick={() => setGreen('#125A51')}>green-1</button>
      <button onClick={() => reset()}>reset</button>
    </>
  );
}

const primary = () => document.documentElement.style.getPropertyValue('--primary');
const success = () => document.documentElement.style.getPropertyValue('--success');

function click(label: string) {
  act(() => {
    screen.getByText(label).click();
  });
}

describe('a swatch applies on the click that chose it', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('paints the first pick immediately, with nothing primed in storage', () => {
    render(
      <ColorLabProvider>
        <Harness />
      </ColorLabProvider>,
    );
    // The old code painted nothing here — storage was still empty at paint time.
    click('purple-1');
    expect(primary()).toBe(hexToHslCss('#B262DA'));
  });

  it('does not lag one selection behind across successive picks', () => {
    render(
      <ColorLabProvider>
        <Harness />
      </ColorLabProvider>,
    );
    click('purple-1');
    click('purple-2');
    // The old code showed purple-1 at this point.
    expect(primary()).toBe(hexToHslCss('#8443B1'));
    expect(primary()).not.toBe(hexToHslCss('#B262DA'));
  });

  it('keeps the two channels independent when applied back to back', () => {
    render(
      <ColorLabProvider>
        <Harness />
      </ColorLabProvider>,
    );
    click('purple-2');
    click('green-1');
    expect(primary()).toBe(hexToHslCss('#8443B1'));
    expect(success()).toBe(hexToHslCss('#125A51'));
  });

  it('clears on reset rather than reverting to the previous pick', () => {
    render(
      <ColorLabProvider>
        <Harness />
      </ColorLabProvider>,
    );
    click('purple-1');
    click('purple-2');
    click('reset');
    expect(primary()).toBe('');
    expect(success()).toBe('');
  });

  it('still records the pick in sessionStorage so it survives a reload', () => {
    render(
      <ColorLabProvider>
        <Harness />
      </ColorLabProvider>,
    );
    click('purple-1');
    expect(window.sessionStorage.getItem('kenworthy.colorlab')).toContain('#B262DA');
  });
});
