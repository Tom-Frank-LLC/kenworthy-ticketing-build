-- The public rental form no longer writes to this table directly.
--
-- `anon` held INSERT on rental_requests, gated by a WITH CHECK that forbids a
-- submitter forging the signature, admin-notes and Square-invoice columns. That
-- policy is correct about *what* may be written and silent about *how often*:
-- twelve scripted inserts in a row were accepted on staging, all 201, with
-- nothing to solve and nothing to slow them down.
--
-- The submission now goes through the `rental-request` edge function, which
-- verifies a Cloudflare Turnstile token, allowlists the columns rather than
-- denying a list of them, bounds the free text, and writes as service_role.
-- This migration is the half that makes that mandatory instead of merely
-- available: with the grant gone, posting straight to PostgREST as anon fails,
-- so the bot check cannot be walked around by skipping the page that renders it.
--
-- ---------------------------------------------------------------------------
-- Deploy order matters here
-- ---------------------------------------------------------------------------
--
--   1. deploy the `rental-request` function
--   2. deploy the frontend
--   3. apply this migration
--
-- Applied before step 1 this takes the public rental form offline, because the
-- browser's insert starts failing with nothing yet standing in for it. The
-- reverse order is safe at every point: the function works while the old grant
-- is still there, and revoking it afterwards is what closes the bypass.
--
-- ---------------------------------------------------------------------------
-- What is deliberately left in place
-- ---------------------------------------------------------------------------
--
-- The "Anyone can submit rental requests" policy is NOT dropped. A policy is
-- only reachable through a grant, so with the grant revoked it is already
-- inert — and leaving it means that if the grant is ever restored by accident
-- (a blanket GRANT across the schema has done exactly this here before, in
-- 20260810165116), the column protections come back with it rather than the
-- table being wide open. Defence in depth costs nothing to keep.
--
-- service_role is untouched: that is the edge function's own access, and it is
-- how the row now gets written at all.

REVOKE INSERT ON public.rental_requests FROM anon;
REVOKE INSERT ON public.rental_requests FROM authenticated;

COMMENT ON TABLE public.rental_requests IS
  'Venue rental enquiries. Public submissions arrive through the rental-request edge function (Turnstile-verified, column-allowlisted, written as service_role) — anon and authenticated deliberately hold no INSERT grant, so the browser cannot write here directly. Staff read and manage these through the admin listing.';
