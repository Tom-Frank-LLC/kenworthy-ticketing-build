-- Baseline for the tier-required rule (20261006225325, audit H2). Applied by
-- run.sh AFTER 20260922203433 and BEFORE the new migration, so `before` is
-- what the old price_ticket_order answered. pricing_rpc_test.sql §9 asks the
-- new function the same questions and requires the same answer for every
-- shape except the ones marked to change — which must now be refused.
--
-- The shapes are the ones production has, not just the ones the bug needs
-- (CLAUDE.md: "a harness only proves the branches it takes"). Most production
-- showings have no tiers at all, so those come first.
\set ON_ERROR_STOP 1
SELECT set_config('test.authrole', 'service_role', false);

CREATE TABLE public.shape_cases (label text PRIMARY KEY, showing uuid, tickets jsonb, channel text DEFAULT 'online', changes boolean DEFAULT false);
CREATE TABLE public.shape_results (label text, phase text, result text, PRIMARY KEY (label, phase));

-- One line per order: every number the function returns that ends up on a row
-- or a charge, or the refusal.
CREATE FUNCTION public.shape_snapshot(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; got text;
BEGIN
  FOR c IN SELECT * FROM public.shape_cases LOOP
    BEGIN
      SELECT string_agg(format('%s:%s/%s/%s/%s/%s/%s', seq, COALESCE(tier_id::text, '-'), COALESCE(tier_name, '-'),
                               list_price::numeric(12,2), discount_amount::numeric(12,2), tax_amount::numeric(12,2),
                               total_price::numeric(12,2)), ' ' ORDER BY seq)
             || format(' | %s %s %s %s %s', min(order_list_subtotal)::numeric(12,2), min(order_discount)::numeric(12,2),
                       min(order_tax)::numeric(12,2), min(order_processing_fee)::numeric(12,2), min(order_grand_total)::numeric(12,2))
        INTO got FROM public.quote_ticket_order(c.showing, c.tickets, c.channel);
    EXCEPTION WHEN OTHERS THEN got := SQLSTATE || ': ' || SQLERRM;
    END;
    INSERT INTO public.shape_results VALUES (c.label, p_phase, got);
  END LOOP;
END $$;

-- Untiered (single price) — most of production.
INSERT INTO public.showings (id, ticket_price) VALUES
  ('00000000-0000-0000-0000-00000000b001', 8.00),
  ('00000000-0000-0000-0000-00000000b002', 0),
  ('00000000-0000-0000-0000-00000000b003', 12.50);
INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label)
  VALUES ('00000000-0000-0000-0000-00000000b003', 'percent', 10, 4, 'four or more');
-- Untiered, assigned seats.
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-00000000b004', 9.00);
INSERT INTO public.seats (id, seat_row, seat_number) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'B', 1), ('00000000-0000-0000-0000-00000000c002', 'B', 2),
  ('00000000-0000-0000-0000-00000000c003', 'C', 1);
INSERT INTO public.venue_seats (id, seat_row, seat_number) VALUES
  ('00000000-0000-0000-0000-00000000c101', 'B', 1), ('00000000-0000-0000-0000-00000000c102', 'B', 2);
-- Untiered rental production that passes on the surcharge.
INSERT INTO public.movies (id, title, pass_processing_fee) VALUES ('00000000-0000-0000-0000-00000000d001', 'Rental Night', true);
INSERT INTO public.showings (id, ticket_price, movie_id) VALUES ('00000000-0000-0000-0000-00000000b005', 10.00, '00000000-0000-0000-0000-00000000d001');
-- Tiers that exist but are all switched off: the page shows no picker, so it
-- sends {} and the base price applies — before and after.
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-00000000b006', 7.00);
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price, is_active) VALUES
  ('00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-00000000b006', 'Retired', 20, false);

-- Tiered GA: the audit's live event. Base 0 beside $55 / $40, and base 8
-- beside one $40 tier.
INSERT INTO public.events (id, title) VALUES ('00000000-0000-0000-0000-00000000d002', 'Audit Gala');
INSERT INTO public.showings (id, ticket_price, event_id) VALUES
  ('00000000-0000-0000-0000-00000000b007', 0, '00000000-0000-0000-0000-00000000d002'),
  ('00000000-0000-0000-0000-00000000b008', 8.00, '00000000-0000-0000-0000-00000000d002');
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price) VALUES
  ('00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-00000000b007', 'Preferred Seating', 55),
  ('00000000-0000-0000-0000-00000000e702', '00000000-0000-0000-0000-00000000b007', 'General Admission', 40),
  ('00000000-0000-0000-0000-00000000e801', '00000000-0000-0000-0000-00000000b008', 'General Admission', 40);
-- Tiered film with Adult / Student and a tier-scoped discount.
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-00000000b009', 8.00);
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price) VALUES
  ('00000000-0000-0000-0000-00000000e901', '00000000-0000-0000-0000-00000000b009', 'Adult', 9),
  ('00000000-0000-0000-0000-00000000e902', '00000000-0000-0000-0000-00000000b009', 'Student', 7);
INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label, eligible_tiers)
  VALUES ('00000000-0000-0000-0000-00000000b009', 'percent', 25, 4, 'adults', ARRAY['Adult']);
-- A tiered showing with an inactive tier beside an active one.
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price, is_active) VALUES
  ('00000000-0000-0000-0000-00000000e903', '00000000-0000-0000-0000-00000000b009', 'Senior', 6, false);

-- Seat tiers: B1 is mapped to Front, B2 to Back, C1 is not mapped at all.
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-00000000b010', 5.00);
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price) VALUES
  ('00000000-0000-0000-0000-00000000ea01', '00000000-0000-0000-0000-00000000b010', 'Front', 30),
  ('00000000-0000-0000-0000-00000000ea02', '00000000-0000-0000-0000-00000000b010', 'Back', 18);
INSERT INTO public.showing_seat_tiers VALUES
  ('00000000-0000-0000-0000-00000000b010', '00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-00000000ea01'),
  ('00000000-0000-0000-0000-00000000b010', '00000000-0000-0000-0000-00000000c102', '00000000-0000-0000-0000-00000000ea02');

INSERT INTO public.shape_cases (label, showing, tickets, channel, changes) VALUES
  -- untiered
  ('untiered $8, 1 ticket {}',                    '00000000-0000-0000-0000-00000000b001', '[{}]', 'online', false),
  ('untiered $8, tier_id null',                   '00000000-0000-0000-0000-00000000b001', '[{"tier_id":null},{"tier_id":""}]', 'online', false),
  ('untiered $8, 6 tickets, cash',                '00000000-0000-0000-0000-00000000b001', '[{},{},{},{},{},{}]', 'none', false),
  ('untiered free $0',                            '00000000-0000-0000-0000-00000000b002', '[{},{}]', 'online', false),
  ('untiered $12.50 with a 4+ discount',          '00000000-0000-0000-0000-00000000b003', '[{},{},{},{}]', 'online', false),
  ('untiered assigned seats',                     '00000000-0000-0000-0000-00000000b004', '[{"seat_id":"00000000-0000-0000-0000-00000000c001"},{"seat_id":"00000000-0000-0000-0000-00000000c003"}]', 'in_person', false),
  ('untiered rental, surcharge online',           '00000000-0000-0000-0000-00000000b005', '[{},{},{}]', 'online', false),
  ('untiered rental, surcharge in person',        '00000000-0000-0000-0000-00000000b005', '[{}]', 'in_person', false),
  ('only inactive tiers, {} at base',             '00000000-0000-0000-0000-00000000b006', '[{},{}]', 'online', false),
  ('only inactive tiers, naming the dead tier',   '00000000-0000-0000-0000-00000000b006', '[{"tier_id":"00000000-0000-0000-0000-00000000e601"}]', 'online', false),
  -- tiered, honest
  ('gala, 2 GA + 1 Preferred',                    '00000000-0000-0000-0000-00000000b007', '[{"tier_id":"00000000-0000-0000-0000-00000000e702"},{"tier_id":"00000000-0000-0000-0000-00000000e702"},{"tier_id":"00000000-0000-0000-0000-00000000e701"}]', 'online', false),
  ('gala base 8, 1 GA',                           '00000000-0000-0000-0000-00000000b008', '[{"tier_id":"00000000-0000-0000-0000-00000000e801"}]', 'online', false),
  ('film 2 Adult + 2 Student, adult discount',    '00000000-0000-0000-0000-00000000b009', '[{"tier_id":"00000000-0000-0000-0000-00000000e901"},{"tier_id":"00000000-0000-0000-0000-00000000e901"},{"tier_id":"00000000-0000-0000-0000-00000000e902"},{"tier_id":"00000000-0000-0000-0000-00000000e902"}]', 'online', false),
  ('film, the inactive Senior tier',              '00000000-0000-0000-0000-00000000b009', '[{"tier_id":"00000000-0000-0000-0000-00000000e903"}]', 'online', false),
  ('film, a tier from another showing',           '00000000-0000-0000-0000-00000000b009', '[{"tier_id":"00000000-0000-0000-0000-00000000e801"}]', 'online', false),
  -- seat tiers
  ('seat B1 asks Back, seat tier Front wins',     '00000000-0000-0000-0000-00000000b010', '[{"seat_id":"00000000-0000-0000-0000-00000000c001","tier_id":"00000000-0000-0000-0000-00000000ea02"}]', 'online', false),
  ('seat B1 and B2 sent with no tier at all',     '00000000-0000-0000-0000-00000000b010', '[{"seat_id":"00000000-0000-0000-0000-00000000c001"},{"seat_id":"00000000-0000-0000-0000-00000000c002"}]', 'in_person', false),
  ('unmapped seat C1 with the page''s fallback tier', '00000000-0000-0000-0000-00000000b010', '[{"seat_id":"00000000-0000-0000-0000-00000000c003","tier_id":"00000000-0000-0000-0000-00000000ea02"}]', 'online', false),
  -- the hole: these priced at the base before, and must be refused now
  ('H2: gala base 0, 4 x {}',                     '00000000-0000-0000-0000-00000000b007', '[{},{},{},{}]', 'online', true),
  ('H2: gala base 0, tier_id null',               '00000000-0000-0000-0000-00000000b007', '[{"tier_id":null}]', 'online', true),
  ('H2: gala base 0, one honest + one bare',      '00000000-0000-0000-0000-00000000b007', '[{"tier_id":"00000000-0000-0000-0000-00000000e701"},{}]', 'online', true),
  ('H2: gala base 8, {}',                         '00000000-0000-0000-0000-00000000b008', '[{}]', 'online', true),
  ('H2: film with tiers, {} for cash',            '00000000-0000-0000-0000-00000000b009', '[{}]', 'none', true),
  ('H2: unmapped seat C1, no tier',               '00000000-0000-0000-0000-00000000b010', '[{"seat_id":"00000000-0000-0000-0000-00000000c003"}]', 'online', true);

SELECT public.shape_snapshot('before');
