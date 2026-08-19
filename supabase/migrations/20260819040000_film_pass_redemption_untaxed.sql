-- A film-pass admission is not a taxed sale.
--
-- The tax was wired backwards. Buying a pass collected NO tax
-- (film-pass-checkout charged price x quantity), while every admission redeemed
-- against that pass recorded 6% — because enforce_ticket_pricing zeroed tax for
-- 'comp' and nothing else, so 'film_pass' fell through to the ordinary
-- price-and-tax branch. The theatre was booking sales tax on money nobody had
-- handed over, and collecting none on the money it did take.
--
-- It went unnoticed partly because QboExportTab skips film_pass rows entirely
-- (src/components/admin/accounting/QboExportTab.tsx:167), so the phantom tax
-- never reached the books it would have contradicted.
--
-- The decided treatment: tax at PURCHASE, not at redemption. The purchase side
-- is fixed in film-pass-checkout, which now adds 6% on top of the listed price.
-- This is the redemption side: a redemption records a $0 admission, exactly like
-- a comp. The pass's own balance still moves through redeem_film_pass, and
-- film_pass_redemptions still records what was spent, so nothing is lost — the
-- value of the admission lives on the pass, where it was paid for.
--
-- Reproduced verbatim from 20260812150000 with one branch added. Everything else
-- — seat tier resolution, tier pricing, the pending-status carve-out — is
-- unchanged.

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
  -- A comp is free, and a pass admission has already been paid for. Both record
  -- a zero-value, zero-tax ticket; neither is a sale at the door.
  IF NEW.payment_method IN ('comp', 'film_pass') THEN
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

COMMENT ON FUNCTION public.enforce_ticket_pricing() IS
  'Server-side ticket pricing. comp and film_pass record a $0 admission: a comp '
  'is free and a pass admission was paid for when the pass was bought. Mirrored '
  'by _shared/pricing.ts, which must round tax the same way.';
