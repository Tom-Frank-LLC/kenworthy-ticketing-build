
-- ============================================================
-- Chart of Accounts foundation (Phase 1)
-- ============================================================

CREATE TYPE public.coa_account_type AS ENUM (
  'income', 'contra_income', 'expense', 'contra_expense',
  'other_income', 'other_expense'
);

CREATE TABLE public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  qbo_account_name text NOT NULL,
  qbo_account_id text,
  account_type public.coa_account_type NOT NULL,
  parent_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.chart_of_accounts TO authenticated;
GRANT ALL ON public.chart_of_accounts TO service_role;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read accounts" ON public.chart_of_accounts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage accounts" ON public.chart_of_accounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER coa_updated_at BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Account mappings: link app-side sources to accounts
-- ============================================================

CREATE TABLE public.account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_key text NOT NULL,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type, source_key)
);

CREATE INDEX idx_account_mappings_source ON public.account_mappings(source_type, source_key);
CREATE UNIQUE INDEX idx_account_mappings_default ON public.account_mappings(source_type)
  WHERE is_default = true;

GRANT SELECT ON public.account_mappings TO authenticated;
GRANT ALL ON public.account_mappings TO service_role;
ALTER TABLE public.account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read mappings" ON public.account_mappings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage mappings" ON public.account_mappings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER am_updated_at BEFORE UPDATE ON public.account_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Add account_id to financial_entries (historical import table)
-- ============================================================

ALTER TABLE public.financial_entries
  ADD COLUMN account_id uuid REFERENCES public.chart_of_accounts(id),
  ADD COLUMN account_source_type text,
  ADD COLUMN account_source_key text,
  ADD COLUMN needs_account_review boolean NOT NULL DEFAULT false;

-- ============================================================
-- Helper: resolve an account from (source_type, source_key)
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_account_id(
  p_source_type text, p_source_key text
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_id FROM public.account_mappings
  WHERE source_type = p_source_type AND source_key = p_source_key
  UNION ALL
  SELECT account_id FROM public.account_mappings
  WHERE source_type = p_source_type AND is_default = true
  LIMIT 1;
$$;

-- ============================================================
-- QBO sync scaffolding (Phase 5 — inactive until creds added)
-- ============================================================

CREATE TABLE public.qbo_connection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  environment text NOT NULL DEFAULT 'sandbox',
  connected_at timestamptz,
  connected_by uuid REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.qbo_connection TO authenticated;
GRANT ALL ON public.qbo_connection TO service_role;
ALTER TABLE public.qbo_connection ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read qbo connection" ON public.qbo_connection
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.qbo_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_table text NOT NULL,
  entry_id uuid NOT NULL,
  account_id uuid REFERENCES public.chart_of_accounts(id),
  status text NOT NULL DEFAULT 'pending',
  qbo_txn_id text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.qbo_sync_jobs TO authenticated;
GRANT ALL ON public.qbo_sync_jobs TO service_role;
ALTER TABLE public.qbo_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read sync jobs" ON public.qbo_sync_jobs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Seed Chart of Accounts from 2025 Statement of Activity
-- ============================================================

-- Top-level groups
INSERT INTO public.chart_of_accounts (code, name, qbo_account_name, account_type, sort_order) VALUES
  ('GRP-CONTRIB', 'Contributed Income', 'Contributed Income', 'income', 100),
  ('GRP-SPONSOR', 'Sponsorships', 'Sponsorships', 'income', 200),
  ('GRP-RENTALS', 'Rentals', 'Rentals', 'income', 300),
  ('GRP-CONCESS', 'Concessions', 'Concessions', 'income', 400),
  ('GRP-MERCH', 'Merchandise', 'Merchandise', 'income', 500),
  ('GRP-PASSES', 'Passes', 'Passes', 'income', 600),
  ('GRP-TICKETS', 'Tickets', 'Tickets', 'income', 700),
  ('GRP-ADV', 'Advertising & marketing', 'Advertising & marketing', 'expense', 1100),
  ('GRP-CONLABOR', 'Contract labor', 'Contract labor', 'expense', 1200),
  ('GRP-CONPROG', 'Contracted Programming', 'Contracted Programming', 'expense', 1300),
  ('GRP-EVENT', 'Event expenses', 'Event expenses', 'expense', 1400),
  ('GRP-FILMEXP', 'Film Expenses', 'Film Expenses', 'expense', 1450),
  ('GRP-FACIL', 'Facilities Expenses', 'Facilities Expenses', 'expense', 1500),
  ('GRP-UTIL', 'Utilities', 'Utilities', 'expense', 1550),
  ('GRP-GA', 'General & administrative expenses', 'General & administrative expenses', 'expense', 1600),
  ('GRP-BANK', 'Bank fees & service charges', 'Bank fees & service charges', 'expense', 1610),
  ('GRP-CPF', 'Contract & professional fees', 'Contract & professional fees', 'expense', 1620),
  ('GRP-MEM', 'Memberships & subscriptions', 'Memberships & subscriptions', 'expense', 1630),
  ('GRP-OFFICE', 'Office expenses', 'Office expenses', 'expense', 1640),
  ('GRP-PROFDEV', 'Professional development', 'Professional development', 'expense', 1650),
  ('GRP-SUPPLY', 'Supplies', 'Supplies', 'expense', 1660),
  ('GRP-PAYROLL', 'Payroll expenses', 'Payroll expenses', 'expense', 1700),
  ('GRP-SALARY', 'Salaries & wages', 'Salaries & wages', 'expense', 1710),
  ('GRP-CAPITAL', 'Capital Expenditures', 'Capital Expenditures', 'other_expense', 1900);

-- Children (resolve parent by code via CTE)
WITH p AS (SELECT id, code FROM public.chart_of_accounts)
INSERT INTO public.chart_of_accounts (code, name, qbo_account_name, account_type, parent_id, sort_order) VALUES
  -- Contributed income
  ('4010', 'Donations from businesses', 'Donations from businesses', 'income', (SELECT id FROM p WHERE code='GRP-CONTRIB'), 110),
  ('4011', 'Donations from individuals', 'Donations from individuals', 'income', (SELECT id FROM p WHERE code='GRP-CONTRIB'), 111),
  ('4012', 'Donations from monthly donors', 'Donations from monthly donors', 'income', (SELECT id FROM p WHERE code='GRP-CONTRIB'), 112),
  ('4013', 'Donations jar', 'Donations jar', 'income', (SELECT id FROM p WHERE code='GRP-CONTRIB'), 113),
  ('4020', 'Grants - Operating', 'Grants - Operating', 'income', (SELECT id FROM p WHERE code='GRP-CONTRIB'), 120),
  -- Sponsorships
  ('4210', 'Black History Month', 'Black History Month Sponsorships', 'income', (SELECT id FROM p WHERE code='GRP-SPONSOR'), 210),
  ('4211', 'Film sponsorships', 'Film sponsorships', 'income', (SELECT id FROM p WHERE code='GRP-SPONSOR'), 211),
  ('4212', 'Live event sponsorships', 'Live event sponsorships', 'income', (SELECT id FROM p WHERE code='GRP-SPONSOR'), 212),
  ('4213', 'Met Live sponsorships', 'Met Live sponsorships', 'income', (SELECT id FROM p WHERE code='GRP-SPONSOR'), 213),
  ('4214', 'Saturday Cartoons sponsorship', 'Saturday Cartoons sponsorship', 'income', (SELECT id FROM p WHERE code='GRP-SPONSOR'), 214),
  ('4215', 'Silent Film Festival sponsorships', 'Silent Film Festival sponsorships', 'income', (SELECT id FROM p WHERE code='GRP-SPONSOR'), 215),
  ('4216', 'Summer Family Matinee sponsorships', 'Summer Family Matinee sponsorships', 'income', (SELECT id FROM p WHERE code='GRP-SPONSOR'), 216),
  -- Rentals
  ('4310', 'Rentals - General', 'A Rentals - General', 'income', (SELECT id FROM p WHERE code='GRP-RENTALS'), 310),
  ('4311', 'Rentals - Live Theater', 'A Rentals - Live Theater', 'income', (SELECT id FROM p WHERE code='GRP-RENTALS'), 311),
  ('4312', 'Fees charged to renters', 'Fees charged to renters', 'income', (SELECT id FROM p WHERE code='GRP-RENTALS'), 312),
  ('4313', 'Film Licensing Fees (rental)', 'Film Licensing Fees', 'income', (SELECT id FROM p WHERE code='GRP-RENTALS'), 313),
  ('4314', 'Non-profit discounts', 'Non-profit discounts', 'contra_income', (SELECT id FROM p WHERE code='GRP-RENTALS'), 314),
  ('4315', 'Poster print', 'Poster print', 'income', (SELECT id FROM p WHERE code='GRP-RENTALS'), 315),
  ('4316', 'Rental Ticket Sales', 'Rental Ticket Sales', 'income', (SELECT id FROM p WHERE code='GRP-RENTALS'), 316),
  ('4317', 'Rentals - Marquee', 'Rentals - Marquee', 'income', (SELECT id FROM p WHERE code='GRP-RENTALS'), 317),
  -- Concessions
  ('4410', 'Concessions sales', 'Concessions', 'income', (SELECT id FROM p WHERE code='GRP-CONCESS'), 410),
  ('4411', 'Concession discounts', 'Discounts', 'contra_income', (SELECT id FROM p WHERE code='GRP-CONCESS'), 411),
  -- Merchandise
  ('4510', 'Merchandise sales', 'Merchandise', 'income', (SELECT id FROM p WHERE code='GRP-MERCH'), 510),
  ('4511', 'Discounts on Merchandise', 'Discounts on Merchandise', 'contra_income', (SELECT id FROM p WHERE code='GRP-MERCH'), 511),
  -- Passes
  ('4610', 'Film Pass Sales', 'Film Pass Sales', 'income', (SELECT id FROM p WHERE code='GRP-PASSES'), 610),
  ('4611', 'Met Live Pass Sales', 'Met Live Pass Sales', 'income', (SELECT id FROM p WHERE code='GRP-PASSES'), 611),
  ('4612', 'Movie Night Gift Cards', 'Movie Night Gift Cards', 'income', (SELECT id FROM p WHERE code='GRP-PASSES'), 612),
  ('4613', 'Silent Film Fest Passes', 'Silent Film Fest Passes', 'income', (SELECT id FROM p WHERE code='GRP-PASSES'), 613),
  -- Returns
  ('4690', 'Returns', 'Returns', 'contra_income', NULL, 690),
  -- Tickets
  ('4710', 'Film Ticket Sales', 'Film Ticket Sales', 'income', (SELECT id FROM p WHERE code='GRP-TICKETS'), 710),
  ('4711', 'Live Event Ticket Sales', 'Live Event Ticket Sales', 'income', (SELECT id FROM p WHERE code='GRP-TICKETS'), 711),
  ('4712', 'Met Live Ticket Sales', 'Met Live Ticket Sales', 'income', (SELECT id FROM p WHERE code='GRP-TICKETS'), 712),
  ('4713', 'NT Live Ticket Sales', 'NT Live Ticket Sales', 'income', (SELECT id FROM p WHERE code='GRP-TICKETS'), 713),
  -- Other revenue lines
  ('4810', 'Sales Tax Collected', 'Sales Tax Collected', 'income', NULL, 810),
  ('4820', 'Tips', 'Tips', 'income', NULL, 820),
  -- Top-level expenses
  ('5010', 'Charitable contributions', 'Charitable contributions', 'expense', NULL, 1010),
  ('5020', 'Event expenses (misc)', 'Event expenses', 'expense', (SELECT id FROM p WHERE code='GRP-EVENT'), 1410),
  -- Advertising
  ('5110', 'Online marketing', 'Online marketing', 'expense', (SELECT id FROM p WHERE code='GRP-ADV'), 1110),
  ('5111', 'Other advertising', 'Other advertising', 'expense', (SELECT id FROM p WHERE code='GRP-ADV'), 1111),
  ('5112', 'Print marketing', 'Print marketing', 'expense', (SELECT id FROM p WHERE code='GRP-ADV'), 1112),
  -- Concessions COGS
  ('5210', 'Concessions COGS', 'Concessions', 'expense', NULL, 1210),
  -- Contract labor
  ('5310', 'Artist fees', 'Artist fees', 'expense', (SELECT id FROM p WHERE code='GRP-CONLABOR'), 1310),
  ('5311', 'Sound tech', 'Sound tech', 'expense', (SELECT id FROM p WHERE code='GRP-CONLABOR'), 1311),
  -- Contracted programming
  ('5410', 'Met Live programming', 'Met Live', 'expense', (SELECT id FROM p WHERE code='GRP-CONPROG'), 1320),
  ('5411', 'NT Live programming', 'NT Live', 'expense', (SELECT id FROM p WHERE code='GRP-CONPROG'), 1321),
  -- Event expenses
  ('5420', 'Entertainment/hospitality', 'Entertainment/hospitality', 'expense', (SELECT id FROM p WHERE code='GRP-EVENT'), 1420),
  ('5421', 'Other event expenses', 'Other event expenses', 'expense', (SELECT id FROM p WHERE code='GRP-EVENT'), 1421),
  ('5422', 'Silent Film Fest expenses', 'Silent Film Fest', 'expense', (SELECT id FROM p WHERE code='GRP-EVENT'), 1422),
  -- Film expenses
  ('5510', 'DVD/Blu-Ray', 'DVD/Blu-Ray', 'expense', (SELECT id FROM p WHERE code='GRP-FILMEXP'), 1451),
  ('5511', 'Film Booking', 'Film Booking', 'expense', (SELECT id FROM p WHERE code='GRP-FILMEXP'), 1452),
  ('5512', 'Film Licensing', 'Film Licensing', 'expense', (SELECT id FROM p WHERE code='GRP-FILMEXP'), 1453),
  ('5513', 'Film Shipping', 'Film Shipping', 'expense', (SELECT id FROM p WHERE code='GRP-FILMEXP'), 1454),
  -- Facilities
  ('5610', 'Maintenance & repair - Building', 'Maintenance & repair - Building', 'expense', (SELECT id FROM p WHERE code='GRP-FACIL'), 1510),
  ('5611', 'Maintenance & repair - Equipment', 'Maintenance & repair - Equipment', 'expense', (SELECT id FROM p WHERE code='GRP-FACIL'), 1511),
  ('5612', 'Maintenance & repair - Projector', 'Maintenance & repair - Projector', 'expense', (SELECT id FROM p WHERE code='GRP-FACIL'), 1512),
  ('5620', 'Electric', 'Electric', 'expense', (SELECT id FROM p WHERE code='GRP-UTIL'), 1551),
  ('5621', 'Garbage', 'Garbage', 'expense', (SELECT id FROM p WHERE code='GRP-UTIL'), 1552),
  ('5622', 'Water', 'Water', 'expense', (SELECT id FROM p WHERE code='GRP-UTIL'), 1553),
  -- Fundraising
  ('5710', 'Fundraising Expenses', 'Fundraising Expenses', 'expense', NULL, 1750),
  -- G&A
  ('5810', 'Bank fees', 'Bank fees & service charges', 'expense', (SELECT id FROM p WHERE code='GRP-BANK'), 1611),
  ('5811', 'Square Fees', 'Square Fees', 'expense', (SELECT id FROM p WHERE code='GRP-BANK'), 1612),
  ('5820', 'Board development', 'Board development', 'expense', (SELECT id FROM p WHERE code='GRP-GA'), 1620),
  ('5830', 'Accounting fees', 'Accounting fees', 'expense', (SELECT id FROM p WHERE code='GRP-CPF'), 1621),
  ('5840', 'Gifts/Cards', 'Gifts/Cards', 'expense', (SELECT id FROM p WHERE code='GRP-GA'), 1622),
  ('5850', 'Insurance', 'Insurance', 'expense', (SELECT id FROM p WHERE code='GRP-GA'), 1623),
  ('5860', 'Memberships & subscriptions (general)', 'Memberships & subscriptions', 'expense', (SELECT id FROM p WHERE code='GRP-MEM'), 1631),
  ('5861', 'Music Licensing', 'Music Licensing', 'expense', (SELECT id FROM p WHERE code='GRP-MEM'), 1632),
  ('5870', 'Internet', 'Internet', 'expense', (SELECT id FROM p WHERE code='GRP-OFFICE'), 1641),
  ('5871', 'Phone services', 'Phone services', 'expense', (SELECT id FROM p WHERE code='GRP-OFFICE'), 1642),
  ('5872', 'Shipping & postage', 'Shipping & postage', 'expense', (SELECT id FROM p WHERE code='GRP-OFFICE'), 1643),
  ('5873', 'Software & apps', 'Software & apps', 'expense', (SELECT id FROM p WHERE code='GRP-OFFICE'), 1644),
  ('5874', 'Website', 'Website', 'expense', (SELECT id FROM p WHERE code='GRP-OFFICE'), 1645),
  ('5880', 'Permits & licenses', 'Permits & licenses', 'expense', (SELECT id FROM p WHERE code='GRP-GA'), 1646),
  ('5890', 'Professional development (general)', 'Professional development', 'expense', (SELECT id FROM p WHERE code='GRP-PROFDEV'), 1651),
  ('5891', 'Meetings', 'Meetings', 'expense', (SELECT id FROM p WHERE code='GRP-PROFDEV'), 1652),
  ('5892', 'Research', 'Research', 'expense', (SELECT id FROM p WHERE code='GRP-PROFDEV'), 1653),
  ('5893', 'Staff training and development', 'Staff training and development', 'expense', (SELECT id FROM p WHERE code='GRP-PROFDEV'), 1654),
  ('5894', 'Small tools & equipment', 'Small tools & equipment', 'expense', (SELECT id FROM p WHERE code='GRP-GA'), 1655),
  ('5900', 'Cleaning Supplies', 'Cleaning Supplies', 'expense', (SELECT id FROM p WHERE code='GRP-SUPPLY'), 1661),
  ('5901', 'Hardware', 'Hardware', 'expense', (SELECT id FROM p WHERE code='GRP-SUPPLY'), 1662),
  ('5902', 'Office supplies', 'Office supplies', 'expense', (SELECT id FROM p WHERE code='GRP-SUPPLY'), 1663),
  ('5903', 'Other supplies & materials', 'Other supplies & materials', 'expense', (SELECT id FROM p WHERE code='GRP-SUPPLY'), 1664),
  ('5904', 'Paper Products', 'Paper Products', 'expense', (SELECT id FROM p WHERE code='GRP-SUPPLY'), 1665),
  -- Payroll
  ('6010', 'Payroll Tax Expense', 'Payroll Tax Expense', 'expense', (SELECT id FROM p WHERE code='GRP-PAYROLL'), 1701),
  ('6011', 'Executive Director', 'Executive Director', 'expense', (SELECT id FROM p WHERE code='GRP-SALARY'), 1711),
  ('6012', 'Marketing Director', 'Marketing Director', 'expense', (SELECT id FROM p WHERE code='GRP-SALARY'), 1712),
  ('6013', 'Operations Manager', 'Operations Manager', 'expense', (SELECT id FROM p WHERE code='GRP-SALARY'), 1713),
  ('6014', 'Wages (hourly)', 'Wages (hourly)', 'expense', (SELECT id FROM p WHERE code='GRP-SALARY'), 1714),
  ('6015', 'Wages (other)', 'Wages', 'expense', (SELECT id FROM p WHERE code='GRP-PAYROLL'), 1715),
  -- Other
  ('6110', 'Reimbursements', 'Reimbursements', 'expense', NULL, 1800),
  ('6120', 'Sales Tax Paid', 'Sales Tax', 'expense', NULL, 1810),
  -- Other revenue
  ('7010', 'Bank Interest Earned', 'Bank Interest Earned', 'other_income', NULL, 2000),
  ('7011', 'Unrealized Gains/Losses', 'Unrealized Gains/Losses', 'other_income', NULL, 2001),
  -- Capital
  ('8010', 'Capital Expenditures (general)', 'Capital Expenditures', 'other_expense', (SELECT id FROM p WHERE code='GRP-CAPITAL'), 1910),
  ('8011', 'EOY Letters (Capital)', 'EOY Letters (Capital)', 'other_income', (SELECT id FROM p WHERE code='GRP-CAPITAL'), 1911),
  ('8012', 'Fall Banquet Income', 'Fall Banquet Income', 'other_income', (SELECT id FROM p WHERE code='GRP-CAPITAL'), 1912),
  ('8013', 'Fundraising Expenses (Capital)', 'Fundraising Expenses', 'other_expense', (SELECT id FROM p WHERE code='GRP-CAPITAL'), 1913),
  ('8014', 'Grants Income - Capital', 'Grants Income - Capital', 'other_income', (SELECT id FROM p WHERE code='GRP-CAPITAL'), 1914),
  ('8015', 'Marquee Restoration (Restricted) - Capital', 'Marquee Restoration (Restricted donations) - Capital', 'other_income', (SELECT id FROM p WHERE code='GRP-CAPITAL'), 1915),
  ('8016', 'Unrestricted Donations - Capital', 'Unrestricted Donations - Capital', 'other_income', (SELECT id FROM p WHERE code='GRP-CAPITAL'), 1916);

-- ============================================================
-- Seed default mappings
-- ============================================================

WITH a AS (SELECT id, code FROM public.chart_of_accounts)
INSERT INTO public.account_mappings (source_type, source_key, account_id, is_default) VALUES
  -- Ticket types
  ('ticket_type', 'film',        (SELECT id FROM a WHERE code='4710'), true),
  ('ticket_type', 'live_event',  (SELECT id FROM a WHERE code='4711'), false),
  ('ticket_type', 'met_live',    (SELECT id FROM a WHERE code='4712'), false),
  ('ticket_type', 'nt_live',     (SELECT id FROM a WHERE code='4713'), false),
  -- Pass types
  ('pass_type', 'film_pass',          (SELECT id FROM a WHERE code='4610'), true),
  ('pass_type', 'met_live_pass',      (SELECT id FROM a WHERE code='4611'), false),
  ('pass_type', 'movie_night_gift',   (SELECT id FROM a WHERE code='4612'), false),
  ('pass_type', 'silent_film_fest',   (SELECT id FROM a WHERE code='4613'), false),
  -- Concessions
  ('concession_category', '_all', (SELECT id FROM a WHERE code='4410'), true),
  ('discount', 'concessions',     (SELECT id FROM a WHERE code='4411'), false),
  ('discount', 'merchandise',     (SELECT id FROM a WHERE code='4511'), false),
  ('discount', 'rental_nonprofit',(SELECT id FROM a WHERE code='4314'), false),
  -- Merch
  ('merch_item', '_all', (SELECT id FROM a WHERE code='4510'), true),
  -- Rentals
  ('rental_line_kind', 'general',        (SELECT id FROM a WHERE code='4310'), true),
  ('rental_line_kind', 'live_theater',   (SELECT id FROM a WHERE code='4311'), false),
  ('rental_line_kind', 'renter_fee',     (SELECT id FROM a WHERE code='4312'), false),
  ('rental_line_kind', 'film_licensing', (SELECT id FROM a WHERE code='4313'), false),
  ('rental_line_kind', 'poster_print',   (SELECT id FROM a WHERE code='4315'), false),
  ('rental_line_kind', 'rental_tickets', (SELECT id FROM a WHERE code='4316'), false),
  ('rental_line_kind', 'marquee',        (SELECT id FROM a WHERE code='4317'), false),
  -- Donations
  ('donation_designation', 'individual',          (SELECT id FROM a WHERE code='4011'), true),
  ('donation_designation', 'business',            (SELECT id FROM a WHERE code='4010'), false),
  ('donation_designation', 'monthly',             (SELECT id FROM a WHERE code='4012'), false),
  ('donation_designation', 'jar',                 (SELECT id FROM a WHERE code='4013'), false),
  ('donation_designation', 'marquee_restoration', (SELECT id FROM a WHERE code='8015'), false),
  ('donation_designation', 'eoy_capital',         (SELECT id FROM a WHERE code='8011'), false),
  ('donation_designation', 'unrestricted_capital',(SELECT id FROM a WHERE code='8016'), false),
  ('donation_designation', 'fall_banquet',        (SELECT id FROM a WHERE code='8012'), false),
  -- Sponsorships
  ('sponsorship_program', 'film',                (SELECT id FROM a WHERE code='4211'), true),
  ('sponsorship_program', 'black_history_month', (SELECT id FROM a WHERE code='4210'), false),
  ('sponsorship_program', 'live_event',          (SELECT id FROM a WHERE code='4212'), false),
  ('sponsorship_program', 'met_live',            (SELECT id FROM a WHERE code='4213'), false),
  ('sponsorship_program', 'saturday_cartoons',   (SELECT id FROM a WHERE code='4214'), false),
  ('sponsorship_program', 'silent_film_fest',    (SELECT id FROM a WHERE code='4215'), false),
  ('sponsorship_program', 'summer_family_matinee',(SELECT id FROM a WHERE code='4216'), false),
  -- Other revenue
  ('tip', '_all',        (SELECT id FROM a WHERE code='4820'), true),
  ('sales_tax', 'collected', (SELECT id FROM a WHERE code='4810'), true),
  ('sales_tax', 'paid',      (SELECT id FROM a WHERE code='6120'), false),
  ('grant_program', 'operating', (SELECT id FROM a WHERE code='4020'), true),
  ('grant_program', 'capital',   (SELECT id FROM a WHERE code='8014'), false),
  ('refund', '_all',     (SELECT id FROM a WHERE code='4690'), true),
  ('interest', '_all',   (SELECT id FROM a WHERE code='7010'), true),
  -- Expenses
  ('expense_category', 'online_marketing',   (SELECT id FROM a WHERE code='5110'), false),
  ('expense_category', 'other_advertising',  (SELECT id FROM a WHERE code='5111'), false),
  ('expense_category', 'print_marketing',    (SELECT id FROM a WHERE code='5112'), false),
  ('expense_category', 'concessions_cogs',   (SELECT id FROM a WHERE code='5210'), false),
  ('expense_category', 'artist_fees',        (SELECT id FROM a WHERE code='5310'), false),
  ('expense_category', 'sound_tech',         (SELECT id FROM a WHERE code='5311'), false),
  ('expense_category', 'met_live_prog',      (SELECT id FROM a WHERE code='5410'), false),
  ('expense_category', 'nt_live_prog',       (SELECT id FROM a WHERE code='5411'), false),
  ('expense_category', 'hospitality',        (SELECT id FROM a WHERE code='5420'), false),
  ('expense_category', 'other_event',        (SELECT id FROM a WHERE code='5421'), true),
  ('expense_category', 'silent_film_fest',   (SELECT id FROM a WHERE code='5422'), false),
  ('expense_category', 'dvd_bluray',         (SELECT id FROM a WHERE code='5510'), false),
  ('expense_category', 'film_booking',       (SELECT id FROM a WHERE code='5511'), false),
  ('expense_category', 'film_licensing',     (SELECT id FROM a WHERE code='5512'), false),
  ('expense_category', 'film_shipping',      (SELECT id FROM a WHERE code='5513'), false),
  ('expense_category', 'maint_building',     (SELECT id FROM a WHERE code='5610'), false),
  ('expense_category', 'maint_equipment',    (SELECT id FROM a WHERE code='5611'), false),
  ('expense_category', 'maint_projector',    (SELECT id FROM a WHERE code='5612'), false),
  ('expense_category', 'electric',           (SELECT id FROM a WHERE code='5620'), false),
  ('expense_category', 'garbage',            (SELECT id FROM a WHERE code='5621'), false),
  ('expense_category', 'water',              (SELECT id FROM a WHERE code='5622'), false),
  ('expense_category', 'bank_fees',          (SELECT id FROM a WHERE code='5810'), false),
  ('expense_category', 'square_fees',        (SELECT id FROM a WHERE code='5811'), false),
  ('expense_category', 'accounting',         (SELECT id FROM a WHERE code='5830'), false),
  ('expense_category', 'insurance',          (SELECT id FROM a WHERE code='5850'), false),
  ('expense_category', 'memberships',        (SELECT id FROM a WHERE code='5860'), false),
  ('expense_category', 'music_licensing',    (SELECT id FROM a WHERE code='5861'), false),
  ('expense_category', 'internet',           (SELECT id FROM a WHERE code='5870'), false),
  ('expense_category', 'phone',              (SELECT id FROM a WHERE code='5871'), false),
  ('expense_category', 'shipping_postage',   (SELECT id FROM a WHERE code='5872'), false),
  ('expense_category', 'software',           (SELECT id FROM a WHERE code='5873'), false),
  ('expense_category', 'website',            (SELECT id FROM a WHERE code='5874'), false),
  ('expense_category', 'permits',            (SELECT id FROM a WHERE code='5880'), false),
  ('expense_category', 'small_tools',        (SELECT id FROM a WHERE code='5894'), false),
  ('expense_category', 'cleaning_supplies',  (SELECT id FROM a WHERE code='5900'), false),
  ('expense_category', 'office_supplies',    (SELECT id FROM a WHERE code='5902'), false),
  ('expense_category', 'paper_products',     (SELECT id FROM a WHERE code='5904'), false),
  ('expense_category', 'reimbursements',     (SELECT id FROM a WHERE code='6110'), false),
  ('expense_category', 'fundraising',        (SELECT id FROM a WHERE code='5710'), false),
  ('expense_category', 'charitable',         (SELECT id FROM a WHERE code='5010'), false),
  ('payroll_category', 'tax',                (SELECT id FROM a WHERE code='6010'), true),
  ('payroll_category', 'executive_director', (SELECT id FROM a WHERE code='6011'), false),
  ('payroll_category', 'marketing_director', (SELECT id FROM a WHERE code='6012'), false),
  ('payroll_category', 'ops_manager',        (SELECT id FROM a WHERE code='6013'), false),
  ('payroll_category', 'hourly',             (SELECT id FROM a WHERE code='6014'), false),
  ('payroll_category', 'other',              (SELECT id FROM a WHERE code='6015'), false);

CREATE TRIGGER qbo_conn_updated_at BEFORE UPDATE ON public.qbo_connection
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER qbo_jobs_updated_at BEFORE UPDATE ON public.qbo_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
