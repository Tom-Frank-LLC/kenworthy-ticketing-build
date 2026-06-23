
-- 1. Pass-processing-fee toggle on each production type
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS pass_processing_fee BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.live_performances ADD COLUMN IF NOT EXISTS pass_processing_fee BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.movies ADD COLUMN IF NOT EXISTS pass_processing_fee BOOLEAN NOT NULL DEFAULT false;

-- 2. Comp ticket fields
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS comp_recipient_name TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS comp_recipient_email TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS issued_by_user_id UUID;

-- 3. Helper: is this user a host of the given production?
CREATE OR REPLACE FUNCTION public.is_host_of(
  _user_id uuid,
  _event_id uuid,
  _live_performance_id uuid,
  _movie_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.host_event_assignments ha
    WHERE ha.user_id = _user_id
      AND (
        (_event_id IS NOT NULL AND ha.event_id = _event_id) OR
        (_live_performance_id IS NOT NULL AND ha.live_performance_id = _live_performance_id) OR
        (_movie_id IS NOT NULL AND ha.movie_id = _movie_id)
      )
  );
$$;

-- Helper: is this user a host for the given showing?
CREATE OR REPLACE FUNCTION public.is_host_of_showing(_user_id uuid, _showing_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.showings s
    JOIN public.host_event_assignments ha ON (
      (ha.event_id IS NOT NULL AND ha.event_id = s.event_id) OR
      (ha.live_performance_id IS NOT NULL AND ha.live_performance_id = s.live_performance_id) OR
      (ha.movie_id IS NOT NULL AND ha.movie_id = s.movie_id)
    )
    WHERE s.id = _showing_id AND ha.user_id = _user_id
  );
$$;

-- 4. Hosts can update their assigned productions
CREATE POLICY "Hosts can update assigned events"
ON public.events FOR UPDATE
USING (public.is_host_of(auth.uid(), id, NULL, NULL))
WITH CHECK (public.is_host_of(auth.uid(), id, NULL, NULL));

CREATE POLICY "Hosts can update assigned live performances"
ON public.live_performances FOR UPDATE
USING (public.is_host_of(auth.uid(), NULL, id, NULL))
WITH CHECK (public.is_host_of(auth.uid(), NULL, id, NULL));

CREATE POLICY "Hosts can update assigned movies"
ON public.movies FOR UPDATE
USING (public.is_host_of(auth.uid(), NULL, NULL, id))
WITH CHECK (public.is_host_of(auth.uid(), NULL, NULL, id));

-- 5. Hosts can manage showings for their productions
CREATE POLICY "Hosts can insert showings for assigned"
ON public.showings FOR INSERT
WITH CHECK (public.is_host_of(auth.uid(), event_id, live_performance_id, movie_id));

CREATE POLICY "Hosts can update assigned showings"
ON public.showings FOR UPDATE
USING (public.is_host_of(auth.uid(), event_id, live_performance_id, movie_id))
WITH CHECK (public.is_host_of(auth.uid(), event_id, live_performance_id, movie_id));

CREATE POLICY "Hosts can delete assigned showings"
ON public.showings FOR DELETE
USING (public.is_host_of(auth.uid(), event_id, live_performance_id, movie_id));

-- 6. Hosts can issue comp tickets for their showings, and update (scan) them
CREATE POLICY "Hosts can issue tickets for assigned showings"
ON public.tickets FOR INSERT
WITH CHECK (public.is_host_of_showing(auth.uid(), showing_id));

CREATE POLICY "Hosts can update tickets for assigned showings"
ON public.tickets FOR UPDATE
USING (public.is_host_of_showing(auth.uid(), showing_id))
WITH CHECK (public.is_host_of_showing(auth.uid(), showing_id));

-- 7. Comp tickets bypass the showing price (price = 0)
CREATE OR REPLACE FUNCTION public.enforce_ticket_pricing()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_ticket_price numeric;
  v_seat_tier_id uuid;
  v_tax_rate numeric := 0.06;
BEGIN
  -- Comp tickets: free, no tax
  IF NEW.payment_method = 'comp' THEN
    NEW.price := 0;
    NEW.tax_rate := 0;
    NEW.tax_amount := 0;
    NEW.total_price := 0;
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
  NEW.status := 'confirmed';
  RETURN NEW;
END;
$function$;
