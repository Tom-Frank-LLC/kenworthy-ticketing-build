import { supabase } from '@/integrations/supabase/client';

/**
 * Square Web Payments SDK: loading, configuration, and tokenising.
 *
 * Card details are entered into an iframe served by Square, from Square's own
 * origin. This code never sees a card number — it receives a single-use token
 * and passes it to an edge function, which is the only thing that talks to the
 * Square API. That is what keeps the theatre out of PCI scope (SAQ A-EP).
 *
 * Which Square environment is in play is decided by the *server*
 * (`SQUARE_ENV` on the edge functions) and reported back by `get_config`. The
 * browser then loads the matching SDK bundle. Deliberately not a second
 * VITE_SQUARE_ENV build flag: two switches for one decision can disagree, and
 * the failure mode of disagreement is a live card entered into a sandbox form.
 */

const SDK_SRC: Record<SquareEnvironment, string> = {
  sandbox: 'https://sandbox.web.squarecdn.com/v1/square.js',
  production: 'https://web.squarecdn.com/v1/square.js',
};

export type SquareEnvironment = 'sandbox' | 'production';

export interface SquareConfig {
  applicationId: string;
  locationId: string;
  environment: SquareEnvironment;
}

export interface SquareCard {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: { message: string }[] }>;
  destroy: () => Promise<void>;
}

declare global {
  interface Window {
    Square?: {
      payments: (
        appId: string,
        locationId: string,
      ) => { card: (options?: Record<string, unknown>) => Promise<SquareCard> };
    };
  }
}

/**
 * Any function exposing a `get_config` action. All of them return the same
 * publishable pair, from the same shared server-side resolution.
 */
export type SquareConfigSource = 'ticket-checkout' | 'film-pass-checkout' | 'square-donation';

export async function fetchSquareConfig(source: SquareConfigSource): Promise<SquareConfig> {
  const { data, error } = await supabase.functions.invoke(source, {
    body: { action: 'get_config' },
  });
  if (error || !data?.applicationId || !data?.locationId) {
    throw new Error(data?.error || error?.message || 'Could not load payment configuration');
  }
  return {
    applicationId: data.applicationId,
    locationId: data.locationId,
    environment: data.environment === 'production' ? 'production' : 'sandbox',
  };
}

/** Load the SDK bundle for this environment, at most once per page. */
export async function loadSquareSdk(environment: SquareEnvironment): Promise<void> {
  if (window.Square) return;

  const src = SDK_SRC[environment];
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (window.Square) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Card form failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Card form failed to load'));
    document.head.appendChild(script);
  });

  if (!window.Square) throw new Error('Card form failed to load');
}

/** Mount a card input into `selector` and return the handle used to tokenise. */
export async function mountSquareCard(
  config: SquareConfig,
  selector: string,
): Promise<SquareCard> {
  if (!window.Square) throw new Error('Card form is not ready');
  const payments = window.Square.payments(config.applicationId, config.locationId);
  const card = await payments.card();
  await card.attach(selector);
  return card;
}

/**
 * Turn the entered card into a one-time token.
 *
 * Throws with the message Square gave (e.g. "Card expiration date is invalid"),
 * because that message is the one worth showing the customer.
 */
export async function tokenizeCard(card: SquareCard): Promise<string> {
  const result = await card.tokenize();
  if (result.status !== 'OK' || !result.token) {
    throw new Error(result.errors?.[0]?.message ?? 'Please check your card details.');
  }
  return result.token;
}

/** Test-card reminder, shown only while the sandbox credentials are in use. */
export const SANDBOX_CARD_HINT =
  'Test mode — use card 4111 1111 1111 1111, any future expiry, any CVV, any ZIP.';
