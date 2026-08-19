-- Record the sales tax on a pass separately from the revenue.
--
-- Passes are taxed at purchase now (20260819040000 moved the tax off the
-- redemption). That created an accounting problem the moment it shipped: the
-- QBO export books film_pass_orders.amount_paid as pass revenue
-- (src/components/admin/accounting/QboExportTab.tsx:201), and amount_paid is what
-- the buyer was CHARGED — tax included. Six percent of every pass sale would be
-- booked as income and never appear as tax payable.
--
-- The same export already does this correctly for tickets: it books the net and
-- sends tax_amount to the 'sales_tax'/'collected' account. Passes need the same
-- two numbers, so they need somewhere to keep the second one.
--
--   film_pass_orders.tax_amount  — tax inside amount_paid, for an online order.
--   user_film_passes.tax_paid    — tax on top of price_paid, for a counter sale.
--
-- Note the two are shaped differently, deliberately and to match what each
-- column already means. amount_paid is the gross charge, so its tax is
-- contained; price_paid is what the pass sold for pre-tax, so its tax is
-- additional. Changing either meaning would silently rewrite the history already
-- in those columns.
--
-- Both default 0, which is exactly right for every row written before the tax
-- existed: those sales genuinely collected none.

ALTER TABLE public.film_pass_orders
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.user_film_passes
  ADD COLUMN IF NOT EXISTS tax_paid numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.film_pass_orders.tax_amount IS
  'Sales tax CONTAINED IN amount_paid. Revenue is amount_paid - tax_amount. '
  '0 for orders predating taxed pass sales, which collected none.';

COMMENT ON COLUMN public.user_film_passes.tax_paid IS
  'Sales tax collected ON TOP OF price_paid at a counter sale. The buyer handed '
  'over price_paid + tax_paid. 0 for passes predating taxed pass sales.';

ALTER TABLE public.film_pass_orders
  DROP CONSTRAINT IF EXISTS film_pass_orders_tax_amount_check;
ALTER TABLE public.film_pass_orders
  ADD CONSTRAINT film_pass_orders_tax_amount_check CHECK (tax_amount >= 0);

ALTER TABLE public.user_film_passes
  DROP CONSTRAINT IF EXISTS user_film_passes_tax_paid_check;
ALTER TABLE public.user_film_passes
  ADD CONSTRAINT user_film_passes_tax_paid_check CHECK (tax_paid >= 0);
