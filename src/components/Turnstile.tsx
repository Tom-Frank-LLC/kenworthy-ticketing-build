import { useEffect, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile — the bot check on public write forms.
 *
 * Turnstile is a CAPTCHA that almost nobody has to solve: it runs browser
 * checks in the background and, for a real visitor, ticks itself green in a
 * second or two without asking anything. Only traffic that looks scripted gets
 * an interactive challenge.
 *
 * What it produces is a single-use token. The token is worthless on its own —
 * the server hands it to Cloudflare to verify before it will accept the
 * submission (see supabase/functions/rental-request). So this component is not
 * the security control; it is the thing that lets the control exist.
 *
 * ---------------------------------------------------------------------------
 * Unconfigured is a supported state
 * ---------------------------------------------------------------------------
 *
 * VITE_TURNSTILE_SITE_KEY has to be created in the Cloudflare dashboard, which
 * is a human step this code cannot do for itself. Until it is set, this renders
 * nothing and reports ready immediately — the form works exactly as it did.
 *
 * The server makes the matching choice, and the two have to agree: it skips
 * verification when its own secret is unset. Setting the pair of them turns the
 * check on at both ends at once. Setting only one is the case worth avoiding —
 * a site key with no secret means a widget the server ignores, and a secret
 * with no site key means every submission is rejected for a missing token. The
 * runbook (docs/RUNBOOK-deploy-staging-prod.md) says to set both together.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

/**
 * True when a token is required at all — exported so callers can branch.
 *
 * Deliberately alongside the component rather than in its own module: it is
 * the same fact as `if (!SITE_KEY) return null` below, and splitting them is
 * how the two drift into disagreeing. The cost is react-refresh giving up
 * hot-reload for this one file, which is a fair trade for a constant that must
 * never diverge from the component it describes.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const turnstileConfigured = Boolean(SITE_KEY);

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile failed to load')));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.appendChild(script);
  });
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  // onToken is called from Turnstile's own callbacks, which are registered once
  // at render time — so it is held in a ref rather than closed over, or a
  // re-rendered parent would leave the widget calling a stale setter.
  const onTokenRef = useRef(onToken);
  useEffect(() => { onTokenRef.current = onToken; }, [onToken]);

  useEffect(() => {
    if (!SITE_KEY) return;

    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !boxRef.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(boxRef.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => onTokenRef.current(token),
          // A token is single-use and short-lived. Both of these hand back
          // null so the submit button knows it no longer holds a valid one.
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* already gone */ }
      }
    };
  }, []);

  if (!SITE_KEY) return null;

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        The verification check could not load. Please disable any content blocker for this page and
        reload, or email us at{' '}
        <a className="underline" href="mailto:events@kenworthy.org">events@kenworthy.org</a>.
      </p>
    );
  }

  return <div ref={boxRef} className="my-2" />;
}
