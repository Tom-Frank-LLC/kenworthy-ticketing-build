-- The QBO Export now books from Square's reports (square-analytics, mode
-- "journal"), so its accounts are chosen by Square reporting category, and by
-- item name inside Square's "Uncategorized".
--
-- 1. Admins could never write account_mappings. The "Admins manage mappings"
--    policy has existed since June, but the table was only ever GRANTed SELECT
--    to authenticated, so every save from the Account Mappings tab failed with
--    permission denied. RLS still limits writes to admins; this only lets the
--    policy be reached. DELETE stays withheld: a mapping is changed, not dropped.
GRANT INSERT, UPDATE ON public.account_mappings TO authenticated;

-- 2. The mappings that are unambiguous. Everything else (Uncategorized items
--    such as rentals and fundraiser tickets, merch, passes, donations) is left
--    unmapped on purpose: the export shows it as UNMAPPED with a picker, and the
--    accountant decides. A guessed account would post silently to the wrong line.
WITH a AS (SELECT id, code FROM public.chart_of_accounts)
INSERT INTO public.account_mappings (source_type, source_key, account_id, is_default, notes)
SELECT 'square_category', k, (SELECT id FROM a WHERE code = c), false, 'seeded with the Square-sourced QBO export'
FROM (VALUES
  ('6 Film Tickets', '4710'),
  ('6 Live Event Tickets', '4711'),
  ('6 METLive Tickets', '4712'),
  ('6 NT Live Tickets', '4713'),
  ('6 Rental Tickets', '4316'),
  ('1 Combos', '4410'),
  ('2 Candy', '4410'),
  ('3 Bottles', '4410'),
  ('3 Soda', '4410'),
  ('4 Beer', '4410'),
  ('4 Wine', '4410'),
  ('5 Popcorn', '4410'),
  ('Cafe', '4410'),
  ('Cocktails', '4410'),
  ('Concessions', '4410')
) AS v(k, c)
WHERE EXISTS (SELECT 1 FROM a WHERE code = c)
ON CONFLICT (source_type, source_key) DO NOTHING;
