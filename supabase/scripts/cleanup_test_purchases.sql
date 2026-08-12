-- ===========================================================================
-- Cleanup: test ticket purchases created while diagnosing the missing-ticket-
-- confirmation bug (see docs/briefs/BRIEF-ticket-email.md).
--
-- READ THIS BEFORE RUNNING ANYTHING.
--
-- This script is deliberately in two halves. Everything above the DELETE
-- section is read-only: it shows you exactly which rows match. Nothing is
-- destructive until you uncomment the DELETE block, and you should only do
-- that after eyeballing the SELECT output and confirming every row is yours.
--
-- These are real customer-facing tables in production. A too-broad predicate
-- deletes tickets somebody paid for. Run the SELECTs, read the rows, then
-- decide.
--
-- Recommended order:
--   1. Run STEP 1 and read the output.
--   2. Narrow the predicate in STEP 0 until STEP 1 shows only your test rows.
--   3. Run STEP 2 to see what the account cleanup would touch.
--   4. Only then uncomment STEP 3 / STEP 4.
--
-- Run against staging first to confirm the shape of the results.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 0 — Define which purchases are test purchases.
--
-- EDIT THIS. The default below is intentionally conservative: it matches
-- nothing until you fill in the identifiers you actually used during testing.
-- Prefer listing the exact email addresses / phone numbers you tested with
-- over any clever heuristic — a date range will also sweep up real customers
-- if the theatre sold anything that day.
-- ---------------------------------------------------------------------------

CREATE TEMP VIEW test_accounts AS
SELECT p.id, p.email, p.phone, p.display_name, p.created_at
  FROM public.profiles p
 WHERE p.email IN (
         -- 'you@example.com',
         -- 'test@example.com',
         NULL
       )
    OR p.phone IN (
         -- '+12085551234',
         NULL
       );


-- ---------------------------------------------------------------------------
-- STEP 1 — Inspect the tickets that would be deleted. READ-ONLY.
-- ---------------------------------------------------------------------------

SELECT t.id            AS ticket_id,
       t.order_token,
       t.status,
       t.total_price,
       t.payment_method,
       t.purchased_at,
       t.scanned_at,
       a.email         AS account_email,
       a.phone         AS account_phone,
       COALESCE(m.title, e.title, lp.title) AS production_title,
       s.start_time
  FROM public.tickets t
  JOIN test_accounts a            ON a.id = t.user_id
  LEFT JOIN public.showings s     ON s.id = t.showing_id
  LEFT JOIN public.movies m       ON m.id = s.movie_id
  LEFT JOIN public.events e       ON e.id = s.event_id
  LEFT JOIN public.live_performances lp ON lp.id = s.live_performance_id
 ORDER BY t.purchased_at DESC;

-- Sanity check: how many, and do any look like real sales?
SELECT COUNT(*)                                   AS tickets_matched,
       COUNT(*) FILTER (WHERE t.scanned_at IS NOT NULL) AS already_scanned,
       SUM(t.total_price)                         AS total_value
  FROM public.tickets t
  JOIN test_accounts a ON a.id = t.user_id;

-- A scanned ticket means somebody walked through a door with it. If
-- already_scanned is greater than zero, stop and work out why before deleting.


-- ---------------------------------------------------------------------------
-- STEP 2 — Inspect the accounts. READ-ONLY.
--
-- Check whether any test account has *other* activity attached. If it does,
-- delete the tickets but keep the account.
-- ---------------------------------------------------------------------------

SELECT a.id,
       a.email,
       a.phone,
       a.display_name,
       a.created_at,
       (SELECT COUNT(*) FROM public.tickets t WHERE t.user_id = a.id)            AS ticket_count,
       (SELECT COUNT(*) FROM public.user_film_passes f WHERE f.user_id = a.id)   AS film_pass_count
  FROM test_accounts a
 ORDER BY a.created_at DESC;


-- ---------------------------------------------------------------------------
-- STEP 3 — Delete the test tickets. DESTRUCTIVE. Uncomment to run.
--
-- Wrapped in a transaction so you can inspect the row count and ROLLBACK if it
-- is not what STEP 1 led you to expect.
-- ---------------------------------------------------------------------------

-- BEGIN;
--
-- DELETE FROM public.tickets t
--  USING test_accounts a
--  WHERE t.user_id = a.id;
--
-- -- Compare this count against STEP 1 before continuing.
-- -- COMMIT;   -- or ROLLBACK;


-- ---------------------------------------------------------------------------
-- STEP 4 — Delete the test auth accounts. DESTRUCTIVE. Uncomment to run.
--
-- Only for accounts that exist solely because of a test purchase. Deleting
-- from auth.users cascades to public.profiles.
--
-- Guarded: refuses to touch an account that still has tickets or film passes,
-- so running this out of order cannot orphan real data.
-- ---------------------------------------------------------------------------

-- BEGIN;
--
-- DELETE FROM auth.users u
--  WHERE u.id IN (SELECT id FROM test_accounts)
--    AND NOT EXISTS (SELECT 1 FROM public.tickets t          WHERE t.user_id = u.id)
--    AND NOT EXISTS (SELECT 1 FROM public.user_film_passes f WHERE f.user_id = u.id);
--
-- -- COMMIT;   -- or ROLLBACK;


-- ---------------------------------------------------------------------------
-- STEP 5 — Post-cleanup verification. READ-ONLY.
-- ---------------------------------------------------------------------------

-- Any ticket still undelivered? After the delivery fix ships, this should only
-- ever show very recent rows (a send in flight), never a growing backlog.
SELECT t.order_token,
       MIN(t.purchased_at)   AS purchased_at,
       COUNT(*)              AS tickets,
       MAX(t.confirmation_error) AS last_error
  FROM public.tickets t
 WHERE t.confirmation_sent_at IS NULL
   AND t.purchased_at > now() - interval '30 days'
 GROUP BY t.order_token
 ORDER BY purchased_at DESC;
