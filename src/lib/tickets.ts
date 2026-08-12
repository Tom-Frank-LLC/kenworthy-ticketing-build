// Client-side helpers for the public ticket endpoints.
//
// The `ticket-access` edge function is deployed with verify_jwt = false, so
// these URLs work with no session at all — which is the point. They are what a
// customer follows from a confirmation email or SMS, and for a phone-only
// purchase there may never be a session to speak of.

const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL;

const TICKET_ACCESS = `${String(SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/ticket-access`;

export interface PublicOrderTicket {
  id: string;
  qr_code: string;
  status: string;
  total_price: number;
  seat: { row: string; number: number } | null;
  tier_name: string | null;
}

export interface PublicOrder {
  order_token: string;
  purchased_at: string;
  title: string;
  start_time: string;
  start_time_display: string;
  venue: string | null;
  tickets: PublicOrderTicket[];
  total: number;
}

// Note: the app renders QR codes client-side with qrcode.react, so there is no
// helper here for the `?qr=` PNG endpoint. That endpoint exists for the
// confirmation email, where no JS can run — see _shared/tickets.ts.

/** The shareable ticket page for a whole order. */
export function ticketPagePath(token: string): string {
  return `/t/${encodeURIComponent(token)}`;
}

// Flat rather than a discriminated union: this project compiles with
// `strict: false`, where narrowing on a literal `ok` field is not reliable.
export interface FetchOrderResult {
  ok: boolean;
  order?: PublicOrder;
  /** True when the token matched no order, as opposed to a transport failure. */
  notFound?: boolean;
  error?: string;
}

/** Load an order by its token. Never throws — the page renders the failure. */
export async function fetchPublicOrder(token: string): Promise<FetchOrderResult> {
  try {
    const res = await fetch(`${TICKET_ACCESS}?token=${encodeURIComponent(token)}`);
    if (res.status === 404) {
      return { ok: false, notFound: true, error: 'We could not find tickets for this link.' };
    }
    if (!res.ok) {
      return { ok: false, notFound: false, error: 'We could not load your tickets just now.' };
    }
    const body = await res.json();
    if (!body?.order) {
      return { ok: false, notFound: true, error: 'We could not find tickets for this link.' };
    }
    return { ok: true, order: body.order as PublicOrder };
  } catch {
    return { ok: false, notFound: false, error: 'We could not reach the ticket service. Check your connection.' };
  }
}
