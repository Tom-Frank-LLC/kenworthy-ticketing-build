// Little Green Light sync — the actual posting, callable in-process.
//
// This moved out of the lgl-sync-donation function for the same reason ticket
// delivery moved out of send-ticket-confirmation, and it was failing the same
// two ways:
//
//   1. The function was never deployed. `supabase functions list` on both
//      staging and production returns every other function and not this one, so
//      the fire-and-forget POST from square-donation has been hitting a 404
//      since the integration was written. Nothing surfaced, because nothing
//      awaits a fire-and-forget call.
//
//   2. Even deployed, the call could not have worked. It sent the anon key as
//      `apikey` and the service-role key as `Authorization: Bearer` — the exact
//      pair the Supabase gateway now rejects outright with 401 "Conflicting API
//      keys" (see the note at the top of deliver.ts).
//
// In-process there is no gateway, no credential to forward, and no second cold
// start. The lgl-sync-donation function stays as a thin HTTP wrapper because
// the admin dashboard's backfill button calls it.

// Deno globals
declare const Deno: any;

const LGL_BASE = 'https://api.littlegreenlight.com/api/v1';

export type LglResult =
  | { ok: true; skipped: string; giftId?: string }
  | { ok: true; constituentId: string; giftId: string }
  | { ok: false; error: string; status: number; detail?: string };

/**
 * Post one completed donation to LGL as a constituent + gift.
 *
 * Idempotent per donation via donations.lgl_gift_id, so a retry after a partial
 * failure does not double-count a gift in the donor database. `admin` must be a
 * service-role client.
 */
export async function syncDonationToLgl(
  admin: any,
  donationId: string,
  opts: { force?: boolean } = {},
): Promise<LglResult> {
  const apiKey = Deno.env.get('LGL_API_KEY');
  if (!apiKey) return { ok: false, error: 'LGL not configured', status: 500 };

  const { data: d, error: dErr } = await admin
    .from('donations')
    .select(
      'id, amount_cents, donor_name, donor_email, donor_phone, dedication_type, dedicate_to, message, status, source, lgl_gift_id, lgl_constituent_id, created_at',
    )
    .eq('id', donationId)
    .maybeSingle();

  if (dErr || !d) return { ok: false, error: 'Donation not found', status: 404 };
  if (d.status !== 'completed') {
    return { ok: false, error: `Donation status is ${d.status}, skipping`, status: 400 };
  }
  if (d.lgl_gift_id && !opts.force) {
    return { ok: true, skipped: 'already synced', giftId: d.lgl_gift_id };
  }

  const markError = async (msg: string) => {
    await admin
      .from('donations')
      .update({ lgl_sync_error: msg.slice(0, 500) })
      .eq('id', d.id);
  };

  // A gift with no email cannot be matched to a constituent, and creating one
  // without an address would seed the donor database with unreachable records.
  // This is the walk-in who put a dollar in at the counter: the money is on the
  // books, the CRM entry is a judgement call for a human.
  if (!d.donor_email) {
    await markError('No donor email — recorded locally, not synced to LGL.');
    return { ok: true, skipped: 'no_donor_email' };
  }

  // Dev-stage kill switch. When app_config.lgl_sync_paused = true, no donations
  // reach the live LGL account. Manual "force" calls from the admin dashboard
  // still respect the pause so a superadmin cannot accidentally push demo data
  // live. Delete this block once we're off the sandbox period.
  const { data: pauseRow } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'lgl_sync_paused')
    .maybeSingle();
  if ((pauseRow?.value as any)?.paused === true) {
    await markError('Skipped: LGL sync is paused (superadmin toggle).');
    return { ok: true, skipped: 'lgl_sync_paused' };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    // 1. Resolve constituent — reuse cached id, else search by email, else create.
    let constituentId: string | null = d.lgl_constituent_id ?? null;

    if (!constituentId) {
      const q = encodeURIComponent(`email_address=${d.donor_email}`);
      const sRes = await fetch(`${LGL_BASE}/constituents/search?q=${q}&limit=1`, { headers });
      if (sRes.ok) {
        const sJson = await sRes.json();
        const first = sJson?.items?.[0];
        if (first?.id) constituentId = String(first.id);
      } else if (sRes.status !== 404) {
        const txt = await sRes.text();
        console.warn('[lgl] search failed', sRes.status, txt);
      }
    }

    if (!constituentId) {
      const parts = (d.donor_name || '').trim().split(/\s+/);
      const first_name = parts[0] || '';
      const last_name = parts.slice(1).join(' ') || '(unknown)';
      const payload: any = {
        first_name,
        last_name,
        email_addresses: [
          {
            address: d.donor_email,
            email_address_type_id: 1, // Home — LGL default
            is_preferred: true,
          },
        ],
      };
      if (d.donor_phone) {
        payload.phone_numbers = [
          { number: d.donor_phone, phone_number_type_id: 1, is_preferred: true },
        ];
      }
      const cRes = await fetch(`${LGL_BASE}/constituents`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!cRes.ok) {
        const detail = await cRes.text();
        await markError(`constituent create ${cRes.status}: ${detail}`);
        return { ok: false, error: 'constituent_create_failed', status: cRes.status, detail };
      }
      const cJson = await cRes.json();
      constituentId = String(cJson.id);
    }

    // 2. Post the gift.
    const noteParts: string[] = [`${describeSource(d.source)} Donation id: ${d.id}.`];
    if (d.dedication_type && d.dedicate_to) {
      const label = d.dedication_type === 'in_memory' ? 'In memory of' : 'In honor of';
      noteParts.push(`${label} ${d.dedicate_to}.`);
    }
    if (d.message) noteParts.push(`Message: ${d.message}`);

    const giftPayload: any = {
      received_amount: (d.amount_cents / 100).toFixed(2),
      received_date: (d.created_at as string).slice(0, 10),
      external_id: `kenworthy-donation-${d.id}`,
      note: noteParts.join(' '),
      // Category/payment type IDs vary per LGL account; leave unset so LGL uses defaults.
    };
    const gRes = await fetch(`${LGL_BASE}/constituents/${constituentId}/gifts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(giftPayload),
    });
    if (!gRes.ok) {
      const detail = await gRes.text();
      await markError(`gift create ${gRes.status}: ${detail}`);
      await admin.from('donations').update({ lgl_constituent_id: constituentId }).eq('id', d.id);
      return { ok: false, error: 'gift_create_failed', status: gRes.status, detail };
    }
    const gJson = await gRes.json();

    await admin
      .from('donations')
      .update({
        lgl_constituent_id: constituentId,
        lgl_gift_id: String(gJson.id),
        lgl_synced_at: new Date().toISOString(),
        lgl_sync_error: null,
      })
      .eq('id', d.id);

    return { ok: true, constituentId, giftId: String(gJson.id) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markError(msg);
    return { ok: false, error: msg, status: 500 };
  }
}

/**
 * How the gift reached us, for the LGL note.
 *
 * Worth stating: a gift bundled with a ticket purchase looks different to a
 * development officer than one made on the Donate page, and "why did this
 * person give $5" is answered by "they were buying tickets".
 */
export function describeSource(source: string | null | undefined): string {
  switch (source) {
    case 'ticket_checkout':
      return 'Kenworthy donation added to an online ticket purchase (Square).';
    case 'staff_pos':
      return 'Kenworthy donation taken at the box office.';
    default:
      return 'Kenworthy online donation (Square).';
  }
}
