-- Comps go through create_ticket_order too, and the last direct INSERT
-- policies on tickets come down. BRIEF-pricing-rpc, decision 3 ("later").
--
-- Two policies still let a browser insert ticket rows: "Staff can issue comps"
-- (narrowed in 20260922001849 to $0 rows) and "Hosts can issue tickets for
-- assigned showings" — which was never narrowed, so a host could write a PAID
-- row for an assigned showing straight through PostgREST, around the pricing
-- function. Both go. Every ticket row is now written by one of:
--
--   create_ticket_order   online / cash / card (priced) and comp ($0)
--   admit_with_film_pass  film_pass ($0), SECURITY DEFINER
--
-- A comp is not priced — the row trigger zeroes it regardless — but it still
-- passes the showing's rules (no-ticket, past) and its seat and tier are still
-- validated, because a comp for the front row is still the front row.

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

-- The old 9-argument signature is a different function to Postgres; drop it so
-- a caller cannot land on the one without comps.
DROP FUNCTION IF EXISTS public.create_ticket_order(uuid, jsonb, text, uuid, text, text, text, text, boolean);
REVOKE ALL ON FUNCTION public.create_ticket_order(uuid, jsonb, text, uuid, text, text, text, text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ticket_order(uuid, jsonb, text, uuid, text, text, text, text, boolean, text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Staff can issue comps" ON public.tickets;
DROP POLICY IF EXISTS "Hosts can issue tickets for assigned showings" ON public.tickets;
-- No INSERT policy remains. With RLS on, that is a refusal for every
-- authenticated direct insert; SECURITY DEFINER functions are unaffected.
