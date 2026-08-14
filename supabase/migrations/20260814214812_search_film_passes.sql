-- Searching the issued-pass list, server-side.
--
-- The admin tab read `user_film_passes` directly with `.limit(50)`. That is
-- fine as a list and wrong as a search: a client-side filter over a truncated
-- page answers "no such pass" for any pass that happens to be 51st, and it
-- answers it confidently. Anything that says "search" has to see the whole
-- table, so the search has to happen where the whole table is.
--
-- Why a function and not a view: the thing being searched is not one table.
-- A pass's contact details live in up to three places —
--
--   profiles          when the pass is linked to an account
--   film_pass_orders  when it was bought online (bearer passes have no account
--                     at all, so this is the *only* contact they ever have)
--   neither           a walk-in bearer pass, which is anonymous by design
--
-- and "search by email" has to look in all of them or it will miss exactly the
-- passes hardest to find another way. Flattening that join once, in one place,
-- is the difference between a search that is complete and a search that is
-- complete-looking.
--
-- Why it returns jsonb rather than a table: the caller needs the page, the
-- total, and the count per status in one answer. Splitting the counts into a
-- second function would mean the same predicate written twice, and two copies
-- of a search predicate drift — the moment they do, the filter says "3
-- cancelled" and the list shows two, with nothing to indicate which is lying.
--
-- Note the counts are taken *before* the status filter and after the text
-- search. That is what makes them useful: they describe the search result, so
-- switching to Cancelled tells you in advance how many you will get.

CREATE OR REPLACE FUNCTION public.search_film_passes(
  p_query  text    DEFAULT NULL,
  p_status text    DEFAULT 'issued',
  p_sort   text    DEFAULT 'newest',
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- The query as typed, and the same query reduced to digits. A phone number
  -- is stored however the patron typed it — "(208) 555-1234" — and searched
  -- however the staff member types it, which is rarely the same way. Comparing
  -- digits-to-digits is the only version of "search by phone" that works.
  v_text   text    := NULLIF(btrim(COALESCE(p_query, '')), '');
  v_digits text    := NULLIF(regexp_replace(COALESCE(p_query, ''), '\D', '', 'g'), '');
  v_status text    := COALESCE(NULLIF(btrim(COALESCE(p_status, '')), ''), 'issued');
  v_sort   text    := COALESCE(NULLIF(btrim(COALESCE(p_sort, '')), ''), 'newest');
  -- Clamped rather than trusted: this is reachable from a browser, and an
  -- unbounded limit is a way to ask the database to serialise the whole table.
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  -- Staff may look; the tab this serves is admin-only, but the box office has
  -- the same legitimate "where is this person's pass" question, and refusing
  -- it here would only push that lookup somewhere less careful.
  IF NOT (
    public.has_role(auth.uid(), 'staff'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Staff access required'
      USING ERRCODE = '42501';
  END IF;

  WITH flat AS (
    SELECT
      p.id,
      p.pass_number,
      p.qr_code,
      p.status,
      p.remaining_balance,
      p.payment_method,
      p.purchased_at,
      p.activated_at,
      p.expires_at,
      p.user_id,
      pt.name        AS pass_type_name,
      pr.display_name AS holder_name,
      pr.email        AS holder_email,
      pr.phone        AS holder_phone,
      o.buyer_name,
      o.buyer_email,
      o.buyer_phone,
      -- Surfaced on every row because the delete confirmation needs it, and
      -- fetching it per-click would mean a second round trip at the exact
      -- moment the answer has to be in front of the person deciding.
      (
        SELECT count(*)
        FROM public.film_pass_redemptions r
        WHERE r.pass_id = p.id
      ) AS redemption_count
    FROM public.user_film_passes p
    LEFT JOIN public.film_pass_types pt ON pt.id = p.pass_type_id
    LEFT JOIN public.profiles pr        ON pr.id = p.user_id
    LEFT JOIN LATERAL (
      -- One order per pass in the normal case; ordered anyway so that a pass
      -- re-linked after a correction reports its current buyer, not its first.
      SELECT fo.buyer_name, fo.buyer_email, fo.buyer_phone
      FROM public.film_pass_orders fo
      WHERE fo.pass_id = p.id
      ORDER BY fo.created_at DESC
      LIMIT 1
    ) o ON true
  ),
  matched AS (
    SELECT *
    FROM flat
    WHERE
      v_text IS NULL
      OR qr_code     ILIKE '%' || v_text || '%'
      OR holder_name ILIKE '%' || v_text || '%'
      OR holder_email ILIKE '%' || v_text || '%'
      OR buyer_name  ILIKE '%' || v_text || '%'
      OR buyer_email ILIKE '%' || v_text || '%'
      OR (
        v_digits IS NOT NULL
        AND (
          -- Prefix, not substring. Numbers start at 1000, so every pass in
          -- circulation contains a "1" — a contains-match on the number would
          -- return the whole table for a one-digit query and look broken.
          -- A prefix means typing 104 narrows to 1040-1049, which is what
          -- somebody half-reading a scuffed sticker actually wants.
          pass_number::text LIKE v_digits || '%'
          -- Digits-only on both sides, so formatting cannot hide a match.
          -- A NULL phone collapses to '' here, and '' LIKE '%2085551234%' is
          -- false, so no NULL guard is needed.
          OR regexp_replace(COALESCE(holder_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
          OR regexp_replace(COALESCE(buyer_phone, ''), '\D', '', 'g')  LIKE '%' || v_digits || '%'
        )
      )
  ),
  counts AS (
    SELECT m.status, count(*) AS n
    FROM matched m
    GROUP BY m.status
  ),
  filtered AS (
    SELECT *
    FROM matched
    WHERE
      -- 'issued' is the default view and hides blanks: a print run of 300
      -- stickers would otherwise bury every real pass. 'all' opts back in,
      -- and any concrete status selects just that one.
      (v_status = 'issued' AND status <> 'unassigned')
      OR v_status = 'all'
      OR status = v_status
  ),
  page AS (
    SELECT
      f.*,
      row_number() OVER (
        ORDER BY
          -- One live branch per sort key. Written as guarded CASE arms rather
          -- than assembled into dynamic SQL: the sort key arrives from a
          -- browser, and a whitelist that is the query itself cannot be got
          -- around. Each arm is a single type, so nothing here needs a cast.
          CASE WHEN v_sort = 'newest'       THEN f.purchased_at END DESC NULLS LAST,
          CASE WHEN v_sort = 'oldest'       THEN f.purchased_at END ASC  NULLS LAST,
          CASE WHEN v_sort = 'expiring'     THEN f.expires_at END        ASC  NULLS LAST,
          CASE WHEN v_sort = 'balance_desc' THEN f.remaining_balance END DESC NULLS LAST,
          CASE WHEN v_sort = 'balance_asc'  THEN f.remaining_balance END ASC  NULLS LAST,
          CASE WHEN v_sort = 'name'
               THEN lower(NULLIF(COALESCE(f.holder_name, f.buyer_name, ''), '')) END ASC NULLS LAST,
          CASE WHEN v_sort = 'number'       THEN f.pass_number END       ASC  NULLS LAST,
          -- Total order, so paging cannot show or skip a row twice when the
          -- chosen key ties.
          f.purchased_at DESC,
          f.id
      ) AS rn,
      count(*) OVER () AS total
    FROM filtered f
  )
  SELECT jsonb_build_object(
    -- How many match the search *and* the status filter — the number the
    -- "showing 50 of N" line is about.
    'total', COALESCE((SELECT max(total) FROM page), 0),
    'counts', COALESCE((SELECT jsonb_object_agg(status, n) FROM counts), '{}'::jsonb),
    'passes', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id,
            'pass_number', pass_number,
            'qr_code', qr_code,
            'status', status,
            'remaining_balance', remaining_balance,
            'payment_method', payment_method,
            'purchased_at', purchased_at,
            'activated_at', activated_at,
            'expires_at', expires_at,
            'user_id', user_id,
            'pass_type_name', pass_type_name,
            'holder_name', holder_name,
            'holder_email', holder_email,
            'holder_phone', holder_phone,
            'buyer_name', buyer_name,
            'buyer_email', buyer_email,
            'buyer_phone', buyer_phone,
            'redemption_count', redemption_count
          )
          -- jsonb_agg makes no promise about input order on its own; the
          -- row number does, and the ordering above is the whole point of a
          -- sort control.
          ORDER BY rn
        )
        FROM page
        WHERE rn > v_offset AND rn <= v_offset + v_limit
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.search_film_passes(text, text, text, integer, integer) IS
  'Admin/box-office pass search across pass number, QR code, and holder or buyer '
  'name/email/phone. Returns {total, counts, passes}; counts are per status over '
  'the text-matched set, before the status filter.';

-- Postgres grants EXECUTE to PUBLIC by default, and this function reads every
-- patron's contact details under the definer's rights. The role check inside
-- is the real gate, but an anon role that cannot call it at all is one fewer
-- thing depending on that check being right.
REVOKE ALL ON FUNCTION public.search_film_passes(text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_film_passes(text, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_film_passes(text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_film_passes(text, text, text, integer, integer) TO service_role;

-- Search touches these columns on every keystroke-debounced call.
CREATE INDEX IF NOT EXISTS film_pass_orders_pass_id_idx
  ON public.film_pass_orders (pass_id)
  WHERE pass_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS film_pass_redemptions_pass_id_idx
  ON public.film_pass_redemptions (pass_id);
