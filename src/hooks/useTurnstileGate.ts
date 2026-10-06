import { useCallback, useState } from 'react';
import { turnstileConfigured } from '@/components/Turnstile';

/**
 * The bot-check state for a form that pays: the token, whether the submit has
 * to wait for one, what its button should say while it waits, and a way to get
 * a fresh one.
 *
 * Why `refresh` exists. A Turnstile token is single-use: the server spends it
 * on the first attempt whatever happens next. So a declined card, a seat taken
 * a moment ago, or any other refusal leaves the page holding a dead token, and
 * resending it is refused as a duplicate. After any failed attempt the caller
 * calls `refresh()`, which remounts the widget (via `widgetKey`) for a new
 * token. Only the widget remounts — the buyer's name, email and card form are
 * left exactly as they were, so a retry is "fix the card, press Pay again".
 *
 * Why the label has two waiting states. Managed Turnstile decides per visitor
 * whether to solve silently or put a checkbox on screen, and on kenworthy.org
 * it put a checkbox in front of real people the day it went live. A button
 * that said "Checking your browser…" then was telling them to wait at the
 * moment the page was waiting on them (#278). `onInteractive` is how the
 * widget says which wait this is.
 *
 * Unconfigured (no VITE_TURNSTILE_SITE_KEY) never waits, matching the widget,
 * which renders nothing. The checkouts' server refuses without a token, so a
 * build without the site key cannot take money — loudly, at the first attempt,
 * which is the intent.
 */
export function useTurnstileGate() {
  const [token, setToken] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  const [widgetKey, setWidgetKey] = useState(0);

  const refresh = useCallback(() => {
    setToken(null);
    setInteractive(false);
    setWidgetKey((k) => k + 1);
  }, []);

  const waiting = turnstileConfigured && !token;

  return {
    token,
    /** True while the submit must not fire: a check is configured and unsolved. */
    waiting,
    /** The submit button's label while `waiting`; null otherwise. */
    waitLabel: waiting
      ? interactive
        ? 'Tick the box above to continue'
        : 'Checking your browser…'
      : null,
    refresh,
    widgetKey,
    onToken: setToken,
    onInteractive: setInteractive,
  };
}

export type TurnstileGate = ReturnType<typeof useTurnstileGate>;
