-- The row trigger as production has it (created in 20260402052623; only the
-- function has been replaced since). Installed after the OLD function so the
-- baseline below is captured under the old rule.
CREATE TRIGGER enforce_ticket_pricing_on_insert
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_pricing();

-- What the OLD trigger stores for every 50-cent price from $0.50 to $100, four
-- tickets an order. order_tax_test.sql replays the same inserts under the new
-- rule and requires identical rows: the "no-op at today's prices" claim, tested
-- rather than argued.
CREATE TABLE public.baseline AS
WITH s AS (
  INSERT INTO public.showings (ticket_price)
  SELECT c / 100.0 FROM generate_series(50, 10000, 50) c
  RETURNING id, ticket_price
), t AS (
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, order_token)
  SELECT s.id, 0, 0, 0, 'base-' || s.ticket_price FROM s, generate_series(1, 4)
  RETURNING showing_id, price, tax_amount, total_price
)
SELECT DISTINCT price, tax_amount, total_price FROM t;
