-- Sold-out handling: make availability both knowable and enforceable.
--
-- Two separate defects, one migration, because the fix for each is the same
-- observation: availability is a fact about the whole showing, and nothing that
-- can only see its own rows is able to compute it.
--
-- ---------------------------------------------------------------------------
-- Defect 1: the client cannot see availability at all.
-- ---------------------------------------------------------------------------
-- Showing.tsx computes `gaAvailable = total_seats - ticketsSold` from
--     select id from tickets where showing_id = ? and status = 'confirmed'
-- and builds `takenSeatIds` the same way. But tickets has RLS enabled with a
-- single SELECT policy:
--     USING (user_id = auth.uid() OR public.is_admin())
-- For an anonymous visitor auth.uid() is NULL, so `user_id = NULL` is NULL,
-- never true, and is_admin() is false. The query returns zero rows — always.
--
-- Verified against both projects as the anon role before writing this:
--     GET /rest/v1/tickets?select=id   -> content-range: */0
--     GET /rest/v1/showings?select=id  -> content-range: 0-0/34
-- So the empty result is RLS, not an empty table.
--
-- The consequences are not cosmetic:
--   * ticketsSold is always 0, so gaAvailable always equals total_seats and the
--     "+" ceiling never engages for the visitors it was written for.
--   * takenSeatIds is always empty, so the seat map offers seats that are
--     already sold; the buyer picks one and checkout rejects it.
-- A "Sold Out" badge driven off that data would have been decoration.
--
-- Fix: showing_availability() below — a SECURITY DEFINER function that returns
-- counts and seat occupancy and nothing else. Occupancy is already public by
-- design (the seat map draws it); buyer identity, contact details and prices
-- stay unreadable. This is deliberately not a new RLS policy on tickets: the
-- client needs two aggregates, not read access to ticket rows.
--
-- ---------------------------------------------------------------------------
-- Defect 2: capacity is checked, but not atomically.
-- ---------------------------------------------------------------------------
-- ticket-checkout already refuses an order exceeding showings.total_seats, as a
-- SELECT count(*) followed by an INSERT. That is correct only if nobody inserts
-- in between. Two buyers taking the last two seats of a 200-seat house both
-- read 199, both pass, both insert: 201 tickets for a 200-seat room. No
-- application-level care closes that window — the count and the write have to
-- happen under one lock.
--
-- Three further paths insert tickets with no capacity check whatsoever:
--     StaffPOS.tsx       box office sales, client-side insert
--     HostDashboard.tsx  host/promoter comps, client-side insert
--     film pass redemption through ticket-checkout
-- A BEFORE INSERT trigger closes the race and covers all four paths at once,
-- including any added later. The application checks stay where they are — they
-- produce good errors before a card is charged. The trigger is what makes them
-- true.

-- ---------------------------------------------------------------------------
-- The hold window, defined once
-- ---------------------------------------------------------------------------
-- Checkout writes ticket rows as 'pending' before charging the card, so a
-- pending row is a live hold while checkout might still confirm it, and
-- abandoned garbage afterwards. Both the trigger and the availability function
-- need that cutoff, and they must not be able to drift apart: if the guard and
-- the display disagree, the UI offers seats the database will refuse.
--
-- ticket-checkout/index.ts holds the same 15 minutes as PENDING_HOLD_MS. It is
-- a different language and cannot read this; that one copy is documented on
-- both sides. Everything inside the database reads this function.

CREATE OR REPLACE FUNCTION public.ticket_hold_window()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 PARALLEL SAFE
AS $function$ SELECT interval '15 minutes' $function$;

COMMENT ON FUNCTION public.ticket_hold_window() IS
  'How long a pending (unpaid) ticket row still holds its seat. Single source of truth for enforce_showing_capacity() and showing_availability(); mirrored by PENDING_HOLD_MS in supabase/functions/ticket-checkout/index.ts.';

-- ---------------------------------------------------------------------------
-- Supporting index
-- ---------------------------------------------------------------------------
-- The trigger counts held tickets for one showing on every GA insert while
-- holding a row lock on that showing. Without this index that count is a heap
-- scan of the whole tickets table inside the critical section.

CREATE INDEX IF NOT EXISTS tickets_showing_id_status_idx
  ON public.tickets (showing_id, status);

-- ---------------------------------------------------------------------------
-- Availability, readable without reading tickets
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.showing_availability(p_showing_id uuid)
 RETURNS TABLE (
   total_seats             integer,
   requires_seat_selection boolean,
   held                    integer,
   available               integer,
   taken_seat_ids          uuid[]
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH held_rows AS (
    SELECT t.seat_id
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
    )
  FROM public.showings s
  WHERE s.id = p_showing_id;
$function$;

COMMENT ON FUNCTION public.showing_availability(uuid) IS
  'Seat availability for one showing: capacity, held count, remaining, and which seats are occupied. SECURITY DEFINER because RLS on tickets restricts every row to its own buyer, which leaves the customer page unable to compute availability at all. Returns only aggregates and seat ids — no buyer, contact or price data.';

-- Explicit and narrow: EXECUTE to the roles that render a seat picker, and to
-- the service role. Revoked from PUBLIC first so the default grant on a new
-- function is not what is relied upon.
REVOKE ALL ON FUNCTION public.showing_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.showing_availability(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The capacity guard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_showing_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_seats integer;
  v_held integer;
BEGIN
  -- Assigned seating is already bounded, twice over: a seat map has a finite
  -- number of seats, and UNIQUE(showing_id, seat_id) makes selling one of them
  -- twice impossible. Counting assigned sales against total_seats here would
  -- actively break those showings — showings.total_seats defaults to 200 while
  -- the Main Theater has 265 seats, so seats 201-265 would become unsellable on
  -- any showing whose capacity was never edited. GA is the case with no
  -- structural ceiling, and so the only case needing one imposed.
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
  SELECT s.total_seats INTO v_total_seats
  FROM public.showings s
  WHERE s.id = NEW.showing_id
  FOR UPDATE;

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
  -- back — the correct outcome for an order that cannot be filled.
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
  'Refuses a general-admission ticket that would push a showing past showings.total_seats, holding a row lock on the showing so the count cannot go stale between check and insert. Raises SQLSTATE PT409, which PostgREST returns as HTTP 409.';

-- Triggers fire in alphabetical order, and this one reads NEW.status, which
-- enforce_ticket_pricing_on_insert is what finally sets (it forces 'confirmed'
-- unless the caller explicitly asked for 'pending'). The zz_ prefix is the
-- mechanism guaranteeing this runs second; it is not a naming preference.
DROP TRIGGER IF EXISTS zz_enforce_showing_capacity_on_insert ON public.tickets;
CREATE TRIGGER zz_enforce_showing_capacity_on_insert
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_showing_capacity();
