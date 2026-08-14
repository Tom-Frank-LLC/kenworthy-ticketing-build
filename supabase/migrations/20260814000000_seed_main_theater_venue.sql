-- The Main Theater venue row, and the 265 seats that have been waiting for it.
--
-- ---------------------------------------------------------------------------
-- What was actually broken
-- ---------------------------------------------------------------------------
-- Migration 20260609161049 seeds the real Kenworthy auditorium — 265 seats with
-- their true gaps and three banks — into public.seats, and then attaches them to
-- a venue:
--
--     INSERT INTO public.venue_seats (venue_id, seat_row, seat_number, ...)
--     SELECT v.id, s.seat_row, ... FROM public.seats s, public.venues v
--     WHERE v.name = 'Main Theater';
--
-- No migration ever creates that venue. The cross join matched nothing, inserted
-- zero rows, and the following UPDATE ... WHERE name = 'Main Theater' updated
-- nothing. Verified against both projects as the anon role before writing this
-- (venues is world-readable, so this is the honest count and not an RLS shadow):
--
--     GET /rest/v1/venues?select=id,name      -> []
--     GET /rest/v1/venue_seats?select=id      -> content-range: */0
--     GET /rest/v1/seats?select=id            -> content-range: 0-264/265
--
-- So the seat chart is not lost and does not need re-entering. It is sitting in
-- public.seats, orphaned for want of a venue row. This migration creates the row
-- and re-runs the attach, idempotently.
--
-- ---------------------------------------------------------------------------
-- Why the seat chart lives in two tables
-- ---------------------------------------------------------------------------
-- public.seats is the physical chart the customer picker renders and the one
-- tickets.seat_id points at (Showing.tsx selects from `seats`, not venue_seats).
-- public.venue_seats is the per-venue copy that seat *pricing* hangs off:
-- showing_seat_tiers.venue_seat_id -> venue_seats. The two are rejoined by
-- (seat_row, section, seat_number) — see pricing.ts and Showing.tsx.
--
-- That join is the reason this migration copies seats verbatim rather than
-- generating a layout. Row A skips no seats but row K skips 3, 11, 16 and 24;
-- section decides which bank a seat number belongs to. A regenerated
-- "rows of N" layout would produce venue_seats that no longer match any seat,
-- and every tier assignment would silently resolve to nothing.
--
-- venue_seats is UNIQUE (venue_id, seat_row, seat_number) — note: no section.
-- That holds for this chart: the three banks use disjoint number ranges
-- (left 1-7, center 8-19, right 20-26), so all 265 (row, number) pairs are
-- distinct. Confirmed before relying on it.

-- ---------------------------------------------------------------------------
-- The venue row
-- ---------------------------------------------------------------------------
-- The name has to be exactly 'Main Theater': that string is the join key
-- 20260609161049 was written against, and it is what makes this migration and
-- that one agree about which venue they mean.

INSERT INTO public.venues (name, description, total_seats, has_assigned_seating, is_active)
SELECT
  'Main Theater',
  'The Kenworthy auditorium — 265 seats in three banks.',
  265,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.venues WHERE name = 'Main Theater'
);

-- ---------------------------------------------------------------------------
-- The attach, redone properly
-- ---------------------------------------------------------------------------
-- Scoped to one venue id rather than repeating the `FROM seats, venues` cross
-- join: if a second venue named 'Main Theater' were ever created by hand, that
-- join would insert 265 rows per match and the ON CONFLICT below would not
-- catch it (different venue_id, so no conflict). Picking the oldest row makes
-- the target unambiguous.
--
-- ON CONFLICT DO NOTHING, not DELETE-then-INSERT: if seat tiers have already
-- been painted against these venue_seats, deleting the rows would cascade the
-- assignments away. Re-running this migration adds what is missing and touches
-- nothing else.

WITH target AS (
  SELECT id FROM public.venues
  WHERE name = 'Main Theater'
  ORDER BY created_at
  LIMIT 1
)
INSERT INTO public.venue_seats (venue_id, seat_row, seat_number, seat_type, section)
SELECT t.id, s.seat_row, s.seat_number, s.seat_type, s.section
FROM public.seats s, target t
ON CONFLICT (venue_id, seat_row, seat_number) DO NOTHING;

-- Capacity and the has-a-seat-map flag, set from what actually attached rather
-- than from the literal 265 — so if this ever runs against a project whose
-- seats table differs, the venue does not advertise a capacity it lacks.

UPDATE public.venues v
SET
  total_seats = GREATEST(sub.seat_count, 1),
  has_assigned_seating = sub.seat_count > 0
FROM (
  SELECT vs.venue_id, count(*)::integer AS seat_count
  FROM public.venue_seats vs
  GROUP BY vs.venue_id
) sub
WHERE v.id = sub.venue_id
  AND v.name = 'Main Theater';

-- ---------------------------------------------------------------------------
-- What has_assigned_seating means from here on
-- ---------------------------------------------------------------------------
-- It used to be read as "every showing in this room is reserved seating", which
-- put the decision on the wrong object: the same auditorium hosts a general
-- admission movie on Friday and a reserved-seat performance on Saturday.
-- Whether a given showing sells reserved seats is showings.requires_seat_selection
-- — which is already the column the customer page, the capacity trigger and
-- ticket-checkout read. This flag now means only "this venue has a seat map to
-- draw from", i.e. whether the per-showing toggle is even offered.

COMMENT ON COLUMN public.venues.has_assigned_seating IS
  'Capability, not policy: this venue has a seat map in venue_seats, so a showing here may be sold as reserved seating. Whether it actually is, is showings.requires_seat_selection — set per showing, because one room hosts both GA and reserved events.';

COMMENT ON COLUMN public.showings.requires_seat_selection IS
  'Single source of truth for GA vs reserved seating on this showing. Read by the customer seat picker (Showing.tsx), the box office (StaffPOS.tsx), pricing (functions/_shared/pricing.ts) and enforce_showing_capacity(), which skips the GA capacity ceiling when a seat is named.';
