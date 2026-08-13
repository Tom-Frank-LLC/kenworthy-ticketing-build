// Printing blank film-pass stickers.
//
// A pass starts life as a sticker with a QR code and nothing else: no owner, no
// balance, no expiry. Those arrive when staff scan it at handoff. So this
// function's whole job is to mint N unguessable codes under one batch id and
// hand them back for printing.
//
// Why an edge function rather than a client insert: no browser may write
// user_film_passes any more. A pass row now carries a spendable balance and a
// status the door scanner trusts, so the ability to insert one is the ability
// to print money. The service role is the only writer, and this is the only
// place it mints blanks.
//
// The codes are `PASS:<uuid>`. The prefix is not decoration — it is what lets
// the door scanner tell a pass from a ticket without a speculative query
// against both tables, and what lets the box office reject a ticket QR held up
// at the activation screen.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import { authenticatedUser } from '../_shared/buyers.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * The most stickers one run may mint.
 *
 * A sheet of Avery labels is 30 to a page; a few hundred is a real print run
 * and ten thousand is a typo. The cap exists so a slipped keystroke cannot fill
 * the table with codes nobody will ever print.
 */
const MAX_BATCH = 500;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const action = String(body.action ?? 'create');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const signedIn = await authenticatedUser(createClient, req);
  if (!signedIn) return json({ error: 'Staff sign-in required' }, 401);

  const { data: isStaff } = await admin.rpc('has_role', {
    _user_id: signedIn.id,
    _role: 'staff',
  });
  if (!isStaff) return json({ error: 'Staff access required' }, 403);

  // -------------------------------------------------------------------------
  // Re-open a batch for reprinting
  // -------------------------------------------------------------------------
  //
  // Printers jam and sheets go missing. Reprinting is reading the codes back,
  // not minting new ones — a second sticker for a code already stuck to a pass
  // would be a duplicate pass, so this deliberately cannot create anything.
  if (action === 'list') {
    const batchId = String(body.batch_id ?? '').trim();
    if (!batchId) return json({ error: 'Which batch?' }, 400);

    const { data, error } = await admin
      .from('user_film_passes')
      .select('id, qr_code, status, batch_id, created_at, film_pass_types!user_film_passes_pass_type_id_fkey(name, price, initial_balance, redemption_price)')
      .eq('batch_id', batchId)
      .order('created_at');

    if (error) {
      console.error('[film-pass-batch] list failed', error);
      return json({ error: 'Could not read that batch' }, 500);
    }

    return json({
      batch_id: batchId,
      pass_type: (data?.[0] as any)?.film_pass_types ?? null,
      passes: (data || []).map((p: any) => ({
        id: p.id,
        qr_code: p.qr_code,
        status: p.status,
      })),
    });
  }

  // -------------------------------------------------------------------------
  // Recent batches, so the print view has something to offer
  // -------------------------------------------------------------------------
  if (action === 'batches') {
    const { data, error } = await admin
      .from('user_film_passes')
      .select('batch_id, created_at, status, film_pass_types!user_film_passes_pass_type_id_fkey(name)')
      .not('batch_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) {
      console.error('[film-pass-batch] batches failed', error);
      return json({ error: 'Could not read batches' }, 500);
    }

    // Grouped here rather than in SQL: PostgREST has no GROUP BY, and a view
    // for this would be a schema object earning its keep once.
    const byBatch = new Map<string, any>();
    for (const row of (data || []) as any[]) {
      const entry = byBatch.get(row.batch_id) ?? {
        batch_id: row.batch_id,
        pass_type_name: row.film_pass_types?.name ?? 'Film Pass',
        created_at: row.created_at,
        total: 0,
        unassigned: 0,
      };
      entry.total += 1;
      if (row.status === 'unassigned') entry.unassigned += 1;
      // The oldest row in the batch is when it was printed.
      if (row.created_at < entry.created_at) entry.created_at = row.created_at;
      byBatch.set(row.batch_id, entry);
    }

    return json({
      batches: Array.from(byBatch.values())
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 50),
    });
  }

  if (action !== 'create') return json({ error: `Unknown action: ${action}` }, 400);

  // -------------------------------------------------------------------------
  // Mint the run
  // -------------------------------------------------------------------------
  const passTypeId = String(body.pass_type_id ?? '').trim();
  const quantity = Math.trunc(Number(body.quantity));

  if (!passTypeId) return json({ error: 'Choose a pass type' }, 400);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return json({ error: 'How many stickers?' }, 400);
  }
  if (quantity > MAX_BATCH) {
    return json({ error: `That is more than one print run — ${MAX_BATCH} at a time.` }, 400);
  }

  const { data: passType } = await admin
    .from('film_pass_types')
    .select('id, name, price, initial_balance, redemption_price, expiration_days, is_active')
    .eq('id', passTypeId)
    .maybeSingle();

  if (!passType) return json({ error: 'Pass type not found' }, 404);
  if (passType.is_active === false) {
    return json({ error: 'That pass type is retired — reactivate it before printing stickers.' }, 400);
  }

  const batchId = crypto.randomUUID();
  const rows = Array.from({ length: quantity }, () => ({
    pass_type_id: passType.id,
    qr_code: `PASS:${crypto.randomUUID()}`,
    batch_id: batchId,
    status: 'unassigned',
    user_id: null,
    remaining_balance: null,
    expires_at: null,
  }));

  const { data: created, error } = await admin
    .from('user_film_passes')
    .insert(rows)
    .select('id, qr_code');

  if (error || !created) {
    console.error('[film-pass-batch] mint failed', error);
    return json({ error: 'Could not create the batch. Please try again.' }, 500);
  }

  return json({
    success: true,
    batch_id: batchId,
    quantity: created.length,
    pass_type: {
      id: passType.id,
      name: passType.name,
      price: Number(passType.price),
      initial_balance: Number(passType.initial_balance),
      redemption_price: Number(passType.redemption_price),
      // What the sticker is worth, said once here so the print view does not
      // recompute it and drift.
      admissions: Math.floor(Number(passType.initial_balance) / Number(passType.redemption_price)),
    },
    passes: created.map((p: any) => ({ id: p.id, qr_code: p.qr_code })),
  });
});
