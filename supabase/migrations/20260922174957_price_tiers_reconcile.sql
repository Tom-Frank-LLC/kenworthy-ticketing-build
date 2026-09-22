-- Price tiers: one live row per name, and a writer that never deletes a tier
-- a ticket points at.
--
-- The bug this fixes: deleting a tier in the showing form and saving left the
-- showing with DUPLICATE tiers. Both writers (ShowingForm, SeatTierEditor)
-- deleted every tier for the showing and reinserted the survivors, and neither
-- checked the delete's result. tickets.tier_id REFERENCES showing_price_tiers(id)
-- with no ON DELETE, so the moment one ticket had sold against a tier, the
-- delete raised 23503, the form swallowed it, and the insert APPENDED a second
-- copy of every tier. Each save added another. Production's Paragon Ragtime
-- showing reached General Admission ×4 / Preferred Seating ×3 this way, and the
-- row dates show it started on 9 Sep — before the discount work it was blamed
-- on. See docs/FINDINGS-duplicate-price-tiers.md.
--
-- Delete-then-insert is therefore the wrong shape once anything sells: a tier
-- that a ticket references must be kept, and the readers already know how to
-- keep it out of the way — the patron page, the POS, the Square variation
-- planner and price_ticket_order all ignore is_active = false. So the writer
-- becomes a reconcile: match by name, update in place, INSERT what is new,
-- DELETE what is gone and unreferenced, DEACTIVATE what is gone and referenced.
--
-- Four parts:
--   1. Repair the duplicates that exist.
--   2. A partial unique index: one LIVE tier per (showing, name). Partial rather
--      than total because a removed tier that tickets reference stays as an
--      inactive row, and its name may legitimately be re-added later.
--   3. The no-ticket trigger stops refusing the deactivation of a priced tier —
--      an inactive tier sells nothing, so it is not "a priced tier".
--   4. set_showing_price_tiers(), the one writer, atomic and admin-gated.

-- 1 -------------------------------------------------------------------------
-- Keep the oldest row per (showing, name) — the one most tickets reference and
-- the one the Square variation was first planned from. Of the extras, delete
-- what no ticket references and deactivate the rest. Seat assignments are
-- repointed first: SeatTierEditor mapped seats to the NEWEST insert, and
-- showing_seat_tiers.tier_id cascades on delete, so deleting an extra without
-- this would take a painted seat map with it.
--
-- Sequential statements rather than one WITH: data-modifying CTEs share a
-- snapshot, so a delete in the same statement could not see the repoint.
CREATE TEMP TABLE tier_extras AS
  SELECT id, keep_id FROM (
    SELECT id,
           first_value(id) OVER w AS keep_id,
           row_number()    OVER w AS rn
    FROM public.showing_price_tiers
    WINDOW w AS (PARTITION BY showing_id, lower(btrim(tier_name))
                 ORDER BY is_active DESC, created_at, display_order, id)
  ) ranked
  WHERE rn > 1;

UPDATE public.showing_seat_tiers st SET tier_id = x.keep_id
  FROM tier_extras x
 WHERE st.tier_id = x.id;

DELETE FROM public.showing_price_tiers t
 USING tier_extras x
 WHERE t.id = x.id
   AND NOT EXISTS (SELECT 1 FROM public.tickets k WHERE k.tier_id = t.id);

UPDATE public.showing_price_tiers t SET is_active = false
  FROM tier_extras x
 WHERE t.id = x.id AND t.is_active;

DROP TABLE tier_extras;

-- 2 -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS showing_price_tiers_one_live_name
  ON public.showing_price_tiers (showing_id, lower(btrim(tier_name)))
  WHERE is_active;

COMMENT ON INDEX public.showing_price_tiers_one_live_name IS
  'A showing offers each tier name once. Partial (live rows only) because a removed tier that tickets reference is kept as an inactive row, and its name may be offered again later. lower(btrim()) so "Adult" and "adult " cannot both be on sale.';

-- 3 -------------------------------------------------------------------------
-- Same rule as 20260827113402, narrowed to live rows. Without this, flipping a
-- showing to walk-in after a $50 tier had sold would be refused at the
-- deactivation — the very statement that makes the flag true.
CREATE OR REPLACE FUNCTION public.enforce_no_tier_on_no_ticket_showing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_active
     AND COALESCE(NEW.price, 0) > 0
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
  'Refuses a LIVE priced showing_price_tiers row for a showing flagged no_ticket_required. Inactive rows pass: they sell nothing, and deactivating a sold tier is how a showing becomes walk-in. Deliberately one-directional — the showings side is not guarded, because ShowingForm writes the showing row before it reconciles tiers.';

-- 4 -------------------------------------------------------------------------
-- The one writer. p_tiers is the form's list in display order:
--   [{ "tier_name": "Adult", "price": 8, "color": "#9C3FA0" }, ...]
-- color is optional; an omitted color keeps the row's existing one.
-- Returns the showing's live tiers afterwards, ids included, so the seat
-- editor can map seats onto them.
--
-- SECURITY DEFINER with its own admin check, the same shape as
-- create_ticket_order: the table's RLS is admin-gated and this is the same
-- gate, but a definer function can also read tickets (which staff cannot) to
-- decide delete-versus-deactivate, and runs as one transaction — two client
-- requests were never atomic, which is how a double-clicked Save could
-- interleave.
CREATE OR REPLACE FUNCTION public.set_showing_price_tiers(
  p_showing_id uuid,
  p_tiers jsonb
) RETURNS SETOF public.showing_price_tiers
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  i integer;
  v_name text;
  v_price numeric;
  v_color text;
  v_id uuid;
  v_keep uuid[] := '{}';
  v_seen text[] := '{}';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_tiers IS NULL OR jsonb_typeof(p_tiers) <> 'array' THEN
    RAISE EXCEPTION 'p_tiers must be a JSON array of tiers' USING ERRCODE = 'PT400';
  END IF;

  -- One save at a time per showing. A second Save landing mid-reconcile would
  -- otherwise see a half-written list.
  PERFORM 1 FROM public.showings WHERE id = p_showing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such showing' USING ERRCODE = 'PT404';
  END IF;

  FOR i IN 0 .. jsonb_array_length(p_tiers) - 1 LOOP
    v_name := btrim(COALESCE(p_tiers -> i ->> 'tier_name', ''));
    IF v_name = '' THEN
      RAISE EXCEPTION 'Every tier needs a name' USING ERRCODE = 'PT400';
    END IF;
    IF lower(v_name) = ANY (v_seen) THEN
      RAISE EXCEPTION 'Two tiers are named "%"', v_name USING ERRCODE = 'PT400';
    END IF;
    v_seen := v_seen || lower(v_name);

    BEGIN
      v_price := (p_tiers -> i ->> 'price')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_price := NULL;
    END;
    IF v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Tier "%" needs a price of 0 or more', v_name USING ERRCODE = 'PT400';
    END IF;
    v_color := NULLIF(btrim(COALESCE(p_tiers -> i ->> 'color', '')), '');

    -- The live row of that name if there is one, else the oldest retired one
    -- (re-adding "Student" revives the row its old tickets point at).
    SELECT id INTO v_id FROM public.showing_price_tiers
     WHERE showing_id = p_showing_id AND lower(btrim(tier_name)) = lower(v_name)
     ORDER BY is_active DESC, created_at, id
     LIMIT 1;

    IF FOUND THEN
      UPDATE public.showing_price_tiers
         SET tier_name = v_name,
             price = v_price,
             color = COALESCE(v_color, color),
             display_order = i,
             is_active = true
       WHERE id = v_id;
    ELSE
      INSERT INTO public.showing_price_tiers (showing_id, tier_name, price, color, display_order, is_active)
      VALUES (p_showing_id, v_name, v_price, COALESCE(v_color, '#9C3FA0'), i, true)
      RETURNING id INTO v_id;
    END IF;
    v_keep := v_keep || v_id;
  END LOOP;

  -- Everything the admin removed. Gone outright when nothing points at it;
  -- retired when a ticket does, because that ticket's tier_id has to keep
  -- resolving on the receipt, the door scanner and the box-office report.
  DELETE FROM public.showing_price_tiers t
   WHERE t.showing_id = p_showing_id
     AND NOT (t.id = ANY (v_keep))
     AND NOT EXISTS (SELECT 1 FROM public.tickets k WHERE k.tier_id = t.id);

  UPDATE public.showing_price_tiers t
     SET is_active = false
   WHERE t.showing_id = p_showing_id
     AND NOT (t.id = ANY (v_keep))
     AND t.is_active;

  RETURN QUERY
    SELECT * FROM public.showing_price_tiers
     WHERE showing_id = p_showing_id AND is_active
     ORDER BY display_order, created_at;
END;
$function$;

COMMENT ON FUNCTION public.set_showing_price_tiers(uuid, jsonb) IS
  'The only writer of showing_price_tiers. Reconciles the showing''s tiers to p_tiers by name: updates in place, inserts new names, deletes removed tiers nothing references and deactivates removed tiers a ticket references. Returns the live tiers. Admin only.';

REVOKE ALL ON FUNCTION public.set_showing_price_tiers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_showing_price_tiers(uuid, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
