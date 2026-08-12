// Film pass sales — self-serve and box office.
//
// What this replaces: MyPasses.tsx inserted a `user_film_passes` row straight
// from the browser with `remaining_balance = initial_balance`. A patron could
// mint themselves a $100 pass for nothing, and RLS allowed it because the row
// was theirs. The POS was worse in a different way: when the patron had no
// profile it created the pass **under the staff member's account**, so the
// walk-in's balance became an employee's, and it looked patrons up by
// `profiles.display_name = <email>`, which is not where email lives.
//
// Same shape as ticket-checkout: price on the server, write the row pending,
// take the money, then activate. A pass that was never paid for never becomes
// spendable — it stays `failed`, and every redemption path filters on `active`.
//
// Two entry points:
//   purchase    — a signed-in patron paying by card (Square Web Payments token)
//   staff_sale  — box office selling to a walk-in; cash, or a card already
//                 taken on the Square Terminal
//
// Box-office sales are attested by an authenticated staff member, exactly as
// box-office ticket sales already are: the money is collected in the room, and
// the terminal checkout id is recorded alongside so the sale reconciles against
// Square. Self-serve sales are never attested — they must produce a real Square
// payment id or they do not happen.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import {
  createPayment,
  loadSquareConfig,
  publishableConfig,
  squareErrorMessage,
} from '../_shared/square.ts';
import {
  EMAIL_RE,
  authenticatedUser,
  contactForUser,
  findOrCreateBuyer,
  findUserByContact,
  readContact,
  type BuyerContact,
} from '../_shared/buyers.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const square = loadSquareConfig();
  const action = String(body.action ?? 'purchase');

  if (action === 'get_config') {
    if (!square.ok) return json({ error: square.error }, 500);
    return json(publishableConfig(square.config));
  }

  if (action !== 'purchase' && action !== 'staff_sale' && action !== 'lookup') {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const signedIn = await authenticatedUser(createClient, req);

  // ---------------------------------------------------------------------
  // Box-office pass lookup
  // ---------------------------------------------------------------------
  //
  // The POS searched `profiles.display_name` for an email address. Email is not
  // stored on profiles at all — it lives in auth.users, which the browser
  // cannot query — so the lookup only ever matched patrons who happened to have
  // typed their email in as a display name. Resolving it here, under the
  // service role, is what makes searching by email actually work.
  if (action === 'lookup') {
    if (!signedIn) return json({ error: 'Staff sign-in required' }, 401);
    const { data: canLookup } = await admin.rpc('has_role', {
      _user_id: signedIn.id,
      _role: 'staff',
    });
    if (!canLookup) return json({ error: 'Staff access required' }, 403);

    const contact = readContact(body);
    if (!contact.email && !contact.phone) {
      return json({ error: 'Search by email or phone' }, 400);
    }

    const userId = await findUserByContact(admin, contact.email, contact.phone);
    if (!userId) return json({ passes: [], patron: null });

    const [{ data: passes }, { data: profile }] = await Promise.all([
      admin
        .from('user_film_passes')
        .select('id, remaining_balance, expires_at, purchased_at, film_pass_types!user_film_passes_pass_type_id_fkey(name)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gt('remaining_balance', 0)
        .order('purchased_at', { ascending: false }),
      admin.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
    ]);

    return json({
      patron: {
        user_id: userId,
        display_name: profile?.display_name ?? contact.email ?? contact.phone,
      },
      passes: (passes || []).map((p: any) => ({
        id: p.id,
        remaining_balance: Number(p.remaining_balance),
        expires_at: p.expires_at,
        purchased_at: p.purchased_at,
        pass_type_name: p.film_pass_types?.name ?? 'Film Pass',
      })),
    });
  }

  // ---------------------------------------------------------------------
  // The pass type, priced from the database
  // ---------------------------------------------------------------------
  const passTypeId = String(body.pass_type_id ?? '').trim();
  if (!passTypeId) return json({ error: 'Choose a pass' }, 400);

  const { data: passType } = await admin
    .from('film_pass_types')
    .select('id, name, price, initial_balance, expiration_days, is_active')
    .eq('id', passTypeId)
    .maybeSingle();

  if (!passType) return json({ error: 'Pass not found' }, 404);
  if (passType.is_active === false) return json({ error: 'That pass is no longer sold' }, 400);

  const price = Number(passType.price);
  const amountCents = Math.round(price * 100);
  if (!Number.isFinite(price) || price < 0) {
    return json({ error: 'That pass has no valid price configured' }, 400);
  }

  const idempotencyKey = normaliseKey(body.idempotency_key);

  // ---------------------------------------------------------------------
  // Who the pass is for, and who is allowed to sell it
  // ---------------------------------------------------------------------
  let userId: string;
  let contact: BuyerContact;
  let soldBy: string | null = null;
  let paymentMethod: string;

  if (action === 'staff_sale') {
    if (!signedIn) return json({ error: 'Staff sign-in required' }, 401);

    const { data: isStaff } = await admin.rpc('has_role', {
      _user_id: signedIn.id,
      _role: 'staff',
    });
    if (!isStaff) return json({ error: 'Staff access required' }, 403);

    contact = readContact(body);
    if (!contact.email && !contact.phone) {
      return json({ error: "Enter the patron's email or phone" }, 400);
    }
    if (contact.email && !EMAIL_RE.test(contact.email)) {
      return json({ error: 'Invalid email format' }, 400);
    }
    if (!contact.name) contact.name = contact.email || contact.phone || 'Kenworthy patron';

    paymentMethod = ['cash', 'card', 'comp'].includes(body.payment_method)
      ? body.payment_method
      : 'cash';

    try {
      // The pass belongs to the patron. Always. This is the mis-assignment fix:
      // if no account matches, one is created for them rather than falling back
      // to the staff member's own id.
      userId = (await findOrCreateBuyer(admin, contact)).userId;
    } catch (err) {
      console.error('[film-pass-checkout] patron resolution failed', err);
      return json({ error: err instanceof Error ? err.message : 'Could not create account' }, 500);
    }
    soldBy = signedIn.id;
  } else {
    if (!signedIn) return json({ error: 'Sign in to buy a film pass' }, 401);
    userId = signedIn.id;
    contact = await contactForUser(admin, userId, readContact(body));
    paymentMethod = 'online';

    if (!body.source_id || typeof body.source_id !== 'string') {
      return json({ error: 'Missing payment source' }, 400);
    }
  }

  const replay = await findExistingPass(admin, idempotencyKey, userId);
  if (replay) return json(replay);

  // ---------------------------------------------------------------------
  // Write it pending
  // ---------------------------------------------------------------------
  const expiresAt = passType.expiration_days
    ? new Date(Date.now() + passType.expiration_days * 86400000).toISOString()
    : null;

  const { data: pending, error: insertErr } = await admin
    .from('user_film_passes')
    .insert({
      user_id: userId,
      pass_type_id: passType.id,
      remaining_balance: Number(passType.initial_balance),
      payment_method: paymentMethod,
      expires_at: expiresAt,
      price_paid: price,
      status: 'pending',
      sold_by_user_id: soldBy,
      checkout_idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (insertErr || !pending) {
    console.error('[film-pass-checkout] pending insert failed', insertErr);
    return json({ error: 'Could not start this purchase. Please try again.' }, 500);
  }

  const fail = async (reason: string) => {
    await admin.from('user_film_passes').update({ status: 'failed' }).eq('id', pending.id);
    return reason;
  };

  // ---------------------------------------------------------------------
  // Take the money
  // ---------------------------------------------------------------------
  let paymentId: string | null = null;
  let receiptUrl: string | null = null;

  if (action === 'purchase') {
    if (!square.ok) {
      await fail(square.error);
      return json({ error: 'Payments are not configured. Please contact the box office.' }, 500);
    }

    try {
      const result = await createPayment(square.config, {
        sourceId: body.source_id,
        amountCents,
        idempotencyKey,
        referenceId: pending.id,
        note: `${passType.name} film pass`,
        buyerEmail: contact.email,
      });

      if (!result.ok || !result.data?.payment) {
        const message = squareErrorMessage(result.data);
        console.error('[film-pass-checkout] Square declined', JSON.stringify(result.data));
        await fail(message);
        return json({ error: message }, 400);
      }

      const payment = result.data.payment;
      if (payment.status && payment.status !== 'COMPLETED') {
        const message = `Payment did not complete (${payment.status}).`;
        await fail(message);
        return json({ error: message }, 400);
      }

      paymentId = payment.id ?? null;
      receiptUrl = payment.receipt_url ?? null;
    } catch (err) {
      console.error('[film-pass-checkout] payment threw', err);
      await fail(err instanceof Error ? err.message : 'Payment failed');
      return json({ error: 'Payment could not be processed. Your card was not charged.' }, 500);
    }
  } else {
    // Box office: money changed hands in the room. Record whatever Square
    // reference the terminal produced so the sale reconciles.
    paymentId = typeof body.square_payment_id === 'string' ? body.square_payment_id : null;
  }

  const { error: activateErr } = await admin
    .from('user_film_passes')
    .update({
      status: 'active',
      square_payment_id: paymentId,
      square_receipt_url: receiptUrl,
    })
    .eq('id', pending.id);

  if (activateErr) {
    console.error('[film-pass-checkout] activation failed after charge', activateErr, { paymentId });
    return json(
      {
        error:
          'Your payment went through but we could not finish issuing the pass. Please contact the box office — do not pay again.',
        square_payment_id: paymentId,
      },
      500,
    );
  }

  if (contact.email) {
    try {
      const [first, ...rest] = contact.name.split(/\s+/);
      void fetch(`${SUPABASE_URL}/functions/v1/mailchimp-subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({
          email: contact.email,
          first_name: first ?? '',
          last_name: rest.join(' '),
          tags: ['film-pass'],
          source: action === 'staff_sale' ? 'pos-film-pass' : 'film-pass-checkout',
        }),
      }).catch(() => {});
    } catch (e) {
      console.warn('[film-pass-checkout] mailchimp sync threw', e);
    }
  }

  return json({
    success: true,
    pass_id: pending.id,
    user_id: userId,
    pass_name: passType.name,
    balance: Number(passType.initial_balance),
    amount_cents: action === 'purchase' ? amountCents : 0,
    price_paid: price,
    expires_at: expiresAt,
    receipt_url: receiptUrl,
    square_payment_id: paymentId,
  });
});

function normaliseKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  return key.length >= 8 && key.length <= 45 ? key : crypto.randomUUID();
}

async function findExistingPass(admin: any, idempotencyKey: string, userId: string) {
  const { data } = await admin
    .from('user_film_passes')
    .select('id, remaining_balance, expires_at, status, square_payment_id, square_receipt_url, price_paid, film_pass_types!user_film_passes_pass_type_id_fkey(name)')
    .eq('checkout_idempotency_key', idempotencyKey)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (!data) return null;

  return {
    success: true,
    replayed: true,
    pass_id: data.id,
    user_id: userId,
    pass_name: (data as any).film_pass_types?.name ?? 'Film Pass',
    balance: Number(data.remaining_balance),
    price_paid: Number(data.price_paid ?? 0),
    expires_at: data.expires_at,
    receipt_url: data.square_receipt_url ?? null,
    square_payment_id: data.square_payment_id ?? null,
  };
}
