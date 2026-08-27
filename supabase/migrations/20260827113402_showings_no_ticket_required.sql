-- A free showing that issues no ticket at all.
--
-- The gap this closes
-- -------------------
-- "Free" already existed, but only in one sense. A showing priced at 0 skips
-- the card step and the button reads "Reserve N Ticket(s)" — it still mints a
-- ticket row, still holds a seat, still counts against capacity. That is an
-- RSVP, and it is the right behaviour for a free screening with a house to
-- manage.
--
-- It is the wrong behaviour for the other kind of free night: doors open, walk
-- in, no ticket exists. Asking those patrons to reserve something is a step
-- with nothing in it, and it leaves the box office with a guest list nobody
-- will read at a door nobody is scanning.
--
-- The two are not distinguishable from `ticket_price = 0`, which is why this
-- is a column rather than an inference.
--
-- Where the rule lives (Tom, 2026-08-26)
-- --------------------------------------
-- The same three places, in the same order of authority, as the past-showing
-- rule this file extends (20260819143722_showing_end_and_past_sales_rules.sql):
--
--   1. Here. The CHECK below, and the BEFORE INSERT trigger on `tickets`.
--      StaffPOS.tsx and HostDashboard.tsx insert tickets straight through
--      PostgREST and touch no edge function, so this is the only layer that
--      covers every path.
--   2. supabase/functions/_shared/purchasable.ts, applied in _shared/pricing.ts
--      — the one gate every online sale passes through, and the layer that
--      turns a stale tab into a sentence a customer can read.
--   3. src/lib/purchasable.ts — the browser's copy. Advisory. It decides what
--      is rendered: "Free — no ticket needed" instead of a purchase panel.
--
-- All three state the same rule and carry the same sentence. Changing one
-- means changing all three.

-- ---------------------------------------------------------------------------
-- The flag
-- ---------------------------------------------------------------------------
--
-- A boolean rather than a `ticketing_mode` enum, matching the flags already on
-- this table (`requires_seat_selection`, `is_active`, `is_featured`). An enum
-- would name the three states explicitly, but it would also be a second source
-- of truth sitting next to `ticket_price` with nothing stopping the two from
-- contradicting each other — `mode = 'paid'` on a row priced at 0, or
-- `'free_walkin'` on one priced at 8. The boolean plus the CHECK below cannot
-- express that contradiction at all.
--
-- NOT NULL DEFAULT false, so every showing that already exists keeps exactly
-- the behaviour it has today and no backfill is needed.

ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS no_ticket_required boolean NOT NULL DEFAULT false;

-- The flag is only meaningful on a free showing. A no-ticket showing that
-- carries a price is not a state anybody meant to create — it is either a
-- price somebody forgot to clear or a flag somebody set on the wrong row, and
-- both are worth refusing at the table rather than discovering in the takings.
--
-- Stated as an implication so it constrains nothing else: a priced showing and
-- a free-but-ticketed showing both satisfy it trivially.
--
-- Tiers live in `showing_price_tiers` and cannot be reached from a table-level
-- CHECK. They get their own guard further down.

ALTER TABLE public.showings
  DROP CONSTRAINT IF EXISTS showings_no_ticket_requires_free;

ALTER TABLE public.showings
  ADD CONSTRAINT showings_no_ticket_requires_free
  CHECK (NOT no_ticket_required OR ticket_price = 0);

COMMENT ON COLUMN public.showings.no_ticket_required IS
  'True when this showing issues no ticket at all — free, walk in, nothing to reserve or scan. Only legal when ticket_price = 0 (see showings_no_ticket_requires_free) and when the showing has no priced tiers. Distinct from ticket_price = 0 alone, which is a free showing that still issues a (free) ticket and holds a seat. Mirrored by needsNoTicket() in src/lib/purchasable.ts and supabase/functions/_shared/purchasable.ts.';

-- SELECT/INSERT/UPDATE on showings are table-level grants, not column-level, so
-- the new column inherits them and needs no GRANT of its own — the same note
-- that applied to duration_minutes in the migration this extends.

-- ---------------------------------------------------------------------------
-- No ticket may exist for a showing that issues none
-- ---------------------------------------------------------------------------
--
-- This is the point of the whole change. Everything above is bookkeeping; a
-- flag that only hides a button is a rendering preference, not a rule. The
-- ticket table is where "no ticket needed" either means something or does not.
--
-- Folded into enforce_showing_not_past() rather than added as a fifth trigger
-- on `tickets`. Both are the same question asked of the same row at the same
-- moment — "can this showing produce a ticket at all" — and splitting them
-- would mean a second SELECT of the showings row per insert and a second place
-- to remember. The function is renamed in spirit but not in name: renaming it
-- would orphan the trigger and the comments in two other files that point at
-- it by name, for no gain.
--
-- Ordering inside the body matters. The no-ticket check runs BEFORE the
-- past-showing check so that a walk-in night that has also finished is
-- reported as the former. "This showing has passed" would send staff looking
-- for a date problem on a showing whose real answer is that it never had
-- tickets to begin with.
--
-- Every payment_method is refused, comps and film passes included. A pass
-- deducts real money off a physical card and a comp occupies a real seat; on a
-- night with no ticketing there is nothing for either to buy. admit_with_film_pass()
-- is left alone deliberately — its eligibility test already requires a
-- pass_type_showings row, and tagging a no-ticket screening as pass-eligible
-- is the mistake this refusal exists to catch rather than one to pre-empt in
-- two places.

CREATE OR REPLACE FUNCTION public.enforce_showing_not_past()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_showing public.showings%ROWTYPE;
  v_closes  timestamptz;
BEGIN
  SELECT * INTO v_showing
  FROM public.showings
  WHERE id = NEW.showing_id;

  -- No showing row: not this trigger's business to adjudicate.
  -- enforce_ticket_pricing already raises on an invalid showing_id.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Asked first, and asked without reference to the clock: a showing that
  -- issues no tickets issues none before it starts, during it, or a year
  -- after. PT409 Conflict rather than the 410 below — the showing is not gone,
  -- it is a showing this row cannot describe.
  IF v_showing.no_ticket_required THEN
    RAISE EXCEPTION 'This showing does not require a ticket.'
      USING ERRCODE = 'PT409',
            HINT = 'Admission is free and open — no ticket is issued, reserved or scanned for this showing.';
  END IF;

  -- Unchanged from 20260819143722. A showing with no start_time fails pricing
  -- for its own reasons and should not be refused here with a sentence that
  -- misdescribes it.
  IF v_showing.start_time IS NULL THEN
    RETURN NEW;
  END IF;

  v_closes := GREATEST(
    public.showing_ends_at(v_showing),
    v_showing.start_time + public.door_grace_window()
  );

  IF now() > v_closes THEN
    RAISE EXCEPTION 'This showing has passed.'
      USING ERRCODE = 'PT410',
            HINT = 'Tickets cannot be sold or issued for a showing that has already taken place.';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_showing_not_past() IS
  'Refuses a ticket insert for a showing that issues no tickets (no_ticket_required, SQLSTATE PT409 -> HTTP 409) or that is past both its end (showing_ends_at) and the in-person door window (door_grace_window) (PT410 -> HTTP 410). The no-ticket test runs first so a walk-in night that has also finished is reported as the former.';

-- The trigger itself is unchanged and already installed by 20260819143722;
-- CREATE OR REPLACE above rebinds it to the new body. Restated here so that a
-- fresh database built from migrations alone ends up with it either way.
DROP TRIGGER IF EXISTS zy_enforce_showing_not_past_on_insert ON public.tickets;
CREATE TRIGGER zy_enforce_showing_not_past_on_insert
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_showing_not_past();

-- ---------------------------------------------------------------------------
-- A no-ticket showing cannot carry a priced tier
-- ---------------------------------------------------------------------------
--
-- The other half of "it can't also carry a price", for the half the CHECK
-- cannot see. A tier row on a walk-in showing sells nothing — the checkout
-- refuses the showing outright and the page renders no purchase panel — so
-- this is not closing a sales hole. What it stops is a contradictory row that
-- reads as a priced showing in the admin form the next time somebody opens it.
--
-- Guards the tier side only, not the showings side. Putting the same test on
-- `showings` would break the ordinary edit: ShowingForm saves the showing row
-- first and reconciles tiers afterwards, so flipping a tiered showing to
-- no-ticket would be refused for tiers the very next statement deletes. The
-- form clears them itself; this catches the direction with no such ordering —
-- adding a priced tier to a showing already flagged.
--
-- A zero-priced tier is allowed through. It contradicts nothing (the showing
-- is free either way), and refusing it would turn a harmless leftover row into
-- a failed save.

CREATE OR REPLACE FUNCTION public.enforce_no_tier_on_no_ticket_showing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.price, 0) > 0
     AND EXISTS (
       SELECT 1 FROM public.showings s
       WHERE s.id = NEW.showing_id AND s.no_ticket_required
     )
  THEN
    RAISE EXCEPTION 'This showing does not require a ticket, so it cannot have priced tiers.'
      USING ERRCODE = 'PT409',
            HINT = 'Clear "No ticket needed" on the showing first, or price the tier at 0.';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_no_tier_on_no_ticket_showing() IS
  'Refuses a priced showing_price_tiers row for a showing flagged no_ticket_required. Deliberately one-directional — the showings side is not guarded, because ShowingForm writes the showing row before it reconciles tiers and would be refused for rows it is about to delete.';

DROP TRIGGER IF EXISTS enforce_no_tier_on_no_ticket_showing_trigger ON public.showing_price_tiers;
CREATE TRIGGER enforce_no_tier_on_no_ticket_showing_trigger
  BEFORE INSERT OR UPDATE ON public.showing_price_tiers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_no_tier_on_no_ticket_showing();

-- PostgREST caches the schema; the new column is invisible to it until it
-- reloads, which would make every select of no_ticket_required return
-- undefined rather than false — indistinguishable from a showing that is
-- ticketed.
NOTIFY pgrst, 'reload schema';
