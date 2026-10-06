-- Counter-sale integrity: what a staff session can claim was paid, and the
-- three writes the box office makes that used to be unsafe or silent.
-- Security audit 2026-10-06: L1, L3 and RLS-9. BRIEF-sec-staff-boundaries.
--
--   1. One Square payment pays for one order. A trigger on tickets refuses a
--      square_payment_id that is already on a different order (or on a film
--      pass), whoever writes it: create_ticket_order, square-terminal's
--      confirm_sale, square-cash-sale's stamp, ticket-checkout's confirm.
--      Before this, one completed card swipe could confirm any number of later
--      counter orders, and a cash sale could be written as a card sale carrying
--      someone else's payment, so the till expected nothing.
--
--   2. create_ticket_order no longer lets a browser say a card was paid. A
--      staff session may write cash (confirmed: staff are trusted with the
--      till), card only as `pending`, and no square_payment_id at all. A card
--      row becomes confirmed only in square-terminal's confirm_sale, which
--      reads the checkout from Square. Online rows come from ticket-checkout,
--      which is the service role.
--
--   3. release_pending_card_sale: the POS's "the reader was never reached / the
--      sale was cancelled on the terminal" release. Staff have no UPDATE on
--      tickets (admins and hosts do), so the browser's own update matched no
--      rows and supabase-js reported success: the seats stayed held and the
--      rows stayed `pending` forever (RLS-9). This does the one transition the
--      POS needs, pending -> failed on a card order, and nothing else.
--
--   4. refund_film_pass_redemption: the film-pass branch of square-refund, as
--      one locked statement. It was a read-modify-write of remaining_balance
--      from the edge function, so two refunds against one pass could each
--      credit from the same starting balance, and it credited void and expired
--      passes, which can never spend it.

-- ---------------------------------------------------------------------------
-- 1. One payment, one order
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tickets_payment_belongs_to_one_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.square_payment_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.square_payment_id IS NOT DISTINCT FROM OLD.square_payment_id
     AND NEW.order_token IS NOT DISTINCT FROM OLD.order_token THEN
    RETURN NEW;  -- a status flip on an already-stamped row: nothing to check
  END IF;

  -- Two confirms racing with one payment id would each see the other's rows
  -- as not yet there. Serialise on the payment id for this transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('square_payment:' || NEW.square_payment_id, 0));

  IF EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.square_payment_id = NEW.square_payment_id
       AND t.order_token IS DISTINCT FROM NEW.order_token
       AND t.id <> NEW.id
  ) OR EXISTS (
    SELECT 1 FROM public.user_film_passes p WHERE p.square_payment_id = NEW.square_payment_id
  ) OR EXISTS (
    SELECT 1 FROM public.film_pass_orders o WHERE o.square_payment_id = NEW.square_payment_id
  ) THEN
    RAISE EXCEPTION 'That Square payment already paid for a different order'
      USING ERRCODE = 'PT423',
            HINT = 'One card payment confirms one order. Take a new payment for this one.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tickets_payment_belongs_to_one_order() IS
  'Refuses a tickets.square_payment_id already used by another order or by a film pass (security audit 2026-10-06, L1).';

REVOKE ALL ON FUNCTION public.tickets_payment_belongs_to_one_order() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tickets_payment_belongs_to_one_order ON public.tickets;
CREATE TRIGGER tickets_payment_belongs_to_one_order
  BEFORE INSERT OR UPDATE OF square_payment_id, order_token ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_payment_belongs_to_one_order();

-- ---------------------------------------------------------------------------
-- 2. create_ticket_order: a browser cannot say a card was paid
-- ---------------------------------------------------------------------------
--
-- The body is 20260922170258's, unchanged, with one block added after the role
-- check (marked). The signature is unchanged, so the grants carry over.

CREATE OR REPLACE FUNCTION public.create_ticket_order(
  p_showing_id uuid,
  p_tickets jsonb,
  p_payment_method text,               -- 'online' | 'cash' | 'card' | 'comp'
  p_user_id uuid,
  p_order_token text DEFAULT NULL,
  p_status text DEFAULT 'confirmed',   -- 'pending' for a card sale awaiting its charge
  p_square_payment_id text DEFAULT NULL,
  p_checkout_idempotency_key text DEFAULT NULL,
  p_sms_consent boolean DEFAULT NULL,
  p_comp_recipient_name text DEFAULT NULL,
  p_comp_recipient_email text DEFAULT NULL
) RETURNS SETOF public.tickets
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_channel text;
  v_token text := COALESCE(p_order_token, gen_random_uuid()::text);
  v_is_service boolean := auth.role() = 'service_role';
  v_caller uuid := auth.uid();
  i integer;
  t record;
BEGIN
  IF p_payment_method NOT IN ('online', 'cash', 'card', 'comp') THEN
    RAISE EXCEPTION 'create_ticket_order takes online, cash, card or comp' USING ERRCODE = 'PT400';
  END IF;
  IF p_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'status must be pending or confirmed' USING ERRCODE = 'PT400';
  END IF;

  -- Who may write what. Staff and the service role: anything. A host: comps
  -- for a showing they are assigned to, and nothing priced.
  IF NOT (
    v_is_service
    OR public.has_role(v_caller, 'staff'::app_role)
    OR (p_payment_method = 'comp' AND public.is_host_of_showing(v_caller, p_showing_id))
  ) THEN
    RAISE EXCEPTION 'Staff access required' USING ERRCODE = '42501';
  END IF;

  -- ---- added 2026-10-06 (security audit L1) --------------------------------
  -- A signed-in session is a browser, and a browser cannot vouch for a card.
  -- The counter's card sale writes `pending` with no payment id; square-terminal
  -- confirms it after reading the checkout from Square. Online rows come from
  -- ticket-checkout as the service role. So from a session: no payment id, and
  -- no confirmed card or online row. Cash stays confirmable, because staff are
  -- trusted with the till and there is nothing for Square to vouch for.
  IF NOT v_is_service THEN
    IF p_square_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'A payment id is recorded by the server that read it from Square, not by the browser'
        USING ERRCODE = '42501';
    END IF;
    IF p_payment_method IN ('card', 'online') AND p_status = 'confirmed' THEN
      RAISE EXCEPTION 'A card sale starts pending and is confirmed once Square reports the payment'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- --------------------------------------------------------------------------

  IF p_payment_method = 'comp' THEN
    IF p_tickets IS NULL OR jsonb_typeof(p_tickets) <> 'array' OR jsonb_array_length(p_tickets) = 0 THEN
      RAISE EXCEPTION 'No tickets requested' USING ERRCODE = 'PT400';
    END IF;
    IF NULLIF(btrim(COALESCE(p_comp_recipient_name, '')), '') IS NULL THEN
      RAISE EXCEPTION 'A comp needs the name of the person it is for' USING ERRCODE = 'PT400';
    END IF;
    -- The showing's own rules, without pricing it: a comp for a walk-in night or
    -- a finished show is refused by the same triggers a sale is.
    FOR i IN 0 .. jsonb_array_length(p_tickets) - 1 LOOP
      SELECT NULLIF(p_tickets -> i ->> 'seat_id', '')::uuid AS seat_id,
             NULLIF(p_tickets -> i ->> 'tier_id', '')::uuid AS tier_id INTO t;
      IF t.tier_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.showing_price_tiers WHERE id = t.tier_id AND showing_id = p_showing_id) THEN
        RAISE EXCEPTION 'Invalid ticket tier for this showing' USING ERRCODE = 'PT400';
      END IF;
      RETURN QUERY
      INSERT INTO public.tickets (
        user_id, showing_id, seat_id, tier_id,
        price, tax_rate, tax_amount, total_price, processing_fee,
        qr_code, order_token, status, payment_method,
        comp_recipient_name, comp_recipient_email, issued_by_user_id
      ) VALUES (
        p_user_id, p_showing_id, t.seat_id, t.tier_id,
        0, 0, 0, 0, 0,
        'COMP-' || gen_random_uuid()::text, v_token, 'confirmed', 'comp',
        btrim(p_comp_recipient_name), NULLIF(btrim(COALESCE(p_comp_recipient_email, '')), ''),
        COALESCE(v_caller, p_user_id)
      )
      RETURNING public.tickets.*;
    END LOOP;
    RETURN;
  END IF;

  -- No card was processed for cash, so no surcharge; online is keyed entry.
  v_channel := CASE p_payment_method WHEN 'online' THEN 'online' WHEN 'card' THEN 'in_person' ELSE 'none' END;

  RETURN QUERY
  INSERT INTO public.tickets (
    user_id, showing_id, seat_id, tier_id,
    price, tax_rate, tax_amount, total_price,
    list_price, discount_amount, discount_id, discount_label,
    processing_fee, qr_code, order_token, status, payment_method,
    square_payment_id, checkout_idempotency_key, sms_consent
  )
  SELECT p_user_id, p_showing_id, q.seat_id, q.tier_id,
         q.price, 0.06, q.tax_amount, q.total_price,
         q.list_price, q.discount_amount, q.discount_id, q.discount_label,
         CASE WHEN q.seq = 0 THEN q.order_processing_fee ELSE 0 END,
         gen_random_uuid()::text, v_token, p_status, p_payment_method,
         p_square_payment_id, p_checkout_idempotency_key, p_sms_consent
  FROM public.price_ticket_order(p_showing_id, p_tickets, v_channel) q
  ORDER BY q.seq
  RETURNING public.tickets.*;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Releasing a card sale that never happened (RLS-9)
-- ---------------------------------------------------------------------------
--
-- Narrow on purpose, rather than an UPDATE policy for staff on tickets: a
-- policy would let a staff session rewrite any column of any ticket, which is
-- exactly what the pricing work took away. This moves only
--   card, pending  ->  failed
-- for one order token, and only the caller's own sale (the POS writes its rows
-- with user_id = the staff member ringing it) unless the caller is an admin.
-- A confirmed, refunded or cash row is never touched.
--
-- Returns the released ids. The POS compares the count with what it wrote,
-- because "no error" has never meant "it happened" on this table.

CREATE OR REPLACE FUNCTION public.release_pending_card_sale(
  p_order_token text,
  p_reason text DEFAULT NULL
) RETURNS SETOF uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_service boolean := auth.role() = 'service_role';
  v_is_admin boolean;
BEGIN
  IF NOT (v_is_service OR public.has_role(v_caller, 'staff'::app_role)) THEN
    RAISE EXCEPTION 'Staff access required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_order_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'order_token is required' USING ERRCODE = 'PT400';
  END IF;
  v_is_admin := v_is_service OR public.has_role(v_caller, 'admin'::app_role);

  RETURN QUERY
  UPDATE public.tickets
     SET status = 'failed',
         payment_error = left(COALESCE(NULLIF(btrim(p_reason), ''), 'Card sale released at the box office'), 500)
   WHERE order_token = p_order_token
     AND payment_method = 'card'
     AND status = 'pending'
     AND (v_is_admin OR user_id = v_caller)
  RETURNING id;
END;
$$;

COMMENT ON FUNCTION public.release_pending_card_sale(text, text) IS
  'POS: mark a counter card order that never reached the reader, or was cancelled on it, as failed (pending -> failed only). Staff may release their own sale; admins any. Security audit 2026-10-06, RLS-9.';

REVOKE ALL ON FUNCTION public.release_pending_card_sale(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_pending_card_sale(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Putting a film-pass admission back on the pass (L3)
-- ---------------------------------------------------------------------------
--
-- One redemption, one transaction: the redemption row and the pass are locked,
-- the balance is credited in place (never read into the edge function and
-- written back), and the redemption is removed so the pass's history matches
-- its balance. A void or expired pass is not credited: it can never spend the
-- money, and crediting it would make the refund look settled when it is not.
-- A depleted pass that can afford an admission again becomes active, the
-- mirror of the rule admit_with_film_pass applies when it deducts.

CREATE OR REPLACE FUNCTION public.refund_film_pass_redemption(p_redemption_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  p record;
  v_cost numeric;
  v_balance numeric;
  v_status text;
BEGIN
  SELECT * INTO r FROM public.film_pass_redemptions WHERE id = p_redemption_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT * INTO p FROM public.user_film_passes WHERE id = r.pass_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'no_pass', 'pass_id', r.pass_id);
  END IF;

  IF p.status IN ('void', 'expired') OR (p.expires_at IS NOT NULL AND p.expires_at < now()) THEN
    RETURN jsonb_build_object(
      'result', 'pass_not_creditable',
      'pass_id', p.id,
      'status', CASE WHEN p.status = 'void' THEN 'void' ELSE 'expired' END,
      'amount', r.amount_deducted
    );
  END IF;

  SELECT redemption_price INTO v_cost FROM public.film_pass_types WHERE id = p.pass_type_id;
  v_balance := round(COALESCE(p.remaining_balance, 0) + COALESCE(r.amount_deducted, 0), 2);
  v_status := CASE
    WHEN p.status = 'depleted' AND v_cost IS NOT NULL AND v_balance >= v_cost THEN 'active'
    ELSE p.status
  END;

  UPDATE public.user_film_passes
     SET remaining_balance = v_balance,
         status = v_status
   WHERE id = p.id;
  DELETE FROM public.film_pass_redemptions WHERE id = r.id;

  RETURN jsonb_build_object(
    'result', 'credited',
    'pass_id', p.id,
    'amount', r.amount_deducted,
    'remaining_balance', v_balance,
    'status', v_status
  );
END;
$$;

COMMENT ON FUNCTION public.refund_film_pass_redemption(uuid) IS
  'square-refund: credit one film-pass admission back to its pass atomically; refuses void/expired passes. Service role only. Security audit 2026-10-06, L3.';

REVOKE ALL ON FUNCTION public.refund_film_pass_redemption(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_film_pass_redemption(uuid) TO service_role;
