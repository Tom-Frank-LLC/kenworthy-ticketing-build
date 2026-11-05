-- A host sees their production's executed rental contract on /host.
-- docs/briefs/BRIEF-host-magic-link-view.md ("Dashboard details and the contract")
--
-- Until now nothing connected a production to the rental request it came from.
-- rental_requests.linked_event_id has existed since the first schema, but only
-- for events, nothing in the app read or wrote it, and it was empty on staging.
-- A rental is as often a live performance or a film as an "event", so the link
-- becomes one of three, like host_event_assignments.
--
-- 1. rental_requests.linked_live_performance_id / linked_movie_id, beside the
--    existing linked_event_id. At most one is set, and a production is linked
--    to at most one request, so "this production's contract" has one answer.
-- 2. set_production_contract(): admin only, the one way the Hosts tab sets the
--    link. Admin only because UPDATE on rental_requests is admin only; the
--    function runs as the caller, so that policy is what decides.
-- 3. host_production_contracts(): a host reads, for their own productions,
--    whether the contract is signed, when and by whom, and the archived PDF's
--    path. Hosts cannot read rental_requests (it holds the renter's contact
--    details, admin notes and the invite_token), so this is a narrow function,
--    like host_attendees().
-- 4. signed-contracts bucket: a host may read the signed PDF of their own
--    production's contract, and no other object.
--
-- Host access goes through can_host_read (20261105025356): an emailed-link
-- (aal1) session of a host-only account passes; host plus a privileged role
-- still needs its code. Reading a contract is a read, like the sales figures.

-- ---------------------------------------------------------------------------
-- 1. The link
-- ---------------------------------------------------------------------------
ALTER TABLE public.rental_requests
  ADD COLUMN IF NOT EXISTS linked_live_performance_id uuid
    REFERENCES public.live_performances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_movie_id uuid
    REFERENCES public.movies(id) ON DELETE SET NULL;

ALTER TABLE public.rental_requests
  ADD CONSTRAINT rental_requests_one_linked_production
  CHECK (num_nonnulls(linked_event_id, linked_live_performance_id, linked_movie_id) <= 1);

-- One request per production. If an existing row breaks this, the migration
-- stops here, loudly, rather than leaving a production with two contracts.
CREATE UNIQUE INDEX IF NOT EXISTS rental_requests_linked_event_once
  ON public.rental_requests (linked_event_id) WHERE linked_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rental_requests_linked_live_performance_once
  ON public.rental_requests (linked_live_performance_id) WHERE linked_live_performance_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rental_requests_linked_movie_once
  ON public.rental_requests (linked_movie_id) WHERE linked_movie_id IS NOT NULL;

COMMENT ON COLUMN public.rental_requests.linked_event_id IS
  'The production this rental became, when it is an event. At most one of the three linked_* columns is set. Set from Admin → Hosts (set_production_contract); its host sees this request''s signed contract on /host.';
COMMENT ON COLUMN public.rental_requests.linked_live_performance_id IS
  'As linked_event_id, for a live performance.';
COMMENT ON COLUMN public.rental_requests.linked_movie_id IS
  'As linked_event_id, for a film.';

-- ---------------------------------------------------------------------------
-- 2. Setting it
-- ---------------------------------------------------------------------------
-- p_kind is 'event' | 'live_performance' | 'movie' (the Hosts tab's keys).
-- p_request_id NULL unlinks the production. Linking a request moves it: it is
-- cleared from whatever it pointed at before, and whatever request pointed at
-- this production is cleared too.
CREATE OR REPLACE FUNCTION public.set_production_contract(p_kind text, p_production_id uuid, p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an admin can link a rental contract' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('event', 'live_performance', 'movie') OR p_production_id IS NULL THEN
    RAISE EXCEPTION 'Unknown production kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  UPDATE public.rental_requests
     SET linked_event_id = NULL, linked_live_performance_id = NULL, linked_movie_id = NULL
   WHERE (p_kind = 'event' AND linked_event_id = p_production_id)
      OR (p_kind = 'live_performance' AND linked_live_performance_id = p_production_id)
      OR (p_kind = 'movie' AND linked_movie_id = p_production_id)
      OR id = p_request_id;

  IF p_request_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.rental_requests
     SET linked_event_id            = CASE WHEN p_kind = 'event' THEN p_production_id END,
         linked_live_performance_id = CASE WHEN p_kind = 'live_performance' THEN p_production_id END,
         linked_movie_id            = CASE WHEN p_kind = 'movie' THEN p_production_id END
   WHERE id = p_request_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- An RLS-refused UPDATE changes nothing and raises nothing. Say so.
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Rental request % was not linked', p_request_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. What a host reads
-- ---------------------------------------------------------------------------
-- Every linked request of a production the caller may read as host (or, for
-- staff, every linked request). Signed or not: an unsigned one lets the
-- dashboard say "not signed yet" rather than nothing at all.
CREATE OR REPLACE FUNCTION public.host_production_contracts()
RETURNS TABLE (
  request_id uuid,
  event_id uuid,
  live_performance_id uuid,
  movie_id uuid,
  signed boolean,
  signed_at timestamptz,
  signed_by_name text,
  signed_pdf_path text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.id, r.linked_event_id, r.linked_live_performance_id, r.linked_movie_id,
         r.signed_pdf_sha256 IS NOT NULL, r.signed_at, r.signed_by_name, r.signed_pdf_path
    FROM public.rental_requests r
   WHERE num_nonnulls(r.linked_event_id, r.linked_live_performance_id, r.linked_movie_id) = 1
     -- has_role 'staff' is true for admin and superadmin too.
     AND (public.has_role(auth.uid(), 'staff')
          OR public.can_host_read(auth.uid(), r.linked_event_id, r.linked_live_performance_id, r.linked_movie_id));
$$;

-- ---------------------------------------------------------------------------
-- 4. The signed PDF
-- ---------------------------------------------------------------------------
-- True when _name is the archived signed PDF of a request linked to a
-- production the caller hosts. Only the latest signing's file is named on the
-- request, so an earlier signing's file stays staff only.
CREATE OR REPLACE FUNCTION public.can_host_read_signed_contract(_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rental_requests r
     WHERE r.signed_pdf_path = _name
       AND public.can_host_read(auth.uid(), r.linked_event_id, r.linked_live_performance_id, r.linked_movie_id)
  );
$$;

CREATE POLICY "Hosts read their production's signed contract"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'signed-contracts' AND public.can_host_read_signed_contract(name));

REVOKE ALL ON FUNCTION public.set_production_contract(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.host_production_contracts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_host_read_signed_contract(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_production_contract(text, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.host_production_contracts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_host_read_signed_contract(text) TO authenticated, service_role;
