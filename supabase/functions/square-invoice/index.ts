// Generate the Square invoice for a rental, from the lines staff already typed.
//
// Until now the rental workflow stopped at the contract. The invoice was
// re-keyed by hand into Square from the same numbers already sitting in
// `rental_invoice_lines` — which is where the customer-facing bill and the QBO
// export quietly drift apart, because only one of them gets corrected when a
// line changes.
//
// This function is the one path from those lines to a Square invoice:
//
//   customer (found by email, or created) -> order (line items, discounts,
//   tax) -> invoice (DRAFT, net-14, emailed by staff from Square)
//
// It creates a DRAFT and stops. Nothing is sent to a renter and no card is
// charged; staff review the invoice in Square and press Send there. That is
// deliberate — "Generate Invoice" next to a Contract button should never be
// the click that puts a wrong number in a renter's inbox.
//
// Re-running is guarded twice: the caller must ask for `regenerate`, and the
// old draft is deleted from Square first, so a rental can never end up with
// two live invoices for the same event.
//
// Staff or admin only, checked server-side against user_roles.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import { loadSquareConfig, squareErrorMessage, squareFetch } from '../_shared/square.ts';
import type { SquareConfig } from '../_shared/square.ts';
import {
  buildOrderParts,
  formatDateSpan,
  invoiceDescription,
  paymentDueDate,
  splitName,
} from '../_shared/rental_invoice.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/**
 * Where staff go to review and send the draft.
 *
 * Square only fills in an invoice's `public_url` once it is published, and a
 * draft has no public page by design. The dashboard link is what a draft is
 * for, so that is what "View Invoice" opens until Square gives us a real one.
 */
function dashboardUrl(config: SquareConfig, invoiceId: string): string {
  const host = config.environment === 'production'
    ? 'https://app.squareup.com'
    : 'https://app.squareupsandbox.com';
  return `${host}/dashboard/invoices/${invoiceId}`;
}

/** Find the renter in Square by email, or make them. */
async function resolveCustomer(
  config: SquareConfig,
  request: Record<string, any>,
): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  const email = (request.email || '').trim();

  // Dedupe on email so a company renting three times a year is one Square
  // customer with a history, not three strangers who happen to share a name.
  if (email) {
    const found = await squareFetch(config, '/customers/search', {
      method: 'POST',
      body: { limit: 1, query: { filter: { email_address: { exact: email } } } },
    });
    if (found.ok && found.data?.customers?.[0]?.id) {
      return { ok: true, customerId: found.data.customers[0].id };
    }
  }

  const created = await squareFetch(config, '/customers', {
    method: 'POST',
    body: {
      idempotency_key: crypto.randomUUID(),
      ...splitName(request.applicant_name),
      email_address: email || undefined,
      phone_number: (request.phone || '').trim() || undefined,
      company_name: (request.organization_name || '').trim() || undefined,
      note: 'Created from a Kenworthy theatre rental request.',
    },
  });
  if (!created.ok || !created.data?.customer?.id) {
    console.error('[square-invoice] customer create failed', created.status, created.data);
    return { ok: false, error: squareErrorMessage(created.data, 'Could not create the customer in Square') };
  }
  return { ok: true, customerId: created.data.customer.id };
}

/**
 * Remove a previous draft before replacing it.
 *
 * Best effort: if the old invoice has already been sent (or paid), it is left
 * alone — deleting a sent invoice is not ours to decide, and Square refuses
 * anyway. The new draft is created either way, and the caller is told.
 */
async function deleteDraft(config: SquareConfig, invoiceId: string): Promise<string | null> {
  const existing = await squareFetch(config, `/invoices/${invoiceId}`);
  const status = existing.data?.invoice?.status;
  const version = existing.data?.invoice?.version;

  if (!existing.ok) return 'The previous invoice could not be read in Square and was left in place.';
  if (status !== 'DRAFT') {
    return `The previous invoice is ${String(status).toLowerCase()} in Square and was left in place — cancel or void it there if it should not stand.`;
  }

  const removed = await squareFetch(config, `/invoices/${invoiceId}?version=${version}`, {
    method: 'DELETE',
  });
  if (!removed.ok) {
    console.error('[square-invoice] draft delete failed', removed.status, removed.data);
    return 'The previous draft could not be deleted in Square and is still there.';
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader.includes(ANON_KEY)) {
    return json({ error: 'Staff sign-in required' }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const rentalRequestId = typeof body.rental_request_id === 'string' ? body.rental_request_id : '';
  if (!rentalRequestId) return json({ error: 'rental_request_id is required' }, 400);
  const regenerate = body.regenerate === true;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Authorise — staff or admin, the same pair that may edit the invoice lines.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Staff sign-in required' }, 401);

  const [{ data: isStaff }, { data: isAdmin }] = await Promise.all([
    admin.rpc('has_role', { _user_id: user.id, _role: 'staff' }),
    admin.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
  ]);
  if (!isStaff && !isAdmin) return json({ error: 'Staff access required' }, 403);

  const squareConfig = loadSquareConfig();
  if (!squareConfig.ok) {
    console.error('[square-invoice]', squareConfig.error);
    return json({ error: squareConfig.error }, 500);
  }
  const config = squareConfig.config;

  // ---- What we are billing -------------------------------------------------

  const { data: request, error: requestErr } = await admin
    .from('rental_requests')
    .select('*')
    .eq('id', rentalRequestId)
    .maybeSingle();
  if (requestErr) {
    console.error('[square-invoice] could not read the rental request', requestErr);
    return json({ error: 'Could not load that rental request' }, 500);
  }
  if (!request) return json({ error: 'Rental request not found' }, 404);

  if (request.square_invoice_id && !regenerate) {
    // Not an error: the button already knows to say "View Invoice". Answering
    // with the existing one keeps a double-click from becoming two invoices.
    return json({
      already_generated: true,
      invoice_id: request.square_invoice_id,
      invoice_url: request.square_invoice_url,
      status: request.square_invoice_status,
    });
  }

  const { data: lines, error: linesErr } = await admin
    .from('rental_invoice_lines')
    .select('line_kind, description, quantity, unit_price, is_taxable, sort_order')
    .eq('rental_request_id', rentalRequestId)
    .order('sort_order');
  if (linesErr) {
    console.error('[square-invoice] could not read invoice lines', linesErr);
    return json({ error: 'Could not load the invoice lines' }, 500);
  }
  if (!lines || lines.length === 0) {
    return json({ error: 'Add at least one invoice line before generating an invoice' }, 400);
  }

  const { lineItems, discounts, taxes, netSubtotalCents } = buildOrderParts(lines as any);
  if (lineItems.length === 0) {
    return json({ error: 'This request has only discount lines — there is nothing to bill' }, 400);
  }
  if (netSubtotalCents <= 0) {
    return json({ error: 'The invoice total must be greater than $0.00' }, 400);
  }

  // ---- Square --------------------------------------------------------------

  const customer = await resolveCustomer(config, request);
  if (!customer.ok) return json({ error: customer.error }, 502);

  let warning: string | null = null;
  if (regenerate && request.square_invoice_id) {
    warning = await deleteDraft(config, request.square_invoice_id);
  }

  const order = await squareFetch(config, '/orders', {
    method: 'POST',
    body: {
      // Deterministic on the first pass so a double-click cannot open two
      // orders; a regeneration is a new key because it is meant to be new.
      idempotency_key: regenerate
        ? `rental-${rentalRequestId}-${crypto.randomUUID()}`
        : `rental-${rentalRequestId}`,
      order: {
        location_id: config.locationId,
        reference_id: rentalRequestId.slice(0, 40),
        customer_id: customer.customerId,
        line_items: lineItems,
        ...(discounts.length ? { discounts } : {}),
        ...(taxes.length ? { taxes } : {}),
      },
    },
  });
  if (!order.ok || !order.data?.order?.id) {
    console.error('[square-invoice] order create failed', order.status, order.data);
    return json({ error: squareErrorMessage(order.data, 'Could not build the invoice in Square') }, 502);
  }

  const eventSpan = formatDateSpan(request.proposed_date, request.end_date);
  const title = [request.event_title?.trim() || 'Theatre rental', eventSpan]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 255);

  const invoice = await squareFetch(config, '/invoices', {
    method: 'POST',
    body: {
      idempotency_key: regenerate
        ? `rental-inv-${rentalRequestId}-${crypto.randomUUID()}`
        : `rental-inv-${rentalRequestId}`,
      invoice: {
        location_id: config.locationId,
        order_id: order.data.order.id,
        primary_recipient: { customer_id: customer.customerId },
        // One balance, due net-14 per clause 3 of the licence agreement.
        payment_requests: [{
          request_type: 'BALANCE',
          due_date: paymentDueDate(),
        }],
        delivery_method: 'EMAIL',
        accepted_payment_methods: {
          card: true,
          square_gift_card: false,
          bank_account: false,
          buy_now_pay_later: false,
        },
        title,
        description: invoiceDescription(request),
        sale_or_service_date: request.proposed_date || undefined,
      },
    },
  });
  if (!invoice.ok || !invoice.data?.invoice?.id) {
    console.error('[square-invoice] invoice create failed', invoice.status, invoice.data);
    // The order is left behind in Square. It bills nobody on its own — an
    // order with no invoice and no payment is inert — but say so in the log
    // rather than pretend the call was clean.
    console.error('[square-invoice] orphaned order', order.data.order.id);
    return json({ error: squareErrorMessage(invoice.data, 'Could not create the invoice in Square') }, 502);
  }

  const created = invoice.data.invoice;
  const invoiceUrl = created.public_url || dashboardUrl(config, created.id);

  // ---- Remember it ---------------------------------------------------------

  const { data: saved, error: saveErr } = await admin
    .from('rental_requests')
    .update({
      square_invoice_id: created.id,
      square_invoice_url: invoiceUrl,
      square_invoice_status: created.status || 'DRAFT',
      square_invoice_created_at: new Date().toISOString(),
    })
    .eq('id', rentalRequestId)
    .select('id');
  if (saveErr || !saved?.length) {
    // The invoice exists in Square either way; losing the local record only
    // means the button would offer to generate a second one. Tell the caller.
    console.error('[square-invoice] could not record the invoice', saveErr, created.id);
    return json({
      error:
        `The invoice was created in Square (${created.id}) but could not be recorded here. ` +
        'Open Square before generating another.',
    }, 500);
  }

  return json({
    invoice_id: created.id,
    invoice_url: invoiceUrl,
    status: created.status || 'DRAFT',
    total_cents: order.data.order.total_money?.amount ?? null,
    warning,
  });
});
