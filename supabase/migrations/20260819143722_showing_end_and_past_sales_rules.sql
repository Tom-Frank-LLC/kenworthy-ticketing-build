-- No ticket for a showing that has already happened.
--
-- The gap this closes
-- -------------------
-- Nothing in the system modelled purchasability. `ticket-checkout` priced,
-- charged and confirmed a ticket for a screening that finished last March
-- without a murmur; the staff POS and the comp issuer insert rows straight
-- from the browser, so they were never even asked. The Showing page rendered
-- its buy flow for any showing reachable by URL. "Hide the button" would have
-- been a symptom fix — the cause is that the rule was never written down
-- anywhere a write had to pass through.
--
-- Where the rule now lives
-- ------------------------
-- Three places, deliberately, in descending order of authority:
--
--   1. This file. `showing_ends_at()` and the BEFORE INSERT trigger below.
--      No client can route around a trigger, and two of the four ticket
--      creation paths (StaffPOS.tsx, HostDashboard.tsx) talk to PostgREST
--      directly and touch no edge function at all. This is the only layer
--      that covers them.
--   2. supabase/functions/_shared/purchasable.ts, applied in
--      _shared/pricing.ts — the one gate every online sale passes through.
--      This is what turns a stale browser tab into a sentence a customer can
--      read, rather than an opaque 400 from the database.
--   3. src/lib/purchasable.ts — the browser's copy. Advisory. It decides what
--      is *rendered*: no buy button, a "This showing has passed" notice.
--
-- All three state the same rule. Changing the cutoff means changing all three.
--
-- The cutoff (Tom, 2026-08-19)
-- ----------------------------
-- Sales stop when the show *ends*, not when it starts. A patron arriving at
-- 7:20 for a 7:00 film is still a patron, and refusing them would have been a
-- rule the box office worked around rather than with.
--
-- That required a duration, which the schema did not have: `movies` carries
-- duration_minutes, but `events` and `live_performances` carry nothing, and
-- `showings` had no column at all. Hence the new column below and the fallback
-- chain in showing_ends_at().

-- ---------------------------------------------------------------------------
-- Per-showing duration
-- ---------------------------------------------------------------------------
--
-- Nullable on purpose. A film already knows how long it runs, and making this
-- required would mean answering the question twice for every screening. It is
-- an override: set it when a showing runs longer than its production says (a
-- double bill, a Q&A after, an intermission), and for the events and live
-- performances that have no runtime of their own and would otherwise fall to
-- the two-hour default.

ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

ALTER TABLE public.showings
  DROP CONSTRAINT IF EXISTS showings_duration_minutes_positive;

ALTER TABLE public.showings
  ADD CONSTRAINT showings_duration_minutes_positive
  CHECK (duration_minutes IS NULL OR duration_minutes > 0);

COMMENT ON COLUMN public.showings.duration_minutes IS
  'How long this showing runs, in minutes. NULL means "ask the production" — see showing_ends_at(). Set it to override a film''s runtime, or to give an event or live performance a real end time (neither table has a duration column).';

-- SELECT/INSERT/UPDATE on showings are table-level grants, not column-level,
-- so the new column inherits them and needs no GRANT of its own. (Compare
-- public.movies, which *is* column-granted to anon — a new column there would
-- be invisible until named explicitly.)

-- ---------------------------------------------------------------------------
-- When a showing is over
-- ---------------------------------------------------------------------------
--
-- Takes the showings row rather than an id, which also makes it a PostgREST
-- computed column: `showings?select=id,start_time,showing_ends_at` works, and
-- any future surface can ask the database the question instead of restating
-- the fallback chain.
--
-- SECURITY DEFINER because it reads public.movies, and a showing whose film
-- has been deactivated must still resolve to the same end time for staff and
-- for an anonymous browser. Returning only a timestamp, it discloses nothing
-- a showtime listing does not.
--
-- The two-hour default is the last resort and is deliberately generous: too
-- long costs a few extra minutes of a purchasable page, too short refuses a
-- real sale during a real show. Mirrored by DEFAULT_SHOWING_MINUTES in both
-- purchasable.ts twins.

CREATE OR REPLACE FUNCTION public.showing_ends_at(s public.showings)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.start_time + make_interval(
    mins => COALESCE(
      NULLIF(GREATEST(s.duration_minutes, 0), 0),
      NULLIF(GREATEST((SELECT m.duration_minutes FROM public.movies m WHERE m.id = s.movie_id), 0), 0),
      120
    )
  )
$function$;

COMMENT ON FUNCTION public.showing_ends_at(public.showings) IS
  'The instant a showing is over, and with it the last moment it can be sold. Duration resolves showings.duration_minutes -> movies.duration_minutes -> 120. Single source of truth for enforce_showing_not_past(); mirrored by showingEndsAt() in src/lib/purchasable.ts and supabase/functions/_shared/purchasable.ts.';

REVOKE ALL ON FUNCTION public.showing_ends_at(public.showings) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.showing_ends_at(public.showings) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- How late the door stays open
-- ---------------------------------------------------------------------------
--
-- Redeeming a film pass and comping a walk-up are in-person acts that happen
-- *during* the show, and a pass is scanned at the door by a staff member
-- looking at the room. Bounding those by the online cutoff would refuse every
-- latecomer, which staff would correctly experience as the system being
-- broken.
--
-- Four hours is the span the scanner already treats as "tonight"
-- (SHOWING_WINDOW_BEFORE_MS in src/pages/admin/TicketScanner.tsx) — long
-- enough for a marathon, short enough that a mis-picked showing from last
-- month is refused.

CREATE OR REPLACE FUNCTION public.door_grace_window()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 PARALLEL SAFE
AS $function$ SELECT interval '4 hours' $function$;

COMMENT ON FUNCTION public.door_grace_window() IS
  'How long after start_time staff can still admit in person (film-pass redemption, comps, walk-up POS). Single source of truth for admit_with_film_pass() and enforce_showing_not_past(); mirrored by DOOR_GRACE_MINUTES in src/lib/purchasable.ts.';

-- ---------------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------------
--
-- The floor, not the ceiling. It refuses a ticket for a showing that is over
-- by *both* measures — past its end and past the door window — because one
-- trigger has to serve online sales and the door at once, and the door's
-- window is the wider of the two. The tighter online rule (sales stop at the
-- end of the show) is applied a layer up, in _shared/pricing.ts, where there
-- is a customer to explain it to.
--
-- So: a 7:00 PM 100-minute film stops selling online at 8:40, and stops
-- admitting at the door at 11:00. Both are refused here after 11:00, whatever
-- the caller and whatever the payment method.
--
-- No payment_method is exempt. film_pass admissions arrive from
-- admit_with_film_pass(), which checks the same window itself and returns a
-- readable 'showing_over' to the scanner before reaching this point; comps and
-- POS sales are in-person acts and get the same four hours. If a genuine
-- backfill of historical ticket rows is ever needed, the escape hatch is
-- `ALTER TABLE public.tickets DISABLE TRIGGER zy_enforce_showing_not_past_on_insert;`
-- inside that transaction — not a carve-out here.

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
  IF NOT FOUND OR v_showing.start_time IS NULL THEN
    RETURN NEW;
  END IF;

  v_closes := GREATEST(
    public.showing_ends_at(v_showing),
    v_showing.start_time + public.door_grace_window()
  );

  IF now() > v_closes THEN
    -- PostgREST maps SQLSTATE 'PT<nnn>' to HTTP <nnn>. 410 Gone is the honest
    -- code: the showing existed and no longer can be sold, which is a
    -- different fact from 404 (no such showing) and from the 409 the capacity
    -- trigger raises. The message is the exact sentence the page shows, so a
    -- buyer who submits a stale tab is not handed a second, differently
    -- worded version of the same fact to reconcile.
    RAISE EXCEPTION 'This showing has passed.'
      USING ERRCODE = 'PT410',
            HINT = 'Tickets cannot be sold or issued for a showing that has already taken place.';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_showing_not_past() IS
  'Refuses a ticket insert for a showing that is past both its end (showing_ends_at) and the in-person door window (door_grace_window). Raises SQLSTATE PT410, which PostgREST returns as HTTP 410.';

-- Trigger ordering is alphabetical. This must run after
-- enforce_ticket_pricing_on_insert (which validates showing_id at all) and
-- before zz_enforce_showing_capacity_on_insert, so that a past showing is
-- reported as past rather than as sold out — "sold out" would send staff
-- looking for capacity to free up on a screening that finished last year.
-- The zy_ prefix is that ordering, not a naming preference.
DROP TRIGGER IF EXISTS zy_enforce_showing_not_past_on_insert ON public.tickets;
CREATE TRIGGER zy_enforce_showing_not_past_on_insert
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_showing_not_past();

-- ---------------------------------------------------------------------------
-- The door: a pass cannot be redeemed against a showing that is over
-- ---------------------------------------------------------------------------
--
-- Replaces the function as last defined in
-- 20260814093200_pass_eligibility_by_type.sql (eligibility by pass_type_showings,
-- per-showing use limits). Reproduced from that file verbatim.
-- The only change is the window check inserted after the eligibility test and
-- before the per-showing limit test, so the reason staff are given is the real one — a
-- pass refused for a screening that finished should not read "insufficient
-- balance". Everything else below is unchanged and is reproduced in full
-- because CREATE OR REPLACE takes the whole body.
--
-- Without this, the trigger above would still catch the insert, but staff
-- would see the raw exception rather than a scanner verdict, and the deduction
-- ordering below would have been wasted work.

CREATE OR REPLACE FUNCTION public.admit_with_film_pass(
  p_pass_code  text,
  p_showing_id uuid,
  p_scanned_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pass       public.user_film_passes%ROWTYPE;
  v_type       public.film_pass_types%ROWTYPE;
  v_showing    public.showings%ROWTYPE;
  v_title      text;
  v_cost       numeric;
  v_remaining  numeric;
  v_ticket_id  uuid;
  v_new_status text;
  v_admitted   integer;
  v_used       integer;
BEGIN
  IF p_showing_id IS NULL THEN
    RETURN jsonb_build_object('result', 'no_showing_selected');
  END IF;
  IF p_pass_code IS NULL OR btrim(p_pass_code) = '' THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- Held for the rest of the transaction. This is what serialises two staff
  -- scanning the same sticker for two friends at the same moment: without it
  -- both read the same balance and both deduct from it, and a $6 pass admits
  -- two people. It is also what makes the per-showing limit below a real limit
  -- rather than a suggestion — the count and the insert that follows it are
  -- inside the same lock, so two simultaneous scans cannot both see "one used,
  -- limit two" and both go through.
  SELECT * INTO v_pass
  FROM public.user_film_passes
  WHERE qr_code = btrim(p_pass_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT * INTO v_showing FROM public.showings WHERE id = p_showing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'showing_not_found');
  END IF;

  SELECT * INTO v_type FROM public.film_pass_types WHERE id = v_pass.pass_type_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'pass_type_not_found');
  END IF;

  SELECT COALESCE(m.title, e.title, lp.title, 'Unknown') INTO v_title
  FROM public.showings s
  LEFT JOIN public.movies m            ON m.id  = s.movie_id
  LEFT JOIN public.events e            ON e.id  = s.event_id
  LEFT JOIN public.live_performances lp ON lp.id = s.live_performance_id
  WHERE s.id = p_showing_id;

  -- An unactivated sticker is a piece of paper. A voided or depleted one is a
  -- pass with a history, and staff need to be told which.
  IF v_pass.status = 'unassigned' THEN
    RETURN jsonb_build_object('result', 'not_activated', 'pass_id', v_pass.id);
  END IF;
  IF v_pass.status <> 'active' THEN
    RETURN jsonb_build_object('result', 'not_active', 'pass_id', v_pass.id, 'status', v_pass.status);
  END IF;

  -- Eligibility. The whole rule is now the existence of a row: this pass's type
  -- against this screening. No category test, because the category stopped
  -- meaning anything the moment a festival pass could cover a live performance;
  -- and no default, because "nobody tagged it" has to mean no rather than yes
  -- or a screening becomes redeemable by inattention.
  IF NOT EXISTS (
    SELECT 1 FROM public.pass_type_showings pts
    WHERE pts.pass_type_id = v_type.id
      AND pts.showing_id   = p_showing_id
  ) THEN
    RETURN jsonb_build_object(
      'result', 'not_eligible_for_pass',
      'pass_id', v_pass.id,
      'pass_type_name', v_type.name,
      'showing_title', v_title,
      'remaining_balance', v_pass.remaining_balance
    );
  END IF;

  -- The screening is over. Deliberately the door window and not
  -- showing_ends_at(): the scanner is used *during* the film, and a latecomer
  -- twenty minutes in is exactly who this path exists for. What it refuses is
  -- yesterday's screening picked by mistake from the selector — a mistake
  -- nothing downstream can catch, because the deduction is real money off a
  -- physical card.
  --
  -- Placed after eligibility and before the per-showing limit for the same
  -- reason the rest of this ladder is ordered as it is: the reason given has to
  -- be the real one. A holder at a screening that finished yesterday should not
  -- be told they have used up their allowance for it.
  IF now() > v_showing.start_time + public.door_grace_window() THEN
    RETURN jsonb_build_object(
      'result', 'showing_over',
      'pass_id', v_pass.id,
      'showing_title', v_title,
      'start_time', v_showing.start_time,
      'remaining_balance', v_pass.remaining_balance
    );
  END IF;

  -- How many times this pass has already been through this door tonight.
  --
  -- Checked here — after eligibility, before expiry and balance — because it
  -- occupies the slot the old already_admitted check held, and for the same
  -- reason: a holder presenting a pass that has hit its cap for this screening
  -- is a specific, ordinary situation, and telling them "not enough balance"
  -- when the balance is fine sends them to the wrong conversation.
  --
  -- NULL is unlimited and skips the count entirely, which is the common case.
  IF v_type.per_showing_use_limit IS NOT NULL THEN
    SELECT count(*) INTO v_used
    FROM public.film_pass_redemptions r
    WHERE r.pass_id = v_pass.id AND r.showing_id = p_showing_id;

    IF v_used >= v_type.per_showing_use_limit THEN
      RETURN jsonb_build_object(
        'result', 'per_showing_limit_reached',
        'pass_id', v_pass.id,
        'showing_title', v_title,
        'admitted_for_showing', v_used,
        'per_showing_use_limit', v_type.per_showing_use_limit,
        'remaining_balance', v_pass.remaining_balance
      );
    END IF;
  END IF;

  IF v_pass.expires_at IS NOT NULL AND v_pass.expires_at < now() THEN
    UPDATE public.user_film_passes SET status = 'expired' WHERE id = v_pass.id;
    RETURN jsonb_build_object(
      'result', 'expired',
      'pass_id', v_pass.id,
      'expires_at', v_pass.expires_at
    );
  END IF;

  v_cost := v_type.redemption_price;

  -- The other bound. Between this and the limit above, a pass admits people
  -- until either it cannot cover another admission or it has spent its
  -- allowance for this particular screening.
  IF COALESCE(v_pass.remaining_balance, 0) < v_cost THEN
    RETURN jsonb_build_object(
      'result', 'insufficient',
      'pass_id', v_pass.id,
      'remaining_balance', COALESCE(v_pass.remaining_balance, 0),
      'redemption_price', v_cost
    );
  END IF;

  -- The seat first. If the house is full the capacity trigger raises PT409 and
  -- the whole transaction rolls back, which is exactly right: no admission, no
  -- deduction. The ticket carries the screening's face value because that is
  -- what the seat was worth; what the *pass* paid is the redemption row below.
  -- (Accounting reads the pass sale as the income and skips film_pass tickets,
  -- or the same $60 would be counted twice.)
  --
  -- payment_method is what makes this seat legible as a pass admission on the
  -- attendee sheet; which pass bought it is the redemption row, not a column
  -- here, so the two can never disagree.
  INSERT INTO public.tickets (
    user_id, showing_id, qr_code, order_token,
    status, payment_method, scanned_at, purchased_at
  ) VALUES (
    v_pass.user_id,            -- NULL for a bearer pass: nobody owns this seat
    p_showing_id,
    gen_random_uuid()::text,
    gen_random_uuid()::text,
    'confirmed',
    'film_pass',
    now(),
    now()
  )
  RETURNING id INTO v_ticket_id;

  v_remaining := round(v_pass.remaining_balance - v_cost, 2);

  -- Depleted is a state, not a computation: every read path filters on
  -- status = 'active', so a pass that can no longer buy an admission has to
  -- stop being active or it will keep being offered as one.
  v_new_status := CASE WHEN v_remaining < v_cost THEN 'depleted' ELSE 'active' END;

  UPDATE public.user_film_passes
  SET remaining_balance = v_remaining,
      status            = v_new_status
  WHERE id = v_pass.id;

  INSERT INTO public.film_pass_redemptions (
    pass_id, ticket_id, showing_id, amount_deducted, redeemed_by
  ) VALUES (
    v_pass.id, v_ticket_id, p_showing_id, v_cost, p_scanned_by
  );

  -- How many this pass has now admitted to this screening, counting the one
  -- just made. Returned so the scanner can say "2nd admission on this pass" —
  -- the reassurance that used to come from the double-admit refusal, and the
  -- one number that tells staff whether the beep they just heard was the
  -- friend they meant to admit or the same sticker read twice.
  SELECT count(*) INTO v_admitted
  FROM public.film_pass_redemptions r
  WHERE r.pass_id = v_pass.id AND r.showing_id = p_showing_id;

  RETURN jsonb_build_object(
    'result', 'admitted',
    'pass_id', v_pass.id,
    'ticket_id', v_ticket_id,
    'showing_title', v_title,
    'start_time', v_showing.start_time,
    'pass_type_name', v_type.name,
    'amount_deducted', v_cost,
    'remaining_balance', v_remaining,
    'admissions_left', floor(v_remaining / v_cost),
    'admitted_for_showing', v_admitted,
    'per_showing_use_limit', v_type.per_showing_use_limit,
    'status', v_new_status
  );
END;
$function$;

COMMENT ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) IS
  'One in-person admission against a film pass: checks eligibility (a pass_type_showings row), that the screening is still within door_grace_window(), the per-showing use limit, expiry and balance, then mints an already-scanned ticket and deducts redemption_price — all in one transaction, so a full house rolls the deduction back with it. Returns a verdict object the door scanner renders directly. Service role only.';

-- Restated rather than relied upon. CREATE OR REPLACE does keep the existing
-- grants, but this function is the one that spends money off a physical card,
-- and "the previous migration granted it correctly" is exactly the kind of
-- inherited assumption worth not making.
REVOKE ALL ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) TO service_role;

-- PostgREST caches the schema; the new column and computed column are
-- invisible to it until it reloads.
NOTIFY pgrst, 'reload schema';
