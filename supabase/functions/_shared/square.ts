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
//
// Each credential falls back to an unprefixed name — SQUARE_APPLICATION_ID,
// SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID — because that is how both Supabase
// projects are actually configured: one credential set whose *values* are
// swapped at go-live, rather than two sets selected by a flag. (Staging is a
// mixture: SQUARE_APPLICATION_ID alongside SQUARE_SANDBOX_ACCESS_TOKEN and
// SQUARE_SANDBOX_LOCATION_ID.) The prefixed names win where they exist, so a
// project can hold both sets and flip with SQUARE_ENV alone; the fallback is
// what lets everything else keep working untouched.
//
// Note the consequence when going live: if SQUARE_ENV=production is set but no
// SQUARE_PRODUCTION_* secrets exist, the unprefixed values are used against the
// live API host. Sandbox credentials there are rejected by Square, so this
// fails loudly at the card form — it cannot quietly charge the wrong account.

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

  /** Env-prefixed name if set, else the unprefixed one this project uses. */
  const credential = (suffix: string) =>
    Deno.env.get(`${prefix}_${suffix}`) || Deno.env.get(`SQUARE_${suffix}`);

  const applicationId = credential('APPLICATION_ID');
  const accessToken = credential('ACCESS_TOKEN');
  const locationId = credential('LOCATION_ID');

  const missing = [
    !applicationId && 'APPLICATION_ID',
    !accessToken && 'ACCESS_TOKEN',
    !locationId && 'LOCATION_ID',
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    // Name both accepted spellings, so the fix is obvious from the error alone.
    const names = missing.map((s) => `${prefix}_${s} (or SQUARE_${s})`).join(', ');
    return {
      ok: false,
      error: `Square ${environment} credentials not configured: ${names} not set`,
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

/** Shared payment body. The tender is the only thing that differs. */
function paymentBody(
  config: SquareConfig,
  params: {
    amountCents: number;
    idempotencyKey: string;
    referenceId?: string;
    note?: string;
    buyerEmail?: string | null;
    orderId?: string | null;
  },
) {
  return {
    idempotency_key: params.idempotencyKey,
    amount_money: { amount: params.amountCents, currency: 'USD' },
    location_id: config.locationId,
    autocomplete: true,
    // The reconciliation hook. Every paid row in our database carries the same
    // token, so a Square payment can be matched back to its order without
    // guessing. Never drop this.
    reference_id: params.referenceId?.slice(0, 40),
    note: params.note?.slice(0, 500),
    buyer_email_address: params.buyerEmail || undefined,
    // Attribution (see createAttributionOrder). Absent, Square still creates an
    // order behind the payment — but its single line is CUSTOM_AMOUNT with no
    // name, which is why per-film revenue never reached Item Sales.
    order_id: params.orderId || undefined,
    statement_description_identifier: 'KENWORTHY',
  };
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
    orderId?: string | null;
  },
) {
  return await squareFetch(config, '/payments', {
    method: 'POST',
    body: { ...paymentBody(config, params), source_id: params.sourceId },
  });
}

/**
 * Register cash taken at the counter.
 *
 * The policy is that no money is collected that does not go through Square, and
 * until this existed the code did not implement it: an in-person cash ticket or
 * film pass wrote database rows and never contacted Square at all, so the books
 * were short by exactly the cash take. Square's Payments API has supported cash
 * tenders all along.
 *
 * `buyerSuppliedCents` is what the patron actually handed over. Square derives
 * `change_back_money` from it, so passing the note tendered gets the drawer
 * arithmetic recorded on Square's side too. Defaults to the exact amount, which
 * is the honest answer when the till took the exact money or nobody typed it in.
 */
export async function createCashPayment(
  config: SquareConfig,
  params: {
    amountCents: number;
    idempotencyKey: string;
    buyerSuppliedCents?: number | null;
    referenceId?: string;
    note?: string;
    buyerEmail?: string | null;
    orderId?: string | null;
  },
) {
  // Square rejects a buyer-supplied amount below the price, which would turn a
  // mistyped tender into a failed sale with the cash already in the drawer.
  const supplied = Number(params.buyerSuppliedCents);
  const buyerSupplied = Number.isFinite(supplied) && supplied >= params.amountCents
    ? Math.round(supplied)
    : params.amountCents;

  return await squareFetch(config, '/payments', {
    method: 'POST',
    body: {
      ...paymentBody(config, params),
      source_id: 'CASH',
      cash_details: {
        buyer_supplied_money: { amount: buyerSupplied, currency: 'USD' },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * One ad-hoc line on a Square order.
 *
 * `amountCents` is **tax-inclusive**, and that is not a shortcut — it is forced.
 * Square computes a percentage tax once over the line total; our pricing rounds
 * tax per ticket row, mirroring the `enforce_ticket_pricing` trigger. Measured
 * in sandbox on 3 × $8.25: we charge 2625, Square's own tax arithmetic makes it
 * 2623. Letting Square compute the tax would mean the amount charged no longer
 * equals SUM(tickets.total_price) — the sum the refund path re-reads — for a
 * two-cent gain in Square's tax report. So the price we charge goes on the line
 * whole, and Square's tax reporting is not fed from here.
 */
export interface SquareLineItem {
  /** What Item Sales groups by. The film or pass name, nothing else. */
  name: string;
  quantity: number;
  /** Tax-inclusive, per unit. */
  amountCents: number;
  /** Tier or fulfilment detail — a variation under the item, not a new item. */
  variationName?: string | null;
  note?: string | null;
}

export function lineItemsTotalCents(items: SquareLineItem[]): number {
  return items.reduce((sum, li) => sum + li.amountCents * li.quantity, 0);
}

/**
 * Create the Square order a payment is attributed to, and return its id.
 *
 * Why this exists: a bare `/payments` call still produces a Square order, but
 * its only line is `item_type: CUSTOM_AMOUNT` with no name (verified in
 * sandbox). Totals tie out; nothing says which film earned the money, so Item
 * Sales shows ticket revenue apparently declining as sales move to our system.
 * Naming the line fixes that.
 *
 * Deliberately **ad-hoc**: no `catalog_object_id`, and nothing here reads or
 * writes `/catalog`. That is the whole point. The 14 Aug incident was our code
 * writing catalog objects; an order line named for a film needs no catalog entry
 * to exist, which also means it works for a film created this morning.
 *
 * **Returns null rather than throwing, always.** Attribution is a reporting
 * nicety and a sale is money. If the order call fails, or the lines do not add
 * up to the amount about to be charged, the caller carries on and creates a bare
 * payment: the money still moves and `reference_id` still reconciles. The one
 * thing that must never happen is a patron refused at the counter because a
 * reporting call had a bad day.
 */
export async function createAttributionOrder(
  config: SquareConfig,
  params: {
    idempotencyKey: string;
    referenceId?: string;
    lineItems: SquareLineItem[];
    /** The amount about to be charged. Must equal the lines exactly. */
    expectedTotalCents: number;
  },
): Promise<string | null> {
  if (!squareOrderAttributionEnabled()) return null;

  const lines = params.lineItems.filter((li) => li.quantity > 0 && li.amountCents > 0);
  if (lines.length === 0) return null;

  // A payment may not exceed its order's total, and an order left larger than
  // its payment sits partly paid in Square's books forever. Either way the
  // mismatch is a bug in the caller's line building, so it is caught here —
  // before any money moves — and the sale proceeds unattributed.
  const total = lineItemsTotalCents(lines);
  if (total !== params.expectedTotalCents) {
    console.error('[square] attribution lines do not match the charge; skipping order', {
      lineTotal: total,
      expected: params.expectedTotalCents,
    });
    return null;
  }

  try {
    const result = await squareFetch(config, '/orders', {
      method: 'POST',
      body: {
        idempotency_key: params.idempotencyKey,
        order: {
          location_id: config.locationId,
          reference_id: params.referenceId?.slice(0, 40),
          line_items: lines.map((li) => ({
            name: li.name.slice(0, 512),
            quantity: String(li.quantity),
            base_price_money: { amount: li.amountCents, currency: 'USD' },
            variation_name: li.variationName?.slice(0, 255) || undefined,
            note: li.note?.slice(0, 500) || undefined,
          })),
        },
      },
    });

    if (!result.ok || !result.data?.order?.id) {
      console.error('[square] attribution order failed', JSON.stringify(result.data));
      return null;
    }
    return result.data.order.id as string;
  } catch (err) {
    console.error('[square] attribution order threw', err);
    return null;
  }
}

/**
 * Whether ticket and film-pass payments carry a named Square order.
 *
 * Default **on**, which breaks the convention of the other flags in this
 * project — and the difference is the point. Those gate writes that can destroy
 * vendor data, so an unset secret must mean "do nothing". This write creates a
 * new order object and never touches an existing one, so the worst an unwanted
 * "on" can do is name a line item. Defaulting off would instead ship a feature
 * that silently does nothing until somebody remembers to set a secret on both
 * projects, which is a failure this codebase has already had.
 *
 * Set `SQUARE_ORDER_ATTRIBUTION=false` to fall back to bare payments without a
 * redeploy. Reconciliation does not depend on it either way.
 */
export function squareOrderAttributionEnabled(): boolean {
  return (Deno.env.get('SQUARE_ORDER_ATTRIBUTION') ?? '').trim().toLowerCase() !== 'false';
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
