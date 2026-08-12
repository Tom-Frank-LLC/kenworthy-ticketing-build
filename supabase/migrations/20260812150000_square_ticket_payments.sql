-- Online ticket and film-pass purchases take payment.
--
-- Context: online checkout created confirmed tickets and film passes for free.
-- There was no Square integration on either path — nothing to "flip to live".
-- The fix inverts the order of operations: a server-side function prices the
-- order, charges Square, and only then confirms the ticket or pass.
--
-- This migration is the database half of that change. Three things:
--
--   1. Payment provenance. A ticket/pass now records which Square payment paid
--      for it, so a refund can credit the customer's actual card instead of
--      only flipping a status column.
--   2. A 'pending' state. Rows are written before the charge so a Square error
--      can never leave a purchase with no record at all; the trigger used to
--      force every insert to 'confirmed', which made that impossible.
--   3. Closing the free-ticket hole. No customer-facing client may insert a
--      confirmed ticket or a film pass any more. Those inserts now happen only
--      through the checkout functions, under the service role, after payment.

-- ---------------------------------------------------------------------------
-- 1. Payment provenance
-- ---------------------------------------------------------------------------

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS square_payment_id  text,
  ADD COLUMN IF NOT EXISTS square_receipt_url text,
  ADD COLUMN IF NOT EXISTS square_refund_id   text,
  ADD COLUMN IF NOT EXISTS refunded_at        timestamptz,
  ADD COLUMN IF NOT EXISTS payment_error      text,
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key text;

COMMENT ON COLUMN public.tickets.checkout_idempotency_key IS
  'Per-attempt key the browser generates once and resends on retry. The checkout function returns the existing order for a repeated key instead of charging again, and hands the same key to Square, so a double-click or a retried request yields exactly one charge and one order. Deliberately not the order_token: order_token is a bearer credential, and a client-supplied value must never be able to name someone else''s order.';

COMMENT ON COLUMN public.tickets.square_payment_id IS
  'Square payment that paid for this ticket. Set by ticket-checkout (online, Web Payments) and by the box office for Terminal card sales. NULL for cash, comp, and film-pass tickets, which have no card payment to refund.';

COMMENT ON COLUMN public.tickets.square_refund_id IS
  'Square refund issued against square_payment_id. Its presence is what distinguishes a customer whose card was actually credited from a ticket merely marked refunded.';

COMMENT ON COLUMN public.tickets.payment_error IS
  'Decline reason from Square when a purchase attempt failed. Kept so a failed order is explicable rather than just absent.';

CREATE INDEX IF NOT EXISTS tickets_square_payment_id_idx
  ON public.tickets (square_payment_id)
  WHERE square_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_checkout_idempotency_key_idx
  ON public.tickets (checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

ALTER TABLE public.user_film_passes
  ADD COLUMN IF NOT EXISTS square_payment_id  text,
  ADD COLUMN IF NOT EXISTS square_receipt_url text,
  ADD COLUMN IF NOT EXISTS price_paid         numeric(10,2),
  ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS sold_by_user_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key text;

CREATE INDEX IF NOT EXISTS user_film_passes_checkout_idempotency_key_idx
  ON public.user_film_passes (checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

-- Passes that predate this migration were all created outright, so they are
-- active by definition; the DEFAULT above already applied to them.
ALTER TABLE public.user_film_passes
  DROP CONSTRAINT IF EXISTS user_film_passes_status_check;

ALTER TABLE public.user_film_passes
  ADD CONSTRAINT user_film_passes_status_check
  CHECK (status IN ('pending', 'active', 'failed', 'refunded'));

COMMENT ON COLUMN public.user_film_passes.status IS
  'pending until the card is charged, then active. A failed charge leaves the row as failed — it holds no spendable balance and must never be treated as a pass. Redemption paths filter on active.';

COMMENT ON COLUMN public.user_film_passes.price_paid IS
  'What the buyer actually paid for the pass, recorded at purchase. film_pass_types.price can change later; this is what a refund is owed against.';

COMMENT ON COLUMN public.user_film_passes.sold_by_user_id IS
  'Staff member who rang up a box-office pass sale. Previously the walk-in pass was created *under the staff account* when the patron had no profile, which handed the patron''s balance to the employee; the pass now always belongs to the patron and the seller is recorded here instead.';

-- ---------------------------------------------------------------------------
-- 2. Let a ticket be born pending
-- ---------------------------------------------------------------------------
--
-- Unchanged from the previous version except for the status line: an insert
-- that explicitly asks for 'pending' keeps it, so the checkout function can
-- write the order, charge the card, and then promote the rows. Everything else
-- — comp handling, seat-tier override, price/tax derivation — is preserved
-- verbatim, because the pricing authority itself is not what is being changed.

CREATE OR REPLACE FUNCTION public.enforce_ticket_pricing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_price numeric;
  v_seat_tier_id uuid;
  v_tax_rate numeric := 0.06;
BEGIN
  IF NEW.payment_method = 'comp' THEN
    NEW.price := 0;
    NEW.tax_rate := 0;
    NEW.tax_amount := 0;
    NEW.total_price := 0;
    NEW.processing_fee := 0;
    NEW.status := 'confirmed';
    RETURN NEW;
  END IF;

  IF NEW.seat_id IS NOT NULL THEN
    SELECT sst.tier_id INTO v_seat_tier_id
    FROM public.showing_seat_tiers sst
    JOIN public.seats s ON s.id = NEW.seat_id
    JOIN public.venue_seats vs
      ON vs.seat_row = s.seat_row
     AND vs.seat_number = s.seat_number
     AND COALESCE(vs.section,'') = COALESCE(s.section,'')
    WHERE sst.showing_id = NEW.showing_id
      AND sst.venue_seat_id = vs.id
    LIMIT 1;
    IF v_seat_tier_id IS NOT NULL THEN
      NEW.tier_id := v_seat_tier_id;
    END IF;
  END IF;

  IF NEW.tier_id IS NOT NULL THEN
    SELECT price INTO v_ticket_price
    FROM public.showing_price_tiers
    WHERE id = NEW.tier_id AND showing_id = NEW.showing_id;
    IF v_ticket_price IS NULL THEN
      RAISE EXCEPTION 'Invalid tier_id for this showing';
    END IF;
  ELSE
    SELECT ticket_price INTO v_ticket_price
    FROM public.showings WHERE id = NEW.showing_id;
    IF v_ticket_price IS NULL THEN
      RAISE EXCEPTION 'Invalid showing_id';
    END IF;
  END IF;

  NEW.price := v_ticket_price;
  NEW.tax_rate := v_tax_rate;
  NEW.tax_amount := ROUND(v_ticket_price * v_tax_rate, 2);
  NEW.total_price := ROUND(v_ticket_price + (v_ticket_price * v_tax_rate), 2);
  -- processing_fee is buyer-paid pass-through; the checkout function computes
  -- it server-side. Negative or absent means none.
  IF NEW.processing_fee IS NULL OR NEW.processing_fee < 0 THEN
    NEW.processing_fee := 0;
  END IF;

  -- A ticket awaiting its charge stays pending; anything else is confirmed on
  -- insert exactly as before.
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    NEW.status := 'confirmed';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. No client may create a paid ticket or a film pass
-- ---------------------------------------------------------------------------
--
-- "Users can purchase tickets" allowed any authenticated account to INSERT a
-- ticket for itself. With the trigger forcing status='confirmed', that was a
-- free, scannable ticket for anyone who could call PostgREST — which is what
-- the signed-in checkout was in fact doing. Online purchases now go through
-- ticket-checkout under the service role, after payment.
--
-- Box office and hosts keep their client-side inserts: those are staff-operated
-- and take payment (or are deliberate comps) in the room.

DROP POLICY IF EXISTS "Users can purchase tickets" ON public.tickets;

DROP POLICY IF EXISTS "Staff can sell tickets" ON public.tickets;
CREATE POLICY "Staff can sell tickets"
  ON public.tickets FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'staff'::app_role));

-- Same hole on the pass side: any authenticated user could insert a pass row
-- for themselves with an arbitrary balance. Pass creation is now exclusively
-- film-pass-checkout's job (service role), for self-serve and box office alike.
DROP POLICY IF EXISTS "Authenticated users can purchase passes" ON public.user_film_passes;

-- Redemption spends money. redeem_film_pass is SECURITY DEFINER and does not
-- verify that the pass belongs to the caller, so an authenticated user holding
-- someone else's pass id could drain it. Only the server may call it now; the
-- checkout function checks ownership first and supplies its own amount.
REVOKE EXECUTE ON FUNCTION public.redeem_film_pass(uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_film_pass(uuid, uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_film_pass(uuid, uuid, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_film_pass(uuid, uuid, numeric) TO service_role;

-- Redemption rows are written by that function; no client writes them directly.
DROP POLICY IF EXISTS "Authenticated users can create redemptions" ON public.film_pass_redemptions;
