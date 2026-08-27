-- What an anonymous visitor may learn about an approved rental.
--
-- /rentals wants to answer "is the theatre free that afternoon?", and until now
-- it could not. The page queried `rental_requests` directly, which reads as if
-- it works and returns nothing: `anon` holds no SELECT grant on that table
-- (20260814214233 revoked it) and no policy would match anyway. So the calendar
-- has only ever reflected programmed showings, and every confirmed private
-- booking has been invisible on it. The magenta "booked" days were showings.
--
-- Restoring the grant is not the fix. That table is one of the most sensitive
-- in the schema — applicant names, email addresses, phone numbers, contract and
-- signature state, Square invoice ids — and the page needs exactly one fact out
-- of it: this day has something on it, roughly between these hours.
--
-- Hence a SECURITY DEFINER function that returns that fact and nothing else.
-- The redaction happens here rather than in the page, so a `select('*')`
-- written on /rentals two years from now cannot widen it. What leaves this
-- function is a date, two clock times, and — only when the renter themselves
-- ticked `is_public` on their submission — the event title they chose to
-- publish. A private booking's title never crosses the boundary at all: it is
-- replaced with NULL in the projection, not merely left unselected.
--
-- ---------------------------------------------------------------------------
-- Times come back as text, on purpose
-- ---------------------------------------------------------------------------
--
-- `arrival_time`, `departure_time`, `event_start_time` and `event_end_time` are
-- `text` columns. Every value the app has ever written to them comes from an
-- `<input type="time">`, so in practice they are `HH:MM` — but nothing in the
-- database enforces that, and a value that does not parse must be survivable.
--
-- Parsing therefore happens once, in TypeScript (`src/lib/rentalAvailability.ts`),
-- where it is unit-tested without a database. Doing it in SQL as well would put
-- two parsers with two notions of a valid time on either side of one wire, and
-- they would drift. This function's job is redaction — the part that has to be
-- in the database because it is a security boundary. Reading a clock is not.
--
-- A time that will not parse becomes an untimed block on the page: the day
-- still reads "Limited availability", and its hours read "Check with us"
-- rather than being painted free or booked on a guess.
--
-- ---------------------------------------------------------------------------
-- Multi-day bookings publish no hours
-- ---------------------------------------------------------------------------
--
-- `arrival_time` and `departure_time` describe the booking, not each day of it.
-- On a three-day rental, "arrives 09:00, departs 22:00" says nothing about
-- whether day two starts at nine. Applying them to every day would invent
-- precision, so a booking that spans days emits NULL times for all of them and
-- lands as an untimed hold. Single-day bookings — nearly all of them — keep
-- their hours.

CREATE OR REPLACE FUNCTION public.get_public_availability(p_from date, p_to date)
RETURNS TABLE (
  day        date,
  start_time text,
  end_time   text,
  is_public  boolean,
  title      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- An empty search_path but for the schemas named: a SECURITY DEFINER function
-- that resolves unqualified names through the caller's search_path is the
-- classic privilege-escalation shape, and Supabase's own linter flags it.
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN;
  END IF;

  -- The calendar asks for a year at a time. A caller asking for a century
  -- would have this expand one row per day per booking for no one's benefit,
  -- so the window is capped rather than trusted.
  IF p_to - p_from > 400 THEN
    RAISE EXCEPTION 'Availability window is limited to 400 days';
  END IF;

  RETURN QUERY
  SELECT
    d::date AS day,
    -- Hours only for a booking that occupies a single day; see the header.
    CASE WHEN r.end_date IS NULL OR r.end_date = r.proposed_date
         THEN COALESCE(r.arrival_time, r.event_start_time)
    END AS start_time,
    CASE WHEN r.end_date IS NULL OR r.end_date = r.proposed_date
         THEN COALESCE(r.departure_time, r.event_end_time)
    END AS end_time,
    COALESCE(r.is_public, false) AS is_public,
    -- The one field whose exposure the renter chose. Anything else about them
    -- — name, email, phone, notes — is not selected and cannot be.
    CASE WHEN COALESCE(r.is_public, false) THEN r.event_title END AS title
  FROM public.rental_requests r
  CROSS JOIN LATERAL generate_series(
    r.proposed_date::timestamp,
    COALESCE(r.end_date, r.proposed_date)::timestamp,
    interval '1 day'
  ) AS d
  WHERE r.status = 'approved'
    AND r.proposed_date IS NOT NULL
    AND d::date BETWEEN p_from AND p_to;
END;
$$;

COMMENT ON FUNCTION public.get_public_availability(date, date) IS
  'Occupied-day rows for the public /rentals calendar, from approved rental_requests only. Returns the day, the booking''s clock times as stored text (single-day bookings only), and the event title ONLY when the renter set is_public. Names, contact details, notes, contract and invoice state are never projected. SECURITY DEFINER because anon holds no SELECT on rental_requests and must not be given one.';

-- The function is the grant. `anon` still cannot read the table it reads.
REVOKE ALL ON FUNCTION public.get_public_availability(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_availability(date, date) TO anon, authenticated;
