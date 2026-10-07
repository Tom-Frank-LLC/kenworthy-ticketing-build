-- A point person for each rental request.
--
-- Ownership of the enquiry inside the admin queue, alongside `status`. It is
-- not contract content: get_rental_request_by_token returns a fixed column
-- list, so the renter's /contract/:token page never sees it.
--
-- No new policy. "Admins update rental requests" already gates every column of
-- the row to has_role(uid, 'admin') (which superadmins pass), and the Rentals
-- tab is admin-only. Staff can read the queue but have never been able to
-- write to it, and anon holds no UPDATE grant at all.
--
-- ON DELETE SET NULL: removing someone's account unassigns their requests
-- rather than blocking the delete or deleting the request.

ALTER TABLE public.rental_requests
  ADD COLUMN IF NOT EXISTS assigned_to uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rental_requests_assigned_to_idx
  ON public.rental_requests (assigned_to)
  WHERE assigned_to IS NOT NULL;

COMMENT ON COLUMN public.rental_requests.assigned_to IS
  'Team member who owns this request in the admin queue (point person). Internal; not printed on the contract and not returned by get_rental_request_by_token.';
