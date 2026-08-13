-- Staff could not read a single ticket, and could not check one in.
--
-- The live SELECT policies on tickets are exactly two:
--
--   "Users can view own tickets"                user_id = auth.uid()
--                                                 OR has_role(auth.uid(), 'admin')
--   "Hosts can view tickets for assigned events" (host assignment EXISTS ...)
--
-- There is no staff policy. has_role honours a hierarchy in which admin and
-- superadmin satisfy 'staff', but not the reverse, so an account holding only
-- `staff` matches neither policy and sees zero ticket rows. Meanwhile staff can
-- already *sell* tickets ("Staff can sell tickets", INSERT) — they could write
-- rows they were then unable to read back.
--
-- Every staff-operated surface is affected, and each fails quietly rather than
-- erroring:
--
--   TicketScanner       the ticket lookup returns no row, so every valid QR
--                       reports "Ticket not found — invalid QR code"
--   StaffPOS            loadDailyStats reads tickets; revenue and counts sit at 0
--   AdminDashboard      sold and checked-in counts render as 0 / capacity
--   AttendeeSheet       attendee lists come back empty
--   BoxOfficeReceipts,  same
--   Analytics, exportContacts
--
-- Nobody noticed because the accounts in use also hold `admin`, which satisfies
-- the existing policy. The moment a genuine staff-only login is used — which is
-- the whole point of having the role — the box office goes blind.
--
-- ---------------------------------------------------------------------------
-- 1. Staff can read tickets
-- ---------------------------------------------------------------------------
-- Additive: RLS policies are OR'd, so this only widens SELECT, and only to
-- accounts holding staff/admin/superadmin. Regular users are unaffected and
-- still see nothing but their own rows.
--
-- Whole rows, deliberately. The surfaces above need showing_id, seat_id,
-- status, scanned_at, purchased_at, total_price, and user_id (to name the
-- attendee). That inevitably includes qr_code and order_token, which are bearer
-- credentials for a ticket — but staff already scan those codes and re-send
-- tickets from the box office, so this grants no capability the role does not
-- already exercise in the room.

DROP POLICY IF EXISTS "Staff can view tickets" ON public.tickets;
CREATE POLICY "Staff can view tickets"
  ON public.tickets FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'::app_role));

-- ---------------------------------------------------------------------------
-- 2. Check-in as an operation, not a table write
-- ---------------------------------------------------------------------------
-- The scanner also has to *write* scanned_at, and the only UPDATE policies are
-- "Admins can update tickets" and "Hosts can update tickets for assigned
-- showings". A staff-only account is blocked there too — and an UPDATE that RLS
-- filters out is not an error: PostgREST answers 204 and supabase-js reports
-- success. Check-in would appear to work and record nothing.
--
-- The obvious patch is a staff UPDATE policy, and it is the wrong one. RLS
-- cannot restrict *columns*, and Supabase gives every logged-in user the same
-- `authenticated` database role, so column privileges cannot separate staff
-- from admin either. A blanket staff UPDATE on tickets would hand the box
-- office the ability to rewrite price, total_price, status and payment ids on a
-- money table, when all it needs is to stamp one timestamp.
--
-- So check-in becomes a function that does exactly that one thing, and
-- authorises itself. Two further things fall out of moving it here:
--
--   * The double-admission race closes. The scanner read scanned_at, decided
--     the ticket was unused, then wrote — so two devices scanning the same QR
--     at once could both see NULL and both admit the holder. The conditional
--     UPDATE below makes claiming the check-in a single atomic step: exactly
--     one caller can move scanned_at off NULL, and the loser is told the
--     ticket is already scanned.
--   * Refusal no longer leaks. Authorisation is decided before existence is
--     revealed, so an unauthorised caller gets 'forbidden' whether or not the
--     QR is real, and cannot use the endpoint to probe for valid codes.
--
-- The audit trigger keeps working unchanged: it fires on the NULL -> set
-- transition to log 'tickets.scan', and its actor comes from auth.uid(), which
-- reads the request's JWT claim and is unaffected by SECURITY DEFINER. The scan
-- is still attributed to the staff member who performed it.

CREATE OR REPLACE FUNCTION public.check_in_ticket(p_qr_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id         uuid;
  v_status     text;
  v_scanned    timestamptz;
  v_showing_id uuid;
  v_seat_id    uuid;
  v_title      text;
  v_start      timestamptz;
  v_row        text;
  v_num        integer;
  v_claimed    timestamptz;
  v_verdict    text;
BEGIN
  IF p_qr_code IS NULL OR length(btrim(p_qr_code)) = 0 THEN
    RETURN jsonb_build_object('verdict', 'not_found', 'ticket', NULL);
  END IF;

  SELECT t.id, t.status, t.scanned_at, t.showing_id, t.seat_id
    INTO v_id, v_status, v_scanned, v_showing_id, v_seat_id
    FROM public.tickets t
   WHERE t.qr_code = btrim(p_qr_code);

  -- Authorise before revealing anything, including whether the code exists.
  IF NOT (
       public.has_role(auth.uid(), 'staff'::app_role)
    OR (v_showing_id IS NOT NULL AND public.is_host_of_showing(auth.uid(), v_showing_id))
  ) THEN
    RETURN jsonb_build_object('verdict', 'forbidden', 'ticket', NULL);
  END IF;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('verdict', 'not_found', 'ticket', NULL);
  END IF;

  -- Production title and showtime for the scanner's verdict card.
  SELECT s.start_time,
         COALESCE(m.title, e.title, lp.title, 'Unknown')
    INTO v_start, v_title
    FROM public.showings s
    LEFT JOIN public.movies            m  ON m.id  = s.movie_id
    LEFT JOIN public.events            e  ON e.id  = s.event_id
    LEFT JOIN public.live_performances lp ON lp.id = s.live_performance_id
   WHERE s.id = v_showing_id;

  IF v_seat_id IS NOT NULL THEN
    SELECT st.seat_row, st.seat_number
      INTO v_row, v_num
      FROM public.seats st
     WHERE st.id = v_seat_id;
  END IF;

  IF v_status <> 'confirmed' THEN
    -- A refunded, pending or failed ticket admits nobody, and must not be
    -- stamped as though it had been used.
    v_verdict := 'not_confirmed';
    v_claimed := v_scanned;
  ELSE
    -- Claim it. `scanned_at IS NULL` in the WHERE clause is what makes this
    -- safe under concurrency: the second scanner updates no rows.
    UPDATE public.tickets
       SET scanned_at = now()
     WHERE id = v_id
       AND scanned_at IS NULL
   RETURNING scanned_at INTO v_claimed;

    IF v_claimed IS NULL THEN
      -- Lost the claim, or it was already used before this call.
      SELECT t.scanned_at INTO v_claimed FROM public.tickets t WHERE t.id = v_id;
      v_verdict := 'already_scanned';
    ELSE
      v_verdict := 'valid';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'verdict', v_verdict,
    'ticket', jsonb_build_object(
      'id',               v_id,
      'production_title', v_title,
      'start_time',       v_start,
      'seat_row',         v_row,
      'seat_number',      v_num,
      'scanned_at',       v_claimed,
      'status',           v_status
    )
  );
END;
$function$;

COMMENT ON FUNCTION public.check_in_ticket(text) IS
  'Validates a ticket QR and atomically claims its check-in, returning a verdict of valid | already_scanned | not_confirmed | not_found | forbidden. SECURITY DEFINER so a staff-only account can check in without being granted blanket UPDATE on tickets, which RLS cannot restrict to the scanned_at column. Authorises (staff, or host of the showing) before revealing whether the code exists.';

-- Only signed-in staff and hosts. Never anon: this endpoint consumes tickets.
REVOKE ALL ON FUNCTION public.check_in_ticket(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in_ticket(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in_ticket(text) TO authenticated, service_role;
