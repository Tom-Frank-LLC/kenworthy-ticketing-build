// Shared ticket-order loading and rendering.
//
// Used by both `ticket-access` (serves the public ticket page + QR images) and
// `send-ticket-confirmation` (emails/texts the ticket). They must agree
// exactly on what an order contains and what the QR encodes, so that logic
// lives here once rather than being copied into each function.

// Deno globals
declare const Deno: any;

// qrcode-generator is pure JavaScript with zero dependencies: it produces the
// module matrix and nothing else.
//
// The obvious choice, `npm:qrcode`, cannot be used here. It works under local
// Deno but fails to boot in the Supabase edge runtime, because it pulls in
// pngjs, which needs node streams and zlib. PNG encoding is therefore done
// below against Web APIs only (CompressionStream), which the edge runtime does
// support.
import qrcodeGenerator from 'https://esm.sh/qrcode-generator@1.4.4';

// The Kenworthy is in Moscow, Idaho — Pacific time. Showtimes are stored as
// timestamptz, so they must be rendered in the venue's zone, not the server's
// (UTC) and not the reader's — a customer travelling would otherwise see the
// wrong showtime printed on their own ticket.
export const VENUE_TIME_ZONE = Deno.env.get('VENUE_TIME_ZONE') || 'America/Los_Angeles';

export interface OrderTicket {
  id: string;
  qr_code: string;
  status: string;
  /** Set once the ticket has been scanned at the door. */
  scanned_at: string | null;
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
  /** Movie runtime in minutes when known; null for events/live performances. */
  duration_minutes: number | null;
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
      id, qr_code, status, scanned_at, total_price, purchased_at, order_token, user_id,
      confirmation_sent_at,
      seats(seat_row, seat_number),
      showing_price_tiers(tier_name),
      showings(
        start_time,
        venues(name),
        movies(title, duration_minutes),
        events(title),
        live_performances(title)
      )
    `)
    .eq('order_token', token)
    // A ticket exists from the moment checkout starts, before the card is
    // charged. Only a paid one is admissible at the door, so pending and failed
    // orders are invisible here — including to whoever holds the token.
    .not('status', 'in', '("pending","failed")')
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
    scanned_at: t.scanned_at ?? null,
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
    duration_minutes: showing?.movies?.duration_minutes ?? null,
    tickets,
    total: tickets.reduce((sum, t) => sum + t.total_price, 0),
  };
}

// --- Minimal PNG encoder ----------------------------------------------------
//
// Only what a QR needs: 8-bit greyscale, no interlacing, no palette. Written
// against Web APIs so it runs in the edge runtime (see the import note above).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

/** zlib-wrapped deflate, which is exactly what a PNG IDAT expects. */
async function zlibDeflate(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * PNG QR encoding the ticket's qr_code value — the exact string the door
 * scanner matches against `tickets.qr_code`.
 *
 * Used for the confirmation email, where no JavaScript can run. The app pages
 * render their QR client-side with qrcode.react instead.
 */
export async function renderQrPng(
  value: string,
  opts: { scale?: number; margin?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const scale = opts.scale ?? 8;
  const margin = opts.margin ?? 2;

  // typeNumber 0 = pick the smallest version that fits; 'M' error correction
  // tolerates ~15% damage, which covers a creased printout or a smudged phone
  // screen without inflating the module count.
  const qr = qrcodeGenerator(0, 'M');
  qr.addData(value);
  qr.make();

  const modules = qr.getModuleCount();
  const size = (modules + margin * 2) * scale;

  // One filter byte (0 = None) per scanline, then one byte per pixel.
  const stride = 1 + size;
  const raw = new Uint8Array(stride * size).fill(0xff);
  for (let y = 0; y < size; y++) raw[y * stride] = 0;

  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.isDark(row, col)) continue;
      const x0 = (col + margin) * scale;
      const y0 = (row + margin) * scale;
      for (let dy = 0; dy < scale; dy++) {
        const rowStart = (y0 + dy) * stride + 1 + x0;
        raw.fill(0x00, rowStart, rowStart + scale);
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, size); // width
  ihdrView.setUint32(4, size); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', await zlibDeflate(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
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
