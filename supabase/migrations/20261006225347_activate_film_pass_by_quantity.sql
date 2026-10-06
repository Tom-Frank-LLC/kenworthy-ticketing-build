-- An online film-pass order for N passes is discharged by N stickers, not one.
-- Security audit 2026-10-06, L2; BRIEF-sec-pricing.
--
-- film-pass-checkout sells up to ten passes in one order and charges for all
-- of them, but activate_film_pass (20260813000000) set the order 'fulfilled'
-- on the first sticker scanned against it. The order then left the box office
-- queue (status = 'paid') with the other passes never issued, and nothing
-- recorded that they were owed.
--
-- Counting needs to know which passes an order produced. film_pass_orders has
-- one pass_id, so the link goes the other way: each pass records the order it
-- discharged. Under the order's row lock (taken below, as before) the count is
-- exact — two staff members scanning against the same order serialise.
--
-- The order stays 'paid', and so stays in the queue, until the last pass is
-- activated; only then is it 'fulfilled' with fulfilled_at/by, which is what
-- the mail queue (20260813210000) keys on. pass_id keeps meaning what it did
-- for a single-pass order: the first pass issued against it.

ALTER TABLE public.user_film_passes
  ADD COLUMN IF NOT EXISTS film_pass_order_id uuid
    REFERENCES public.film_pass_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.user_film_passes.film_pass_order_id IS
  'The online order this pass was activated against, NULL for a counter sale. activate_film_pass counts these to fulfil an order by its quantity; the accounting export uses it to book order passes once (at the order) rather than again as counter sales.';

CREATE INDEX IF NOT EXISTS user_film_passes_film_pass_order_id_idx
  ON public.user_film_passes (film_pass_order_id)
  WHERE film_pass_order_id IS NOT NULL;

-- Every pass activated against an order so far is the one in its pass_id.
UPDATE public.user_film_passes p
SET film_pass_order_id = o.id
FROM public.film_pass_orders o
WHERE o.pass_id = p.id
  AND p.film_pass_order_id IS NULL;

-- Body identical to 20260813000000 except: the passes already issued against
-- the order are counted; a full order is refused; the new pass records its
-- order; and the order is fulfilled only by its last pass.
CREATE OR REPLACE FUNCTION public.activate_film_pass(
  p_qr_code           text,
  p_order_id          uuid    DEFAULT NULL,
  p_user_id           uuid    DEFAULT NULL,
  p_pass_type_id      uuid    DEFAULT NULL,
  p_activated_by      uuid    DEFAULT NULL,
  p_payment_method    text    DEFAULT NULL,
  p_price_paid        numeric DEFAULT NULL,
  p_square_payment_id text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pass        public.user_film_passes%ROWTYPE;
  v_order       public.film_pass_orders%ROWTYPE;
  v_type        public.film_pass_types%ROWTYPE;
  v_user_id     uuid    := p_user_id;
  v_type_id     uuid    := p_pass_type_id;
  v_price_paid  numeric := p_price_paid;
  v_expires_at  timestamptz;
  v_issued      integer := 0;
  v_complete    boolean := false;
BEGIN
  IF p_qr_code IS NULL OR btrim(p_qr_code) = '' THEN
    RETURN jsonb_build_object('result', 'no_code');
  END IF;

  SELECT * INTO v_pass
  FROM public.user_film_passes
  WHERE qr_code = btrim(p_qr_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- Only a blank can be activated. Re-scanning an already-active sticker is
  -- the most likely mistake at a busy counter, so it gets its own verdict
  -- rather than a generic refusal.
  IF v_pass.status <> 'unassigned' THEN
    RETURN jsonb_build_object(
      'result', 'already_activated',
      'pass_id', v_pass.id,
      'status', v_pass.status,
      'remaining_balance', v_pass.remaining_balance
    );
  END IF;

  -- An order, when this is a collection or a posting, supplies the owner, the
  -- type and what was actually paid. Locked alongside the pass so two staff
  -- members cannot discharge the same order with two stickers.
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.film_pass_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('result', 'order_not_found');
    END IF;
    IF v_order.status <> 'paid' THEN
      RETURN jsonb_build_object('result', 'order_not_payable', 'order_status', v_order.status);
    END IF;

    -- How many passes this order has already produced. Read under the order's
    -- lock, so a concurrent activation against it waits and then sees this one.
    SELECT count(*) INTO v_issued
    FROM public.user_film_passes
    WHERE film_pass_order_id = p_order_id;
    -- A 'paid' order with every pass issued should not exist (the last pass
    -- fulfils it), but if one does it is owed nothing more. Reported as
    -- fulfilled, which is what it is in fact, so the counter is told "already
    -- handed over" rather than "that order is paid".
    IF v_issued >= v_order.quantity THEN
      RETURN jsonb_build_object('result', 'order_not_payable', 'order_status', 'fulfilled',
                                'quantity', v_order.quantity, 'passes_activated', v_issued);
    END IF;

    v_user_id    := COALESCE(v_user_id, v_order.user_id);
    v_type_id    := COALESCE(v_type_id, v_order.pass_type_id);
    v_price_paid := COALESCE(
      v_price_paid,
      CASE WHEN v_order.quantity > 0
           THEN round(v_order.amount_paid / v_order.quantity, 2)
           ELSE v_order.amount_paid END
    );
  END IF;

  -- Fall back to what the sticker was printed for. A batch is minted for a
  -- type, so this is nearly always the answer already.
  v_type_id := COALESCE(v_type_id, v_pass.pass_type_id);

  SELECT * INTO v_type FROM public.film_pass_types WHERE id = v_type_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'pass_type_not_found');
  END IF;

  -- The clock starts here, not at purchase: a pass waiting in a drawer to be
  -- collected must not spend its validity being un-collected.
  v_expires_at := CASE
    WHEN v_type.expiration_days IS NULL THEN NULL
    ELSE now() + make_interval(days => v_type.expiration_days)
  END;

  UPDATE public.user_film_passes
  SET user_id            = v_user_id,
      pass_type_id       = v_type_id,
      remaining_balance  = v_type.initial_balance,
      expires_at         = v_expires_at,
      status             = 'active',
      activated_at       = now(),
      activated_by       = p_activated_by,
      purchased_at       = now(),
      payment_method     = COALESCE(p_payment_method, v_pass.payment_method),
      price_paid         = COALESCE(v_price_paid, v_type.price),
      square_payment_id  = COALESCE(p_square_payment_id, v_pass.square_payment_id),
      film_pass_order_id = p_order_id
  WHERE id = v_pass.id;

  IF p_order_id IS NOT NULL THEN
    v_issued   := v_issued + 1;
    v_complete := v_issued >= v_order.quantity;
    -- Fulfilled by its last pass, not its first. Until then the order stays
    -- 'paid' and in the queue, owed quantity - issued more stickers.
    UPDATE public.film_pass_orders
    SET pass_id      = COALESCE(pass_id, v_pass.id),
        status       = CASE WHEN v_complete THEN 'fulfilled' ELSE status END,
        fulfilled_at = CASE WHEN v_complete THEN now() ELSE fulfilled_at END,
        fulfilled_by = CASE WHEN v_complete THEN p_activated_by ELSE fulfilled_by END
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'result', 'activated',
    'pass_id', v_pass.id,
    'qr_code', v_pass.qr_code,
    'user_id', v_user_id,
    'pass_type_id', v_type_id,
    'pass_type_name', v_type.name,
    'remaining_balance', v_type.initial_balance,
    'redemption_price', v_type.redemption_price,
    'admissions', floor(v_type.initial_balance / v_type.redemption_price),
    'expires_at', v_expires_at,
    'order_id', p_order_id,
    -- For an order: how far through it this sticker got. NULL for a counter sale.
    'quantity', CASE WHEN p_order_id IS NOT NULL THEN v_order.quantity END,
    'passes_activated', CASE WHEN p_order_id IS NOT NULL THEN v_issued END,
    'passes_remaining', CASE WHEN p_order_id IS NOT NULL THEN v_order.quantity - v_issued END,
    'order_fulfilled', CASE WHEN p_order_id IS NOT NULL THEN v_complete END
  );
END;
$function$;

COMMENT ON FUNCTION public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text) IS
  'Turns a printed blank sticker into a funded pass and, for an online order, records the pass against it, in one transaction. The order is fulfilled when its quantity of passes has been activated, not by the first. Expiry is measured from this moment, not from purchase. Returns a verdict object (activated / not_found / already_activated / order_not_payable / ...) instead of raising, so the box office can be told what went wrong. Service role only: it is the sole way a balance comes into existence.';

REVOKE ALL ON FUNCTION public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text) TO service_role;
