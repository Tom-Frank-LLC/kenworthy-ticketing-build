
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS processing_fee numeric NOT NULL DEFAULT 0;

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
  -- processing_fee is buyer-paid pass-through; client supplies it. Default 0.
  IF NEW.processing_fee IS NULL OR NEW.processing_fee < 0 THEN
    NEW.processing_fee := 0;
  END IF;
  NEW.status := 'confirmed';
  RETURN NEW;
END;
$function$;
