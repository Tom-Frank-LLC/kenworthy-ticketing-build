-- The door admits a ticket for any screening, and burns it doing so.
--
-- `check_in_ticket` takes a QR code and nothing else. It confirms the ticket is
-- `confirmed` and unscanned, stamps scanned_at, and answers 'valid'. Which
-- screening the ticket is *for* never enters into it. The scanner renders that
-- as "Ticket validated — enjoy the show!" (TicketScanner.tsx), and while it does
-- display the production title and showtime on the verdict card, nothing
-- compares them to the night in progress and nothing asks the operator to.
--
-- Two things follow, and the second is worse than the first:
--
--   1. Admission control is bypassable for the price of the cheapest seat on
--      the calendar. Buy a $5 matinee ticket for any date, present it at a
--      sold-out $25 event, and the scanner goes green.
--
--   2. A patron who arrives on the wrong night — or hands over the wrong ticket
--      from a wallet holding several — has that ticket *consumed*. It is now
--      `scanned_at`-stamped, so when they come back on the right night it reads
--      as 'already_scanned' and they are turned away from a show they paid for,
--      with the audit trail agreeing that they already came in.
--
-- The second is the reason this is fixed at the door rather than in the UI. A
-- client-side comparison would stop the operator being misled, but the row is
-- written by the time the client sees the answer. The check has to happen
-- before the claim, which means it happens here.
--
-- Verified live on staging, 2026-08-19: the deployed function accepts exactly
-- one parameter, `p_qr_code`, so no showing-scoping existed to be misread.
--
-- ---------------------------------------------------------------------------
-- The shape of the fix
-- ---------------------------------------------------------------------------
--
-- `p_showing_id` is added, and defaults to NULL. NULL means "don't scope",
-- which is precisely the behaviour that exists today — so a caller that has not
-- been updated, or an operator with no screening selected, is not broken by
-- this migration. The scanner passes the screening it is already tracking (it
-- has one: the selector that governs film-pass admissions), and gains the
-- check.
--
-- The new verdict is `wrong_showing`, and it is deliberately *not* a refusal to
-- act — it is a refusal to *consume*. The ticket is left untouched, so the
-- three ways this fires all end well:
--
--   the patron is here on the wrong night   -> told which night, ticket intact
--   they handed over the wrong ticket       -> hand over the other one, rescan
--   the operator has the wrong screening    -> fix the selector, rescan
--
-- None of those should cost anybody a ticket, and now none of them do.
--
-- The verdict carries the ticket's own title and start_time, which is what lets
-- the scanner say "this is for Thursday's Casablanca" instead of "no". That
-- discloses nothing new: the same fields already ride on every other verdict,
-- and the caller has already passed the staff/host authorisation below.
--
-- ---------------------------------------------------------------------------
-- Why DROP and not CREATE OR REPLACE
-- ---------------------------------------------------------------------------
--
-- Adding a defaulted parameter does not replace `check_in_ticket(text)`; it
-- creates a second function alongside it, and then every existing one-argument
-- call is ambiguous and errors. The old signature has to go. Dropping a
-- function also drops its grants, so they are restated at the bottom — omitting
-- them would leave a function nobody can execute, which is the quiet kind of
-- broken this codebase has been bitten by before.

DROP FUNCTION IF EXISTS public.check_in_ticket(text);

CREATE FUNCTION public.check_in_ticket(
  p_qr_code    text,
  p_showing_id uuid DEFAULT NULL
)
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

  -- The wrong night, checked before the claim so the ticket survives it.
  --
  -- Ordered ahead of the status test on purpose: a patron presenting next
  -- week's ticket should be told it is for next week, not that it is
  -- "not confirmed". Ordered after authorisation, so this cannot be used to
  -- probe which showing a code belongs to.
  IF p_showing_id IS NOT NULL AND v_showing_id IS DISTINCT FROM p_showing_id THEN
    RETURN jsonb_build_object(
      'verdict', 'wrong_showing',
      'ticket', jsonb_build_object(
        'id',               v_id,
        'production_title', v_title,
        'start_time',       v_start,
        'seat_row',         v_row,
        'seat_number',      v_num,
        'scanned_at',       v_scanned,
        'status',           v_status
      )
    );
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

COMMENT ON FUNCTION public.check_in_ticket(text, uuid) IS
  'Validates a ticket QR and atomically claims its check-in, returning a verdict of valid | wrong_showing | already_scanned | not_confirmed | not_found | forbidden. Pass p_showing_id to scope the scan to one screening: a ticket for a different showing returns wrong_showing and is left unclaimed, so presenting the wrong ticket never costs the holder the right one. NULL (the default) keeps the unscoped behaviour. SECURITY DEFINER so a staff-only account can check in without being granted blanket UPDATE on tickets, which RLS cannot restrict to the scanned_at column. Authorises (staff, or host of the showing) before revealing whether the code exists.';

-- Restated because DROP took the old grants with it. Only signed-in staff and
-- hosts; never anon — this endpoint consumes tickets.
REVOKE ALL ON FUNCTION public.check_in_ticket(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in_ticket(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in_ticket(text, uuid) TO authenticated, service_role;
