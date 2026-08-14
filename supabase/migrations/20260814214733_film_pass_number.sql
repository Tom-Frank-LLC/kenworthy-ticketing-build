-- A pass gets a short number a human can read out.
--
-- Until now the only identifier a pass carried was its qr_code, `PASS:<uuid>`.
-- That is the right thing for a scanner and the wrong thing for everything
-- else: "look up pass 1042" is a sentence someone can say down a phone, and
-- "look up pass PASS:9f3c1a2e-..." is not. The admin search is the immediate
-- reason, but the same number is what makes a lost-pass conversation at the
-- counter possible at all.
--
-- Why a sequence and not a random short code: the number is an ordinal, not a
-- secret. It is printed on the sticker in plain sight and it authorises
-- nothing — the qr_code stays the unguessable half, and every write path
-- (activate, admit, void) still keys off that. Anyone who can read a pass
-- number off a sticker is already holding the sticker. Making it sequential
-- buys collision-freedom for nothing and lets a batch print in order, which is
-- how a box of stickers gets filed.
--
-- Why it is assigned at mint rather than at activation: the number has to be
-- on the printed sticker, and printing happens before anybody owns the pass.
-- A number assigned at activation would never reach the paper.
--
-- Numbering starts at 1000 so every pass in circulation has four digits. A
-- run that starts at 1 produces "pass 7", which reads like a quantity rather
-- than an identifier, and staff transcribing it get no length cue that they
-- have written down all of it.

ALTER TABLE public.user_film_passes
  ADD COLUMN IF NOT EXISTS pass_number integer;

COMMENT ON COLUMN public.user_film_passes.pass_number IS
  'Short human-readable pass number, printed on the sticker. Assigned at mint. '
  'An identifier only — it grants nothing, and qr_code remains the secret half.';

CREATE SEQUENCE IF NOT EXISTS public.film_pass_number_seq
  AS integer
  START WITH 1000
  OWNED BY public.user_film_passes.pass_number;

-- Backfill in the order the rows were created, so the existing stock numbers
-- the way a future print run will.
--
-- Deliberately not `UPDATE ... FROM (SELECT ... ORDER BY) ... nextval()`:
-- Postgres does not promise an UPDATE visits its source rows in the subquery's
-- order, so that spelling assigns *some* permutation of the numbers rather than
-- the one intended, and it does so without failing. row_number() over an
-- explicit ordering is the version that means what it says.
DO $$
DECLARE
  v_next integer;
BEGIN
  WITH ordered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM public.user_film_passes
    WHERE pass_number IS NULL
  )
  UPDATE public.user_film_passes p
  SET pass_number = 999 + ordered.rn
  FROM ordered
  WHERE p.id = ordered.id;

  -- Park the sequence past whatever the backfill used, so the first minted
  -- sticker continues the run instead of colliding with it.
  SELECT COALESCE(MAX(pass_number), 999) + 1 INTO v_next
  FROM public.user_film_passes;

  PERFORM setval('public.film_pass_number_seq', v_next, false);
END $$;

ALTER TABLE public.user_film_passes
  ALTER COLUMN pass_number SET DEFAULT nextval('public.film_pass_number_seq');

ALTER TABLE public.user_film_passes
  ALTER COLUMN pass_number SET NOT NULL;

-- Unique because the number is what staff will type. Two passes answering to
-- 1042 turns a lookup into a guess.
CREATE UNIQUE INDEX IF NOT EXISTS user_film_passes_pass_number_key
  ON public.user_film_passes (pass_number);

-- The sequence is driven by the column default, which fires as the service
-- role during a mint. Nobody else needs to advance it, and handing anon or
-- authenticated a nextval() would let a browser burn numbers out of the run.
REVOKE ALL ON SEQUENCE public.film_pass_number_seq FROM PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE public.film_pass_number_seq TO service_role;
