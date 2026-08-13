-- Film passes become physical objects.
--
-- What a film pass is now: a paper pass carrying a stickered QR code. The
-- theatre prints batches of *blank* stickers; a sticker becomes a pass at the
-- moment staff scan it at handoff, which is what attaches an owner (or nobody)
-- and loads the balance. It is redeemed only in person, at the door, and only
-- against a standard movie: each admission deducts a fixed amount from the
-- balance, so a $60 pass is ten $6 admissions against $8 tickets.
--
-- What it is not: stored value for anything else, a gift card, or a way to pay
-- for a ticket online. The online path is removed in the accompanying code
-- change and refused server-side here by simply never granting anyone but the
-- service role a way in.
--
-- The shape of the change, and why each piece exists:
--
--   1. A sticker exists before it means anything. That is the whole reason
--      user_film_passes.user_id and .remaining_balance become nullable and a
--      'unassigned' status appears: a printed blank has no owner and holds no
--      money, and modelling it as a zero-balance pass owned by nobody-in-
--      particular would make "was this ever sold?" unanswerable.
--
--   2. Expiry starts at activation, not at purchase. A pass sitting in a
--      drawer waiting to be collected must not burn its clock, so expires_at
--      is computed in activate_film_pass rather than at insert.
--
--   3. Eligibility is data, not a price comparison. showings.film_pass_eligible
--      says whether a screening takes passes. Deriving it from `ticket_price =
--      8` would make the rule invisible and would silently start accepting
--      passes the day someone changes a price.
--
--   4. Buying online no longer produces anything scannable. film_pass_orders
--      records an obligation — money taken, physical pass still owed — and it
--      is discharged when a sticker is activated against it.
--
-- Two SECURITY DEFINER functions carry the two moments that must be atomic:
-- activation (a blank becomes a funded pass and an order is discharged) and
-- admission (a balance is spent and a seat is claimed). Both are reachable only
-- by the service role, so the browser can neither activate a sticker nor spend
-- a balance without going through an edge function that has checked who is
-- asking.

-- ---------------------------------------------------------------------------
-- 1. What an admission costs
-- ---------------------------------------------------------------------------
--
-- Not a constant in the scanner. A $60 pass buying ten $8 movies at $6 each is
-- a pricing decision, and pricing decisions in this codebase live in the
-- database (see enforce_ticket_pricing). initial_balance / redemption_price is
-- how many admissions a pass is worth; both are editable without a deploy.

ALTER TABLE public.film_pass_types
  ADD COLUMN IF NOT EXISTS redemption_price numeric(10,2) NOT NULL DEFAULT 6.00;

COMMENT ON COLUMN public.film_pass_types.redemption_price IS
  'Deducted from the balance for one in-person admission. The pass is worth initial_balance / redemption_price admissions — $60 / $6 = 10 against $8 tickets, the theatre absorbing the $2 difference. Configuration, deliberately: the door scanner must never carry a hardcoded price.';

ALTER TABLE public.film_pass_types
  DROP CONSTRAINT IF EXISTS film_pass_types_redemption_price_check;

ALTER TABLE public.film_pass_types
  ADD CONSTRAINT film_pass_types_redemption_price_check
  CHECK (redemption_price > 0);

-- ---------------------------------------------------------------------------
-- 2. A pass that can exist before it belongs to anyone
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_film_passes
  ADD COLUMN IF NOT EXISTS qr_code     text,
  ADD COLUMN IF NOT EXISTS batch_id    uuid,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- A blank sticker has no owner, and a walk-in who pays cash and gives no
-- contact details never acquires one: the paper is the credential, exactly as
-- it is for cash. Attaching such a pass to the staff member who sold it is the
-- bug 20260812150000 fixed on the sale path; NULL is the honest answer.
ALTER TABLE public.user_film_passes ALTER COLUMN user_id DROP NOT NULL;

-- Balance does not exist until activation. NOT NULL would force a printed
-- blank to claim a balance of zero, which is indistinguishable from a pass
-- that has been spent to nothing.
ALTER TABLE public.user_film_passes ALTER COLUMN remaining_balance DROP NOT NULL;

-- Likewise the pass type: a blank sticker is minted for a type (that is what
-- gets printed on the sheet), so this stays NOT NULL, but the *balance* it
-- implies is only realised at activation.

COMMENT ON COLUMN public.user_film_passes.qr_code IS
  'Sticker payload, minted as PASS:<uuid>. The prefix is what lets the door scanner tell a pass from a ticket before it queries anything. UNIQUE where present; NULL only on rows predating the physical model.';

COMMENT ON COLUMN public.user_film_passes.batch_id IS
  'Groups one print run, so a sheet of stickers can be reprinted or a whole batch voided if it goes missing between the printer and the box office.';

COMMENT ON COLUMN public.user_film_passes.user_id IS
  'Whose pass this is, attached at activation. NULL for a printed blank, and NULL for a bearer pass — a walk-in who paid cash and gave no contact details holds the paper, and the paper is the credential.';

COMMENT ON COLUMN public.user_film_passes.remaining_balance IS
  'NULL until activation: an unassigned sticker holds no money. After activation, what is left to spend at redemption_price per admission.';

-- Unique where it exists. A partial index rather than a plain UNIQUE so the
-- pre-existing rows, which have no code, do not all collide on NULL — and so a
-- future backfill cannot quietly mint duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS user_film_passes_qr_code_key
  ON public.user_film_passes (qr_code)
  WHERE qr_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_film_passes_batch_id_idx
  ON public.user_film_passes (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_film_passes_status_idx
  ON public.user_film_passes (status);

-- The status vocabulary now covers two lifecycles that share a table.
--
--   Payment (from 20260812150000): pending -> active | failed | refunded
--   Physical:              unassigned -> active -> depleted | expired | void
--
-- They meet at 'active', which is the only status that is ever spendable, and
-- that is the invariant every read path filters on. The older values stay
-- because rows carrying them exist and because the online order path still
-- writes 'refunded' when a pass sale is reversed.
ALTER TABLE public.user_film_passes
  DROP CONSTRAINT IF EXISTS user_film_passes_status_check;

ALTER TABLE public.user_film_passes
  ADD CONSTRAINT user_film_passes_status_check
  CHECK (status IN (
    'unassigned', 'pending', 'active', 'depleted',
    'expired', 'void', 'failed', 'refunded'
  ));

COMMENT ON COLUMN public.user_film_passes.status IS
  'unassigned: printed, blank, worthless. active: activated at handoff and spendable. depleted: balance exhausted. expired: past expires_at. void: killed by staff (lost, stolen, misprinted). pending/failed/refunded come from the payment lifecycle. Only active is ever spendable.';

-- A new row is a blank sticker unless someone says otherwise. The old default
-- ('active') was right when the only way to create a pass was to sell one; it
-- is now the single most dangerous value to default to, because it would make
-- an accidental insert a funded pass.
ALTER TABLE public.user_film_passes ALTER COLUMN status SET DEFAULT 'unassigned';

-- ---------------------------------------------------------------------------
-- 3. Which screenings take a pass
-- ---------------------------------------------------------------------------
--
-- The rule is: standard movies yes, events and premium screenings no. Encoded
-- as a flag rather than derived from ticket_price because the intent ("this is
-- a standard screening") is not recoverable from the price — a $12 movie and
-- an $8 movie differ by a business decision, not by structure — and because a
-- derived rule would change meaning silently the next time a price moves.
--
-- The one part that *is* structural gets enforced structurally: a showing with
-- no movie is not a movie, so it can never be eligible whatever anyone sets.
-- That is the half of "eligibility drift" that can be closed for good.

ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS film_pass_eligible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.showings.film_pass_eligible IS
  'Whether a film pass may be redeemed at the door for this screening. Defaults true and is forced false for anything that is not a movie. Staff turn it off for premium screenings; the door scanner reads this flag and never re-derives intent from the price.';

CREATE OR REPLACE FUNCTION public.enforce_film_pass_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Events and live performances are never pass-eligible. This is not a policy
  -- someone should be able to fat-finger: a pass is for movies, and a showing
  -- with no movie_id has no movie.
  IF NEW.movie_id IS NULL THEN
    NEW.film_pass_eligible := false;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_film_pass_eligibility() IS
  'Forces film_pass_eligible false on any showing that is not a movie, so the "no passes at events" half of the rule cannot drift no matter what a form submits. Price-based eligibility stays a staff decision on the flag itself.';

DROP TRIGGER IF EXISTS enforce_film_pass_eligibility_trg ON public.showings;
CREATE TRIGGER enforce_film_pass_eligibility_trg
  BEFORE INSERT OR UPDATE ON public.showings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_film_pass_eligibility();

-- Backfill. Everything that is not a movie is handled by the trigger firing on
-- the UPDATE below; the price test is the one-time part. It describes the
-- shape of *today's* data — standard screenings are $8, premium ones are more
-- — and is deliberately not promoted into an ongoing rule. From here the flag
-- is set by whoever creates the showing.
-- The WHERE clause is not an optimisation: showings carries an audit trigger,
-- so an unguarded UPDATE would write an audit row for every one of the ~1,800
-- screenings in the table to record that nothing changed.
UPDATE public.showings s
SET film_pass_eligible = false
WHERE s.film_pass_eligible
  AND (
    s.movie_id IS NULL
    OR s.ticket_price > 8.00
    OR EXISTS (
      SELECT 1 FROM public.showing_price_tiers t
      WHERE t.showing_id = s.id AND t.is_active AND t.price > 8.00
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Buying online is an obligation, not a pass
-- ---------------------------------------------------------------------------
--
-- Paying online gets you a physical pass, collected or posted. Between the
-- payment and the handoff the theatre owes a pass to a named person, and that
-- debt needs somewhere to live or it gets lost — which is the failure the box
-- office would feel as "somebody paid and never got anything".

CREATE TABLE IF NOT EXISTS public.film_pass_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pass_type_id    uuid NOT NULL REFERENCES public.film_pass_types(id) ON DELETE RESTRICT,
  quantity        integer NOT NULL DEFAULT 1,
  fulfillment     text NOT NULL,
  mailing_address jsonb,
  buyer_name      text,
  buyer_email     text,
  buyer_phone     text,
  amount_paid     numeric(10,2),
  payment_method  text NOT NULL DEFAULT 'online',
  square_payment_id  text,
  square_receipt_url text,
  checkout_idempotency_key text,
  status          text NOT NULL DEFAULT 'pending',
  pass_id         uuid REFERENCES public.user_film_passes(id) ON DELETE SET NULL,
  fulfilled_at    timestamptz,
  fulfilled_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmation_sent_at timestamptz,
  confirmation_error   text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT film_pass_orders_quantity_check CHECK (quantity > 0),
  CONSTRAINT film_pass_orders_fulfillment_check CHECK (fulfillment IN ('pickup', 'mail')),
  CONSTRAINT film_pass_orders_status_check
    CHECK (status IN ('pending', 'paid', 'fulfilled', 'failed', 'void')),
  -- A posted pass with nowhere to post it is an order that cannot be filled.
  CONSTRAINT film_pass_orders_mail_needs_address
    CHECK (fulfillment <> 'mail' OR mailing_address IS NOT NULL)
);

COMMENT ON TABLE public.film_pass_orders IS
  'An online film-pass purchase: money taken, physical pass still owed. Discharged by activate_film_pass when a blank sticker is activated against it. status=paid is the box office queue — every row in it is a patron waiting for a pass.';

COMMENT ON COLUMN public.film_pass_orders.status IS
  'pending while the card is being charged, paid once it clears, fulfilled when a sticker has been activated against it. failed is a declined charge; void is a cancelled order. Only paid rows are an outstanding obligation.';

COMMENT ON COLUMN public.film_pass_orders.mailing_address IS
  'Where to post the pass, as {line1, line2, city, state, postal_code}. Posting is a manual staff task — the platform records the address and the fulfilment state, and integrates with no carrier.';

CREATE INDEX IF NOT EXISTS film_pass_orders_status_idx
  ON public.film_pass_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS film_pass_orders_user_id_idx
  ON public.film_pass_orders (user_id);

CREATE INDEX IF NOT EXISTS film_pass_orders_idempotency_key_idx
  ON public.film_pass_orders (checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

CREATE TRIGGER film_pass_orders_updated_at
  BEFORE UPDATE ON public.film_pass_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.film_pass_orders ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.film_pass_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.film_pass_orders TO service_role;

-- Staff read the queue. Nobody writes from a browser: an order is created by
-- the checkout function after Square clears, and closed by activation. A
-- client-side insert here would be a pass promised without a payment.
CREATE POLICY "Staff can view film pass orders"
  ON public.film_pass_orders FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'::app_role));

-- ---------------------------------------------------------------------------
-- 5. One admission per pass per showing
-- ---------------------------------------------------------------------------
--
-- Redemptions already record what was spent against which ticket. What they
-- could not answer is "has this pass already got someone into *this* screening"
-- — the question a second scan of the same sticker asks. Recording the showing
-- makes the double-admit guard an index rather than a race.

ALTER TABLE public.film_pass_redemptions
  ADD COLUMN IF NOT EXISTS showing_id  uuid REFERENCES public.showings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS redeemed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.film_pass_redemptions.showing_id IS
  'Which screening this admission was for. NULL on rows predating the door-scan model, which is why the uniqueness guard below is partial.';

CREATE UNIQUE INDEX IF NOT EXISTS film_pass_redemptions_pass_showing_key
  ON public.film_pass_redemptions (pass_id, showing_id)
  WHERE showing_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. A ticket that belongs to nobody
-- ---------------------------------------------------------------------------
--
-- A bearer pass admits a person who has no account, and the admission still
-- has to occupy a seat: capacity, check-in counts and the attendee sheet all
-- read tickets, so an admission that minted no ticket would be an audience
-- member the house count cannot see.
--
-- The alternative — inventing an account, or attaching the seat to the staff
-- member holding the scanner — is the mis-assignment bug in a new costume.
-- NULL is what "walked in with a paper pass" actually means.
--
-- RLS consequence, stated rather than discovered later: the SELECT policy is
-- `user_id = auth.uid() OR is_admin()`, and NULL never equals anything, so a
-- bearer ticket is readable by admins only. That is correct — there is no
-- patron account for it to belong to.

ALTER TABLE public.tickets ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN public.tickets.user_id IS
  'The account this ticket belongs to. NULL only for a bearer film-pass admission, where the paper pass is the credential and no account exists; such rows are readable by admins alone, since no auth.uid() can match NULL.';

-- ---------------------------------------------------------------------------
-- 7. Activation — a blank sticker becomes a pass
-- ---------------------------------------------------------------------------
--
-- Atomic because it is three writes that must agree: the sticker acquires an
-- owner and a balance, the order that paid for it is discharged, and both must
-- be true or neither. Doing this as three PostgREST calls from an edge function
-- leaves a window where a pass is funded but the order still reads as owed —
-- and the box office would hand out a second one.
--
-- Returns a verdict rather than raising, so the POS can say *why* a sticker was
-- refused. An exception here would reach the browser as an opaque 500.

CREATE OR REPLACE FUNCTION public.activate_film_pass(
  p_qr_code           text,
  p_order_id          uuid    DEFAULT NULL,
  p_user_id           uuid    DEFAULT NULL,
  p_pass_type_id      uuid    DEFAULT NULL,
  p_activated_by      uuid    DEFAULT NULL,
  p_payment_method    text    DEFAULT NULL,
  p_price_paid        numeric DEFAULT NULL,
  p_square_payment_id text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pass        public.user_film_passes%ROWTYPE;
  v_order       public.film_pass_orders%ROWTYPE;
  v_type        public.film_pass_types%ROWTYPE;
  v_user_id     uuid    := p_user_id;
  v_type_id     uuid    := p_pass_type_id;
  v_price_paid  numeric := p_price_paid;
  v_expires_at  timestamptz;
BEGIN
  IF p_qr_code IS NULL OR btrim(p_qr_code) = '' THEN
    RETURN jsonb_build_object('result', 'no_code');
  END IF;

  SELECT * INTO v_pass
  FROM public.user_film_passes
  WHERE qr_code = btrim(p_qr_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- Only a blank can be activated. Re-scanning an already-active sticker is
  -- the most likely mistake at a busy counter, so it gets its own verdict
  -- rather than a generic refusal.
  IF v_pass.status <> 'unassigned' THEN
    RETURN jsonb_build_object(
      'result', 'already_activated',
      'pass_id', v_pass.id,
      'status', v_pass.status,
      'remaining_balance', v_pass.remaining_balance
    );
  END IF;

  -- An order, when this is a collection or a posting, supplies the owner, the
  -- type and what was actually paid. Locked alongside the pass so two staff
  -- members cannot discharge the same order with two stickers.
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.film_pass_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('result', 'order_not_found');
    END IF;
    IF v_order.status <> 'paid' THEN
      RETURN jsonb_build_object('result', 'order_not_payable', 'order_status', v_order.status);
    END IF;

    v_user_id    := COALESCE(v_user_id, v_order.user_id);
    v_type_id    := COALESCE(v_type_id, v_order.pass_type_id);
    v_price_paid := COALESCE(
      v_price_paid,
      CASE WHEN v_order.quantity > 0
           THEN round(v_order.amount_paid / v_order.quantity, 2)
           ELSE v_order.amount_paid END
    );
  END IF;

  -- Fall back to what the sticker was printed for. A batch is minted for a
  -- type, so this is nearly always the answer already.
  v_type_id := COALESCE(v_type_id, v_pass.pass_type_id);

  SELECT * INTO v_type FROM public.film_pass_types WHERE id = v_type_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'pass_type_not_found');
  END IF;

  -- The clock starts here, not at purchase: a pass waiting in a drawer to be
  -- collected must not spend its validity being un-collected.
  v_expires_at := CASE
    WHEN v_type.expiration_days IS NULL THEN NULL
    ELSE now() + make_interval(days => v_type.expiration_days)
  END;

  UPDATE public.user_film_passes
  SET user_id           = v_user_id,
      pass_type_id      = v_type_id,
      remaining_balance = v_type.initial_balance,
      expires_at        = v_expires_at,
      status            = 'active',
      activated_at      = now(),
      activated_by      = p_activated_by,
      purchased_at      = now(),
      payment_method    = COALESCE(p_payment_method, v_pass.payment_method),
      price_paid        = COALESCE(v_price_paid, v_type.price),
      square_payment_id = COALESCE(p_square_payment_id, v_pass.square_payment_id)
  WHERE id = v_pass.id;

  IF p_order_id IS NOT NULL THEN
    UPDATE public.film_pass_orders
    SET status       = 'fulfilled',
        pass_id      = v_pass.id,
        fulfilled_at = now(),
        fulfilled_by = p_activated_by
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'result', 'activated',
    'pass_id', v_pass.id,
    'qr_code', v_pass.qr_code,
    'user_id', v_user_id,
    'pass_type_id', v_type_id,
    'pass_type_name', v_type.name,
    'remaining_balance', v_type.initial_balance,
    'redemption_price', v_type.redemption_price,
    'admissions', floor(v_type.initial_balance / v_type.redemption_price),
    'expires_at', v_expires_at,
    'order_id', p_order_id
  );
END;
$function$;

COMMENT ON FUNCTION public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text) IS
  'Turns a printed blank sticker into a funded pass and discharges the order that paid for it, in one transaction. Expiry is measured from this moment, not from purchase. Returns a verdict object (activated / not_found / already_activated / order_not_payable / ...) instead of raising, so the box office can be told what went wrong. Service role only: it is the sole way a balance comes into existence.';

REVOKE ALL ON FUNCTION public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Admission — the door scan
-- ---------------------------------------------------------------------------
--
-- Every rule the pass has lives here, on the server, because the door is where
-- the rules are actually tested and the scanner is a browser: eligibility,
-- expiry, sufficiency, and one-admission-per-showing. The client picks a
-- showing and presents a code; it decides nothing else.
--
-- The ordering matters. Nothing is deducted until the seat is minted, and the
-- seat is minted inside the same transaction as the deduction, so a sold-out
-- showing (the capacity trigger raising PT409) cannot leave a pass $6 lighter
-- with nobody admitted.

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
BEGIN
  IF p_showing_id IS NULL THEN
    RETURN jsonb_build_object('result', 'no_showing_selected');
  END IF;
  IF p_pass_code IS NULL OR btrim(p_pass_code) = '' THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

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

  -- Already through the door for this screening. Checked before expiry and
  -- balance because a second scan of a pass that just admitted someone is the
  -- common case, and "already admitted" is the useful thing to say about it.
  IF EXISTS (
    SELECT 1 FROM public.film_pass_redemptions r
    WHERE r.pass_id = v_pass.id AND r.showing_id = p_showing_id
  ) THEN
    RETURN jsonb_build_object(
      'result', 'already_admitted',
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
    'status', v_new_status
  );
END;
$function$;

COMMENT ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) IS
  'One in-person admission against a film pass: checks eligibility (a movie, flagged eligible), double-admit, expiry and balance, then mints an already-scanned ticket and deducts redemption_price — all in one transaction, so a full house rolls the deduction back with it. Returns a verdict object the door scanner renders directly. Service role only.';

REVOKE ALL ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_with_film_pass(text, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Close the browser's remaining way in
-- ---------------------------------------------------------------------------
--
-- 20260812150000 dropped the INSERT policy that let a patron mint their own
-- pass, but left UPDATE open to staff — which, now that a pass row carries a
-- spendable balance and a status the door trusts, is a way to top one up from
-- the console. Minting, activating, spending and voiding all go through the
-- service role now, so no client needs to write this table at all.

DROP POLICY IF EXISTS "Admins can update passes" ON public.user_film_passes;

CREATE POLICY "Admins can update passes"
  ON public.user_film_passes FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE INSERT, UPDATE, DELETE ON public.user_film_passes FROM authenticated;
GRANT SELECT ON public.user_film_passes TO authenticated;

-- Redemptions are written by admit_with_film_pass alone.
REVOKE INSERT, UPDATE, DELETE ON public.film_pass_redemptions FROM authenticated;
GRANT SELECT ON public.film_pass_redemptions TO authenticated;

-- The pass audit trail matters now that a sticker carries money: activation,
-- every deduction, and voiding are all worth being able to reconstruct.
--
-- UPDATE and DELETE only, deliberately. Minting a batch is a single INSERT of
-- hundreds of identical blanks; auditing it row by row would bury the events
-- that matter under a wall of "a worthless sticker was printed". Who printed
-- which batch is recorded on the rows themselves via batch_id.
DROP TRIGGER IF EXISTS audit_user_film_passes ON public.user_film_passes;
CREATE TRIGGER audit_user_film_passes
  AFTER UPDATE OR DELETE ON public.user_film_passes
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
