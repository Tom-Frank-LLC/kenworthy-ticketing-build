// Shared ticket-order loading and rendering.
//
// Used by both `ticket-access` (serves the public ticket page + QR images) and
// `send-ticket-confirmation` (emails/texts the ticket). They must agree
// exactly on what an order contains and what the QR encodes, so that logic
// lives here once rather than being copied into each function.

// Deno globals
declare const Deno: any;

import QRCode from 'npm:qrcode@1.5.4';

// The Kenworthy is in Moscow, Idaho — Pacific time. Showtimes are stored as
// timestamptz, so they must be rendered in the venue's zone, not the server's
// (UTC) and not the reader's — a customer travelling would otherwise see the
// wrong showtime printed on their own ticket.
export const VENUE_TIME_ZONE = Deno.env.get('VENUE_TIME_ZONE') || 'America/Los_Angeles';

export interface OrderTicket {
  id: string;
  qr_code: string;
  status: string;
  total_price: number;
  seat: { row: string; number: number } | null;
  tier_name: string | null;
}

export interface Order {
  order_token: string;
  user_id: string;
  purchased_at: string;
  confirmation_sent_at: string | null;
  title: string;
  start_time: string;
  start_time_display: string;
  venue: string | null;
  tickets: OrderTicket[];
  total: number;
}

/** Render a showtime in the venue's local zone, e.g. "Fri, Aug 14, 2026 at 7:30 PM". */
export function formatShowtime(iso: string, timeZone: string = VENUE_TIME_ZONE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  return `${date} at ${time}`;
}

/** "Row C, Seat 12" / "General Admission", with the tier name when there is one. */
export function describeSeat(t: OrderTicket): string {
  const base = t.seat ? `Row ${t.seat.row}, Seat ${t.seat.number}` : 'General Admission';
  return t.tier_name ? `${base} · ${t.tier_name}` : base;
}

export function formatMoney(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`;
}

/**
 * Load an order by its token using a service-role client. Returns null when the
 * token matches nothing. Callers must not distinguish "no such token" from
 * "wrong token" in their responses, so a guesser learns nothing either way.
 */
export async function loadOrder(admin: any, token: string): Promise<Order | null> {
  const { data: rows, error } = await admin
    .from('tickets')
    .select(`
      id, qr_code, status, total_price, purchased_at, order_token, user_id,
      confirmation_sent_at,
      seats(seat_row, seat_number),
      showing_price_tiers(tier_name),
      showings(
        start_time,
        venues(name),
        movies(title),
        events(title),
        live_performances(title)
      )
    `)
    .eq('order_token', token)
    .order('purchased_at', { ascending: true });

  if (error) {
    console.error('[tickets] order lookup failed', error);
    throw new Error('lookup failed');
  }
  if (!rows || rows.length === 0) return null;

  const first: any = rows[0];
  const showing = first.showings || null;
  const title =
    showing?.movies?.title ||
    showing?.events?.title ||
    showing?.live_performances?.title ||
    'Kenworthy showing';

  const tickets: OrderTicket[] = rows.map((t: any) => ({
    id: t.id,
    // Fall back to the row id so a ticket with a null qr_code still produces a
    // scannable code rather than an empty one. The scanner matches on
    // qr_code, so this only ever applies to rows that predate QR assignment.
    qr_code: t.qr_code || t.id,
    status: t.status,
    total_price: Number(t.total_price || 0),
    seat: t.seats ? { row: t.seats.seat_row, number: t.seats.seat_number } : null,
    tier_name: t.showing_price_tiers?.tier_name ?? null,
  }));

  return {
    order_token: token,
    user_id: first.user_id,
    purchased_at: first.purchased_at,
    confirmation_sent_at: first.confirmation_sent_at ?? null,
    title,
    start_time: showing?.start_time ?? '',
    start_time_display: showing?.start_time ? formatShowtime(showing.start_time) : '',
    venue: showing?.venues?.name ?? null,
    tickets,
    total: tickets.reduce((sum, t) => sum + t.total_price, 0),
  };
}

/**
 * PNG QR encoding the ticket's qr_code value — the exact string the door
 * scanner matches against `tickets.qr_code`.
 *
 * Copied into a plain Uint8Array because `toBuffer` hands back a Node Buffer,
 * whose ArrayBufferLike backing is not accepted as a Response BodyInit.
 */
export async function renderQrPng(value: string): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await QRCode.toBuffer(value, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
  return new Uint8Array(buf);
}

/** Public URL of the mobile ticket page for an order. */
export function ticketPageUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, '')}/t/${encodeURIComponent(token)}`;
}

/** Public URL of a single ticket's QR PNG — safe to use as an email <img src>. */
export function ticketQrUrl(supabaseUrl: string, token: string, ticketId: string): string {
  const base = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/ticket-access`;
  return `${base}?token=${encodeURIComponent(token)}&qr=${encodeURIComponent(ticketId)}`;
}
