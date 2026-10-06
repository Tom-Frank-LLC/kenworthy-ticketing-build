-- Identity is auth.users, and a session is not a role.
-- Security audit 2026-10-06, findings H1 and M1 (docs/AUDIT-security-2026-10-06.md).
--
-- The premise this repairs: "authenticated means staff". It stopped being true
-- when checkout began minting a confirmed auth account for every guest buyer
-- (_shared/buyers.ts). Any of those buyers could take "Forgot password?" on /auth
-- and hold a real session. With that session they could PATCH their own
-- profiles.email / phone, and two server paths trusted profiles.email as
-- identity: buyer resolution (ticket and pass theft) and invite-staff
-- (escalation to admin, by pre-claiming an address an admin would later invite).
--
-- What this migration does:
--   1. profiles.email is re-derived from auth.users.email, now and on every
--      change. It is a display copy, never an identity.
--   2. `authenticated` loses table-wide UPDATE on profiles. It keeps UPDATE on
--      the columns a client legitimately writes, which is none of email, phone
--      or signer_title.
--   3. A unique index on lower(profiles.email), created only if the data allows
--      it, so this migration cannot fail on production data.
--   4. Service-role-only lookups on auth.users for buyer and invitee resolution.
--   5. M1: role gates where "has a session" was standing in for "is staff":
--      apply_production_template_to_showing, shift_requests, dvd_rentals.
--   6. An inert Custom Access Token hook function that refuses to issue a token
--      to an account with no staff/host/admin/superadmin role. It does nothing
--      until it is switched on in Auth -> Hooks (see the brief: that is a manual
--      dashboard step, and it is deliberately not done here).

-- ---------------------------------------------------------------------------
-- 1. profiles.email follows auth.users.email
-- ---------------------------------------------------------------------------

-- Repair any copy that has drifted. A drifted row is either a stale copy (an
-- email change in auth that never reached profiles) or the H1 primitive having
-- been used. The audit_profiles trigger records each change with the old value,
-- so this repair also leaves the evidence of any tampering in admin_audit_log.
DO $$
DECLARE
  v_fixed integer;
BEGIN
  UPDATE public.profiles p
     SET email = u.email
    FROM auth.users u
   WHERE u.id = p.id
     AND p.email IS DISTINCT FROM u.email;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'profiles.email re-derived from auth.users on % row(s)', v_fixed;
END $$;

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET email = NEW.email
   WHERE id = NEW.id
     AND email IS DISTINCT FROM NEW.email;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- ---------------------------------------------------------------------------
-- 2. Column-scoped UPDATE on profiles
-- ---------------------------------------------------------------------------
-- Every client write to profiles, found by grep across src/ and
-- supabase/functions/ on 2026-10-06:
--   src/pages/Profile.tsx        display_name, marketing_opt_in (phone removed
--                                in the same change -- see below)
--   src/pages/Auth.tsx           marketing_opt_in (signup path, member accounts off)
--   src/lib/mailchimp.ts         mailchimp_synced_at, mailchimp_ltv_tickets,
--                                mailchimp_ltv_donations, mailchimp_last_purchase_at,
--                                mailchimp_fav_genre
-- Edge functions write profiles as service_role (buyers.ts phone, the
-- mailchimp-webhook opt-in flag) and are unaffected by this grant.
--
-- Not granted, on purpose:
--   email         identity-adjacent; follows auth.users (section 1).
--   phone         read by buyer resolution and by delivery as a contact of
--                 record. A self-asserted number is not a verified one.
--   signer_title  printed on rental contracts as the Kenworthy signatory's title.
--   id, created_at, mailchimp_interest_ids: no client writes them.
-- updated_at is set by the update_profiles_updated_at trigger, which does not
-- need a column privilege.
REVOKE UPDATE ON public.profiles FROM authenticated, anon, PUBLIC;
GRANT UPDATE (
  display_name,
  marketing_opt_in,
  mailchimp_synced_at,
  mailchimp_ltv_tickets,
  mailchimp_ltv_donations,
  mailchimp_last_purchase_at,
  mailchimp_fav_genre
) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. One profile per address, if the data allows it
-- ---------------------------------------------------------------------------
-- After section 1, profiles.email is a copy of auth.users.email, which auth
-- keeps unique case-sensitively. The only duplicates left can be case variants
-- of one address on two accounts. If any exist the index is skipped with a
-- NOTICE instead of failing the migration: deciding which of two real accounts
-- keeps an address is a human merge, not something to do inside a deploy. The
-- brief has the read-only query that finds them and the follow-up.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT lower(email) FROM public.profiles
     WHERE email IS NOT NULL
     GROUP BY lower(email)
    HAVING count(*) > 1
  ) d;

  IF v_dupes = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_unique
      ON public.profiles (lower(email)) WHERE email IS NOT NULL;
    RAISE NOTICE 'profiles_email_lower_unique created';
  ELSE
    RAISE NOTICE 'profiles_email_lower_unique NOT created: % address(es) are held by more than one profile', v_dupes;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Identity lookups on auth.users, for edge functions only
-- ---------------------------------------------------------------------------
-- buyers.ts used to ask profiles first "because it is one indexed lookup". The
-- property worth keeping is one round trip instead of a paged listUsers scan;
-- the source has to be auth.users. These are service_role-only: an anon or
-- signed-in caller who could run them would have an account-existence oracle.

CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Auth stores addresses lower-cased; the lower() on the column covers any
  -- older mixed-case row. When both a case variant and the exact form exist,
  -- the exact form wins, then the oldest account, so the answer is stable.
  SELECT u.id
    FROM auth.users u
   WHERE lower(u.email) = lower(btrim(p_email))
     AND btrim(coalesce(p_email, '')) <> ''
     AND u.deleted_at IS NULL
   ORDER BY (u.email = lower(btrim(p_email))) DESC, u.created_at, u.id
   LIMIT 1
$$;

-- Phone is not a verified identity: anyone can type any number at checkout,
-- and the first checkout to use a number owns it in auth. So this match is
-- deliberately narrow:
--   * auth.users.phone only, never profiles.phone (which a session could write);
--   * never an account holding staff, host, admin or superadmin -- those can
--     sign in, so attaching a stranger's order to one would hand them its QR
--     codes;
--   * digits-only comparison, because auth stores E.164 without the '+'.
-- buyers.ts additionally uses it only when the buyer gave no email at all.
CREATE OR REPLACE FUNCTION public.auth_user_id_by_phone(p_phone text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
    FROM auth.users u
   WHERE regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') <> ''
     AND regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')
         = regexp_replace(p_phone, '\D', '', 'g')
     AND u.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles r
        WHERE r.user_id = u.id
          AND r.role IN ('staff', 'host', 'admin', 'superadmin')
     )
   ORDER BY u.created_at, u.id
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auth_user_id_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_phone(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. M1: role gates, not session gates
-- ---------------------------------------------------------------------------

-- 5a. apply_production_template_to_showing. Its one caller is
-- src/pages/admin/ShowingForm.tsx, behind <AdminOnly>, right after an admin
-- inserts a showing. It writes showing_price_tiers and showing_seat_tiers, whose
-- own write policies are admin-only, and the sibling RPC set_showing_price_tiers
-- already refuses non-admins with this exact error. Body otherwise unchanged
-- from 20260617060311.
CREATE OR REPLACE FUNCTION public.apply_production_template_to_showing(p_showing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_show RECORD;
  v_prod_type text;
  v_prod_id uuid;
  v_template RECORD;
  v_new_tier_id uuid;
  v_mapping jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT movie_id, event_id, live_performance_id INTO v_show
  FROM public.showings WHERE id = p_showing_id;

  IF v_show.movie_id IS NOT NULL THEN
    v_prod_type := 'movie'; v_prod_id := v_show.movie_id;
  ELSIF v_show.event_id IS NOT NULL THEN
    v_prod_type := 'event'; v_prod_id := v_show.event_id;
  ELSIF v_show.live_performance_id IS NOT NULL THEN
    v_prod_type := 'concert'; v_prod_id := v_show.live_performance_id;
  ELSE
    RETURN;
  END IF;

  -- Only seed if showing has no tiers yet
  IF EXISTS (SELECT 1 FROM public.showing_price_tiers WHERE showing_id = p_showing_id) THEN
    RETURN;
  END IF;

  -- Copy tier rows; remember template_id → new tier id
  FOR v_template IN
    SELECT * FROM public.production_price_tiers
    WHERE production_type = v_prod_type AND production_id = v_prod_id
    ORDER BY display_order
  LOOP
    INSERT INTO public.showing_price_tiers (showing_id, tier_name, price, color, display_order, is_active)
    VALUES (p_showing_id, v_template.tier_name, v_template.price, v_template.color, v_template.display_order, true)
    RETURNING id INTO v_new_tier_id;
    v_mapping := v_mapping || jsonb_build_object(v_template.id::text, v_new_tier_id::text);
  END LOOP;

  -- Copy seat→tier mapping using the id map above
  INSERT INTO public.showing_seat_tiers (showing_id, venue_seat_id, tier_id)
  SELECT p_showing_id, pst.venue_seat_id, (v_mapping ->> pst.tier_template_id::text)::uuid
  FROM public.production_seat_tiers pst
  WHERE pst.production_type = v_prod_type AND pst.production_id = v_prod_id
    AND v_mapping ? pst.tier_template_id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_production_template_to_showing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_production_template_to_showing(uuid) TO authenticated, service_role;

-- 5b. shift_requests. The one writer is the time-clock widget on StaffPOS
-- (src/components/pos/TimeClockWidget.tsx), which only staff can open; the
-- inbox that approves them is admin labor. A role-less session could insert a
-- row already 'approved', or flip its own row to 'approved' (the requester
-- clause on UPDATE had no WITH CHECK). Now: only staff file, a new request is
-- always pending and unresolved, and only staff update. Who among staff may
-- approve is M6's question (square-labor), not this one.
DROP POLICY IF EXISTS "Users create own shift requests" ON public.shift_requests;
DROP POLICY IF EXISTS "Staff create own pending shift requests" ON public.shift_requests;
CREATE POLICY "Staff create own pending shift requests" ON public.shift_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND public.has_role(auth.uid(), 'staff')
    AND status = 'pending'
    AND resolved_by IS NULL
    AND resolved_at IS NULL
  );

DROP POLICY IF EXISTS "Admin/staff update shift requests" ON public.shift_requests;
CREATE POLICY "Admin/staff update shift requests" ON public.shift_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

-- 5c. dvd_rentals INSERT. The member half ("user_id = auth.uid()") served the
-- patron reservation button on /dvds, which is switched off with member
-- accounts (src/pages/Dvds.tsx renders "Ask at the box office" instead), and is
-- the only INSERT in the app; the staff DVD library tab reads and updates
-- rentals but does not create them. Staff keep the ability to insert, as the
-- old policy allowed. With patron sign-in refused, the
-- member clause only ever served a session nobody is meant to have. If member
-- accounts relaunch, restore it deliberately, together with sign-in.
-- (Own-row SELECT and cancel-own-reservation are left alone: they grant a
-- role-less user nothing beyond their own rows.)
DROP POLICY IF EXISTS "Members create own reservations" ON public.dvd_rentals;
DROP POLICY IF EXISTS "Staff create reservations" ON public.dvd_rentals;
CREATE POLICY "Staff create reservations" ON public.dvd_rentals
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

-- ---------------------------------------------------------------------------
-- 6. Custom Access Token hook: no token without a role (INERT until enabled)
-- ---------------------------------------------------------------------------
-- Tom's decision (2026-10-06): an account with no staff, host, admin or
-- superadmin role must not be able to sign in. send-auth-email stops mailing
-- such accounts a login link, but that does not reach a buyer who already set a
-- password, or a refresh token already issued. This function, once selected in
-- Auth -> Hooks -> Customize Access Token, refuses every token issuance --
-- password sign-in, OTP/link verification, and refresh -- for a role-less
-- account, so existing patron sessions also end at their next refresh.
--
-- Invitees pass: invite-staff upserts the role immediately after
-- inviteUserByEmail, long before the invitee can click the link.
CREATE OR REPLACE FUNCTION public.refuse_roleless_access_token(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := nullif(event->>'user_id', '')::uuid;
BEGIN
  IF v_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = v_user
       AND role IN ('staff', 'host', 'admin', 'superadmin')
  ) THEN
    -- Claims untouched: this hook decides who, not what the token says.
    RETURN jsonb_build_object('claims', event->'claims');
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign-in is for Kenworthy staff. Your tickets are in your confirmation email.'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_roleless_access_token(jsonb) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.refuse_roleless_access_token(jsonb) TO supabase_auth_admin;
  END IF;
END $$;
