-- A general-admission tier can have its own ticket limit.
-- BRIEF-tier-ticket-limits. Asked for by box-office staff for the ballet:
-- "Preferred Seating" is a fixed block of the house and sells out before
-- "General Admission", but a GA tier was only ever a name and a price, so the
-- showing's one capacity number was the only ceiling and nothing stopped
-- Preferred selling every seat in the room.
--
-- Assigned seating already has this, structurally: each tier owns specific
-- seats on the map, so a tier is gone when its seats are. This is the GA
-- equivalent, and it is deliberately GA-only for the same reason the showing
-- capacity guard is (see 20260812170000): a seated ticket is bounded by its seat.
--
-- Four parts:
--   1. showing_price_tiers.max_tickets — NULL is no limit (every tier that
--      exists today), 0 is "this tier is closed" and is allowed on purpose: it
--      is how staff sell out one tier by hand before its count runs out.
--   2. enforce_showing_capacity() also refuses a ticket that would push its
--      tier past the limit. Same trigger, same row lock, same PT409, so every
--      path that issues a ticket — website, box office, terminal, comps, pass
--      redemption — is held to it, and the race between two buyers for the last
--      Preferred seat serialises exactly as the race for the last seat does.
--   3. showing_availability() returns each live tier's limit and what is left,
--      so the patron page and the POS can grey a tier out before the click.
--   4. set_showing_price_tiers() writes the limit. An omitted key keeps the row's
--      limit (the seat editor, which has no limit field, saves through this same
--      function and must not wipe one); an explicit null clears it.

-- 1 -------------------------------------------------------------------------
ALTER TABLE public.showing_price_tiers
  ADD COLUMN IF NOT EXISTS max_tickets integer;

ALTER TABLE public.showing_price_tiers
  DROP CONSTRAINT IF EXISTS showing_price_tiers_max_tickets_nonnegative;
ALTER TABLE public.showing_price_tiers
  ADD CONSTRAINT showing_price_tiers_max_tickets_nonnegative
  CHECK (max_tickets IS NULL OR max_tickets >= 0);

COMMENT ON COLUMN public.showing_price_tiers.max_tickets IS
  'Most tickets this tier may sell for its showing, counting confirmed sales and unexpired pending holds. NULL = no limit beyond the showing''s own capacity; 0 = closed. General admission only: enforced by enforce_showing_capacity(), which ignores seated tickets. Written by set_showing_price_tiers().';

-- 2 -------------------------------------------------------------------------
-- The body below is 20260812170000's, unchanged except for the tier block and
-- the move of the "no capacity recorded" early return below it: a showing with
-- no total_seats can still have a tier with a limit.
CREATE OR REPLACE FUNCTION public.enforce_showing_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_seats integer;
  v_held integer;
  v_tier_name text;
  v_tier_max integer;
  v_tier_held integer;
BEGIN
  -- Assigned seating is already bounded, twice over: a seat map has a finite
  -- number of seats, and UNIQUE(showing_id, seat_id) makes selling one of them
  -- twice impossible. Counting assigned sales against total_seats here would
  -- actively break those showings — showings.total_seats defaults to 200 while
  -- the Main Theater has 265 seats, so seats 201-265 would become unsellable on
  -- any showing whose capacity was never edited. GA is the case with no
  -- structural ceiling, and so the only case needing one imposed. The same
  -- holds for a tier: a seated tier owns its seats on the map.
  IF NEW.seat_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- A ticket that is not held occupies nothing. This reads NEW.status after
  -- enforce_ticket_pricing has finalised it — see the trigger name below.
  IF NEW.status NOT IN ('confirmed', 'pending') THEN
    RETURN NEW;
  END IF;

  -- Lock the showing row. This is the entire reason the check lives here:
  -- concurrent orders for the last seat serialise on this line, so the count
  -- below cannot be invalidated by another transaction before the insert lands.
  -- It serialises the tier count too: a tier belongs to one showing (the
  -- showing_id match below), so every ticket against it takes this same lock.
  SELECT s.total_seats INTO v_total_seats
  FROM public.showings s
  WHERE s.id = NEW.showing_id
  FOR UPDATE;

  -- The tier's own limit. Checked before the showing's, so that when both are
  -- exhausted the buyer is told the more specific thing ("Preferred Seating is
  -- sold out") and can still pick General Admission. A tier of a different
  -- showing matches nothing here; price_ticket_order already refuses one.
  IF NEW.tier_id IS NOT NULL THEN
    SELECT t.tier_name, t.max_tickets INTO v_tier_name, v_tier_max
    FROM public.showing_price_tiers t
    WHERE t.id = NEW.tier_id
      AND t.showing_id = NEW.showing_id;

    IF v_tier_max IS NOT NULL THEN
      SELECT count(*) INTO v_tier_held
      FROM public.tickets t
      WHERE t.showing_id = NEW.showing_id
        AND t.tier_id = NEW.tier_id
        AND t.seat_id IS NULL
        AND (
          t.status = 'confirmed'
          OR (t.status = 'pending'
              AND t.purchased_at > now() - public.ticket_hold_window())
        );

      IF v_tier_held + 1 > v_tier_max THEN
        -- Read out verbatim to the buyer by ticket-checkout and to staff by
        -- the POS, so it is written for them.
        RAISE EXCEPTION
          '% is sold out for this showing.', v_tier_name
          USING ERRCODE = 'PT409',
                HINT = 'Raise this tier''s ticket limit on the showing if more are genuinely available.';
      END IF;
    END IF;
  END IF;

  -- No showing row, or no capacity recorded: not this trigger's business to
  -- adjudicate. enforce_ticket_pricing already raises on an invalid showing_id.
  IF v_total_seats IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count everyone who is coming, assigned seats included: capacity is a fact
  -- about the room, so an assigned sale consumes space just as a GA sale does.
  -- (Enforcement is still GA-only per the guard above; this governs only what a
  -- GA insert is measured against.) purchased_at is NOT NULL DEFAULT now(), so
  -- the comparison is never NULL.
  SELECT count(*) INTO v_held
  FROM public.tickets t
  WHERE t.showing_id = NEW.showing_id
    AND (
      t.status = 'confirmed'
      OR (t.status = 'pending'
          AND t.purchased_at > now() - public.ticket_hold_window())
    );

  -- v_held excludes NEW: this is BEFORE INSERT, so the row is not in the table
  -- yet. In a multi-row INSERT the trigger fires once per row and earlier rows
  -- of the same statement *are* visible, so a 3-ticket order into a house with
  -- 2 seats left is rejected on its third row and the whole statement rolls
  -- back — the correct outcome for an order that cannot be filled. The tier
  -- count above behaves the same way.
  IF v_held + 1 > v_total_seats THEN
    -- PostgREST maps SQLSTATE 'PT<nnn>' to HTTP <nnn>, so the client-side staff
    -- inserts in StaffPOS and HostDashboard surface this as a 409 carrying this
    -- message, with no error-handling code needed on those paths.
    RAISE EXCEPTION
      'Sold out: all % seats for this showing are already sold or on hold.',
      v_total_seats
      USING ERRCODE = 'PT409',
            HINT = 'Increase this showing''s capacity if more seats are genuinely available.';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_showing_capacity() IS
  'Refuses a general-admission ticket that would push its tier past showing_price_tiers.max_tickets, or the showing past showings.total_seats, holding a row lock on the showing so neither count can go stale between check and insert. Raises SQLSTATE PT409, which PostgREST returns as HTTP 409.';

-- The trigger itself (zz_enforce_showing_capacity_on_insert) is unchanged and
-- still points at this function.

-- 3 -------------------------------------------------------------------------
-- A new output column changes the return type, which CREATE OR REPLACE cannot
-- do, so drop and recreate — in this migration's one transaction, so there is
-- no instant at which callers find it missing. The old columns keep their names
-- and order; a client that predates this ignores `tiers`.
DROP FUNCTION IF EXISTS public.showing_availability(uuid);

CREATE FUNCTION public.showing_availability(p_showing_id uuid)
 RETURNS TABLE (
   total_seats             integer,
   requires_seat_selection boolean,
   held                    integer,
   available               integer,
   taken_seat_ids          uuid[],
   tiers                   jsonb
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH held_rows AS (
    SELECT t.seat_id, t.tier_id
    FROM public.tickets t
    WHERE t.showing_id = p_showing_id
      AND (
        t.status = 'confirmed'
        OR (t.status = 'pending'
            AND t.purchased_at > now() - public.ticket_hold_window())
      )
  )
  SELECT
    s.total_seats,
    s.requires_seat_selection,
    (SELECT count(*) FROM held_rows)::integer,
    -- Never negative: an oversold showing (any sale predating the trigger
    -- below) should read as 0 left, not as a negative number the UI would have
    -- to special-case.
    GREATEST(s.total_seats - (SELECT count(*) FROM held_rows), 0)::integer,
    COALESCE(
      (SELECT array_agg(seat_id) FROM held_rows WHERE seat_id IS NOT NULL),
      '{}'::uuid[]
    ),
    -- Every live tier, limited or not, so a caller can treat them uniformly:
    -- available is NULL where there is no limit. held counts GA tickets only,
    -- which is all the limit governs.
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'tier_id',     pt.id,
                'max_tickets', pt.max_tickets,
                'held',        h.n,
                'available',   CASE WHEN pt.max_tickets IS NULL THEN NULL
                                    ELSE GREATEST(pt.max_tickets - h.n, 0) END
              ) ORDER BY pt.display_order, pt.created_at)
         FROM public.showing_price_tiers pt
         CROSS JOIN LATERAL (
           SELECT count(*)::integer AS n FROM held_rows hr
            WHERE hr.tier_id = pt.id AND hr.seat_id IS NULL
         ) h
        WHERE pt.showing_id = p_showing_id AND pt.is_active),
      '[]'::jsonb
    )
  FROM public.showings s
  WHERE s.id = p_showing_id;
$function$;

COMMENT ON FUNCTION public.showing_availability(uuid) IS
  'Seat availability for one showing: capacity, held count, remaining, which seats are occupied, and per live tier its ticket limit and what is left of it. SECURITY DEFINER because RLS on tickets restricts every row to its own buyer, which leaves the customer page unable to compute availability at all. Returns only aggregates and seat ids — no buyer, contact or price data.';

-- As 20260812170000, and as the anon-surface allowlist expects: the patron page
-- calls this as anon.
REVOKE ALL ON FUNCTION public.showing_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.showing_availability(uuid) TO anon, authenticated, service_role;

-- 4 -------------------------------------------------------------------------
-- 20260922174957's function with max_tickets added. p_tiers is now:
--   [{ "tier_name": "Preferred", "price": 40, "max_tickets": 60 }, ...]
-- max_tickets: a whole number >= 0 sets the limit, null clears it, and an
-- absent key keeps whatever the row has (a brand-new tier: no limit).
CREATE OR REPLACE FUNCTION public.set_showing_price_tiers(
  p_showing_id uuid,
  p_tiers jsonb
) RETURNS SETOF public.showing_price_tiers
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  i integer;
  v_name text;
  v_price numeric;
  v_color text;
  v_has_max boolean;
  v_max_json jsonb;
  v_max integer;
  v_id uuid;
  v_keep uuid[] := '{}';
  v_seen text[] := '{}';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_tiers IS NULL OR jsonb_typeof(p_tiers) <> 'array' THEN
    RAISE EXCEPTION 'p_tiers must be a JSON array of tiers' USING ERRCODE = 'PT400';
  END IF;

  -- One save at a time per showing. A second Save landing mid-reconcile would
  -- otherwise see a half-written list.
  PERFORM 1 FROM public.showings WHERE id = p_showing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such showing' USING ERRCODE = 'PT404';
  END IF;

  FOR i IN 0 .. jsonb_array_length(p_tiers) - 1 LOOP
    v_name := btrim(COALESCE(p_tiers -> i ->> 'tier_name', ''));
    IF v_name = '' THEN
      RAISE EXCEPTION 'Every tier needs a name' USING ERRCODE = 'PT400';
    END IF;
    IF lower(v_name) = ANY (v_seen) THEN
      RAISE EXCEPTION 'Two tiers are named "%"', v_name USING ERRCODE = 'PT400';
    END IF;
    v_seen := v_seen || lower(v_name);

    BEGIN
      v_price := (p_tiers -> i ->> 'price')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_price := NULL;
    END;
    IF v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Tier "%" needs a price of 0 or more', v_name USING ERRCODE = 'PT400';
    END IF;
    v_color := NULLIF(btrim(COALESCE(p_tiers -> i ->> 'color', '')), '');

    -- The limit. Strict: a number that is not a whole number >= 0 is refused
    -- rather than rounded or ignored, because a limit that silently did not
    -- save is a tier that silently oversells.
    v_has_max := (p_tiers -> i) ? 'max_tickets';
    v_max := NULL;
    IF v_has_max THEN
      v_max_json := p_tiers -> i -> 'max_tickets';
      IF jsonb_typeof(v_max_json) = 'number' THEN
        IF (v_max_json #>> '{}')::numeric <> trunc((v_max_json #>> '{}')::numeric)
           OR (v_max_json #>> '{}')::numeric < 0
           OR (v_max_json #>> '{}')::numeric > 100000 THEN
          RAISE EXCEPTION 'Tier "%" needs a ticket limit that is a whole number of 0 or more, or no limit', v_name
            USING ERRCODE = 'PT400';
        END IF;
        v_max := (v_max_json #>> '{}')::integer;
      ELSIF jsonb_typeof(v_max_json) <> 'null' THEN
        RAISE EXCEPTION 'Tier "%" needs a ticket limit that is a whole number of 0 or more, or no limit', v_name
          USING ERRCODE = 'PT400';
      END IF;
    END IF;

    -- The live row of that name if there is one, else the oldest retired one
    -- (re-adding "Student" revives the row its old tickets point at).
    SELECT id INTO v_id FROM public.showing_price_tiers
     WHERE showing_id = p_showing_id AND lower(btrim(tier_name)) = lower(v_name)
     ORDER BY is_active DESC, created_at, id
     LIMIT 1;

    IF FOUND THEN
      UPDATE public.showing_price_tiers
         SET tier_name = v_name,
             price = v_price,
             color = COALESCE(v_color, color),
             max_tickets = CASE WHEN v_has_max THEN v_max ELSE max_tickets END,
             display_order = i,
             is_active = true
       WHERE id = v_id;
    ELSE
      INSERT INTO public.showing_price_tiers (showing_id, tier_name, price, color, max_tickets, display_order, is_active)
      VALUES (p_showing_id, v_name, v_price, COALESCE(v_color, '#9C3FA0'), v_max, i, true)
      RETURNING id INTO v_id;
    END IF;
    v_keep := v_keep || v_id;
  END LOOP;

  -- Everything the admin removed. Gone outright when nothing points at it;
  -- retired when a ticket does, because that ticket's tier_id has to keep
  -- resolving on the receipt, the door scanner and the box-office report.
  DELETE FROM public.showing_price_tiers t
   WHERE t.showing_id = p_showing_id
     AND NOT (t.id = ANY (v_keep))
     AND NOT EXISTS (SELECT 1 FROM public.tickets k WHERE k.tier_id = t.id);

  UPDATE public.showing_price_tiers t
     SET is_active = false
   WHERE t.showing_id = p_showing_id
     AND NOT (t.id = ANY (v_keep))
     AND t.is_active;

  RETURN QUERY
    SELECT * FROM public.showing_price_tiers
     WHERE showing_id = p_showing_id AND is_active
     ORDER BY display_order, created_at;
END;
$function$;

COMMENT ON FUNCTION public.set_showing_price_tiers(uuid, jsonb) IS
  'The only writer of showing_price_tiers. Reconciles the showing''s tiers to p_tiers by name: updates in place, inserts new names, deletes removed tiers nothing references and deactivates removed tiers a ticket references. max_tickets: a number sets the tier''s limit, null clears it, an absent key keeps it. Returns the live tiers. Admin only.';

REVOKE ALL ON FUNCTION public.set_showing_price_tiers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_showing_price_tiers(uuid, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
