-- Rentals that run longer than a day.
--
-- The request form, the admin card, and the contract were all built around a
-- single `proposed_date`. Multi-day bookings are ordinary here — a weekend
-- festival, a three-night theatre run — and staff have been recording the
-- extra days in the notes field, where nothing renders them on the contract
-- the renter signs.
--
-- The booking is modelled as a contiguous range: `proposed_date` is the first
-- day, `end_date` the last. A single-day rental leaves `end_date` NULL rather
-- than repeating the start, so every existing row is already correct and there
-- is nothing to backfill, and "has an end date" reads the same as "spans more
-- than one day".
--
-- Times (arrival / start / end / departure) stay one set for the whole
-- booking, exactly as the paper information sheet works. Per-day times would
-- be a different shape of table, and nobody has asked for one.

ALTER TABLE public.rental_requests
  ADD COLUMN IF NOT EXISTS end_date date;

-- A backwards range is a data-entry slip that would otherwise reach the
-- contract as "August 16 through August 14". The form validates it too; this
-- is the copy that also covers the admin editing a row directly.
ALTER TABLE public.rental_requests
  DROP CONSTRAINT IF EXISTS rental_requests_end_date_after_start;

ALTER TABLE public.rental_requests
  ADD CONSTRAINT rental_requests_end_date_after_start
  CHECK (end_date IS NULL OR proposed_date IS NULL OR end_date >= proposed_date);

COMMENT ON COLUMN public.rental_requests.end_date IS
  'Last day of a multi-day booking. NULL for a single-day rental; never equal-and-redundant with proposed_date by convention.';
