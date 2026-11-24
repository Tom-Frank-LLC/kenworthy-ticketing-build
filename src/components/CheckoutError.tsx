import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A checkout failure the buyer must not miss (BRIEF-checkout-error-visibility).
 *
 * The problem this solves: a failed pay attempt — a declined card, an
 * incomplete bot-check, a server refusal — used to be reported only by a Sonner
 * toast that auto-dismissed in a few seconds, and/or by `text-destructive` red
 * text on the near-black checkout background. The toast was gone before a buyer
 * could re-read the form, and red-on-black is both below the WCAG contrast floor
 * and conveyed by colour alone — invisible to a red-deficient viewer (~8% of
 * men, the reporter of the Oct 7 incident among them). Buyers concluded the site
 * was broken and gave up on a correctable mistake.
 *
 * So this banner is:
 *   - persistent — it stays until the caller clears it (a new attempt), not a
 *     few-second toast;
 *   - high-contrast — the message is `text-foreground` (near-white on dark),
 *     comfortably past 4.5:1, not the low-contrast destructive red;
 *   - never colour-alone — a warning icon AND text carry the error (WCAG 1.4.1),
 *     with the red reserved for the border/icon accent;
 *   - announced — `role="alert"`, and it moves focus/scrolls into view when it
 *     appears so a keyboard or screen-reader user is taken to it.
 *
 * Render it unconditionally with a possibly-null `message`; it returns nothing
 * when there is no error, so callers need no surrounding `&&`.
 */
export function CheckoutError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Bring it into view when it first appears (or its text changes). A buyer who
  // scrolled the pay button up off-screen, or is navigating by keyboard, is
  // otherwise never shown why the purchase stopped.
  useEffect(() => {
    if (message) {
      ref.current?.focus();
      // Optional call: jsdom (tests) has no scrollIntoView, and a stray pay
      // page shouldn't throw over a nicety.
      ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
  }, [message]);

  if (!message) return null;

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cn(
        'flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-foreground outline-none',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="font-medium">{message}</p>
    </div>
  );
}
