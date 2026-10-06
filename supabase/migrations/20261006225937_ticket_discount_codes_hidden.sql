-- Promo-code discount rules are not readable by the public.
-- BRIEF-sec-rls-regressions (audit 2026-10-06 L19).
--
-- ticket_discounts.code is reserved for promo codes. Pricing ignores coded
-- rules today, but the public policy showed every active rule, code included,
-- so the day codes ship every one of them would be one GET away.
--
-- A column grant cannot fix this: src/lib/discounts.ts selects `code` as anon
-- precisely to drop coded rules from the preview (usableRules filters
-- `!r.code`), and a select naming a withheld column fails outright, which
-- would silently turn every discount preview into full price. Filtering the
-- rows instead keeps that select working and returns the public only rules
-- whose code is NULL — which are the only rules the preview uses anyway.
-- Staff and admins still see every rule. price_ticket_order reads the table as
-- SECURITY DEFINER and is unaffected.

DROP POLICY IF EXISTS "Anyone can view active ticket discounts" ON public.ticket_discounts;
CREATE POLICY "Anyone can view active ticket discounts"
  ON public.ticket_discounts FOR SELECT
  USING (
    (is_active = true AND code IS NULL)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'staff'::app_role)
  );
