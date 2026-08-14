-- Eligibility stops being a property of the screening and becomes a
-- relationship between a pass and a screening.
--
-- The old model was one boolean: showings.film_pass_eligible, forced false for
-- anything without a movie_id. It answers exactly one question — "do passes
-- work here" — and it can only answer it for every pass at once. That was
-- sufficient while there was one kind of pass.
--
-- A festival pass breaks it in both directions at the same time. It has to work
-- at the festival's screenings, which include events and live performances that
-- the trigger refuses to make eligible at all; and it must NOT work at the
-- ordinary Tuesday movie that the standard pass covers. There is no value of a
-- single boolean that expresses that, because the boolean has no idea which
-- pass is asking.
--
-- So the question moves. Not "is this screening pass-eligible" but "is *this
-- pass* good *here*", which is a row in a join table or it is nothing:
--
--   pass_type_showings (pass_type_id, showing_id)
--
-- A pass is good at a screening iff that row exists. The standard pass is the
-- rows pointing at standard movies; the festival pass is the rows pointing at
-- the festival's run. Neither is a special case in code — same door, same
-- function, different rows.
--
-- Two consequences worth stating rather than discovering:
--
--   1. The movies-only trigger goes. It encoded "a pass is for films" as a
--      structural fact, and it stops being one the moment a pass is scoped to
--      a named set of screenings. A festival pass covering a live performance
--      inside the festival is not drift, it is the point. What replaces the
--      guarantee is that eligibility is now explicit everywhere: nothing is
--      eligible by default, so nothing can leak in by forgetting to say no.
--
--   2. Eligibility is no longer a default. film_pass_eligible defaulted to
--      true, so a newly created movie showing took passes without anyone
--      deciding. Under an explicit model a new showing is eligible for nothing
--      until a row says otherwise, which would quietly stop the standard pass
--      working at next week's films. film_pass_types.is_default_for_movies is
--      what carries that forward: the admin form pre-selects those passes for
--      a new standard-priced movie, so the old behaviour survives as a visible
--      default rather than an invisible one.
--
-- The old column is dropped in the migration that follows this one, not in this
-- one, so the frontend can be deployed in between. See the header there.

-- ---------------------------------------------------------------------------
-- 1. What a pass type now carries
-- ---------------------------------------------------------------------------

ALTER TABLE public.film_pass_types
  ADD COLUMN IF NOT EXISTS per_showing_use_limit integer,
  ADD COLUMN IF NOT EXISTS is_default_for_movies boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.film_pass_types.per_showing_use_limit IS
  'How many admissions this pass may buy for one screening. NULL means unlimited — the balance is the only bound, which is what lets a holder bring friends. 1 restores the one-person-per-screening rule 20260814085500 removed, now as a per-type choice rather than a rule for everyone. A festival pass is the case that wants a small number: it is sold cheap per admission precisely because it is not meant to admit a party.';

COMMENT ON COLUMN public.film_pass_types.is_default_for_movies IS
  'Whether the showing form pre-selects this pass for a newly created standard-priced movie screening. This is the successor to showings.film_pass_eligible defaulting to true: without it, an explicit eligibility model silently stops the standard pass working at every screening created after the migration. Set on the passes that cover ordinary films; left off for a festival or any other pass scoped to a named run.';

-- Zero is not "unlimited", it is "this pass admits nobody", which is a pass
-- type that should be deactivated rather than configured. NULL is the only way
-- to say unlimited, so the two cannot be confused.
ALTER TABLE public.film_pass_types
  DROP CONSTRAINT IF EXISTS film_pass_types_per_showing_use_limit_check;

ALTER TABLE public.film_pass_types
  ADD CONSTRAINT film_pass_types_per_showing_use_limit_check
  CHECK (per_showing_use_limit IS NULL OR per_showing_use_limit > 0);

-- Every pass type that exists at this moment is a standard film pass — the
-- festival pass is the first one that will not be, and it does not exist yet.
-- Flagging them here is what makes the backfill below meaningful and what keeps
-- new movie showings behaving as they did yesterday.
--
-- Inactive types are left alone: they are not sold, so pre-selecting them on a
-- new showing would tag screenings for a pass nobody can buy.
UPDATE public.film_pass_types
SET is_default_for_movies = true
WHERE is_active AND NOT is_default_for_movies;

-- ---------------------------------------------------------------------------
-- 2. The relationship itself
-- ---------------------------------------------------------------------------
--
-- Deliberately just the pair. Everything a reader might be tempted to hang off
-- this row — a price override, a per-showing limit — belongs on the pass type,
-- because it is a property of the pass and not of the pairing, and putting it
-- here would let the same pass cost different amounts at different doors with
-- nothing saying which is intended.

CREATE TABLE IF NOT EXISTS public.pass_type_showings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_type_id uuid NOT NULL REFERENCES public.film_pass_types(id) ON DELETE CASCADE,
  showing_id   uuid NOT NULL REFERENCES public.showings(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT pass_type_showings_unique_pair UNIQUE (pass_type_id, showing_id)
);

COMMENT ON TABLE public.pass_type_showings IS
  'Which pass types may be redeemed at which screenings. A pass is good at a screening iff a row exists for (its type, that showing) — there is no default and no fallback, so a screening nobody has tagged accepts no passes at all. Replaces showings.film_pass_eligible, which could only speak for every pass at once.';

COMMENT ON COLUMN public.pass_type_showings.created_by IS
  'Who tagged this screening. Kept because bulk-tagging a festival is a few clicks that can quietly make dozens of screenings redeemable, and "who did that" is the first question when one of them should not have been.';

-- Both directions are read. The unique constraint's index serves the door
-- ("is this pass good here", pass_type_id first); this one serves the admin
-- form and the scanner ("which passes work at this screening").
CREATE INDEX IF NOT EXISTS pass_type_showings_showing_id_idx
  ON public.pass_type_showings (showing_id);

GRANT SELECT ON public.pass_type_showings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pass_type_showings TO authenticated;
GRANT ALL ON public.pass_type_showings TO service_role;

ALTER TABLE public.pass_type_showings ENABLE ROW LEVEL SECURITY;

-- Public read. The pairing is not a secret — it is the answer to "does my pass
-- work on Friday", which is a question the site should be able to answer
-- without anyone signing in. It exposes no balance and no patron.
CREATE POLICY "Pass eligibility is public"
  ON public.pass_type_showings FOR SELECT
  USING (true);

-- Staff write. Tagging a screening is scheduling work, and scheduling is
-- already a staff job (see job_postings, showings). Deleting is the same act in
-- reverse — untagging a screening someone tagged by mistake must not need an
-- admin, or the mistake stands until one is found.
CREATE POLICY "Staff can tag screenings for a pass"
  ON public.pass_type_showings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Staff can untag screenings for a pass"
  ON public.pass_type_showings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'));

-- ---------------------------------------------------------------------------
-- 3. Carry the old truth across
-- ---------------------------------------------------------------------------
--
-- Every screening that took passes yesterday still takes them today, against
-- the passes that existed yesterday. Anything else would be this migration
-- silently changing what the door does, which is the one thing it must not do:
-- the failure would surface as a patron being turned away at a film they have
-- already paid for.
--
-- Deliberately not scoped to future showings. The scanner's window reaches four
-- hours back, so a screening that started this afternoon is still being
-- admitted to; and a past redemption's reporting reads better against a
-- consistent table than one that starts mid-history. A few thousand rows of
-- two uuids is not a size worth optimising against correctness.
INSERT INTO public.pass_type_showings (pass_type_id, showing_id)
SELECT t.id, s.id
FROM public.showings s
CROSS JOIN public.film_pass_types t
WHERE s.film_pass_eligible
  AND t.is_default_for_movies
ON CONFLICT ON CONSTRAINT pass_type_showings_unique_pair DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. The door
-- ---------------------------------------------------------------------------
--
-- Restated in full — CREATE OR REPLACE FUNCTION has no partial form, and a
-- reader comparing this against 20260814085500 should see the whole of what the
-- door does rather than a diff. Two checks change; nothing else moves.
--
-- The ordering is still the point of the structure: the reason a pass is
-- refused must be the real one, so a pass turned away at a concert reads as
-- "not valid for this screening" and never as "insufficient balance". The seat
-- is still minted before the deduction and inside the same transaction, so a
-- full house rolls the deduction back with it.

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
  'One in-person admission against a film pass. Eligibility is a row in pass_type_showings for (this pass''s type, this showing) and nothing else — no category rule, no default — so a festival pass covers its festival and nothing more. film_pass_types.per_showing_use_limit caps how many admissions one pass may buy for one screening; NULL is unlimited and the balance is then the only bound. Mints an already-scanned ticket and deducts redemption_price in the same transaction, so a full house rolls the deduction back with it. Returns a verdict object the door scanner renders directly. Service role only.';

REVOKE ALL ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) TO service_role;
