// Square environment + API access, in one place.
//
// Every Square call in this project — donations, ticket checkout, film passes,
// the box-office Terminal, refunds — resolves its credentials and API base
// through here. That is the whole point: "go live" must be a secrets change,
// not a code edit. Before this module the sandbox host and the sandbox
// credential names were hardcoded at each call site, so flipping to production
// meant editing (and re-reviewing) every function.
//
// Selection rule:
//
//   SQUARE_ENV=production  -> SQUARE_PRODUCTION_*  + connect.squareup.com
//   anything else (default) -> SQUARE_SANDBOX_*    + connect.squareupsandbox.com
//
// Defaulting to sandbox is deliberate: a missing or misspelled SQUARE_ENV must
// never silently start charging real cards.

// Deno globals
declare const Deno: any;

export type SquareEnvironment = 'sandbox' | 'production';

export interface SquareConfig {
  environment: SquareEnvironment;
  /** Publishable — safe to hand to the browser SDK. */
  applicationId: string;
  /** Secret — never leaves the edge function. */
  accessToken: string;
  /** Publishable — the browser SDK needs it to build the card form. */
  locationId: string;
  /** e.g. https://connect.squareupsandbox.com/v2 */
  apiBase: string;
}

/** Pinned so a Square API change can never alter behaviour without a deploy. */
export const SQUARE_API_VERSION = '2024-01-18';

const API_BASE: Record<SquareEnvironment, string> = {
  sandbox: 'https://connect.squareupsandbox.com/v2',
  production: 'https://connect.squareup.com/v2',
};

const CREDENTIAL_PREFIX: Record<SquareEnvironment, string> = {
  sandbox: 'SQUARE_SANDBOX',
  production: 'SQUARE_PRODUCTION',
};

export function squareEnvironment(): SquareEnvironment {
  return Deno.env.get('SQUARE_ENV')?.trim().toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
}

/**
 * Resolve the active Square credentials.
 *
 * Returns a config or a human-readable reason it could not be built — callers
 * turn that into a 500. Throwing was avoided so a missing secret surfaces as a
 * clear message ("SQUARE_PRODUCTION_ACCESS_TOKEN is not set") rather than an
 * opaque function crash.
 */
export function loadSquareConfig():
  | { ok: true; config: SquareConfig }
  | { ok: false; error: string } {
  const environment = squareEnvironment();
  const prefix = CREDENTIAL_PREFIX[environment];

  const applicationId = Deno.env.get(`${prefix}_APPLICATION_ID`);
  const accessToken = Deno.env.get(`${prefix}_ACCESS_TOKEN`);
  const locationId = Deno.env.get(`${prefix}_LOCATION_ID`);

  const missing = [
    !applicationId && `${prefix}_APPLICATION_ID`,
    !accessToken && `${prefix}_ACCESS_TOKEN`,
    !locationId && `${prefix}_LOCATION_ID`,
  ].filter(Boolean);

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Square ${environment} credentials not configured: ${missing.join(', ')} not set`,
    };
  }

  return {
    ok: true,
    config: {
      environment,
      applicationId: applicationId!,
      accessToken: accessToken!,
      locationId: locationId!,
      apiBase: API_BASE[environment],
    },
  };
}

/** The publishable half of the config — this is what the browser may see. */
export function publishableConfig(config: SquareConfig) {
  return {
    applicationId: config.applicationId,
    locationId: config.locationId,
    environment: config.environment,
  };
}

/**
 * Call the Square REST API with auth, version pin, and JSON handling applied.
 * `path` is relative to the versioned base, e.g. "/payments".
 */
export async function squareFetch(
  config: SquareConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(`${config.apiBase}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Square-Version': SQUARE_API_VERSION,
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data };
}

/**
 * The message a customer should see for a failed Square call.
 *
 * Square returns a structured error array; `detail` is written for humans
 * ("Card declined. Please use a different card."), so prefer it, then the
 * code, then a generic fallback. Never surface raw JSON to a buyer.
 */
export function squareErrorMessage(data: any, fallback = 'Card was declined'): string {
  return data?.errors?.[0]?.detail || data?.errors?.[0]?.code || fallback;
}

/**
 * Charge a card token.
 *
 * `amountCents` is always the server's number — no caller passes a
 * client-supplied amount through here.
 */
export async function createPayment(
  config: SquareConfig,
  params: {
    sourceId: string;
    amountCents: number;
    idempotencyKey: string;
    referenceId?: string;
    note?: string;
    buyerEmail?: string | null;
  },
) {
  return await squareFetch(config, '/payments', {
    method: 'POST',
    body: {
      idempotency_key: params.idempotencyKey,
      source_id: params.sourceId,
      amount_money: { amount: params.amountCents, currency: 'USD' },
      location_id: config.locationId,
      autocomplete: true,
      reference_id: params.referenceId?.slice(0, 40),
      note: params.note?.slice(0, 500),
      buyer_email_address: params.buyerEmail || undefined,
      statement_description_identifier: 'KENWORTHY',
    },
  });
}

/** Refund a previously captured payment, in whole or in part. */
export async function refundPayment(
  config: SquareConfig,
  params: {
    paymentId: string;
    amountCents: number;
    idempotencyKey: string;
    reason?: string;
  },
) {
  return await squareFetch(config, '/refunds', {
    method: 'POST',
    body: {
      idempotency_key: params.idempotencyKey,
      payment_id: params.paymentId,
      amount_money: { amount: params.amountCents, currency: 'USD' },
      reason: params.reason?.slice(0, 192),
    },
  });
}
