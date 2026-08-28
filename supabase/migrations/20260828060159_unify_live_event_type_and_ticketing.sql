-- One "live event" shape across both tables.
--
-- Admin had two create paths — Add Event (events) and Add Performance
-- (live_performances) — that shared ~80% of their fields and differed only in
-- which of two columns they carried. Nothing on the public site distinguished
-- them beyond ticketing behaviour, so the split was heavier than the site
-- needed and admins had to guess which button to press.
--
-- The tables stay. What changes is that each can now express the whole shape:
-- what the thing IS (subcategory) and how people GET IN (ticket_type), which
-- are independent — an RSVP concert is a real thing and had nowhere to live.
--
-- Additive only. No rows are moved, no table is dropped, and every existing
-- row keeps the value it already had.

-- The unified type. Supersets live_performance_subcategory rather than
-- extending it: ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction that writes the new value, and a fresh type sidesteps that
-- entirely. The old enum stays where it is, still describing its own column.
CREATE TYPE public.live_event_type AS ENUM (
  'concert',
  'stand_up_comedy',
  'theatre',
  'dance',
  'film_screening',
  'community_event'
);

-- Deliberately NULL for the 199 existing events rather than defaulted.
-- Those rows are a real mix — a ballet, a stand-up tour, community nights —
-- so stamping them all 'community_event' would invent data that reads as
-- deliberate. NULL means "nobody has said yet", which is the truth.
ALTER TABLE public.events
  ADD COLUMN subcategory public.live_event_type;

COMMENT ON COLUMN public.events.subcategory IS
  'What the event is (concert, theatre, screening…). NULL means unset — no one has categorised this row yet.';

-- The other half of the shape, for the table that lacked it. Defaulted to
-- ticketed because that is what every live_performance has always been: the
-- table had no way to say otherwise, so no existing row can be anything else.
ALTER TABLE public.live_performances
  ADD COLUMN ticket_type public.event_ticket_type NOT NULL DEFAULT 'ticketed',
  ADD COLUMN rsvp_url text;

COMMENT ON COLUMN public.live_performances.ticket_type IS
  'How people get in. Matches events.ticket_type so one admin form serves both tables.';
