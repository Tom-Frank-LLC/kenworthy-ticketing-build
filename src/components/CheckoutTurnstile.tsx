import { Turnstile } from '@/components/Turnstile';
import type { TurnstileGate } from '@/hooks/useTurnstileGate';

/**
 * The bot check on a form that takes money or books seats: ticket checkout,
 * film passes, donations.
 *
 * Keyed on the gate's `widgetKey`, so `gate.refresh()` after a failed attempt
 * swaps in a fresh widget — and a fresh single-use token — without touching
 * anything else on the form. Place it above the submit button: the button's
 * "Tick the box above to continue" means this.
 *
 * If the check cannot run at all, the way out is the box office, which can
 * sell anything this page can.
 */
export function CheckoutTurnstile({ gate }: { gate: TurnstileGate }) {
  return (
    <Turnstile
      key={gate.widgetKey}
      onToken={gate.onToken}
      onInteractive={gate.onInteractive}
      fallback={
        <>
          call the box office on{' '}
          <a className="underline" href="tel:+12088824127">208-882-4127</a>.
        </>
      }
    />
  );
}
