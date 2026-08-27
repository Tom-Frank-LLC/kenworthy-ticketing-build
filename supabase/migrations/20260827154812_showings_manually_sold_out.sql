-- A showing an admin has closed to online sales by hand.
--
-- The gap this closes
-- -------------------
-- "Sold out" already existed, but only as arithmetic. The showing page
-- compares tickets sold against total_seats (general admission) or counts
-- unclaimed seats (assigned) and renders a notice when nothing is left. That
-- is the right answer when the house filled through this system.
--
-- It has no answer at all for the house that filled somewhere else: a school
-- block booking taken over the phone, a private buyout, a rental that took the
-- room, a night the fire marshal capped lower than the seat map says. In every
-- one of those the seats are gone and the row still reads 0 / 200, so the page
-- keeps selling tickets to a room that has none.
--
-- The existing lever is is_active = false, and it is the wrong one: it hides
-- the showing outright. A sold-out night is still a night the public should be
-- able to see, read the time of, and be told plainly is full.
--
-- Not inferable from any column we have, which is why this is a flag.
--
-- What it deliberately does NOT do (Tom, 2026-08-25)
-- --------------------------------------------------
-- It closes the *online* sale and nothing else. The box office may still need
-- to comp a seat, honour a holdback, or sell the one return that came back,
-- on a night the public line correctly reads "sold out". Those paths —
-- StaffPOS.tsx and HostDashboard.tsx — insert tickets straight through
-- PostgREST, so a BEFORE INSERT trigger on `tickets` would take them down with
-- the website.
--
-- So, unlike the walk-in rule in 20260827113402 (which IS such a trigger,
-- because a showing that issues no tickets issues none to anybody), this flag
-- is enforced one layer up:
--
--   1. supabase/functions/_shared/pricing.ts, via isManuallySoldOut() in
--      _shared/purchasable.ts — the single gate every online ticket sale
--      passes through, and the layer that turns a stale tab into a sentence.
--   2. src/lib/purchasable.ts — the browser's copy. Advisory. It decides what
--      renders: a Sold Out notice instead of a purchase panel, and a Sold Out
--      label instead of "Get Tickets" in the listings.
--
-- There is deliberately no third, database-level layer. That asymmetry is the
-- feature: the counter stays open while the website is closed.

-- ---------------------------------------------------------------------------
-- The flag
-- ---------------------------------------------------------------------------
--
-- A boolean rather than a sales_status enum (open/sold_out/closed), matching
-- the flags already on this table — is_active, is_featured,
-- requires_seat_selection, no_ticket_required. "Closed" as an enum value would
-- duplicate is_active, and the two would be free to disagree about a showing
-- that is both. A separate boolean cannot express that contradiction.
--
-- Named `manually_` on purpose. It is not "is this showing sold out" — the
-- honest answer to that also involves capacity, and lives in the page and in
-- showing_availability(). This column records only that a person said so.
--
-- NOT NULL DEFAULT false, so every existing showing keeps today's behaviour
-- and no backfill is needed.

ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS manually_sold_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.showings.manually_sold_out IS
  'True when an admin has closed this showing to online ticket sales by hand, regardless of how many seats remain — the house filled through another channel. Closes the website only: StaffPOS and comps still issue tickets, by design, so this is deliberately NOT enforced by a trigger on tickets. Enforced for online sales in supabase/functions/_shared/pricing.ts and mirrored by isManuallySoldOut() in src/lib/purchasable.ts. Independent of capacity: showing_availability() does not read it.';

-- ---------------------------------------------------------------------------
-- What the notice says
-- ---------------------------------------------------------------------------
--
-- Optional. NULL means the standard notice, which is what almost every night
-- wants. It exists for the night where the bare words mislead — "Sold out —
-- this screening was booked privately by the Latah County Historical Society"
-- answers the question a patron is about to email the box office to ask.
--
-- Deliberately NOT constrained to rows where the flag is set. Reopening a
-- showing clears the flag and keeps the message, so a run that sells out every
-- Saturday does not need its sentence retyped each week; a CHECK tying the two
-- together would force the text to be destroyed on reopening. Nothing reads
-- the column while the flag is false.

ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS sold_out_message text;

COMMENT ON COLUMN public.showings.sold_out_message IS
  'Optional replacement for the standard sold-out notice, shown only while manually_sold_out is true. Read by the showing page and returned by ticket-checkout as the refusal message. Kept when the showing is reopened — see the migration that added it — so the text survives a run that sells out repeatedly.';

-- SELECT/INSERT/UPDATE on showings are table-level grants, not column-level, so
-- both new columns inherit them and need no GRANT of their own — the same note
-- that applied to duration_minutes and no_ticket_required before them.

-- ---------------------------------------------------------------------------
-- No CHECK against the walk-in flag
-- ---------------------------------------------------------------------------
--
-- A showing that issues no ticket cannot sell out of them, so
-- (manually_sold_out AND no_ticket_required) is a contradiction. It is left
-- expressible on purpose, for the same reason requires_seat_selection is:
-- refusing it at the table turns an ordinary edit into a failed save. An admin
-- who marks a night sold out and later reclassifies it as a free walk-in would
-- have the second change rejected, with the fix — clear a flag they are not
-- looking at — nowhere on screen.
--
-- Instead the contradiction is made harmless where it is read. ShowingForm
-- forces this column false when the walk-in flag is set (as it already does
-- for ticket_price and requires_seat_selection), and isManuallySoldOut()
-- answers false for a walk-in showing in both copies, so a legacy row that
-- somehow holds both renders as the walk-in night it is rather than printing
-- "Sold Out" over a screening anyone can attend.

-- PostgREST caches the schema; both columns are invisible to it until it
-- reloads, and a select that silently lacks manually_sold_out reads as false —
-- an open showing. That is the safe direction (the website keeps selling a
-- showing it should have closed, which staff can see and fix) rather than the
-- unsafe one, but it is still wrong, so: reload.
NOTIFY pgrst, 'reload schema';
