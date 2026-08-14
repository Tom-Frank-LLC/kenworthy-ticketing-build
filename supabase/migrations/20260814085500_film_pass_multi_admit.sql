-- A film pass admits a party, not a person.
--
-- 20260813000000 built the door scan around an assumption that reads as
-- obvious and is wrong: that a pass belongs to one person, so scanning it twice
-- at the same screening must be a mistake. It enforced that with a partial
-- UNIQUE INDEX on (pass_id, showing_id) and an `already_admitted` verdict.
--
-- What actually happens at the door is that a pass holder brings a friend. The
-- pass is a *balance*, not a season ticket — a $60 pass is ten $6 admissions,
-- and nothing about the model says those ten admissions have to be ten
-- different nights or ten different people. Two people arriving together for
-- one film is two admissions and $12 off the balance, which is exactly what the
-- theatre intends to sell.
--
-- So the limit comes off. What replaces it is not a looser rule but a different
-- one, already present and already sufficient: the balance. A pass admits until
-- it can no longer cover redemption_price, and that bound is enforced in the
-- same transaction that mints the seat.
--
-- Two things are deliberately *kept*:
--
--   showing_id stays populated on every redemption. It stops being a uniqueness
--   key and goes back to being what it reads as — the record of which screening
--   an admission was for, which is how "this pass bought four seats for the
--   Thursday show" becomes answerable at all. Dropping the column with the
--   constraint would have thrown away the reporting to remove the rule.
--
--   The row lock on the pass. Now that repeat scans are legal, two devices
--   scanning the same sticker at once is an ordinary event rather than an
--   anomaly, and FOR UPDATE is the only thing stopping both from reading the
--   same balance and each deducting from it.
--
-- Accidental double-counting — one sticker held to the camera a beat too long —
-- is now a client concern, because the server can no longer tell an accident
-- from a friend. It is handled in TicketScanner by ignoring a re-read of the
-- identical code inside a short cooldown. That is the right place for it: it is
-- a property of one camera in one moment, not a rule about passes.

-- ---------------------------------------------------------------------------
-- 1. The index that encoded the old rule
-- ---------------------------------------------------------------------------
--
-- Replaced rather than simply dropped. The lookup it served — "redemptions of
-- this pass against this showing" — is still made, by reporting rather than by
-- the guard, and it is the same lookup on the same two columns. Only the
-- uniqueness was ever wrong.

DROP INDEX IF EXISTS public.film_pass_redemptions_pass_showing_key;

CREATE INDEX IF NOT EXISTS film_pass_redemptions_pass_showing_idx
  ON public.film_pass_redemptions (pass_id, showing_id)
  WHERE showing_id IS NOT NULL;

COMMENT ON COLUMN public.film_pass_redemptions.showing_id IS
  'Which screening this admission was for. A pass may hold several rows for one showing — each is one person it admitted, bounded by the balance, not by a one-per-screening rule. NULL on rows predating the door-scan model.';

-- ---------------------------------------------------------------------------
-- 2. The door scan, with one check removed and nothing else touched
-- ---------------------------------------------------------------------------
--
-- Restated in full rather than patched, because CREATE OR REPLACE FUNCTION has
-- no partial form and a reader comparing this against 20260813000000 should be
-- able to see the whole of what the door now does, not a diff.
--
-- The ordering below still matters and is unchanged: the reason a pass is
-- refused must be the real one, so eligibility is tested before expiry and
-- expiry before balance. And the seat is still minted before the deduction, in
-- the same transaction, so a full house (the capacity trigger raising PT409)
-- rolls the deduction back with it rather than leaving a pass $6 lighter with
-- nobody admitted.

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
  -- two people.
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

  -- Eligibility, server-side and in this order so the reason given is the real
  -- one: a pass refused at a concert should not read "insufficient balance".
  IF v_showing.movie_id IS NULL OR NOT v_showing.film_pass_eligible THEN
    RETURN jsonb_build_object(
      'result', 'ineligible',
      'pass_id', v_pass.id,
      'showing_title', v_title,
      'remaining_balance', v_pass.remaining_balance
    );
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

  -- The only bound left. A pass admits people until it cannot cover another
  -- admission, whether those people arrive on one night or ten.
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
    'status', v_new_status
  );
END;
$function$;

COMMENT ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) IS
  'One in-person admission against a film pass: checks eligibility (a movie, flagged eligible), expiry and balance, then mints an already-scanned ticket and deducts redemption_price — all in one transaction, so a full house rolls the deduction back with it. A pass may be scanned repeatedly for the same screening; each scan admits one more person and the balance is the only limit. Returns a verdict object the door scanner renders directly, including admitted_for_showing so staff can see it was the second admission and not a double read. Service role only.';

REVOKE ALL ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) TO service_role;
