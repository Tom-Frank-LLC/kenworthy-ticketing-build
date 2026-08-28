// Film pass money and lifecycle — sale, activation, lookup, void.
//
// A film pass is a physical object now. That changes what this function is for.
//
// It used to mint a spendable balance the instant a card cleared, and the pass
// existed only in the database. There is no digital pass any more: buying one
// online creates an *order*, which the box office discharges by scanning a
// blank sticker and handing over paper. The moment of creation moved from the
// payment to the handoff, and this function's job moved with it.
//
// What lives here, and why together: these are the four operations that either
// move money or bring a balance into existence, and all four have to answer
// "who is asking" before they do anything. Splitting them across functions
// would mean four copies of that answer.
//
//   order        public   take the card, record what the theatre now owes
//   activate     staff    scan a blank sticker; it becomes a funded pass
//   lookup       staff    find a pass by its code, or a patron's passes
//   queue        staff    orders paid for and not yet handed over, plus mail
//                         orders activated and not yet posted
//   mark_posted  staff    the envelope went out; emails the buyer, once
//   void         admin    kill a lost, stolen or misprinted pass
//
// Two things this function will not do any more, both deliberately answered
// with an error rather than silently ignored:
//
//   purchase    minted a digital pass for a signed-in patron. There is no such
//               thing now. A stale browser tab must be told, not humoured.
//   staff_sale  created a pass row from the counter without a sticker. The
//               walk-in path is `activate` with payment details attached — the
//               pass and the paper come into existence together or not at all.
//
// Card data never touches this function. The browser hands the card to Square's
// iframe and sends a single-use token, which is all `source_id` ever is.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import {
  createPayment,
  squareFetch,
  loadSquareConfig,
  publishableConfig,
  squareErrorMessage,
} from '../_shared/square.ts';
import { buildTicketOrder, orderRequestBody } from '../_shared/square-order.ts';
import {
  EMAIL_RE,
  authenticatedUser,
  contactForUser,
  findOrCreateBuyer,
  findUserByContact,
  readContact,
  type BuyerContact,
} from '../_shared/buyers.ts';
import { sendTransactionalEmail } from '../_shared/deliver.ts';
import {
  buildPassOrderEmailHtml,
  buildPassOrderEmailText,
  buildPassOrderSubject,
  buildPassPostedEmailHtml,
  buildPassPostedEmailText,
  buildPassPostedSubject,
  readMailingAddress,
  type Fulfillment,
  type MailingAddress,
} from '../_shared/pass_orders.ts';

// Deno globals
declare const Deno: any;

/** Idaho sales tax, the same rate _shared/pricing.ts applies to a ticket. */
const FILM_PASS_TAX_RATE = 0.06;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/** A single order is a gift, a stack of them is a mistake or an attack. */
const MAX_PASSES_PER_ORDER = 10;

/**
 * The only statuses a pass may be deleted in. Reasoning at the `delete` action.
 *
 * Named once and used twice — for the check that produces a readable refusal,
 * and again on the delete itself as the race guard. Two literals here would be
 * one edit away from a guard that no longer guards what the message claims.
 */
const DELETABLE_STATUSES = ['void', 'unassigned', 'depleted'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const square = loadSquareConfig();
  const action = String(body.action ?? 'order');

  if (action === 'get_config') {
    if (!square.ok) return json({ error: square.error }, 500);
    return json(publishableConfig(square.config));
  }

  // The two removed actions. Answered explicitly because a cached bundle in
  // somebody's browser will still be asking for them, and "unknown action" is
  // a worse answer than the truth.
  if (action === 'purchase' || action === 'staff_sale') {
    return json(
      {
        error:
          'Film passes are physical now — there is no digital pass to issue. Buy one online for collection or post, or ask at the box office.',
      },
      410,
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const signedIn = await authenticatedUser(createClient, req);

  /** Staff gate, used by every action but `order`. */
  const requireStaff = async (): Promise<Response | { id: string }> => {
    if (!signedIn) return json({ error: 'Staff sign-in required' }, 401);
    const { data: isStaff } = await admin.rpc('has_role', {
      _user_id: signedIn.id,
      _role: 'staff',
    });
    if (!isStaff) return json({ error: 'Staff access required' }, 403);
    return { id: signedIn.id };
  };

  // ---------------------------------------------------------------------
  // The box office queue: money taken, pass still owed
  // ---------------------------------------------------------------------
  //
  // Every row here is a person waiting. Without somewhere to see them, a paid
  // online order is an obligation with no reminder attached, and the way that
  // fails is quietly — weeks later, as "I paid for this and never got it".
  if (action === 'queue') {
    const staff = await requireStaff();
    if (staff instanceof Response) return staff;

    // Two obligations, two lists, one round trip — both screens show both.
    //
    //   orders         paid, no sticker scanned yet. Someone is waiting.
    //   awaiting_post  mail only: sticker scanned, envelope not yet posted.
    //                  Activation used to end the story here, which is how an
    //                  envelope could sit on the desk with nothing recording it.
    const [{ data, error }, { data: awaiting, error: awaitingErr }] = await Promise.all([
      admin
        .from('film_pass_orders')
        .select(
          'id, quantity, fulfillment, mailing_address, buyer_name, buyer_email, buyer_phone, amount_paid, status, created_at, user_id, pass_type_id, film_pass_types!film_pass_orders_pass_type_id_fkey(name, price, initial_balance, redemption_price)',
        )
        .eq('status', 'paid')
        .order('created_at'),
      admin
        .from('film_pass_orders')
        .select(
          'id, quantity, fulfillment, mailing_address, buyer_name, buyer_email, buyer_phone, amount_paid, status, created_at, fulfilled_at, user_id, pass_type_id, film_pass_types!film_pass_orders_pass_type_id_fkey(name, price, initial_balance, redemption_price), profiles!film_pass_orders_fulfilled_by_fkey(display_name)',
        )
        .eq('fulfillment', 'mail')
        .eq('status', 'fulfilled')
        .is('posted_at', null)
        // Oldest first: the longest-waiting envelope is the most urgent, which
        // is the opposite of the newest-first instinct.
        .order('fulfilled_at'),
    ]);

    if (error) {
      console.error('[film-pass-checkout] queue failed', error);
      return json({ error: 'Could not read the pickup queue' }, 500);
    }
    if (awaitingErr) {
      console.error('[film-pass-checkout] mail queue failed', awaitingErr);
      return json({ error: 'Could not read the mail queue' }, 500);
    }

    return json({
      awaiting_post: (awaiting || []).map((o: any) => ({
        id: o.id,
        quantity: o.quantity,
        fulfillment: o.fulfillment,
        mailing_address: o.mailing_address,
        buyer_name: o.buyer_name,
        buyer_email: o.buyer_email,
        buyer_phone: o.buyer_phone,
        amount_paid: Number(o.amount_paid ?? 0),
        created_at: o.created_at,
        fulfilled_at: o.fulfilled_at,
        fulfilled_by_name: o.profiles?.display_name ?? null,
        user_id: o.user_id,
        pass_type_id: o.pass_type_id,
        pass_type_name: o.film_pass_types?.name ?? 'Film Pass',
      })),
      orders: (data || []).map((o: any) => ({
        id: o.id,
        quantity: o.quantity,
        fulfillment: o.fulfillment,
        mailing_address: o.mailing_address,
        buyer_name: o.buyer_name,
        buyer_email: o.buyer_email,
        buyer_phone: o.buyer_phone,
        amount_paid: Number(o.amount_paid ?? 0),
        created_at: o.created_at,
        user_id: o.user_id,
        pass_type_id: o.pass_type_id,
        pass_type_name: o.film_pass_types?.name ?? 'Film Pass',
      })),
    });
  }

  // ---------------------------------------------------------------------
  // Mark posted: the envelope actually went out
  // ---------------------------------------------------------------------
  //
  // Activation puts a sticker on the card. This records that the card left the
  // building — the step nothing used to capture, so a mailed pass could be
  // marked fulfilled and then sit on a desk indefinitely.
  //
  // There is no undo. A mis-marked order is recovered the way a wrong pass
  // already is: void the QR, activate a fresh sticker, post that. So the click
  // is guarded in the UI, and the effects here are made to happen at most once.
  if (action === 'mark_posted') {
    const staff = await requireStaff();
    if (staff instanceof Response) return staff;

    const orderId = String(body.order_id ?? '').trim();
    if (!orderId) return json({ error: 'Which order?' }, 400);

    // The whole guard is this WHERE clause.
    //
    // Read-then-write would race: two staff on two devices, both holding a
    // queue fetched before either clicked, both read posted_at IS NULL, both
    // decide to send. Postgres lets exactly one UPDATE match, and the loser
    // gets zero rows — so the email below is reached only by the winner. This
    // matters more than it looks: a duplicate here is not a duplicate write,
    // it is a second email telling a patron their pass shipped.
    const { data: marked, error: markErr } = await admin
      .from('film_pass_orders')
      .update({ posted_at: new Date().toISOString(), posted_by: staff.id })
      .eq('id', orderId)
      .eq('fulfillment', 'mail')
      .eq('status', 'fulfilled')
      .is('posted_at', null)
      .select(
        'id, quantity, buyer_name, buyer_email, mailing_address, posted_at, film_pass_types!film_pass_orders_pass_type_id_fkey(name)',
      )
      .maybeSingle();

    if (markErr) {
      console.error('[film-pass-checkout] mark_posted failed', markErr);
      return json({ error: 'Could not mark that order posted' }, 500);
    }

    // No row matched. Say which of the three reasons it was, because the
    // counter needs to tell the difference between "somebody beat me to it"
    // and "this is not ready to post".
    if (!marked) {
      const { data: existing } = await admin
        .from('film_pass_orders')
        .select('id, fulfillment, status, posted_at')
        .eq('id', orderId)
        .maybeSingle();

      if (!existing) return json({ error: 'That order no longer exists' }, 404);
      if (existing.fulfillment !== 'mail') {
        return json({ result: 'not_a_mail_order', error: 'That order is for collection, not post' }, 400);
      }
      if (existing.posted_at) {
        return json({ result: 'already_posted', posted_at: existing.posted_at });
      }
      return json(
        {
          result: 'not_yet_activated',
          error: 'Activate a sticker against this order before posting it',
        },
        400,
      );
    }

    // -------------------------------------------------------------------
    // Tell them it is on the way
    // -------------------------------------------------------------------
    //
    // Awaited, not fire-and-forget, unlike the order confirmation: nothing is
    // being held open behind this, and the staff member watching the button is
    // the only person who will ever be in a position to notice the send
    // failed. The outcome is still written to the row either way — the row
    // outlives the toast.
    const type = (marked as any).film_pass_types;
    let notice: 'sent' | 'failed' | 'no_email' = 'no_email';

    if (marked.buyer_email) {
      const summary = {
        passTypeName: type?.name ?? 'Film Pass',
        quantity: marked.quantity,
        mailingAddress: (marked.mailing_address ?? null) as MailingAddress | null,
        buyerName: marked.buyer_name ?? null,
      };

      const result = await sendTransactionalEmail(
        marked.buyer_email,
        buildPassPostedSubject(summary),
        buildPassPostedEmailHtml(summary),
        buildPassPostedEmailText(summary),
      );

      notice = result.ok ? 'sent' : 'failed';
      await admin
        .from('film_pass_orders')
        .update(
          result.ok
            ? { posted_notice_sent_at: new Date().toISOString(), posted_notice_error: null }
            : { posted_notice_error: result.error.slice(0, 500) },
        )
        .eq('id', marked.id);
    }

    return json({ result: 'posted', posted_at: marked.posted_at, notice });
  }

  // ---------------------------------------------------------------------
  // Lookup: by sticker code, or by the patron it belongs to
  // ---------------------------------------------------------------------
  if (action === 'lookup') {
    const staff = await requireStaff();
    if (staff instanceof Response) return staff;

    const code = String(body.qr_code ?? '').trim();

    if (code) {
      const { data: pass } = await admin
        .from('user_film_passes')
        .select(
          'id, qr_code, status, remaining_balance, expires_at, activated_at, user_id, batch_id, price_paid, film_pass_types!user_film_passes_pass_type_id_fkey(name, initial_balance, redemption_price)',
        )
        .eq('qr_code', code)
        .maybeSingle();

      if (!pass) return json({ pass: null, passes: [], patron: null });

      let holder: { display_name: string | null; email: string | null } | null = null;
      if (pass.user_id) {
        const { data: profile } = await admin
          .from('profiles')
          .select('display_name, email')
          .eq('id', pass.user_id)
          .maybeSingle();
        holder = {
          display_name: profile?.display_name ?? null,
          email: profile?.email ?? null,
        };
      }

      return json({ pass: describePass(pass, holder), passes: [], patron: null });
    }

    const contact = readContact(body);
    if (!contact.email && !contact.phone) {
      return json({ error: 'Search by pass code, email or phone' }, 400);
    }

    const userId = await findUserByContact(admin, contact.email, contact.phone);
    if (!userId) return json({ pass: null, passes: [], patron: null });

    const [{ data: passes }, { data: profile }] = await Promise.all([
      admin
        .from('user_film_passes')
        .select(
          'id, qr_code, status, remaining_balance, expires_at, activated_at, user_id, batch_id, price_paid, film_pass_types!user_film_passes_pass_type_id_fkey(name, initial_balance, redemption_price)',
        )
        .eq('user_id', userId)
        // Everything they hold, not just the spendable ones: "why won't my pass
        // work" is answered by seeing that it is depleted or expired, and a
        // filtered list answers it with silence.
        .in('status', ['active', 'depleted', 'expired', 'void'])
        .order('activated_at', { ascending: false, nullsFirst: false }),
      admin.from('profiles').select('display_name, email').eq('id', userId).maybeSingle(),
    ]);

    return json({
      pass: null,
      patron: {
        user_id: userId,
        display_name: profile?.display_name ?? contact.email ?? contact.phone,
        email: profile?.email ?? contact.email,
      },
      passes: (passes || []).map((p: any) =>
        describePass(p, {
          display_name: profile?.display_name ?? null,
          email: profile?.email ?? null,
        }),
      ),
    });
  }

  // ---------------------------------------------------------------------
  // Activation — the moment a sticker becomes a pass
  // ---------------------------------------------------------------------
  //
  // Two shapes, one function. Collecting an online order supplies an order id
  // and the pass inherits its owner. A walk-in supplies payment details and
  // either a contact (creating an account) or nothing at all — a bearer pass,
  // where the paper *is* the credential, exactly as cash is.
  if (action === 'activate') {
    const staff = await requireStaff();
    if (staff instanceof Response) return staff;

    const qrCode = String(body.qr_code ?? '').trim();
    if (!qrCode) return json({ error: 'Scan a blank sticker' }, 400);
    if (!qrCode.startsWith('PASS:')) {
      // Almost always a ticket QR held up at the wrong screen.
      return json({ error: 'That is not a film pass sticker.' }, 400);
    }

    const orderId = String(body.order_id ?? '').trim() || null;
    let userId: string | null = null;
    let passTypeId: string | null = String(body.pass_type_id ?? '').trim() || null;
    let paymentMethod: string | null = null;
    let pricePaid: number | null = null;
    let taxPaid = 0;
    let squarePaymentId: string | null = null;

    if (!orderId) {
      // Walk-in. The price comes from the pass type, never from the browser.
      if (!passTypeId) return json({ error: 'Choose a pass type' }, 400);

      const { data: passType } = await admin
        .from('film_pass_types')
        .select('id, price, is_active')
        .eq('id', passTypeId)
        .maybeSingle();
      if (!passType) return json({ error: 'Pass type not found' }, 404);
      if (passType.is_active === false) {
        return json({ error: 'That pass is no longer sold' }, 400);
      }

      paymentMethod = ['cash', 'card', 'comp'].includes(body.payment_method)
        ? body.payment_method
        : 'cash';
      // Pre-tax, deliberately: price_paid is the revenue figure the QBO export
      // books, and tax is recorded separately as tax_paid. A comp collects
      // neither.
      pricePaid = paymentMethod === 'comp' ? 0 : Number(passType.price);
      taxPaid = paymentMethod === 'comp'
        ? 0
        : Math.round(Math.round(Number(passType.price) * 100) * FILM_PASS_TAX_RATE) / 100;
      squarePaymentId =
        typeof body.square_payment_id === 'string' ? body.square_payment_id : null;

      // Contact is optional. A walk-in who gives one gets a pass attached to an
      // account, and a lost pass can then be voided and reissued. One who gives
      // nothing gets a bearer pass, which is the honest model for paper.
      const contact = readContact(body);
      if (contact.email || contact.phone) {
        if (contact.email && !EMAIL_RE.test(contact.email)) {
          return json({ error: 'Invalid email format' }, 400);
        }
        if (!contact.name) contact.name = contact.email || contact.phone || 'Kenworthy patron';
        try {
          userId = (await findOrCreateBuyer(admin, contact)).userId;
        } catch (err) {
          console.error('[film-pass-checkout] patron resolution failed', err);
          return json(
            { error: err instanceof Error ? err.message : 'Could not create account' },
            500,
          );
        }
      }
    }

    const { data: result, error } = await admin.rpc('activate_film_pass', {
      p_qr_code: qrCode,
      p_order_id: orderId,
      p_user_id: userId,
      p_pass_type_id: passTypeId,
      p_activated_by: signedIn!.id,
      p_payment_method: paymentMethod,
      p_price_paid: pricePaid,
      p_square_payment_id: squarePaymentId,
    });

    if (error) {
      console.error('[film-pass-checkout] activation failed', error);
      return json({ error: 'Could not activate that sticker. Please try again.' }, 500);
    }

    // The RPC returns a verdict rather than raising, so the counter can be told
    // what actually happened. Anything but success is a 400 carrying the reason.
    const verdict = result as Record<string, any>;
    if (verdict.result !== 'activated') {
      return json({ ...verdict, error: activationMessage(verdict) }, 400);
    }

    // activate_film_pass has a fixed signature and no tax parameter, so the
    // figure is stamped on afterwards rather than by widening an RPC that other
    // callers share. A failure here costs the tax split on one counter sale and
    // nothing else — the pass is already live and the money already collected —
    // so it is logged rather than surfaced to somebody holding a queue.
    if (taxPaid > 0 && verdict.pass_id) {
      const { error: taxErr } = await admin
        .from('user_film_passes')
        .update({ tax_paid: taxPaid })
        .eq('id', verdict.pass_id);
      if (taxErr) {
        console.error('[film-pass-checkout] could not record tax_paid', verdict.pass_id, taxErr);
      }
    }

    return json({ success: true, ...verdict, tax_paid: taxPaid });
  }

  // ---------------------------------------------------------------------
  // The door scan
  // ---------------------------------------------------------------------
  //
  // Thin on purpose. Every rule — eligible screening, not already through,
  // not expired, enough balance — is decided by admit_with_film_pass in one
  // transaction, because the door is where those rules are actually tested and
  // the scanner is a browser. This function's only contribution is answering
  // "is a staff member holding this scanner", which the database cannot see.
  if (action === 'admit') {
    const staff = await requireStaff();
    if (staff instanceof Response) return staff;

    const passCode = String(body.qr_code ?? '').trim();
    const showingId = String(body.showing_id ?? '').trim() || null;
    if (!passCode) return json({ error: 'Scan a pass' }, 400);
    if (!showingId) return json({ result: 'no_showing_selected' });

    const { data: result, error } = await admin.rpc('admit_with_film_pass', {
      p_pass_code: passCode,
      p_showing_id: showingId,
      p_scanned_by: signedIn!.id,
    });

    if (error) {
      // PT409 is the capacity trigger: the house filled up between the queue
      // forming and this scan. The whole transaction rolled back, so the pass
      // still holds its balance — worth saying, because the alternative
      // reading ("did that just cost them $6?") is the one staff will assume.
      if ((error as any).code === 'PT409') {
        return json({ result: 'sold_out', message: error.message });
      }
      console.error('[film-pass-checkout] admission failed', error);
      return json({ error: 'The scan could not be completed. Try again.' }, 500);
    }

    return json(result);
  }

  // ---------------------------------------------------------------------
  // Void — a lost, stolen or misprinted pass
  // ---------------------------------------------------------------------
  //
  // Admin only, and it destroys value: the balance is left visible on the row
  // so what was killed is answerable, but the status stops it being spendable.
  // No money is returned here — refunding a pass is a decision at the counter,
  // and pretending otherwise would credit a card this function never charged.
  if (action === 'void') {
    if (!signedIn) return json({ error: 'Sign-in required' }, 401);
    const { data: isAdmin } = await admin.rpc('has_role', {
      _user_id: signedIn.id,
      _role: 'admin',
    });
    if (!isAdmin) return json({ error: 'Admin access required' }, 403);

    const passId = String(body.pass_id ?? '').trim();
    if (!passId) return json({ error: 'Which pass?' }, 400);

    const { data: updated, error } = await admin
      .from('user_film_passes')
      .update({ status: 'void' })
      .eq('id', passId)
      .in('status', ['unassigned', 'active', 'depleted', 'expired'])
      .select('id, qr_code, status, remaining_balance');

    if (error) {
      console.error('[film-pass-checkout] void failed', error);
      return json({ error: 'Could not void that pass' }, 500);
    }
    // A blocked write returns no error and no rows, so the row count is the
    // only thing that says whether anything happened.
    if (!updated || updated.length === 0) {
      return json({ error: 'That pass could not be voided — it may already be void.' }, 409);
    }

    return json({ success: true, pass: updated[0] });
  }

  // ---------------------------------------------------------------------
  // Delete: the row goes, not just its spendability
  // ---------------------------------------------------------------------
  //
  // Void and delete are not the same act and the difference matters. Void
  // keeps the row — the balance stays readable, so "what did we kill and what
  // was on it" is still answerable. Delete is housekeeping for a list that has
  // grown noisy, and it is irreversible.
  //
  // Which statuses may be deleted, and why the two that may not:
  //
  //   void        cancelled already; the decision was made once.
  //   unassigned  a blank sticker, most likely a misprint.
  //   depleted    spent down to nothing; it can never be used again.
  //
  //   active      still spendable, and possibly in somebody's wallet. Cancel
  //               it first — that is a separate deliberate act, and requiring
  //               both means no single click destroys a live pass.
  //   expired     expiry is a clock, not a decision, and a clock can be wrong:
  //               a wrongly-dated pass gets its expiry corrected rather than
  //               deleted. Cancel first if it really is finished.
  //
  // Why this lives here rather than in a client `.delete()`: a stale RLS
  // policy from the original schema does grant admins DELETE, but a later
  // migration revoked the table grant from `authenticated`, so a browser
  // delete would be refused at the grant. It would also be refused *silently*
  // — PostgREST reports a blocked delete as a success with no rows — and the
  // UI would cheerfully report that a pass still in the table was gone.
  if (action === 'delete') {
    if (!signedIn) return json({ error: 'Sign-in required' }, 401);
    const { data: isAdmin } = await admin.rpc('has_role', {
      _user_id: signedIn.id,
      _role: 'admin',
    });
    if (!isAdmin) return json({ error: 'Admin access required' }, 403);

    const passId = String(body.pass_id ?? '').trim();
    if (!passId) return json({ error: 'Which pass?' }, 400);

    // Read before deleting, so a refusal can say *why*. Deleting straight off
    // with a status filter can only report "nothing happened", which is the
    // same answer for "already gone" and "that pass is still active" — two
    // situations needing opposite responses from the person at the screen.
    const { data: pass, error: readErr } = await admin
      .from('user_film_passes')
      .select('id, qr_code, pass_number, status, remaining_balance')
      .eq('id', passId)
      .maybeSingle();

    if (readErr) {
      console.error('[film-pass-checkout] delete lookup failed', readErr);
      return json({ error: 'Could not read that pass' }, 500);
    }
    if (!pass) return json({ error: 'That pass no longer exists.' }, 404);

    if (!DELETABLE_STATUSES.includes(pass.status)) {
      return json(
        {
          error:
            pass.status === 'active'
              ? 'That pass is still active. Cancel it first, then delete it.'
              : 'That pass has expired rather than been cancelled. Cancel it first, then delete it.',
        },
        409,
      );
    }

    // Counted before the delete because the cascade is about to remove them,
    // and the count is what makes the loss reportable afterwards rather than
    // merely warned about beforehand.
    const { count: redemptions } = await admin
      .from('film_pass_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('pass_id', passId);

    const { data: removed, error } = await admin
      .from('user_film_passes')
      .delete()
      .eq('id', passId)
      // Re-stated at the delete itself, not just checked above: between the
      // read and here, somebody at the counter could have activated this very
      // sticker. The filter makes that race end in a no-op rather than in a
      // live pass being deleted out from under them.
      .in('status', DELETABLE_STATUSES)
      .select('id');

    if (error) {
      console.error('[film-pass-checkout] delete failed', error);
      return json({ error: 'Could not delete that pass' }, 500);
    }
    if (!removed || removed.length === 0) {
      return json(
        { error: 'That pass changed while you were looking at it — reload and try again.' },
        409,
      );
    }

    // Name whoever did it on the audit entry.
    //
    // The audit trigger already captured the whole row — which is what makes a
    // deleted pass reconstructible at all — but it reads the actor from
    // auth.uid(), and this write is the service role's, so it lands as NULL.
    // "A pass was destroyed and nobody did it" is a poor record of the one
    // action here that cannot be undone.
    //
    // Not a race: the trigger fires inside the delete above, so the row is
    // already there, and a given pass can only ever be deleted once — so
    // entity_id plus the action names exactly one row, now and forever.
    const { error: stampErr } = await admin
      .from('admin_audit_log')
      .update({ actor_id: signedIn.id, actor_email: signedIn.email })
      .eq('entity_type', 'user_film_passes')
      .eq('entity_id', passId)
      .eq('action', 'user_film_passes.delete');

    if (stampErr) {
      // Logged, not surfaced: the pass is already gone, and failing the
      // response now would tell the admin the delete did not happen.
      console.error('[film-pass-checkout] could not attribute the delete', stampErr);
    }

    return json({
      success: true,
      pass_number: pass.pass_number ?? null,
      qr_code: pass.qr_code,
      status: pass.status,
      redemptions_removed: redemptions ?? 0,
    });
  }

  if (action !== 'order') return json({ error: `Unknown action: ${action}` }, 400);

  // =====================================================================
  // Buying online: money now, paper later
  // =====================================================================

  const passTypeId = String(body.pass_type_id ?? '').trim();
  if (!passTypeId) return json({ error: 'Choose a pass' }, 400);

  const { data: passType } = await admin
    .from('film_pass_types')
    .select('id, name, price, initial_balance, redemption_price, ticket_face_value, fine_print, expiration_days, is_active, square_variation_id')
    .eq('id', passTypeId)
    .maybeSingle();

  if (!passType) return json({ error: 'Pass not found' }, 404);
  if (passType.is_active === false) return json({ error: 'That pass is no longer sold' }, 400);

  const unitPrice = Number(passType.price);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return json({ error: 'That pass has no valid price configured' }, 400);
  }

  const quantity = Math.trunc(Number(body.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1) {
    return json({ error: 'How many passes?' }, 400);
  }
  if (quantity > MAX_PASSES_PER_ORDER) {
    return json(
      { error: `Up to ${MAX_PASSES_PER_ORDER} passes per order — call the box office for more.` },
      400,
    );
  }

  const fulfillment: Fulfillment = body.fulfillment === 'mail' ? 'mail' : 'pickup';
  let mailingAddress: MailingAddress | null = null;
  if (fulfillment === 'mail') {
    const parsed = readMailingAddress(body.mailing_address);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    mailingAddress = parsed.address;
  }

  // Sales tax, added on top of the listed price. film_pass_types.price is the
  // pre-tax figure, the way showings.ticket_price is.
  //
  // This used to charge price x quantity flat, which meant the theatre collected
  // no tax on a pass while recording 6% on every admission redeemed against it
  // — tax owed on money nobody paid, and none on the money it took. Redemptions
  // are $0 now (migration 20260819040000); the tax belongs here, at the sale.
  //
  // Rounded PER PASS, matching how enforce_ticket_pricing rounds a ticket, so
  // two passes cost exactly twice one pass and the arithmetic never depends on
  // quantity.
  const unitPriceCents = Math.round(unitPrice * 100);
  const unitTaxCents = Math.round(unitPriceCents * FILM_PASS_TAX_RATE);
  const amountCents = (unitPriceCents + unitTaxCents) * quantity;
  const total = amountCents / 100;
  const idempotencyKey = normaliseKey(body.idempotency_key);

  // -------------------------------------------------------------------------
  // Who is buying
  // -------------------------------------------------------------------------
  //
  // Same rule as ticket checkout: a signed-in buyer wins, and everyone else is
  // matched on contact or given a silent account. Patrons do not sign in any
  // more, so in practice this is always the guest path — the account exists so
  // the order has an owner and the pass has somewhere to attach at activation,
  // not because anyone will ever log into it.
  let contact: BuyerContact = readContact(body);
  let userId: string;

  if (signedIn) {
    userId = signedIn.id;
    contact = await contactForUser(admin, userId, contact);
  } else {
    if (!contact.name) return json({ error: 'Name is required' }, 400);
    if (!contact.email) {
      return json({ error: 'Email is required so we can confirm your order' }, 400);
    }
    if (!EMAIL_RE.test(contact.email)) return json({ error: 'Invalid email format' }, 400);
    try {
      userId = (await findOrCreateBuyer(admin, contact)).userId;
    } catch (err) {
      console.error('[film-pass-checkout] buyer resolution failed', err);
      return json({ error: err instanceof Error ? err.message : 'Could not create account' }, 500);
    }
  }

  const replay = await findExistingOrder(admin, idempotencyKey, userId);
  if (replay) return json(replay);

  if (!body.source_id || typeof body.source_id !== 'string') {
    return json({ error: 'Missing payment source' }, 400);
  }

  // -------------------------------------------------------------------------
  // Write the order pending, then charge
  // -------------------------------------------------------------------------
  //
  // The same ordering as every other paid path here: the record exists before
  // the money moves, so a Square error can never leave a charge with nothing
  // recorded against it. The difference is what a completed charge produces —
  // an obligation, not a pass.
  const { data: pending, error: insertErr } = await admin
    .from('film_pass_orders')
    .insert({
      user_id: userId,
      pass_type_id: passType.id,
      quantity,
      fulfillment,
      mailing_address: mailingAddress,
      buyer_name: contact.name || null,
      buyer_email: contact.email,
      buyer_phone: contact.phone,
      amount_paid: total,
      // Contained in amount_paid, not added to it — the QBO export books
      // amount_paid - tax_amount as revenue.
      tax_amount: (unitTaxCents * quantity) / 100,
      payment_method: 'online',
      status: 'pending',
      checkout_idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (insertErr || !pending) {
    console.error('[film-pass-checkout] pending order insert failed', insertErr);
    return json({ error: 'Could not start this purchase. Please try again.' }, 500);
  }

  const fail = async (reason: string) => {
    await admin
      .from('film_pass_orders')
      .update({ status: 'failed', notes: reason.slice(0, 500) })
      .eq('id', pending.id);
  };

  if (!square.ok) {
    await fail(square.error);
    return json({ error: 'Payments are not configured. Please contact the box office.' }, 500);
  }

  let paymentId: string | null = null;
  let receiptUrl: string | null = null;

  // Register the sale as an Order so the pass lands in Square's item sales under
  // '9 Film Passes' instead of being an amount with a note. Best-effort: any
  // disagreement about the total falls back to the bare payment rather than
  // charging a different number than the buyer was shown.
  let squareOrderId: string | undefined;
  try {
    const built = buildTicketOrder([{
      tierKey: '__film_pass',
      displayName: passType.name,
      variationId: (passType as any).square_variation_id ?? null,
      unitPriceCents,
      unitTaxCents,
      count: quantity,
      // Taxed at the sale. The redemption that spends this pass records $0.
    }]);

    if (!(passType as any).square_variation_id) {
      console.warn(`[film-pass-checkout] pass type ${passType.name} has no Square variation; billed as an ad-hoc line`);
    }

    if (built.expectedTotalCents !== amountCents) {
      console.error(`[film-pass-checkout] order total ${built.expectedTotalCents} != charge ${amountCents}; bare payment`);
    } else {
      const createdOrder = await squareFetch(square.config, '/orders', {
        method: 'POST',
        body: orderRequestBody({
          locationId: square.config.locationId,
          referenceId: pending.id,
          built,
          idempotencyKey: `order-${idempotencyKey}`,
          // No fulfillment, for the same reason as ticket-checkout: a paid
          // PICKUP order stays OPEN in Square. How the pass reaches the buyer
          // is tracked in our own tables, not Square's.
          fulfillment: 'NONE',
          buyerEmail: contact.email,
          buyerName: contact.name,
        }),
      });
      const squareTotal = createdOrder.data?.order?.total_money?.amount;
      if (!createdOrder.ok || !createdOrder.data?.order?.id) {
        console.error('[film-pass-checkout] order create failed', createdOrder.status, JSON.stringify(createdOrder.data));
      } else if (squareTotal !== amountCents) {
        console.error(`[film-pass-checkout] Square totalled ${squareTotal} vs charge ${amountCents}; abandoning order`);
      } else {
        squareOrderId = createdOrder.data.order.id;
      }
    }
  } catch (err) {
    console.error('[film-pass-checkout] order build threw, falling back to bare payment', err);
  }

  try {
    const result = await createPayment(square.config, {
      sourceId: body.source_id,
      amountCents,
      idempotencyKey,
      orderId: squareOrderId,
      referenceId: pending.id,
      note: `${quantity} × ${passType.name}`,
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

  const { error: paidErr } = await admin
    .from('film_pass_orders')
    .update({
      status: 'paid',
      square_payment_id: paymentId,
      square_receipt_url: receiptUrl,
    })
    .eq('id', pending.id);

  if (paidErr) {
    console.error('[film-pass-checkout] could not mark order paid', paidErr, { paymentId });
    return json(
      {
        error:
          'Your payment went through but we could not finish recording the order. Please contact the box office — do not pay again.',
        square_payment_id: paymentId,
      },
      500,
    );
  }

  // -------------------------------------------------------------------------
  // Tell them where their pass will be
  // -------------------------------------------------------------------------
  //
  // Fire-and-forget: a Resend outage must not fail a paid order. The outcome is
  // written back to the row, because the failure mode of a fire-and-forget send
  // is silence, and silence here means a buyer with no idea what they bought.
  const summary = {
    passTypeName: passType.name,
    quantity,
    amountPaid: total,
    initialBalance: Number(passType.initial_balance),
    redemptionPrice: Number(passType.redemption_price),
    // Per-type, because both differ per pass: what a ticket is worth, and what
    // the pass is not valid for. A sentence written once in pass_orders.ts was
    // wrong for whichever pass it was not written about.
    ticketFaceValue:
      passType.ticket_face_value == null ? null : Number(passType.ticket_face_value),
    finePrint: passType.fine_print ?? null,
    fulfillment,
    mailingAddress,
    buyerName: contact.name || null,
  };

  const confirm = (async () => {
    if (!contact.email) return;
    const result = await sendTransactionalEmail(
      contact.email,
      buildPassOrderSubject(summary),
      buildPassOrderEmailHtml(summary),
      buildPassOrderEmailText(summary),
    );
    await admin
      .from('film_pass_orders')
      .update(
        result.ok
          ? { confirmation_sent_at: new Date().toISOString(), confirmation_error: null }
          : { confirmation_error: result.error.slice(0, 500) },
      )
      .eq('id', pending.id);
    if (!result.ok) console.error('[film-pass-checkout] confirmation failed', result.error);
  })().catch((e) => console.error('[film-pass-checkout] confirmation threw', e));

  // @ts-ignore — EdgeRuntime exists only in the Supabase edge runtime.
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(confirm);
  }

  syncMailchimp(contact);

  return json({
    success: true,
    order_id: pending.id,
    user_id: userId,
    pass_name: passType.name,
    quantity,
    fulfillment,
    amount_cents: amountCents,
    total,
    initial_balance: Number(passType.initial_balance),
    redemption_price: Number(passType.redemption_price),
    receipt_url: receiptUrl,
    square_payment_id: paymentId,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  // Square caps idempotency keys at 45 characters.
  return key.length >= 8 && key.length <= 45 ? key : crypto.randomUUID();
}

/** One shape for a pass, wherever the box office sees it. */
function describePass(
  p: any,
  holder: { display_name: string | null; email: string | null } | null,
) {
  const type = p.film_pass_types ?? {};
  const redemption = Number(type.redemption_price ?? 0);
  const balance = p.remaining_balance === null ? null : Number(p.remaining_balance);
  return {
    id: p.id,
    qr_code: p.qr_code,
    status: p.status,
    remaining_balance: balance,
    admissions_left: balance !== null && redemption > 0 ? Math.floor(balance / redemption) : null,
    redemption_price: redemption || null,
    expires_at: p.expires_at,
    activated_at: p.activated_at,
    price_paid: p.price_paid === null ? null : Number(p.price_paid),
    pass_type_name: type.name ?? 'Film Pass',
    holder_name: holder?.display_name ?? null,
    holder_email: holder?.email ?? null,
    bearer: !p.user_id,
  };
}

/** Turn an activation verdict into something a staff member can act on. */
function activationMessage(verdict: Record<string, any>): string {
  switch (verdict.result) {
    case 'not_found':
      return 'That sticker is not one of ours — check the code and try again.';
    case 'already_activated':
      return verdict.status === 'active'
        ? `That sticker is already an active pass with $${Number(
            verdict.remaining_balance ?? 0,
          ).toFixed(2)} on it.`
        : `That sticker has already been used — it is ${verdict.status}.`;
    case 'order_not_found':
      return 'That order no longer exists.';
    case 'order_not_payable':
      return verdict.order_status === 'fulfilled'
        ? 'That order has already been handed over.'
        : `That order is ${verdict.order_status}, so there is nothing to hand over.`;
    case 'pass_type_not_found':
      return 'That pass type no longer exists.';
    case 'no_code':
      return 'Scan a sticker first.';
    default:
      return 'That sticker could not be activated.';
  }
}

/** The order this key already created, if the buyer is retrying. */
async function findExistingOrder(admin: any, idempotencyKey: string, userId: string) {
  const { data } = await admin
    .from('film_pass_orders')
    .select(
      'id, quantity, fulfillment, amount_paid, status, square_payment_id, square_receipt_url, film_pass_types!film_pass_orders_pass_type_id_fkey(name, initial_balance, redemption_price)',
    )
    .eq('checkout_idempotency_key', idempotencyKey)
    .eq('user_id', userId)
    .in('status', ['paid', 'fulfilled'])
    .maybeSingle();

  if (!data) return null;

  return {
    success: true,
    replayed: true,
    order_id: data.id,
    user_id: userId,
    pass_name: (data as any).film_pass_types?.name ?? 'Film Pass',
    quantity: data.quantity,
    fulfillment: data.fulfillment,
    total: Number(data.amount_paid ?? 0),
    initial_balance: Number((data as any).film_pass_types?.initial_balance ?? 0),
    redemption_price: Number((data as any).film_pass_types?.redemption_price ?? 0),
    receipt_url: data.square_receipt_url ?? null,
    square_payment_id: data.square_payment_id ?? null,
  };
}

/** Marketing sync. Fire-and-forget: an outage must not affect a paid order. */
function syncMailchimp(contact: BuyerContact) {
  if (!contact.email) return;
  try {
    const [first, ...rest] = (contact.name || '').split(/\s+/);
    void fetch(`${SUPABASE_URL}/functions/v1/mailchimp-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({
        email: contact.email,
        first_name: first ?? '',
        last_name: rest.join(' '),
        tags: ['film-pass'],
        source: 'film-pass-checkout',
      }),
    }).catch(() => {});
  } catch (e) {
    console.warn('[film-pass-checkout] mailchimp sync threw', e);
  }
}
