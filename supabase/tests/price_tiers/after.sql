\set ON_ERROR_STOP 1
-- Runs AFTER 20260922174957_price_tiers_reconcile.sql, on the data before.sql seeded.
\set paragon '''00000000-0000-0000-0000-00000000e533'''
\set seated  '''00000000-0000-0000-0000-00000000c0de'''
\set healthy '''00000000-0000-0000-0000-00000000f1ee'''
\set retired '''00000000-0000-0000-0000-000000000e7d'''

-- 1. The repair -------------------------------------------------------------
SELECT public.check('Paragon: one live General Admission and one live Preferred Seating',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :paragon AND is_active) = 2
  AND (SELECT count(DISTINCT tier_name) FROM public.showing_price_tiers WHERE showing_id = :paragon AND is_active) = 2);
SELECT public.check('Paragon: the live rows are the oldest (31 Aug) ones',
  (SELECT bool_and(created_at = '2026-08-31 15:20+00') FROM public.showing_price_tiers WHERE showing_id = :paragon AND is_active));
SELECT public.check('Paragon: the duplicate a ticket references is kept, retired',
  (SELECT is_active = false FROM public.showing_price_tiers WHERE id = '00000000-0000-0000-0000-0000000000a2'));
SELECT public.check('Paragon: the duplicates nothing references are gone',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :paragon) = 3,
  (SELECT string_agg(tier_name || ':' || is_active, ', ' ORDER BY created_at) FROM public.showing_price_tiers WHERE showing_id = :paragon));
SELECT public.check('Paragon: both tickets still resolve to a tier',
  (SELECT bool_and(t.tier_id IS NOT NULL AND p.id IS NOT NULL) FROM public.tickets t LEFT JOIN public.showing_price_tiers p ON p.id = t.tier_id WHERE t.showing_id = :paragon));

SELECT public.check('seated: seat map repointed onto the kept row, which the ticket also references',
  (SELECT count(*) FROM public.showing_seat_tiers WHERE showing_id = :seated AND tier_id = '00000000-0000-0000-0000-0000000000c1') = 2
  AND (SELECT count(*) FROM public.showing_seat_tiers WHERE showing_id = :seated) = 2);
SELECT public.check('seated: the unreferenced duplicate is deleted without cascading the map away',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :seated) = 1);

SELECT public.check('healthy showing untouched',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :healthy AND is_active) = 2);
SELECT public.check('a retired row beside a live one of the same name is not a duplicate',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :retired) = 2
  AND (SELECT is_active FROM public.showing_price_tiers WHERE id = '00000000-0000-0000-0000-0000000000d2'));

-- 2. The guard ----------------------------------------------------------------
SELECT public.expect('a second LIVE tier of the same name is refused (23505)', public.try_sql($q$
  INSERT INTO public.showing_price_tiers (showing_id, tier_name, price) VALUES ('00000000-0000-0000-0000-00000000f1ee', 'Adult', 9)$q$), '23505');
SELECT public.expect('...also when it differs only by case and whitespace', public.try_sql($q$
  INSERT INTO public.showing_price_tiers (showing_id, tier_name, price) VALUES ('00000000-0000-0000-0000-00000000f1ee', ' adult ', 9)$q$), '23505');
SELECT public.expect('a retired row of that name is still allowed', public.try_sql($q$
  INSERT INTO public.showing_price_tiers (showing_id, tier_name, price, is_active) VALUES ('00000000-0000-0000-0000-00000000f1ee', 'Adult', 9, false)$q$), 'ok');
DELETE FROM public.showing_price_tiers WHERE showing_id = :healthy AND NOT is_active;

-- 3. The writer ---------------------------------------------------------------
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000ad', false);
SELECT set_config('test.role', 'staff', false);
SELECT public.expect('staff cannot write tiers (42501)', public.try_sql($q$
  SELECT public.set_showing_price_tiers('00000000-0000-0000-0000-00000000f1ee', '[{"tier_name":"Adult","price":8}]')$q$), '42501');
SELECT set_config('test.role', 'admin', false);

SELECT public.expect('a missing showing is PT404', public.try_sql($q$
  SELECT public.set_showing_price_tiers('00000000-0000-0000-0000-000000000000', '[]')$q$), 'PT404');
SELECT public.expect('not an array is PT400', public.try_sql($q$
  SELECT public.set_showing_price_tiers('00000000-0000-0000-0000-00000000f1ee', '{"tier_name":"Adult"}')$q$), 'PT400');
SELECT public.expect('a blank name is PT400', public.try_sql($q$
  SELECT public.set_showing_price_tiers('00000000-0000-0000-0000-00000000f1ee', '[{"tier_name":"  ","price":8}]')$q$), 'PT400');
SELECT public.expect('two tiers of one name in the request is PT400, not 23505', public.try_sql($q$
  SELECT public.set_showing_price_tiers('00000000-0000-0000-0000-00000000f1ee', '[{"tier_name":"Adult","price":8},{"tier_name":"adult","price":9}]')$q$), 'PT400');
SELECT public.expect('a negative or non-numeric price is PT400', public.try_sql($q$
  SELECT public.set_showing_price_tiers('00000000-0000-0000-0000-00000000f1ee', '[{"tier_name":"Adult","price":"free"}]')$q$), 'PT400');
SELECT public.check('a refused request changed nothing',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :healthy) = 2);

-- The bug itself: delete a tier and save, on a showing with sold tickets.
-- Paragon is live GA + PS; the admin drops PS. Save twice (a double-click).
SELECT public.check('delete-a-tier-then-save leaves exactly one live tier',
  (SELECT count(*) FROM public.set_showing_price_tiers(:paragon, '[{"tier_name":"General Admission","price":50}]')) = 1);
-- (each call sits in its own statement: two uncorrelated subplans in one
-- SELECT are evaluated in no guaranteed order, so a state check beside the
-- call could read the state from before it)
CREATE TEMP TABLE again AS SELECT * FROM public.set_showing_price_tiers(:paragon, '[{"tier_name":"General Admission","price":50}]');
SELECT public.check('...and saving again does not multiply it',
  (SELECT count(*) FROM again) = 1
  AND (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :paragon AND is_active) = 1);
SELECT public.check('the kept GA row is the same row the ticket references (id survives a save)',
  (SELECT id = '00000000-0000-0000-0000-0000000000a1' FROM public.showing_price_tiers WHERE showing_id = :paragon AND is_active));
SELECT public.check('the dropped PS tier, unreferenced, is deleted',
  NOT EXISTS (SELECT 1 FROM public.showing_price_tiers WHERE showing_id = :paragon AND lower(tier_name) LIKE 'preferrred%'));
SELECT public.check('the retired GA duplicate the other ticket references is still there',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :paragon) = 2);

-- Drop a tier that HAS sold: it is retired, not deleted, and the ticket keeps its tier.
INSERT INTO public.tickets (showing_id, tier_id, price) SELECT :healthy, id, 6 FROM public.showing_price_tiers WHERE showing_id = :healthy AND tier_name = 'Student';
CREATE TEMP TABLE dropped AS SELECT * FROM public.set_showing_price_tiers(:healthy, '[{"tier_name":"Adult","price":8}]');
SELECT public.check('dropping a sold tier retires it',
  (SELECT string_agg(tier_name, ',' ORDER BY display_order) FROM dropped) = 'Adult'
  AND (SELECT is_active FROM public.showing_price_tiers WHERE showing_id = :healthy AND tier_name = 'Student') = false);
CREATE TEMP TABLE revived AS SELECT * FROM public.set_showing_price_tiers(:healthy, '[{"tier_name":"Adult","price":8},{"tier_name":"Student","price":5}]');
SELECT public.check('re-adding it revives the same row, at the new price',
  (SELECT string_agg(tier_name || '@' || price, ',' ORDER BY display_order) FROM revived) = 'Adult@8,Student@5'
  AND (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = :healthy) = 2
  AND (SELECT bool_and(p.is_active) FROM public.tickets t JOIN public.showing_price_tiers p ON p.id = t.tier_id WHERE t.showing_id = :healthy));

-- Rename, reorder, recolour, price change: all in place.
SELECT public.check('rename + reorder + colour + price are applied in place',
  (SELECT string_agg(tier_name || '@' || price || '#' || display_order || color, ',' ORDER BY display_order)
     FROM public.set_showing_price_tiers(:healthy, '[{"tier_name":"Student","price":5.5,"color":"#123456"},{"tier_name":"ADULT","price":8}]'))
  = 'Student@5.5#0#123456,ADULT@8#1#9C3FA0');
SELECT public.check('an omitted colour keeps the existing one',
  (SELECT color FROM public.showing_price_tiers WHERE showing_id = :healthy AND tier_name = 'Student') = '#123456');

-- A brand-new tier is appended; whitespace is trimmed.
SELECT public.check('new names are inserted, trimmed',
  (SELECT string_agg(tier_name, ',' ORDER BY display_order) FROM public.set_showing_price_tiers(:healthy, '[{"tier_name":"ADULT","price":8},{"tier_name":"  Child ","price":4}]')) = 'ADULT,Child');

-- Empty list: what "no ticket needed" and "tiered pricing unticked" send.
INSERT INTO public.tickets (showing_id, tier_id, price) SELECT :healthy, id, 8 FROM public.showing_price_tiers WHERE showing_id = :healthy AND tier_name = 'ADULT';
UPDATE public.showings SET no_ticket_required = true, ticket_price = 0 WHERE id = :healthy;
SELECT public.expect('flipping a sold showing to walk-in retires its priced tiers instead of being refused', public.try_sql($q$
  SELECT public.set_showing_price_tiers('00000000-0000-0000-0000-00000000f1ee', '[]')$q$), 'ok');
SELECT public.check('...no live tier remains, the sold ones are retired, the unsold one is gone',
  (SELECT count(*) FILTER (WHERE is_active) = 0 AND count(*) = 2 FROM public.showing_price_tiers WHERE showing_id = :healthy));
SELECT public.expect('the no-ticket trigger still refuses a LIVE priced tier', public.try_sql($q$
  INSERT INTO public.showing_price_tiers (showing_id, tier_name, price) VALUES ('00000000-0000-0000-0000-00000000f1ee', 'Adult', 8)$q$), 'PT409');
SELECT public.expect('...and the RPC surfaces that refusal rather than half-writing', public.try_sql($q$
  SELECT public.set_showing_price_tiers('00000000-0000-0000-0000-00000000f1ee', '[{"tier_name":"Adult","price":8}]')$q$), 'PT409');
SELECT public.check('a refused reconcile leaves the retired rows retired',
  (SELECT count(*) FILTER (WHERE is_active) FROM public.showing_price_tiers WHERE showing_id = :healthy) = 0);

-- Seat editor path: the returned rows carry ids the map can be rebuilt on.
CREATE TEMP TABLE seated_rows AS SELECT * FROM public.set_showing_price_tiers(:seated, '[{"tier_name":"Front","price":30},{"tier_name":"Back","price":15}]');
SELECT public.check('returned rows carry ids and display_order',
  (SELECT bool_and(id IS NOT NULL) AND array_agg(display_order ORDER BY display_order) = '{0,1}' FROM seated_rows));
SELECT public.check('the seat map survived (its tier was matched by name, not replaced)',
  (SELECT count(*) FROM public.showing_seat_tiers WHERE showing_id = :seated AND tier_id = '00000000-0000-0000-0000-0000000000c1') = 2);

RESET ROLE;
SELECT n, CASE WHEN pass THEN 'ok  ' ELSE 'FAIL' END AS verdict, name, detail FROM public.results WHERE NOT pass ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM public.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.results WHERE NOT pass) THEN RAISE EXCEPTION 'price_tiers tests failed'; END IF; END $$;
